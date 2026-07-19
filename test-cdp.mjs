// CDP 自动化测试：通过 remote-debugging 驱动桌宠，验证缩放锚点、点击漂移、拖拽换算、气泡显示
// 断言一律用主进程权威状态（petAPI.debugState），不信渲染层 outerWidth/screenX
// 测试期间开启鼠标穿透，屏蔽用户真实鼠标的干扰；结束（含异常）恢复
// 用法: node test-cdp.mjs   （需要 electron 以 --remote-debugging-port=9223 运行）
import { writeFileSync } from 'fs';

const PORT = 9223;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(name, actual, expected, tol = 3) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: actual=${Number(actual).toFixed(2)} expected=${Number(expected).toFixed(2)} (±${tol})`);
}
function checkTrue(name, cond, detail = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

// --- 连接 page target ---
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === 'page' && t.url.includes('index.html'));
if (!page) { console.error('找不到 page target:', list.map(t => t.url)); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let idc = 1;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
};
function cmd(method, params = {}) {
  const id = idc++;
  return new Promise((res, rej) => {
    pending.set(id, (d) => d.error ? rej(new Error(method + ': ' + JSON.stringify(d.error))) : res(d.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evl(expression) {
  const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}
const geom = () => evl(`petAPI.debugState().then(s => ({
  x: s.bounds.x, y: s.bounds.y, w: s.bounds.width, h: s.bounds.height,
  scale: s.scale, zoom: s.zoom, iw: window.innerWidth, area: s.area }))`);
const resize = (dy) => evl(`petAPI.resize({dy:${dy}, ax:120, ay:120, vw:window.innerWidth, vh:window.innerHeight})`);
async function toScale(target) {
  for (let i = 0; i < 25; i++) {
    const g = await geom();
    if (Math.abs(g.scale - target) < 0.005) return g;
    await resize(g.scale < target ? -100 : 100);
    await sleep(120);
  }
  return await geom();
}

await cmd('Runtime.enable');
await cmd('Page.enable');

try {
  // --- 屏蔽真实鼠标 + 冻结状态机（防走路干扰测量） ---
  await evl(`petAPI.debugIgnoreMouse(true)`);
  await evl(`clearTimers(); state = 'drag';`);
  await sleep(300);

  // --- T0a: 启动即同步缩放（持久化恢复到非 1 时，渲染层 curScale 必须跟上，否则气泡补偿错） ---
  const boot = await geom();
  const bootCur = await evl(`curScale`);
  console.log(`T0a 启动恢复 scale=${boot.scale} 渲染层 curScale=${bootCur}`);
  check('T0a 启动 curScale 同步', bootCur, boot.scale, 0.001);

  // --- 归一到 scale 1 作为基准 ---
  const g0 = await toScale(1);
  console.log('T0 基准状态:', JSON.stringify(g0));
  check('T0 窗口宽', g0.w, 240, 2);
  check('T0 zoom=scale=1', g0.zoom, 1, 0.01);
  check('T0 视口宽(CSS)', g0.iw, 240, 1);

  // --- T1: 滚轮放大 x3，中心锚点 ---
  await resize(-100); await sleep(120);
  await resize(-100); await sleep(120);
  await resize(-100); await sleep(300);
  const g1 = await geom();
  console.log('T1 放大后状态:', JSON.stringify(g1));
  check('T1 scale', g1.scale, 1.26, 0.01);
  check('T1 窗口宽', g1.w, Math.round(240 * 1.26), 2);
  check('T1 zoom=scale', g1.zoom, g1.scale, 0.01);
  check('T1 视口宽仍240', g1.iw, 240, 1);
  check('T1 锚点居中 x 位移', g1.x - g0.x, -(g1.w - g0.w) / 2, 2);
  // y 轴贴底会触发边缘钳制：期望值 = min(居中锚点, 最大 y)
  const maxY = g1.area.y + g1.area.height - g1.h;
  const expectY = Math.max(g1.area.y, Math.min(g0.y - (g1.h - g0.h) / 2, maxY));
  check('T1 锚点+钳制 y', g1.y, expectY, 2);

  // --- T2: 点击（微移）窗口不应动 ---
  await sleep(200);
  const c0 = await geom();
  await evl(`{
    const o = document.getElementById('orb');
    o.dispatchEvent(new PointerEvent('pointerdown', {clientX: 150, clientY: 150, screenX: 500, screenY: 500, bubbles: true}));
    window.dispatchEvent(new PointerEvent('pointermove', {clientX: 152, clientY: 151, screenX: 502, screenY: 501, bubbles: true}));
    window.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}));
  }`);
  await sleep(300);
  const c1 = await geom();
  check('T2 点击后 x 不变', c1.x - c0.x, 0, 0);
  check('T2 点击后 y 不变', c1.y - c0.y, 0, 0);

  // --- T3: 拖拽：screenX 位移 -60, -30，窗口 1:1 跟随（任何缩放） ---
  const d0 = await geom();
  await evl(`{
    const o = document.getElementById('orb');
    o.dispatchEvent(new PointerEvent('pointerdown', {clientX: 150, clientY: 150, screenX: 500, screenY: 500, bubbles: true}));
    window.dispatchEvent(new PointerEvent('pointermove', {clientX: 90, clientY: 120, screenX: 440, screenY: 470, bubbles: true}));
  }`);
  await sleep(300);
  const d1 = await geom();
  // macOS 会钳制窗口不许移出 workArea（比如菜单栏上方），期望值要算上钳制
  const expX = Math.max(d0.area.x, d0.x - 60) - d0.x;
  const expY = Math.max(d0.area.y, d0.y - 30) - d0.y;
  check('T3 拖拽 x 位移', d1.x - d0.x, expX, 2);
  check('T3 拖拽 y 位移', d1.y - d0.y, expY, 2);
  await evl(`window.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}))`);

  // --- T4: 大尺寸气泡：完整 + 贴在头顶上方 ---
  await evl(`clearTimers(); state = 'idle';`);
  await evl(`document.getElementById('orb').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))`);
  await sleep(500);
  const shot1 = await cmd('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot-big.png', Buffer.from(shot1.data, 'base64'));
  const b1 = await evl(`{
    const r = document.getElementById('bubbleBody').getBoundingClientRect();
    ({ l: r.left, t: r.top, r: r.right, b: r.bottom, tf: document.getElementById('bubbleBody').style.transform })}`);
  console.log('T4 大气泡 rect(CSS):', JSON.stringify(b1));
  checkTrue('T4 气泡完整在窗口内', b1.l >= 0 && b1.t >= 0 && b1.r <= 240 && b1.b <= 240);
  checkTrue('T4 气泡贴近头顶（底边 60~80px）', b1.b >= 60 && b1.b <= 80, `b=${b1.b.toFixed(1)}`);

  // --- T5: 缩小到最小，气泡不应截断 ---
  await toScale(0.4);
  await sleep(200);
  const g2 = await geom();
  console.log('T5 缩小后状态:', JSON.stringify(g2));
  check('T5 scale 到下限 0.4', g2.scale, 0.4, 0.01);
  check('T5 最小窗口宽', g2.w, Math.round(240 * 0.4), 2);
  check('T5 zoom=scale', g2.zoom, g2.scale, 0.01);
  await evl(`clearTimers(); state = 'idle';`);
  await evl(`document.getElementById('orb').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))`);
  await sleep(500);
  const shot2 = await cmd('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot-small.png', Buffer.from(shot2.data, 'base64'));
  const b2 = await evl(`{
    const r = document.getElementById('bubbleBody').getBoundingClientRect();
    ({ l: r.left, t: r.top, r: r.right, b: r.bottom, tf: document.getElementById('bubbleBody').style.transform })}`);
  console.log('T5 小气泡 rect(CSS):', JSON.stringify(b2));
  checkTrue('T5 气泡完整在窗口内', b2.l >= -1 && b2.t >= -1 && b2.r <= 241 && b2.b <= 241);

  // --- T6: 小尺寸下拖拽仍 1:1 跟随 ---
  const e0 = await geom();
  await evl(`{
    const o = document.getElementById('orb');
    o.dispatchEvent(new PointerEvent('pointerdown', {clientX: 100, clientY: 150, screenX: 500, screenY: 500, bubbles: true}));
    window.dispatchEvent(new PointerEvent('pointermove', {clientX: 140, clientY: 170, screenX: 540, screenY: 520, bubbles: true}));
  }`);
  await sleep(300);
  const e1 = await geom();
  check('T6 小窗拖拽 x 位移', e1.x - e0.x, 40, 2);
  check('T6 小窗拖拽 y 位移', e1.y - e0.y, 20, 2);
  await evl(`window.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}))`);

  // --- T7: 回到标准尺寸截图（最终形态）---
  const g3 = await toScale(1);
  console.log('T7 回标准后状态:', JSON.stringify(g3));
  check('T7 回到 scale 1', g3.scale, 1, 0.01);
  await evl(`clearTimers(); state = 'idle';`);
  await evl(`document.getElementById('orb').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))`);
  await sleep(500);
  const shot3 = await cmd('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot-normal.png', Buffer.from(shot3.data, 'base64'));
} finally {
  await evl(`petAPI.debugIgnoreMouse(false)`).catch(() => {});
}

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
