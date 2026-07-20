// Kimi 桌宠 · 主进程
// 透明无边框小窗，置顶悬浮；宠物"走路"= 窗口本身在屏幕上平移
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { aggregate, effectiveState, STALE_TTL } = require('./agent-state.cjs');
const { spawn } = require('child_process');

// 单实例锁：桌宠不需要双胞胎，重复启动直接退出（误双击/重复 npm start 都不会下崽）
// KIMI_PET_ALLOW_MULTI=1 放行：测试场景需要与常驻实例并存的隔离实例时用
if (process.env.KIMI_PET_ALLOW_MULTI !== '1' && !app.requestSingleInstanceLock()) app.quit();

const SIZE = 240; // 基准边长（正方形，宠物住在底部，上方留白给气泡和 zzz）
const MIN_SCALE = 0.4, MAX_SCALE = 2.5; // 滚轮缩放的上下限（96px ~ 600px）
let win = null;
let tray = null;
let scale = 1;     // 当前缩放倍数，实际窗口边长 = SIZE * scale
let mode = 'kolo'; // 行为模式：stay 乖乖待着 / kolo 到处乱跑（kimi only live once）
let dblAction = 'terminal'; // 双击动作：terminal 开 Kimi Code 终端 / website 开官网
let lastSessions = []; // 最近一次聚合出的活跃会话清单（菜单"会话状态"用）
// 会话状态的中文名（菜单明细用）
const SESSION_LABEL = { working: '在忙', searching: '搜索中', thinking: '思考中', permission: '等你批准', ask: '问你问题', done: '刚搞定', error: '出错了', idle: '空闲' };

// 持久化：记住上次的大小和位置（userData/settings.json）
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!win) return;
    const [x, y] = win.getPosition();
    // 合并保留其他键（如 agentLinkInstalled），不整个覆盖
    fs.writeFile(settingsFile(), JSON.stringify({ ...loadSettings(), scale, x, y, mode, dblclick: dblAction }), () => {});
  }, 400);
}

// Kimi Code 联动自动安装：逻辑在 agent-hook.cjs（纯 Node 模块，可单测），这里只负责接线
const { ensureAgentHook: installAgentHook } = require('./agent-hook.cjs');
function ensureAgentHook() {
  installAgentHook({
    kimiHome: process.env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code'),
    hookSrc: path.join(__dirname, 'pet-hook.cjs'),
    loadSettings,
    // 合并保留其他键（scale/x/y/mode），不整个覆盖
    patchSettings: (patch) => fs.writeFileSync(settingsFile(), JSON.stringify({ ...loadSettings(), ...patch })),
  });
}

// 切换行为模式并通报渲染层
function setMode(m) {
  mode = m;
  if (win) win.webContents.send('set-mode', m);
  saveSettings();
}

// 切换双击动作（terminal 开终端 / website 开官网）
function setDblAction(a) {
  dblAction = a;
  saveSettings();
}

// 调整大小：窗口等比缩放 + 页面同步 zoom，位置钳回屏幕内
// fx/fy 为缩放锚点（窗口内相对位置 0~1，默认中心），缩放前后锚点在屏幕上的位置不变
function setScale(s, fx = 0.5, fy = 0.5) {
  if (!win) return;
  s = Math.min(Math.max(s, MIN_SCALE), MAX_SCALE);
  if (s === scale) return;
  const oldSize = win.getSize()[0];
  scale = s;
  const size = Math.round(SIZE * s);
  const area = screen.getPrimaryDisplay().workArea;
  let [x, y] = win.getPosition();
  x += fx * (oldSize - size);
  y += fy * (oldSize - size);
  x = Math.max(area.x, Math.min(x, area.x + area.width - size));
  y = Math.max(area.y, Math.min(y, area.y + area.height - size));
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: size, height: size });
  win.webContents.setZoomFactor(s);
  win.webContents.send('pet-scale', s);
  saveSettings();
}

// 菜单（右键和托盘共用；每次重建让"大小"选中态跟随当前 scale）
function buildMenu() {
  const sizeItems = [
    { label: '迷你 (120px)', s: 0.5 },
    { label: '小只 (180px)', s: 0.75 },
    { label: '标准 (240px)', s: 1 },
    { label: '大只 (360px)', s: 1.5 },
    { label: '巨大 (480px)', s: 2 }
  ].map(({ label, s }) => ({
    label, type: 'radio', checked: s === scale, click: () => setScale(s)
  }));
  return Menu.buildFromTemplate([
    { label: '打开 Kimi Code 终端', click: openKimiTerminal },
    // 通知样式（横幅/提醒）只能用户在系统设置改：帮他直接打开设置页（macOS 专属，Windows 没有这个概念）
    ...(process.platform === 'darwin' ? [{ label: '通知样式设置', click: () => spawn('open', ['x-apple.systempreferences:com.apple.preference.notifications'], { detached: true, stdio: 'ignore' }).unref() }] : []),
    { label: '大小', submenu: sizeItems },
    {
      label: '模式', submenu: [
        { label: 'stay', type: 'radio', checked: mode === 'stay', click: () => setMode('stay') },
        { label: 'kolo', type: 'radio', checked: mode === 'kolo', click: () => setMode('kolo') }
      ]
    },
    // 双击动作：开终端 or 开官网
    {
      label: '双击', submenu: [
        { label: '打开 Kimi Code 终端', type: 'radio', checked: dblAction === 'terminal', click: () => setDblAction('terminal') },
        { label: '打开官网', type: 'radio', checked: dblAction === 'website', click: () => setDblAction('website') }
      ]
    },
    // 会话状态明细：每个活跃 Kimi Code 会话一行（项目名 + 状态），纯展示
    {
      label: `会话状态（${lastSessions.length}）`,
      submenu: lastSessions.length
        ? lastSessions.map(x => ({ label: `「${x.proj || x.id}」${SESSION_LABEL[x.state] || x.state}`, enabled: false }))
        : [{ label: '（没有活跃会话）', enabled: false }]
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
}

// 双击/菜单：开一个 Kimi Code 终端（login shell 跑 kimi，PATH 走用户自己的配置）
const GHOSTTY_APP = '/Applications/Ghostty.app';
function openKimiTerminal() {
  try {
    if (process.platform === 'darwin') {
      if (fs.existsSync(GHOSTTY_APP)) {
        spawn(path.join(GHOSTTY_APP, 'Contents', 'MacOS', 'ghostty'),
          ['-e', process.env.SHELL || '/bin/zsh', '-lc', 'kimi'],
          { detached: true, stdio: 'ignore' }).unref();
      } else {
        installGhosttyThenOpen();
      }
      return;
    }
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', 'cmd', '/k', 'kimi'], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    console.log('[terminal] 打开终端失败:', e.message);
  }
}

// 没装 Ghostty：有 Homebrew 就自动装（装完自动开）；没 brew 就开可见终端引导装（需输一次密码）
function installGhosttyThenOpen() {
  const brew = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(p => fs.existsSync(p));
  if (!brew) {
    // Homebrew 安装必须用户输密码，没法后台静默装：开个可见终端跑完整脚本，输完密码全自动
    toast('装 brew 要密码', '弹出的终端里输入登录密码（输入时看不见字符是正常的），先装 Homebrew 再自动装 Ghostty，装完自动打开 Kimi Code 终端。', true);
    const scriptPath = path.join(os.tmpdir(), 'kimi-pet-install-ghostty.sh');
    fs.writeFileSync(scriptPath, [
      '#!/bin/bash',
      'set -e',
      '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
      'eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || eval "$(/usr/local/bin/brew shellenv)"',
      'brew install --cask ghostty',
      `/Applications/Ghostty.app/Contents/MacOS/ghostty -e "$SHELL" -lc kimi &`,
      'exit 0'
    ].join('\n'), { mode: 0o755 });
    spawn('open', ['-a', 'Terminal.app', scriptPath], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  toast('装 Ghostty 中…', '正在通过 Homebrew 安装 Ghostty，装完会自动打开 Kimi Code 终端。', true);
  const inst = spawn(brew, ['install', '--cask', 'ghostty'], { detached: true, stdio: 'ignore' });
  inst.on('close', (code) => {
    clearToast();
    if (code === 0 && fs.existsSync(GHOSTTY_APP)) openKimiTerminal();
    else toast('装失败了', 'Ghostty 自动安装失败，可以去 ghostty.org 手动下载安装。', true);
  });
}

// 气泡通报（短提示；sticky 时常驻等用户点掉）+ 需要行动/有详情时补一条系统通知
function toast(text, notify, sticky) {
  if (win) win.webContents.send('pet-toast', { text, sticky: !!sticky });
  if (notify && Notification.isSupported()) {
    new Notification({ title: 'Kimi 桌宠', body: notify }).show();
  }
}
// 清掉常驻气泡（比如装完 Ghostty 时收掉进度提示）
function clearToast() { if (win) win.webContents.send('pet-toast', { clear: true }); }

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;

  // 恢复上次的大小和模式；位置只有在某台显示器范围内才恢复，否则回默认右下角
  const st = loadSettings();
  scale = Math.min(Math.max(st.scale || 1, MIN_SCALE), MAX_SCALE);
  mode = st.mode === 'stay' ? 'stay' : 'kolo';
  dblAction = st.dblclick === 'website' ? 'website' : 'terminal';
  const size0 = Math.round(SIZE * scale);
  const onScreen = (x, y) => screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return x >= a.x && x + size0 <= a.x + a.width && y >= a.y && y + size0 <= a.y + a.height;
  });
  const pos = (Number.isFinite(st.x) && Number.isFinite(st.y) && onScreen(st.x, st.y))
    ? { x: Math.round(st.x), y: Math.round(st.y) }
    : { x: wa.x + wa.width - size0 - 60, y: wa.y + wa.height - size0 - 10 };

  win = new BrowserWindow({
    width: size0,
    height: size0,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 置顶到屏保级，基本压得住普通窗口；所有工作区可见
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // macOS：不占用 Dock 图标，做个安静的小透明
  if (app.dock) app.dock.hide();

  win.loadFile('index.html');

  // 窗口销毁后立即置空：退出流程中两个轮询定时器还在跑，不置空会向已销毁窗口发消息抛异常
  win.on('closed', () => { win = null; });

  // Electron 会按 origin 记住上次的页面 zoom，启动时强制同步回当前 scale，
  // 否则窗口尺寸(240)和 zoom(上次残留)脱节，拖拽/锚点换算全乱
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(scale);
    // 恢复持久化缩放时渲染层的 curScale 初值是错的(1)，必须主动通报，否则气泡补偿算错
    win.webContents.send('pet-scale', scale);
    // 同理，行为模式也要在启动时通报
    win.webContents.send('set-mode', mode);
  });

  // 光标位置轮询：渲染层收不到窗口外的鼠标事件，主进程代查屏幕坐标发过去（眼睛追踪 + 游走定位用）
  setInterval(() => {
    if (!win) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    win.webContents.send('cursor-pos', {
      x: p.x, y: p.y, wx: b.x + b.width / 2, wy: b.y + b.height / 2,
      area: screen.getPrimaryDisplay().workArea
    });
  }, 120);

  // Kimi Code 联动：每个会话一个状态文件，轮询整个目录聚合成全局状态转发渲染层
  // KIMI_PET_STATE_DIR 可覆盖路径：测试时用独立目录，避免被真实 hook 状态污染
  const agentStateDir = process.env.KIMI_PET_STATE_DIR || path.join(app.getPath('userData'), 'agent-state');
  // 旧版本的全局单状态文件已弃用，顺手清掉
  try { fs.rmSync(path.join(app.getPath('userData'), 'agent-state.json'), { force: true }); } catch {}
  let lastAgent = 'idle', lastSesSig = '[]';
  const lastEventTs = new Map(); // 会话 id → 上次见到的事件 ts（同状态新事件也要重新通报）
  setInterval(() => {
    if (!win) return;
    const now = Date.now();
    const sessions = [];
    let isNewEvent = false;
    let files = [];
    try { files = fs.readdirSync(agentStateDir); } catch {} // 目录不存在 = 没有任何会话活动
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      let s = null;
      try { s = JSON.parse(fs.readFileSync(path.join(agentStateDir, f), 'utf8')); } catch {}
      if (!s || !Number.isFinite(s.ts)) continue;
      if (effectiveState(s, now).stale) { // 死会话残留（关终端没发 SessionEnd），清掉
        try { fs.rmSync(path.join(agentStateDir, f), { force: true }); } catch {}
        lastEventTs.delete(id);
        continue;
      }
      if (lastEventTs.get(id) !== s.ts) { lastEventTs.set(id, s.ts); isNewEvent = true; }
      sessions.push({ ...s, id });
    }
    const { state, ts } = aggregate(sessions, now);
    // 渲染层用的会话清单（指示点/完成播报/菜单明细）：所有活着的会话（含空闲），死会话已在上面的循环清掉
    const sesList = sessions
      .map(s => ({ id: s.id, proj: s.proj || '', state: effectiveState(s, now).state }));
    const sesSig = JSON.stringify(sesList);
    lastSessions = sesList;
    // 清单变化（会话完成/过期退场）即使没有新事件也要通报，否则徽标和菜单会过期
    if (state !== lastAgent || isNewEvent || sesSig !== lastSesSig) {
      lastAgent = state;
      lastSesSig = sesSig;
      win.webContents.send('agent-state', { state, ts, sessions: sesList });
    }
  }, 500);

  // 滚轮缩放：往上滚变大，往下滚变小，步进 8%，以鼠标位置为锚点
  // ax/ay 与 vw/vh 同为渲染层视口坐标，相除即锚点相对位置，与 zoom 坐标语义无关
  ipcMain.on('pet-resize', (event, { dy, ax, ay, vw, vh }) => {
    if (!win || !vw || !vh || !dy) return; // dy=0（横向滚动等）不该触发缩放
    let next = Math.round(scale * (dy < 0 ? 1.08 : 1 / 1.08) * 100) / 100;
    if (next > 0.94 && next < 1.06) next = 1; // 经过标准尺寸附近时吸附，方便回正
    setScale(next, ax / vw, ay / vh);
  });

  // 右键菜单
  win.webContents.on('context-menu', (e) => {
    e.preventDefault();
    buildMenu().popup({ window: win });
  });

  // 位置变化持久化（拖拽/走路/钳制都会触发，已防抖）
  win.on('move', saveSettings);

  // 宠物走一步：窗口平移 {dx,dy}，撞到屏幕边缘则按轴回报反弹
  // 分量可能不足 1px（小体型拆细步），小数部分按轴累积进下一步，避免取整偏差
  let stepFracX = 0, stepFracY = 0;
  ipcMain.on('pet-step', (event, { dx, dy }) => {
    if (!win || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const [x, y] = win.getPosition();
    const size = win.getSize()[0];
    const area = screen.getPrimaryDisplay().workArea;
    stepFracX += dx; stepFracY += dy;
    const mx = Math.trunc(stepFracX), my = Math.trunc(stepFracY);
    stepFracX -= mx; stepFracY -= my;
    let nx = x + mx, ny = y + my;
    let flipX = false, flipY = false;
    if (nx <= area.x) { nx = area.x; flipX = true; }
    if (nx >= area.x + area.width - size) { nx = area.x + area.width - size; flipX = true; }
    if (ny <= area.y) { ny = area.y; flipY = true; }
    if (ny >= area.y + area.height - size) { ny = area.y + area.height - size; flipY = true; }
    win.setPosition(nx, ny);
    event.reply('pet-step-done', { flipX, flipY });
  });

  // 拖拽开始：主进程记下窗口当前位置
  let dragOrigin = null;
  ipcMain.on('pet-drag-start', () => {
    if (!win) return;
    dragOrigin = { x: win.getPosition()[0], y: win.getPosition()[1], size: win.getSize()[0] };
  });
  // 拖拽：dx/dy 是鼠标在屏幕坐标系的绝对位移，直接叠加到按下时的窗口位置。
  // 不能用 clientX：它相对窗口，窗口一动就产生反馈（实测只跟得上一半）
  ipcMain.on('pet-drag', (event, { dx, dy }) => {
    // 防御 NaN/undefined：非鼠标指针事件可能不带屏幕坐标，setPosition 收到 NaN 会直接抛异常
    if (!win || !dragOrigin || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    win.setPosition(Math.round(dragOrigin.x + dx), Math.round(dragOrigin.y + dy));
  });

  // 双击：按用户设置开终端或开官网
  ipcMain.on('pet-open-terminal', () => {
    if (dblAction === 'website') shell.openExternal('https://www.kimi.com');
    else openKimiTerminal();
  });

  // 调试用：回报主进程权威状态（自动化测试断言用）
  ipcMain.handle('pet-debug-state', () => ({
    scale,
    mode,
    bounds: win ? win.getBounds() : null,
    zoom: win ? win.webContents.getZoomFactor() : null,
    area: screen.getPrimaryDisplay().workArea,
    trayBounds: tray ? tray.getBounds() : null
  }));
  // 调试用：测试时屏蔽用户鼠标干扰（窗口变点击穿透）
  ipcMain.handle('pet-debug-ignore-mouse', (_e, flag) => {
    if (win) win.setIgnoreMouseEvents(!!flag);
  });
  // 调试用：重置 agent 状态跟踪（长测试套件里让用例互不污染）
  ipcMain.handle('pet-debug-reset-agent', () => { lastAgent = 'idle'; lastSesSig = '[]'; lastEventTs.clear(); });
}

app.whenReady().then(() => {
  ensureAgentHook(); // Kimi Code 联动：有则装，无则跳过，手动卸过尊重
  createWindow();

  // 托盘：macOS 菜单栏 / Windows 系统托盘，和右键同一套菜单
  // 44px 图必须声明 scaleFactor=2 按 22pt 渲染，否则 macOS 当 @1x 显示整整大一倍
  // template image：macOS 按菜单栏明暗自动上色（深底白、浅底黑），Windows 忽略此设置
  const trayImg = nativeImage.createFromBuffer(
    fs.readFileSync(path.join(__dirname, 'assets', 'tray.png')), { scaleFactor: 2 });
  trayImg.setTemplateImage(true);
  tray = new Tray(trayImg);
  tray.setToolTip('Kimi 桌宠');
  const popMenu = () => tray.popUpContextMenu(buildMenu());
  tray.on('click', popMenu);
  tray.on('right-click', popMenu);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// 退出前把状态同步落盘（日常防抖 400ms，退出时可能等不到；合并保留其他键）
app.on('before-quit', () => {
  clearTimeout(saveTimer);
  if (!win) return;
  const [x, y] = win.getPosition();
  try { fs.writeFileSync(settingsFile(), JSON.stringify({ ...loadSettings(), scale, x, y, mode, dblclick: dblAction })); } catch {}
});
