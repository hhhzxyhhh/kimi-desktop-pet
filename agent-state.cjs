// 多会话 agent 状态聚合（纯 Node 模块，可单测）
// 每个 Kimi Code 会话一个状态文件，桌宠按优先级汇总：
// 需要用户响应(permission/ask) > 出错(error) > 在忙(working/searching/thinking) > 完成庆祝(done) > 空闲
const FLASH_TTL = { done: 3500, error: 5000 }; // 瞬时庆祝/报错：闪一下就恢复
const STALE_TTL = 2 * 3600 * 1000; // 会话文件 2h 没更新：会话多半已死（没来得及发 SessionEnd），不计入
const TIER = { permission: 5, ask: 5, error: 4, working: 3, searching: 3, thinking: 3, done: 2, idle: 1 };

// 单个会话文件 → 有效状态：done/error 过期转 idle；PostToolUse 的 working 连续 15s
// 没有任何动作 = 真在沉思，降级为 thinking（ts 视为当下推导，别被防乱序拦掉）
function effectiveState(s, now) {
  if (!s || !Number.isFinite(s.ts)) return { state: 'idle', ts: 0, stale: true };
  let state = s.state, ts = s.ts;
  const flash = FLASH_TTL[state];
  if (flash && now - s.ts >= flash) { state = 'idle'; ts = now; }
  if (state === 'working' && s.ev === 'PostToolUse' && now - s.ts > 15000) { state = 'thinking'; ts = now; }
  return { state, ts, stale: now - s.ts > STALE_TTL };
}

// sessions: [{state, ev, ts}] → { state, ts }：跳过空闲与死会话，同优先级取事件最新的
function aggregate(sessions, now) {
  let best = null;
  for (const s of sessions) {
    const e = effectiveState(s, now);
    if (e.stale || e.state === 'idle') continue;
    if (!best || TIER[e.state] > TIER[best.state] ||
        (TIER[e.state] === TIER[best.state] && e.ts > best.ts)) best = e;
  }
  return best ? { state: best.state, ts: best.ts } : { state: 'idle', ts: now };
}

module.exports = { effectiveState, aggregate, FLASH_TTL, STALE_TTL, TIER };
