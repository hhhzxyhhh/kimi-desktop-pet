// CDP 自动化测试：通过 remote-debugging 驱动桌宠，验证缩放锚点、点击漂移、拖拽换算、气泡显示
// 断言一律用主进程权威状态（petAPI.debugState），不信渲染层 outerWidth/screenX
// 测试期间开启鼠标穿透，屏蔽用户真实鼠标的干扰；结束（含异常）恢复
// 用法: node test-cdp.mjs   （需要 electron 以 --remote-debugging-port=9223 运行）
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const PORT = 9223;
// 测试专用联动状态目录（实例用 KIMI_PET_STATE_DIR 指向它）；开局先清掉，防上次残留污染
// 默认用系统临时目录（Windows 没有 /tmp）；也可用 KIMI_PET_STATE_DIR 显式指定保持一致
const agentDir = process.env.KIMI_PET_STATE_DIR || join(tmpdir(), 'pet-test-agent-state');
rmSync(agentDir, { recursive: true, force: true });
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
// 等到几何读数稳定（连续两次一致）再取，防窗口服务器时序抖动
async function geomSettled() {
  let a = await geom();
  for (let i = 0; i < 10; i++) {
    await sleep(120);
    const b = await geom();
    if (b.x === a.x && b.y === a.y && b.w === a.w && b.h === a.h) return b;
    a = b;
  }
  return a;
}
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
  // 锚点居中，但贴边会触发钳制：期望值 = clamp(居中锚点)
  const maxX = g1.area.x + g1.area.width - g1.w;
  const expectX = Math.max(g1.area.x, Math.min(g0.x - (g1.w - g0.w) / 2, maxX));
  check('T1 锚点+钳制 x', g1.x, expectX, 2);
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
  const d0 = await geomSettled();
  await evl(`{
    const o = document.getElementById('orb');
    o.dispatchEvent(new PointerEvent('pointerdown', {clientX: 150, clientY: 150, screenX: 500, screenY: 500, bubbles: true}));
    window.dispatchEvent(new PointerEvent('pointermove', {clientX: 90, clientY: 120, screenX: 440, screenY: 470, bubbles: true}));
  }`);
  await sleep(300);
  const d1 = await geomSettled();
  // macOS 会钳制窗口不许移出 workArea（比如菜单栏上方），期望值要算上钳制
  const expX = Math.max(d0.area.x, d0.x - 60) - d0.x;
  const expY = Math.max(d0.area.y, d0.y - 30) - d0.y;
  check('T3 拖拽 x 位移', d1.x - d0.x, expX, 4);
  check('T3 拖拽 y 位移', d1.y - d0.y, expY, 4);
  await evl(`window.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}))`);

  // --- T9: 右键不触发戳（不进 shock、不出气泡） ---
  await evl(`clearTimers(); state = 'idle'; setExpr('default');`);
  await evl(`{
    const o = document.getElementById('orb');
    o.dispatchEvent(new PointerEvent('pointerdown', {button: 2, clientX: 120, clientY: 150, bubbles: true}));
    window.dispatchEvent(new PointerEvent('pointerup', {button: 2, bubbles: true}));
  }`);
  await sleep(300);
  const t9expr = await evl(`document.getElementById('orb').dataset.expr`);
  const t9bub = await evl(`document.getElementById('bubble').classList.contains('show')`);
  checkTrue('T9 右键不戳', t9expr === 'default' && !t9bub, `expr=${t9expr} bubble=${t9bub}`);

  // --- T10: 右键后移动鼠标，窗口不应被当成拖拽跟着走 ---
  const f0 = await geom();
  await evl(`{
    const o = document.getElementById('orb');
    o.dispatchEvent(new PointerEvent('pointerdown', {button: 2, clientX: 120, clientY: 150, screenX: 500, screenY: 500, bubbles: true}));
    // 模拟菜单吞掉 pointerup 后，鼠标划过很多点
    for (let i = 1; i <= 5; i++) {
      window.dispatchEvent(new PointerEvent('pointermove', {clientX: 120 + i * 20, clientY: 150, screenX: 500 + i * 20, screenY: 500, bubbles: true}));
    }
  }`);
  await sleep(300);
  const f1 = await geom();
  const f1state = await evl(`state`);
  check('T10 右键后 x 不跟鼠标', f1.x - f0.x, 0, 0);
  check('T10 右键后 y 不跟鼠标', f1.y - f0.y, 0, 0);
  checkTrue('T10 未进入拖拽态', f1state !== 'drag', `state=${f1state}`);

  // --- T11: 拖拽松手 20% 概率晕眩（控 Math.random 走两个分支） ---
  const dragOnce = () => evl(`{
    const o = document.getElementById('orb');
    o.dispatchEvent(new PointerEvent('pointerdown', {clientX: 150, clientY: 150, screenX: 500, screenY: 500, bubbles: true}));
    window.dispatchEvent(new PointerEvent('pointermove', {clientX: 90, clientY: 120, screenX: 440, screenY: 470, bubbles: true}));
    window.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}));
  }`);
  await evl(`clearTimers(); state = 'idle'; setExpr('default'); window.__r = Math.random; Math.random = () => 0.1;`);
  await dragOnce();
  await sleep(200);
  const t11a = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T11 松手低概率分支晕眩', t11a === 'dizzy', `expr=${t11a}`);
  await sleep(900);
  const t11b = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T11 晕眩后回神', t11b === 'default', `expr=${t11b}`);
  await evl(`clearTimers(); state = 'idle'; setExpr('default'); Math.random = () => 0.9;`);
  await dragOnce();
  await sleep(200);
  const t11c = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T11 松手高概率分支不晕', t11c === 'default', `expr=${t11c}`);
  await evl(`Math.random = window.__r;`);

  // --- T12: 自然睡醒开心，被戳醒生气 ---
  await evl(`clearTimers(); startSleep();`);
  await sleep(100);
  await evl(`wake(false)`);
  await sleep(100);
  const t12a = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T12 自然睡醒开心', t12a === 'happy', `expr=${t12a}`);
  await sleep(1700);
  const t12b = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T12 开心后恢复', t12b === 'default', `expr=${t12b}`);
  await evl(`clearTimers(); startSleep();`);
  await sleep(100);
  await evl(`wake(true)`);
  await sleep(100);
  const t12c = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T12 被戳醒生气', t12c === 'angry', `expr=${t12c}`);

  // --- T13: Kimi Code 联动：状态文件 → 表情 + TTL 恢复 ---
  // 测试实例通过 KIMI_PET_STATE_DIR 指到这个独立目录，与真实 hook 的状态目录隔离
  const writeAgent = (state, ageMs = 0, ev, session = 'test-session') => {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, session + '.json'), JSON.stringify({ state, ev, proj: session, ts: Date.now() - ageMs }));
  };
  await evl(`clearTimers(); state = 'idle';`);
  writeAgent('searching');
  await sleep(800);
  const t13a = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T13 搜索中→放大镜眼', t13a === 'search', `expr=${t13a}`);
  writeAgent('permission');
  await sleep(800);
  const t13b = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T13 请求权限→感叹号', t13b === 'notice', `expr=${t13b}`);
  writeAgent('ask');
  await sleep(800);
  const t13q = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T13 提问→问号脸', t13q === 'question', `expr=${t13q}`);

  // --- T15: 睡觉时被 agent 叫醒；睡颜与 agent 脸绝不共存 ---
  await evl(`clearTimers(); startSleep();`);
  writeAgent('ask');
  await sleep(900);
  const t15 = await evl(`({
    sleeping: document.getElementById('orb').classList.contains('sleeping'),
    expr: document.getElementById('orb').dataset.expr
  })`);
  checkTrue('T15 来活叫醒（睡觉类已移除）', t15.sleeping === false, JSON.stringify(t15));
  checkTrue('T15 叫醒后显示提问脸', t15.expr === 'question', JSON.stringify(t15));
  await evl(`clearTimers(); document.getElementById('orb').classList.remove('sleeping'); state = 'idle';`);

  // --- T16: 思考脸最短展示 1.2s + 非瞬时状态常驻 ---
  await evl(`petAPI.debugResetAgent(); agentState = null; agentFaceSince = 0;`);
  writeAgent('thinking');
  await sleep(700);
  const t16a = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T16 思考中→齿轮眼', t16a === 'think', `expr=${t16a}`);
  writeAgent('working');
  await sleep(200); // 思考脸才挂 0.9s，不许被顶掉
  const t16b = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T16 思考脸至少挂 1.2s', t16b === 'think', `expr=${t16b}`);
  await sleep(1300); // 过 1.2s，应切到工作脸
  const t16c = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T16 到点切换工作脸', t16c === 'focus', `expr=${t16c}`);
  writeAgent('thinking', 5000); // 非瞬时状态不过期：文件即当前状态，旧事件也保持显示
  await sleep(1500);
  const t16d = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T16 非瞬时状态常驻', t16d === 'think', `expr=${t16d}`);

  // --- T17: PostToolUse 的 working 超时降级 thinking ---
  writeAgent('working', 2000, 'PostToolUse'); // 工具刚完成 2s：仍在干活
  await sleep(1500);
  const t17a = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T17 工具刚完成→工作脸', t17a === 'focus', `expr=${t17a}`);
  writeAgent('working', 20000, 'PostToolUse'); // 20s 没动作：降级沉思
  await sleep(1500);
  const t17b = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T17 超时无动作→思考脸', t17b === 'think', `expr=${t17b}`);
  await evl(`petAPI.debugResetAgent(); agentState = null; agentFaceSince = 0; clearTimeout(agentQueueTimer);`);
  writeAgent('working', 400000); // 400 秒前的工作状态：不过期，长期保持
  await sleep(2500);
  const t13c = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T13 工作状态无限期保持', t13c === 'focus', `expr=${t13c}`);
  writeAgent('done', 10000); // done 是瞬时庆祝，10 秒前即过期
  await sleep(800);
  const t13f = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T13 done 闪完即恢复', t13f === 'default', `expr=${t13f}`);
  writeAgent('working');
  await sleep(800);
  let leftPost = 0;
  for (let i = 0; i < 10; i++) {
    if (await evl(`clearTimers(); state = 'idle'; decide(); state`) !== 'idle') leftPost++;
  }
  checkTrue('T13 开工期间 decide 坚守岗位', leftPost === 0, `离岗次数=${leftPost}`);
  writeAgent('done');
  await sleep(800);
  const t13d = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T13 完成→开心', t13d === 'happy', `expr=${t13d}`);
  await sleep(4000); // done TTL 3.5s
  const t13e = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T13 完成后自动恢复', t13e === 'default', `expr=${t13e}`);
  // --- T18: 多会话聚合：权限最优先，一个会话结束不影响另一个 ---
  writeAgent('working', 0, 'PreToolUse', 'session-a');
  writeAgent('permission', 0, undefined, 'session-b');
  await sleep(900);
  const t18a = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T18 B 请求权限压过 A 在忙', t18a === 'notice', `expr=${t18a}`);
  rmSync(join(agentDir, 'session-b.json'), { force: true }); // B 会话结束（SessionEnd 会删状态文件）
  await sleep(900);
  const t18b = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T18 B 结束后回落到 A 的工作脸', t18b === 'focus', `expr=${t18b}`);
  writeAgent('idle', 0, undefined, 'session-a'); // A 也闲了
  await sleep(900);
  const t18c = await evl(`document.getElementById('orb').dataset.expr`);
  checkTrue('T18 全部空闲恢复默认', t18c === 'default', `expr=${t18c}`);

  // --- T20: 多会话可视化：指示点（数量=会话数，红=需注意）+ 完成播报点名 ---
  rmSync(agentDir, { recursive: true, force: true }); // 先清掉前面用例的残留会话文件
  writeAgent('working', 0, 'PreToolUse', 'session-a');
  await sleep(900);
  const t20a = await evl(`document.querySelectorAll('.ses-dot').length`);
  checkTrue('T20 单会话也有一颗点', t20a === 1, `点数=${t20a}`);
  writeAgent('working', 0, 'PreToolUse', 'session-b');
  await sleep(900);
  const t20b = await evl(`({ all: document.querySelectorAll('.ses-dot').length, red: document.querySelectorAll('.ses-dot.red').length })`);
  checkTrue('T20 两个在忙两颗绿点', t20b.all === 2 && t20b.red === 0, JSON.stringify(t20b));
  writeAgent('permission', 0, undefined, 'session-b'); // B 等批准 → 一红一绿
  await sleep(900);
  const t20c = await evl(`({ all: document.querySelectorAll('.ses-dot').length, red: document.querySelectorAll('.ses-dot.red').length })`);
  checkTrue('T20 B 等批准一红一绿', t20c.all === 2 && t20c.red === 1, JSON.stringify(t20c));
  writeAgent('done', 0, undefined, 'session-a'); // A 完成：播报点名
  await sleep(900);
  const t20d = await evl(`document.getElementById('bubbleBody').textContent`);
  checkTrue('T20 完成播报点名', t20d.includes('session-a'), t20d);
  writeAgent('idle', 0, undefined, 'session-a');
  writeAgent('idle', 0, undefined, 'session-b');
  await sleep(900);
  const t20e = await evl(`({ all: document.querySelectorAll('.ses-dot').length, gray: document.querySelectorAll('.ses-dot.gray').length })`);
  checkTrue('T20 空闲窗口两颗灰点', t20e.all === 2 && t20e.gray === 2, JSON.stringify(t20e));
  rmSync(join(agentDir, 'session-a.json'), { force: true }); // 关闭一个窗口（SessionEnd 删文件）
  await sleep(900);
  const t20f = await evl(`document.querySelectorAll('.ses-dot').length`);
  checkTrue('T20 关一个窗口少一颗点', t20f === 1, `点数=${t20f}`);
  rmSync(join(agentDir, 'session-b.json'), { force: true });
  await sleep(900);
  const t20g = await evl(`document.querySelectorAll('.ses-dot').length`);
  checkTrue('T20 全部关闭点清空', t20g === 0, `点数=${t20g}`);
  rmSync(agentDir, { recursive: true, force: true });

  // --- T4: 大尺寸气泡：完整 + 贴在头顶上方 ---
  await evl(`clearTimers(); state = 'idle';`);
  await evl(`talk()`); // dblclick 现在是开终端，说话直接调 talk()
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
  await evl(`talk()`); // dblclick 现在是开终端，说话直接调 talk()
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
  await evl(`talk()`); // dblclick 现在是开终端，说话直接调 talk()
  await sleep(500);
  const shot3 = await cmd('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot-normal.png', Buffer.from(shot3.data, 'base64'));

  // --- T8: stay 模式不散步，kolo 模式会散步 ---
  await evl(`mode = 'stay'`);
  let walks = 0;
  for (let i = 0; i < 30; i++) {
    if (await evl(`clearTimers(); state = 'idle'; decide(); state`) === 'walk') walks++;
  }
  checkTrue('T8 stay 模式 30 次 decide 从不散步', walks === 0, `walks=${walks}`);
  await evl(`mode = 'kolo'`);
  walks = 0;
  for (let i = 0; i < 30; i++) {
    if (await evl(`clearTimers(); state = 'idle'; decide(); state`) === 'walk') walks++;
  }
  checkTrue('T8 kolo 模式 30 次 decide 至少散一次步', walks > 0, `walks=${walks}`);

  // --- T14: kolo 满屏乱跑（目标点模式，明显位移 + 向目标方向移动） ---
  const w0 = await geom();
  await evl(`{ window.__r = Math.random; Math.random = () => 0.05; startWalk(); Math.random = window.__r; }`);
  await sleep(3000);
  const w1 = await geom();
  await evl(`clearTimers(); state = 'idle'; squash.classList.remove('hop');`);
  const moved = Math.hypot(w1.x - w0.x, w1.y - w0.y);
  checkTrue('T14 乱跑明显位移', moved > 10, `位移=${moved.toFixed(1)}`);
  checkTrue('T14 朝左上目标移动', w1.x < w0.x && w1.y <= w0.y, `dx=${(w1.x - w0.x).toFixed(1)} dy=${(w1.y - w0.y).toFixed(1)}`);

  // --- T19: 睡觉中被强制拉去走路，睡颜类必须摘掉（不许一边睡一边蹦） ---
  await evl(`clearTimers(); startSleep();`);
  await sleep(100);
  const t19a = await evl(`document.getElementById('orb').classList.contains('sleeping')`);
  checkTrue('T19 入睡后睡颜在', t19a === true);
  await evl(`startWalk();`);
  await sleep(100);
  const t19b = await evl(`document.getElementById('orb').classList.contains('sleeping')`);
  checkTrue('T19 强制走路后睡颜已摘', t19b === false);
  await evl(`clearTimers(); state = 'idle'; squash.classList.remove('hop');`);

  // --- T21: 双击 = 打开终端（stub 掉真实调用，别真开 Terminal）；说话已挪到菜单 ---
  await evl(`window.__ot = 0; window.__rawOT = openKimiTerm; openKimiTerm = () => { window.__ot++; };`);
  await evl(`document.getElementById('orb').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))`);
  await sleep(200);
  const t21 = await evl(`window.__ot`);
  checkTrue('T21 双击触发打开终端', t21 === 1, `调用次数=${t21}`);
  await evl(`openKimiTerm = window.__rawOT;`);
} finally {
  await evl(`petAPI.debugIgnoreMouse(false)`).catch(() => {});
}

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
