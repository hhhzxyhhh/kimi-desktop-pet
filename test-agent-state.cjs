// agent-state.cjs 单元测试：多会话状态聚合（纯 Node，任何平台可跑）
// 用法: node test-agent-state.cjs
const { effectiveState, aggregate, STALE_TTL } = require('./agent-state.cjs');

let failures = 0;
function check(name, actual, expected, detail = '') {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}${detail ? '  ' + detail : ''}`);
}

const NOW = 1_000_000_000;
const ago = (ms) => NOW - ms;
const S = (state, ageMs, ev) => ({ state, ev, ts: ago(ageMs) });

/* ---------- effectiveState：单会话状态推导 ---------- */
check('working 保持', effectiveState(S('working', 2000, 'PreToolUse'), NOW).state, 'working');
check('PostToolUse 15s 内仍在干活', effectiveState(S('working', 14000, 'PostToolUse'), NOW).state, 'working');
check('PostToolUse 超 15s 降级 thinking', effectiveState(S('working', 16000, 'PostToolUse'), NOW).state, 'thinking');
check('非 PostToolUse 的 working 不降级', effectiveState(S('working', 60000, 'PreToolUse'), NOW).state, 'working');
check('done 3.5s 内是 done', effectiveState(S('done', 3000), NOW).state, 'done');
check('done 过期转 idle', effectiveState(S('done', 4000), NOW).state, 'idle');
check('error 5s 内是 error', effectiveState(S('error', 4500), NOW).state, 'error');
check('error 过期转 idle', effectiveState(S('error', 6000), NOW).state, 'idle');
check('超过 STALE_TTL 标记 stale', effectiveState(S('working', STALE_TTL + 1000, 'PreToolUse'), NOW).stale, true);
check('缺 ts 视为 stale', effectiveState({ state: 'working' }, NOW).stale, true);

/* ---------- aggregate：多会话聚合 ---------- */
check('无会话 → idle', aggregate([], NOW).state, 'idle');
check('全部 idle → idle', aggregate([S('idle', 1000), S('idle', 500)], NOW).state, 'idle');
check('单会话在忙', aggregate([S('working', 2000, 'PreToolUse')], NOW).state, 'working');
check('A 完成庆祝 + B 在忙 → 在忙优先', aggregate([S('done', 1000), S('working', 8000, 'PreToolUse')], NOW).state, 'working');
check('A 在忙 + B 请求权限 → 权限最优先', aggregate([S('working', 1000, 'PreToolUse'), S('permission', 9000)], NOW).state, 'permission');
check('A 提问 + B 搜索 → 提问优先', aggregate([S('searching', 1000), S('ask', 20000)], NOW).state, 'ask');
check('A 在忙 + B 刚出错 → 出错优先', aggregate([S('working', 1000, 'PreToolUse'), S('error', 1000)], NOW).state, 'error');
check('同级取最新事件：B 的思考比 A 的工作新', aggregate([S('working', 9000, 'PreToolUse'), S('thinking', 1000)], NOW).state, 'thinking');
check('done 过期后只剩另一个会话在忙', aggregate([S('done', 10000), S('searching', 3000)], NOW).state, 'searching');
check('死会话不计入：只剩死会话 → idle', aggregate([S('working', STALE_TTL + 5000, 'PreToolUse')], NOW).state, 'idle');
check('死会话不抢活会话的镜', aggregate([S('permission', STALE_TTL + 5000), S('working', 1000, 'PreToolUse')], NOW).state, 'working');
check('B 被 interrupt 回 idle 后 A 仍在忙', aggregate([S('working', 3000, 'PreToolUse'), S('idle', 500)], NOW).state, 'working');

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
