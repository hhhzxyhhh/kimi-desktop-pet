// 图标生成：加载 index.html 提取球球 SVG，再用干净的 data: 页面按目标尺寸精确栅格化
// 用法: node_modules/.bin/electron gen-icon.cjs  （生成 assets/*.png 后自动退出）
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// 独立 userData，避免和正在运行的桌宠实例抢 Chromium 单例锁
app.setPath('userData', path.join(app.getPath('temp'), 'kimi-icon-gen'));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512, height: 512,
    x: -10000, y: -10000, // 挪到屏幕外，悄悄渲染
    frame: false, transparent: true, show: true
  });

  // 从 index.html 里提取 orbSvg() 的产物（含渐变 defs 和眼睛分组）
  await win.loadFile('index.html');
  await new Promise(r => setTimeout(r, 500));
  const svg = await win.webContents.executeJavaScript(
    `document.querySelector('#squash svg').outerHTML`
  );

  // 干净页面：只有 SVG，无滤镜无动画，按 512 CSS px 精确渲染
  // 注意：表情/汗珠的显隐规则在 index.html 的 <style> 里，这里要补一份，只留默认眼
  const html = `<!DOCTYPE html><html><head><style>
    body{margin:0;background:transparent}
    .expr,.sweat{display:none} .expr-default{display:block}
  </style></head><body>${
    svg.replace('<svg ', '<svg width="512" height="512" ')
  }</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 300));

  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.mkdirSync('assets', { recursive: true });
  fs.writeFileSync('assets/icon.png', img.resize({ width: 512 }).toPNG());
  console.log('生成 assets/icon.png');

  // 托盘图标：macOS 菜单栏惯例是 template image（单色剪影 + 镂空，系统按明暗自动上色）。
  // 用 mask 把球做成剪影、眼睛镂空；图形约占 60%（太大就会比别的图标显眼）
  const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="36" height="36">
    <mask id="m">
      <ellipse cx="100" cy="112" rx="86" ry="79" fill="white"/>
      <rect x="67" y="67" width="20" height="40" rx="10" fill="black"/>
      <rect x="113" y="67" width="20" height="40" rx="10" fill="black"/>
    </mask>
    <rect width="200" height="200" fill="black" mask="url(#m)"/>
  </svg>`;
  const trayHtml = `<!DOCTYPE html><html><head><style>
    body{margin:0;background:transparent}
    svg{position:absolute;left:4px;top:4px}
  </style></head><body>${traySvg}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(trayHtml));
  await new Promise(r => setTimeout(r, 300));
  const trayImg = await win.webContents.capturePage({ x: 0, y: 0, width: 44, height: 44 });
  fs.writeFileSync('assets/tray.png', trayImg.resize({ width: 44 }).toPNG());
  console.log('生成 assets/tray.png');
  app.quit();
});
