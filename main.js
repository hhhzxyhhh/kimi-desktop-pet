// Kimi 桌宠 · 主进程
// 透明无边框小窗，置顶悬浮；宠物"走路"= 窗口本身在屏幕上平移
const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron');
const path = require('path');

const SIZE = 240; // 基准边长（正方形，宠物住在底部，上方留白给气泡和 zzz）
const MIN_SCALE = 0.4, MAX_SCALE = 2.5; // 滚轮缩放的上下限（96px ~ 600px）
let win = null;
let scale = 1;    // 当前缩放倍数，实际窗口边长 = SIZE * scale

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;

  win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    x: wa.x + wa.width - SIZE - 60,
    y: wa.y + wa.height - SIZE - 10,
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
  });

  // 调整大小：窗口等比缩放 + 页面同步 zoom，位置钳回屏幕内
  // fx/fy 为缩放锚点（窗口内相对位置 0~1，默认中心），缩放前后锚点在屏幕上的位置不变
  const setScale = (s, fx = 0.5, fy = 0.5) => {
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
  };

  // 滚轮缩放：往上滚变大，往下滚变小，步进 8%，以鼠标位置为锚点
  // ax/ay 与 vw/vh 同为渲染层视口坐标，相除即锚点相对位置，与 zoom 坐标语义无关
  ipcMain.on('pet-resize', (event, { dy, ax, ay, vw, vh }) => {
    if (!win || !vw || !vh) return;
    let next = Math.round(scale * (dy < 0 ? 1.08 : 1 / 1.08) * 100) / 100;
    if (next > 0.94 && next < 1.06) next = 1; // 经过标准尺寸附近时吸附，方便回正
    setScale(next, ax / vw, ay / vh);
  });

  // 右键菜单（每次弹出时重建，让"大小"的选中态跟随当前 scale）
  win.webContents.on('context-menu', (e) => {
    e.preventDefault();
    const sizeItems = [
      { label: '迷你 (120px)', s: 0.5 },
      { label: '小只 (180px)', s: 0.75 },
      { label: '标准 (240px)', s: 1 },
      { label: '大只 (360px)', s: 1.5 },
      { label: '巨大 (480px)', s: 2 }
    ].map(({ label, s }) => ({
      label, type: 'radio', checked: s === scale, click: () => setScale(s)
    }));
    const menu = Menu.buildFromTemplate([
      { label: '睡觉 / 叫醒', click: () => win.webContents.send('toggle-sleep') },
      { label: '说句话', click: () => win.webContents.send('talk') },
      { label: '大小', submenu: sizeItems },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]);
    menu.popup({ window: win });
  });

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

  // 拖拽：渲染层报"相对按下点的视口位移 + 视口宽"，主进程按窗口实际尺寸换算
  // （位移与视口宽同一坐标系，size/vw 的比值换算对 zoom 坐标语义免疫）
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
    area: screen.getPrimaryDisplay().workArea
  }));
  // 调试用：测试时屏蔽用户鼠标干扰（窗口变点击穿透）
  ipcMain.handle('pet-debug-ignore-mouse', (_e, flag) => {
    if (win) win.setIgnoreMouseEvents(!!flag);
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
