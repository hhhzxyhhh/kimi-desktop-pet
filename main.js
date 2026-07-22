// Kimi 桌宠 · 主进程
// 透明无边框小窗，置顶悬浮；宠物"走路"= 窗口本身在屏幕上平移
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { aggregate, effectiveState, needsReminder, STALE_TTL, REMIND_MAX_AGE } = require('./agent-state.cjs');
const { clampWindow, clampStep, clampToRect, nearestArea } = require('./display-areas.cjs');
const { applyStationaryCollectionBehavior } = require('./mac-window.cjs');
const { spawn } = require('child_process');

// 统一 userData：打包版 productName 是"Kimi桌宠"（默认 userData 会跟着变），
// 不统一到固定目录的话，hook 写入的联动状态和打包版读的目录会对不上
app.setPath('userData', path.join(app.getPath('appData'), 'kimi-desktop-pet'));

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
let remindMin = 0; // 超强提醒（分钟）：permission/ask 超时没人理就闪现到光标旁蹦跶；0=关
// 坐标数值守卫：NaN 和 INT_MIN 之类的哨兵/溢出值都会让 setPosition/setBounds 抛异常
const saneCoord = (v) => Number.isFinite(v) && Math.abs(v) < 100000;
// 进程探活：kill(pid, 0)，ESRCH=死了，EPERM=活着但无权（也算活）
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}
// setPosition 防弹衣：崩溃改成记日志（连同肇事值），异常对话框不再吓用户
function safeSetPosition(tag, x, y) {
  try { win.setPosition(x, y); }
  catch (e) { console.log(`[setPosition:${tag}] 拒绝执行 (${x}, ${y}):`, e.message); }
}
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
    fs.writeFile(settingsFile(), JSON.stringify({ ...loadSettings(), scale, x, y, mode, dblclick: dblAction, remindMin, ignoredSessions: [...ignoredSessions] }), () => {});
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

// 切换超强提醒超时（分钟，0=关）
function setRemindMin(m) {
  remindMin = m;
  saveSettings();
}

// 按会话忽略监控：忽略的会话不出点、不参与聚合/提醒；只隐藏，不影响会话本身
let ignoredSessions = new Set();
function toggleIgnoreSession(id) {
  if (!id) return;
  ignoredSessions.has(id) ? ignoredSessions.delete(id) : ignoredSessions.add(id);
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
  let [x, y] = win.getPosition();
  if (!saneCoord(x) || !saneCoord(y)) return; // 显示器热插拔重配置时读数可能是 NaN/哨兵值
  x += fx * (oldSize - size);
  y += fy * (oldSize - size);
  // 多屏：钳进窗口中心最近的显示器工作区
  const c = clampWindow(screen.getAllDisplays().map(d => d.workArea), x, y, size);
  try {
    win.setBounds({ x: Math.round(c.x), y: Math.round(c.y), width: size, height: size });
  } catch (e) {
    console.log('[setScale] 拒绝执行:', e.message); // 显示器重配置时 workArea 可能是坏值
    return;
  }
  win.webContents.setZoomFactor(s);
  win.webContents.send('pet-scale', s);
  saveSettings();
}

// 菜单（右键和托盘共用）
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '打开 Kimi Code 终端', click: openKimiTerminal },
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
    // 超强提醒：permission/ask 超时没人理，闪现到光标旁上蹿下跳
    {
      label: '超强提醒', submenu: [
        { label: '关', type: 'radio', checked: remindMin === 0, click: () => setRemindMin(0) },
        { label: '1 分钟', type: 'radio', checked: remindMin === 1, click: () => setRemindMin(1) },
        { label: '5 分钟', type: 'radio', checked: remindMin === 5, click: () => setRemindMin(5) },
        { label: '10 分钟', type: 'radio', checked: remindMin === 10, click: () => setRemindMin(10) }
      ]
    },
    // 开机自启：状态以系统为准（登录项是 OS 存的）
    {
      label: '开机自启', submenu: [
        { label: '开', type: 'radio', checked: app.getLoginItemSettings().openAtLogin, click: () => app.setLoginItemSettings({ openAtLogin: true }) },
        { label: '关', type: 'radio', checked: !app.getLoginItemSettings().openAtLogin, click: () => app.setLoginItemSettings({ openAtLogin: false }) }
      ]
    },
    // 会话状态明细：悬停展开二级目录——打开终端 / 取消监控（取消后隐身，有活动自动回来）；同项目多窗带 id 后缀区分
    {
      label: `会话状态（${lastSessions.length}）`,
      submenu: lastSessions.length
        ? lastSessions.map(x => {
            const dup = lastSessions.filter(y => y.proj && y.proj === x.proj).length > 1;
            const name = `「${x.proj || x.id}${dup ? ' ·' + x.id.slice(-4) : ''}」`;
            return {
              label: `${name}${SESSION_LABEL[x.state] || x.state}`,
              submenu: [
                { label: '打开终端', click: () => openSessionTerminal(x.id, x.cwd) },
                { label: '取消监控', click: () => toggleIgnoreSession(x.id) }
              ]
            };
          })
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

// 打开指定会话的终端（Ghostty 里 kimi --session 恢复）
function openSessionTerminal(id, cwd) {
  try {
    if (!/^[\w-]+$/.test(String(id || ''))) return; // session id 只允许安全字符
    // shell 安全引号（单引号包裹 + 内部单引号转义），防目录名注入；Ghostty 不吃 spawn 的 cwd，必须 cd
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    if (process.platform === 'darwin') {
      if (!fs.existsSync(GHOSTTY_APP)) return;
      const cmd = cwd ? `cd ${q(cwd)} && kimi --session ${id}` : `kimi --session ${id}`;
      spawn(path.join(GHOSTTY_APP, 'Contents', 'MacOS', 'ghostty'),
        ['-e', process.env.SHELL || '/bin/zsh', '-lc', cmd],
        { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      const cmd = cwd ? `cd /d "${String(cwd).replace(/"/g, '""')}" & kimi --session ${id}` : `kimi --session ${id}`;
      spawn('cmd', ['/c', 'start', 'cmd', '/k', cmd], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    console.log('[open-session] 打开失败:', e.message);
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
  // 超强提醒超时：菜单只给 1/5/10；KIMI_PET_REMIND_MIN 是测试覆盖通道，设了就优先于设置文件
  remindMin = process.env.KIMI_PET_REMIND_MIN !== undefined
    ? (Number(process.env.KIMI_PET_REMIND_MIN) || 0)
    : ([1, 5, 10].includes(st.remindMin) ? st.remindMin : 0);
  ignoredSessions = new Set(Array.isArray(st.ignoredSessions) ? st.ignoredSessions : []);
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
    // macOS：panel 类型是浮动工具面板，台前调度不按普通文档窗口管理它（学 Clawd）
    ...(process.platform === 'darwin' ? { type: 'panel', roundedCorners: false } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 置顶到屏保级（mac-window 还会再抬到 1500），基本压得住普通窗口；所有工作区可见（含全屏 Space）
  // skipTransformProcessType：配合 dock.hide，避免切 Space 时窗口被短暂隐藏（学 Clawd）
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  // macOS 原生加固：豁免台前调度左侧保留区钳制 + 挪进 stationary 私有 Space（切 Space 动画不藏）
  const reapplyStationary = () => applyStationaryCollectionBehavior(win);
  reapplyStationary();

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
    reapplyStationary(); // 加载后 macOS 可能重置行为，补一刀（Clawd 的 event-level safety net 思路）
  });
  // 位置尺寸变化后 macOS 可能又把行为洗掉，周期兜底
  if (process.platform === 'darwin') setInterval(() => { if (win) reapplyStationary(); }, 10000);

  // 光标位置轮询：渲染层收不到窗口外的鼠标事件，主进程代查屏幕坐标发过去（眼睛追踪 + 游走定位用）
  // 省电：没有活跃会话时降频到 ~360ms，有会话活动保持 120ms
  let cursorTick = 0;
  setInterval(() => {
    if (!win) return;
    const active = lastSessions.some(x => x.state !== 'idle');
    if (!active && ++cursorTick % 3 !== 0) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    win.webContents.send('cursor-pos', {
      x: p.x, y: p.y, wx: b.x + b.width / 2, wy: b.y + b.height / 2,
      area: screen.getPrimaryDisplay().workArea,
      areas: screen.getAllDisplays().map(d => d.workArea) // 多屏全量工作区（散步选点用）
    });
  }, 120);

  // Kimi Code 联动：每个会话一个状态文件，轮询整个目录聚合成全局状态转发渲染层
  // KIMI_PET_STATE_DIR 可覆盖路径：测试时用独立目录，避免被真实 hook 状态污染
  const agentStateDir = process.env.KIMI_PET_STATE_DIR || path.join(app.getPath('userData'), 'agent-state');
  // 旧版本的全局单状态文件已弃用，顺手清掉
  try { fs.rmSync(path.join(app.getPath('userData'), 'agent-state.json'), { force: true }); } catch {}
  let lastAgent = 'idle', lastSesSig = '[]';
  const lastEventTs = new Map(); // 会话 id → 上次见到的事件 ts（同状态新事件也要重新通报）
  let reminding = false, lastRemindMove = 0; // 超强提醒状态与上次闪现时间
  let remindSuppressed = false;              // 拖拽中渲染层要求抑制闪现
  let remindOrigin = null, remindDragged = false; // 提醒进场前的位置 / 期间是否被用户拖过
  let lastRemindTarget = null;                    // 上次闪现落点（测试断言用）
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
      // 进程探活：hook 记录的调用方 pid 链全灭 = CLI 已死，直接清场（不等 TTL）
      const hasLivePid = Array.isArray(s.pids) && s.pids.length && s.pids.some(pidAlive);
      if (Array.isArray(s.pids) && s.pids.length && !hasLivePid) {
        try { fs.rmSync(path.join(agentStateDir, f), { force: true }); } catch {}
        lastEventTs.delete(id);
        continue;
      }
      // 超时清场只在没有活 pid 时生效：CLI 活着的会话（不管忙闲）一直保留；死了立即清场
      // 但 pid 被复用的死会话会误判"活着"：24h 保险丝兜底（正常任务碰不到）
      const e = effectiveState(s, now);
      if (e.stale && (!hasLivePid || now - s.ts > 24 * 3600 * 1000)) {
        try { fs.rmSync(path.join(agentStateDir, f), { force: true }); } catch {}
        lastEventTs.delete(id);
        continue;
      }
      const seenTs = lastEventTs.get(id);
      if (seenTs !== s.ts) {
        lastEventTs.set(id, s.ts); isNewEvent = true;
        // 被忽略的会话有"观察期间的新事件"才算又开始活动（启动时第一次见到不算，防重启全员恢复）
        if (seenTs !== undefined && ignoredSessions.delete(id)) saveSettings();
      }
      sessions.push({ ...s, id });
    }
    const { state, ts } = aggregate(sessions.filter(s => !ignoredSessions.has(s.id)), now);
    // 渲染层点清单与菜单明细同一份：都不含被忽略的（忽略即隐身，有活动自动回来）
    const sesList = sessions
      .map(s => ({ id: s.id, proj: s.proj || '', cwd: s.cwd || '', state: effectiveState(s, now).state }))
      .filter(x => !ignoredSessions.has(x.id));
    lastSessions = sesList;
    const sesSig = JSON.stringify(sesList) + JSON.stringify([...ignoredSessions]);
    // 超强提醒：有超时没人理的 permission/ask（不含被忽略的），就隔 ~1.2s 闪现到光标旁边
    const remind = remindMin > 0 && needsReminder(sessions.filter(s => !ignoredSessions.has(s.id)), now, remindMin * 60000);
    if (remind !== reminding) {
      reminding = remind;
      if (reminding) {
        remindOrigin = win.getPosition(); // 进场前记住家，散场送回去（闪现会改持久化位置）
        remindDragged = false;
        // 系统通知同步推一条：用户不看屏幕也能收到（取刚超龄的那个会话报项目名）
        const att = sessions.find(s => {
          const e = effectiveState(s, now);
          const age = now - s.ts;
          return !e.stale && ['permission', 'ask'].includes(e.state) && age > remindMin * 60000 && age < REMIND_MAX_AGE;
        });
        if (att && Notification.isSupported()) {
          new Notification({ title: 'Kimi 桌宠',
            body: `「${att.proj || '那边'}」${att.state === 'ask' ? '在问你问题' : '在等你批准'}，去看看吧` }).show();
        }
      } else if (remindOrigin && !remindDragged) {
        safeSetPosition("remind-restore", remindOrigin[0], remindOrigin[1]); // 没被用户拖走才送回，拖过就尊重新位置
      }
      remindOrigin = remind ? remindOrigin : null;
      win.webContents.send('super-remind', remind);
    }
    if (reminding && !remindSuppressed && now - lastRemindMove > 1200) {
      lastRemindMove = now;
      const p = screen.getCursorScreenPoint();
      const size = win.getSize()[0];
      // 光标附近随机落脚（别正压光标），多屏钳进光标所在屏
      const c = clampWindow(screen.getAllDisplays().map(d => d.workArea),
        p.x + (Math.random() - 0.5) * 160 - size / 2,
        p.y + (Math.random() - 0.5) * 120 - 40 - size / 2, size);
      lastRemindTarget = { x: Math.round(c.x), y: Math.round(c.y) };
      safeSetPosition("remind", lastRemindTarget.x, lastRemindTarget.y);
    }
    // 清单变化（会话完成/过期退场）即使没有新事件也要通报，否则徽标和菜单会过期
    if (state !== lastAgent || isNewEvent || sesSig !== lastSesSig) {
      lastAgent = state;
      lastSesSig = sesSig;
      win.webContents.send('agent-state', { state, ts, sessions: sesList });
      // 托盘 tooltip 顺带显示会话概况
      if (tray) {
        const active = sesList.filter(x => x.state !== 'idle').length;
        tray.setToolTip(`Kimi 桌宠${sesList.length ? ` · ${sesList.length} 个会话${active ? `（${active} 个在忙）` : ''}` : ''}`);
      }
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

  // 宠物走一步：窗口平移 {dx,dy}；多屏按 clampStep 钳制（屏内不动、死角钳进目标屏）
  // 分量可能不足 1px（小体型拆细步），小数部分按轴累积进下一步，避免取整偏差
  let stepFracX = 0, stepFracY = 0;
  ipcMain.on('pet-step', (event, { dx, dy, tx, ty }) => {
    if (!win || !saneCoord(dx) || !saneCoord(dy)) return;
    const [x, y] = win.getPosition();
    if (!saneCoord(x) || !saneCoord(y)) return; // 显示器热插拔重配置时读数可能是 NaN/哨兵值
    const size = win.getSize()[0];
    const areas = screen.getAllDisplays().map(d => d.workArea);
    stepFracX += dx; stepFracY += dy;
    const mx = Math.trunc(stepFracX), my = Math.trunc(stepFracY);
    stepFracX -= mx; stepFracY -= my;
    const want = clampStep(areas, x + mx, y + my, size, tx, ty);
    safeSetPosition("step", want.x, want.y);
    // macOS 对菜单栏这类交界处有"禁区"：落点被拒（系统强行挪回）时，
    // 直接跳进补了内收的目标屏里——跨屏就该是一跳，不是硬挤
    const [ax, ay] = win.getPosition();
    if (Math.abs(ax - want.x) > 2 || Math.abs(ay - want.y) > 2) {
      const hasT = Number.isFinite(tx) && Number.isFinite(ty);
      const r = nearestArea(areas, hasT ? tx : want.x + size / 2, hasT ? ty : want.y + size / 2);
      if (r) {
        const j = clampToRect({ x: r.x + 8, y: r.y + 8, width: r.width - 16, height: r.height - 16 }, want.x, want.y, size);
        safeSetPosition("step-jump", j.x, j.y);
      }
    }
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
    if (!win || !dragOrigin || !saneCoord(dx) || !saneCoord(dy) ||
        !saneCoord(dragOrigin.x) || !saneCoord(dragOrigin.y)) return;
    safeSetPosition('drag', Math.round(dragOrigin.x + dx), Math.round(dragOrigin.y + dy));
  });

  // 双击：按用户设置开终端或开官网
  ipcMain.on('pet-open-terminal', () => {
    if (dblAction === 'website') shell.openExternal('https://www.kimi.com');
    else openKimiTerminal();
  });

  // 点指示点：打开那个会话本身（终端里 kimi --session 恢复）
  ipcMain.on('pet-open-session', (_e, { id, cwd }) => openSessionTerminal(id, cwd));

  // 拖拽时抑制提醒闪现（渲染层通报）；提醒期间被拖过就不送回原位了
  ipcMain.on('pet-remind-suppress', (_e, f) => {
    remindSuppressed = !!f;
    if (f && reminding) remindDragged = true;
  });

  // 调试用：回报主进程权威状态（自动化测试断言用）
  ipcMain.handle('pet-debug-state', () => ({
    scale,
    mode,
    bounds: win ? win.getBounds() : null,
    zoom: win ? win.webContents.getZoomFactor() : null,
    area: screen.getPrimaryDisplay().workArea,
    areas: screen.getAllDisplays().map(d => d.workArea),
    cursor: screen.getCursorScreenPoint(),
    remindTarget: lastRemindTarget,
    trayBounds: tray ? tray.getBounds() : null
  }));
  // 调试用：测试时屏蔽用户鼠标干扰（窗口变点击穿透）
  ipcMain.handle('pet-debug-ignore-mouse', (_e, flag) => {
    if (win) win.setIgnoreMouseEvents(!!flag);
  });
  // 调试用：重置 agent 状态跟踪（长测试套件里让用例互不污染）
  ipcMain.handle('pet-debug-reset-agent', () => { lastAgent = 'idle'; lastSesSig = '[]'; lastEventTs.clear(); });
  // 调试用：切换某会话的忽略状态（忽略/恢复监控）
  ipcMain.handle('pet-debug-ignore-session', (_e, id) => toggleIgnoreSession(id));
}

app.whenReady().then(() => {
  // macOS：先不占用 Dock 图标再做窗口——要压住全屏应用，agent 身份会影响 Space 归属
  if (app.dock) app.dock.hide();
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

  // 多屏热插拔：显示器被拔掉时，把球钳回最近的存活屏
  screen.on('display-removed', () => {
    if (!win) return;
    const areas = screen.getAllDisplays().map(d => d.workArea);
    if (!areas.length) return;
    const [x, y] = win.getPosition();
    const c = clampWindow(areas, x, y, win.getSize()[0]);
    safeSetPosition("display-removed", c.x, c.y);
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
  try { fs.writeFileSync(settingsFile(), JSON.stringify({ ...loadSettings(), scale, x, y, mode, dblclick: dblAction, remindMin, ignoredSessions: [...ignoredSessions] })); } catch {}
});
