// pet-hook.cjs 单元测试：用 stdin 驱动真实 hook 进程，验证状态文件的写入/删除（纯 Node，跨平台）
// 用法: node test-pet-hook.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let failures = 0;
function checkTrue(name, cond, detail = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-hook-run-'));
const env = { ...process.env, KIMI_PET_STATE_DIR: dir };
const runHook = (payload) =>
  execFileSync('node', [path.join(__dirname, 'pet-hook.cjs')], { input: JSON.stringify(payload), env });
const readSes = (id) => JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));

// T1: 普通工具事件 → working，项目名取自 cwd 末级，pid 链已记录
runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 's1', cwd: '/home/u/proj-a' });
const t1 = readSes('s1');
checkTrue('T1 调工具→working', t1.state === 'working', JSON.stringify(t1));
checkTrue('T1 项目名写入', t1.proj === 'proj-a', t1.proj);
checkTrue('T1 pid 链已记录且含父进程', Array.isArray(t1.pids) && t1.pids.length > 0 && t1.pids.every(Number.isInteger), JSON.stringify(t1.pids));

// T2: session_id 特殊字符文件名转义；搜索工具 → searching
runHook({ hook_event_name: 'PreToolUse', tool_name: 'WebSearch', session_id: 's/2: x', cwd: '/p' });
checkTrue('T2 文件名转义 + 搜索→searching', readSes('s_2__x').state === 'searching');

// T3: AskUserQuestion → ask；Interrupt → idle 覆盖
runHook({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', session_id: 's1' });
checkTrue('T3 提问→ask', readSes('s1').state === 'ask');
runHook({ hook_event_name: 'Interrupt', session_id: 's1' });
checkTrue('T3 打断→idle', readSes('s1').state === 'idle');

// T4: SessionEnd 删除自己的状态文件，不影响别的会话
runHook({ hook_event_name: 'SessionEnd', session_id: 's1' });
checkTrue('T4 会话结束删文件', !fs.existsSync(path.join(dir, 's1.json')) && fs.existsSync(path.join(dir, 's_2__x.json')));

// T5: 缺 session_id → unknown；缺 cwd → proj 空串
runHook({ hook_event_name: 'Stop' });
const t5 = readSes('unknown');
checkTrue('T5 缺省会话/项目名兜底', t5.state === 'done' && t5.proj === '', JSON.stringify(t5));

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
