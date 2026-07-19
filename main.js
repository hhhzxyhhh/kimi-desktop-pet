// Kimi 桌宠 · 主进程
// 透明无边框小窗，置顶悬浮；宠物"走路"= 窗口本身在屏幕上平移
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const SIZE = 240; // 基准边长（正方形，宠物住在底部，上方留白给气泡和 zzz）
const MIN_SCALE = 0.4, MAX_SCALE = 2.5; // 滚轮缩放的上下限（96px ~ 600px）
let win = null;
let tray = null;
let scale = 1;    // 当前缩放倍数，实际窗口边长 = SIZE * scale

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
    fs.writeFile(settingsFile(), JSON.stringify({ scale, x, y }), () => {});
  }, 400);
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
    { label: '睡觉 / 叫醒', click: () => win && win.webContents.send('toggle-sleep') },
    { label: '说句话', click: () => win && win.webContents.send('talk') },
    { label: '大小', submenu: sizeItems },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;

  // 恢复上次的大小；位置只有在某台显示器范围内才恢复，否则回默认右下角
  const st = loadSettings();
  scale = Math.min(Math.max(st.scale || 1, MIN_SCALE), MAX_SCALE);
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

  // Electron 会按 origin 记住上次的页面 zoom，启动时强制同步回当前 scale，
  // 否则窗口尺寸(240)和 zoom(上次残留)脱节，拖拽/锚点换算全乱
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(scale);
    // 恢复持久化缩放时渲染层的 curScale 初值是错的(1)，必须主动通报，否则气泡补偿算错
    win.webContents.send('pet-scale', scale);
  });

  // 光标位置轮询：渲染层收不到窗口外的鼠标事件，主进程代查屏幕坐标发过去（眼睛追踪用）
  setInterval(() => {
    if (!win) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    win.webContents.send('cursor-pos', { x: p.x, y: p.y, wx: b.x + b.width / 2, wy: b.y + b.height / 2 });
  }, 120);

  // 滚轮缩放：往上滚变大，往下滚变小，步进 8%，以鼠标位置为锚点
  // ax/ay 与 vw/vh 同为渲染层视口坐标，相除即锚点相对位置，与 zoom 坐标语义无关
  ipcMain.on('pet-resize', (event, { dy, ax, ay, vw, vh }) => {
    if (!win || !vw || !vh) return;
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

  // 宠物走一步：窗口平移 dx，撞到屏幕边缘则回报 flipped 让渲染进程掉头
  ipcMain.on('pet-step', (event, dx) => {
    if (!win) return;
    const [x, y] = win.getPosition();
    const size = win.getSize()[0];
    const area = screen.getPrimaryDisplay().workArea;
    let nx = x + dx;
    let flipped = false;
    if (nx <= area.x) { nx = area.x; flipped = true; }
    if (nx >= area.x + area.width - size) { nx = area.x + area.width - size; flipped = true; }
    win.setPosition(Math.round(nx), y);
    event.reply('pet-step-done', flipped);
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
    if (!win || !dragOrigin) return;
    win.setPosition(Math.round(dragOrigin.x + dx), Math.round(dragOrigin.y + dy));
  });

  // 调试用：回报主进程权威状态（自动化测试断言用）
  ipcMain.handle('pet-debug-state', () => ({
    scale,
    bounds: win ? win.getBounds() : null,
    zoom: win ? win.webContents.getZoomFactor() : null,
    area: screen.getPrimaryDisplay().workArea,
    trayBounds: tray ? tray.getBounds() : null
  }));
  // 调试用：测试时屏蔽用户鼠标干扰（窗口变点击穿透）
  ipcMain.handle('pet-debug-ignore-mouse', (_e, flag) => {
    if (win) win.setIgnoreMouseEvents(!!flag);
  });
}

app.whenReady().then(() => {
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
