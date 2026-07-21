// display-areas.cjs 单元测试：多显示器几何（纯 Node，跨平台）
// 用法: node test-display-areas.cjs
const { nearestArea, clampWindow, clampStep, randomWindowPos } = require('./display-areas.cjs');

let failures = 0;
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
function ok(name, cond, detail = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

// 上下布局（本机）：主屏 1512 在下，4K 1920 在上（含菜单栏缝隙 y∈(0,38)）
const VERT = [
  { x: 0, y: 38, width: 1512, height: 882 },
  { x: -247, y: -1055, width: 1920, height: 1055 }
];
// 左右布局（含 80px 无屏死角）
const HORZG = [
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: 2000, y: 0, width: 1920, height: 1080 }
];
// 品字三屏
const TRI = [
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: -1920, y: 0, width: 1920, height: 1080 },
  { x: 0, y: -1080, width: 1920, height: 1080 }
];

/* nearestArea */
eq('主屏内的点归主屏', nearestArea(VERT, 700, 500), VERT[0]);
eq('上屏内的点归上屏', nearestArea(VERT, 500, -500), VERT[1]);
ok('菜单栏缝隙归最近屏（同距取前者）', nearestArea(VERT, 700, 19) === VERT[0]);
eq('右屏点归右屏', nearestArea(HORZG, 2500, 400), HORZG[1]);
eq('品字三屏顶部点归顶屏', nearestArea(TRI, 500, -500), TRI[2]);

/* clampWindow（拖拽/缩放/闪现） */
eq('屏内不动', clampWindow(VERT, 700, 500, 96), { x: 700, y: 500 });
eq('越右边界钳回', clampWindow(HORZG, 3850, 400, 96), { x: 3824, y: 400 });
eq('菜单栏缝隙钳到最近屏', clampWindow(VERT, 700, -20, 96).y, 38);

/* clampStep（散步跨屏；注意判定按窗口中心点） */
eq('屏内不动', clampStep(VERT, 700, 500, 96, 100, -500), { x: 700, y: 500 });
eq('菜单栏缝隙按目标屏放行（内收防 macOS 弹回）', clampStep(VERT, 700, -20, 96, 500, -500), { x: 700, y: -100 });
eq('左右布局死角钳进目标右屏', clampStep(HORZG, 1950, 400, 96, 2500, 400), { x: 2004, y: 400 });
eq('三屏死角钳进目标所在屏', clampStep(TRI, -100, -500, 96, 500, -500), { x: 4, y: -500 });
eq('无目标死角钳进最近屏', clampStep(VERT, 700, -20, 96).y, 42);

/* randomWindowPos（面积加权） */
const p1 = randomWindowPos(VERT, 96, () => 0.05);
ok('小随机数选第一块屏', p1.y >= 38 && p1.y <= 920 - 96, JSON.stringify(p1));
const p2 = randomWindowPos(VERT, 96, () => 0.9);
ok('大随机数选大面积屏（上屏）', p2.y <= -96, JSON.stringify(p2));
ok('点在屏内（右屏）', (() => { const p = randomWindowPos(HORZG, 96, () => 0.9); return p.x >= 2000 && p.x <= 3920 - 96; })());
eq('空列表兜底', randomWindowPos([], 96), { x: 0, y: 0 });

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
