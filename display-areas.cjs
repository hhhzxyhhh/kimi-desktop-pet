// 多显示器几何（纯函数模块，可单测）：与拓扑无关——左右/上下/品字/3+ 屏同一套规则
// areas: [{x, y, width, height}]（各显示器 workArea 的列表，顺序即系统返回顺序）

// 窗口（左上角 x,y，边长 size）钳进 rect
function clampToRect(r, x, y, size) {
  return {
    x: Math.max(r.x, Math.min(x, r.x + r.width - size)),
    y: Math.max(r.y, Math.min(y, r.y + r.height - size))
  };
}

// 点 (px,py) 到 rect 边界的距离（内部为 0）
function distToRect(px, py, r) {
  const nx = Math.max(r.x, Math.min(px, r.x + r.width));
  const ny = Math.max(r.y, Math.min(py, r.y + r.height));
  return Math.hypot(px - nx, py - ny);
}

// 包含或最接近 (px,py) 的矩形；同距离取列表靠前者
function nearestArea(areas, px, py) {
  let best = null, bestD = Infinity;
  for (const r of areas) {
    const d = distToRect(px, py, r);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

// 通用钳制：窗口中心找最近矩形钳进去（拖拽/缩放/闪现用）
function clampWindow(areas, x, y, size) {
  const r = nearestArea(areas, x + size / 2, y + size / 2);
  return r ? clampToRect(r, x, y, size) : { x, y };
}

// 步进钳制（散步用）：位置在某矩形内 → 不动；在死角 → 钳进"目标所在矩形"，
// 球自然沿边滑行、爬到交界处钻进下一块屏（含菜单栏这类工作区缝隙）。
// 钳入时往屏内收 EDGE_MARGIN：贴死显示器外边界会被 macOS 当成离屏窗口随机挪走
const EDGE_MARGIN = 4;
function clampStep(areas, x, y, size, tx, ty) {
  const cx = x + size / 2, cy = y + size / 2;
  const inside = areas.some(r => cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height);
  if (inside) return { x, y };
  const hasT = Number.isFinite(tx) && Number.isFinite(ty);
  const r = nearestArea(areas, hasT ? tx : cx, hasT ? ty : cy);
  if (!r) return { x, y };
  return clampToRect({ x: r.x + EDGE_MARGIN, y: r.y + EDGE_MARGIN,
    width: r.width - 2 * EDGE_MARGIN, height: r.height - 2 * EDGE_MARGIN }, x, y, size);
}

// 按面积加权随机选屏 + 屏内随机窗口位置（rand 可注入便于测试）
function randomWindowPos(areas, size, rand = Math.random) {
  const total = areas.reduce((s, r) => s + r.width * r.height, 0);
  if (!areas.length || total <= 0) return { x: 0, y: 0 };
  let pick = rand() * total, r = areas[0];
  for (const a of areas) { pick -= a.width * a.height; if (pick <= 0) { r = a; break; } }
  return {
    x: r.x + rand() * Math.max(0, r.width - size),
    y: r.y + rand() * Math.max(0, r.height - size)
  };
}

module.exports = { clampToRect, distToRect, nearestArea, clampWindow, clampStep, randomWindowPos };
