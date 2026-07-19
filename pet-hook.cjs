// Kimi Code hook → Kimi 桌宠状态桥
// 从 stdin 读 hook 事件 JSON，把 agent 状态写入桌宠的状态文件（桌宠主进程每 500ms 轮询）
// 安装位置：~/.kimi-code/hooks/pet-hook.cjs（由 config.toml 的 [[hooks]] 调用）
const fs = require('fs');
const os = require('os');
const path = require('path');

// 与 Electron userData 对齐的状态文件路径（跨平台）
const appData = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support')
  : process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
    : path.join(os.homedir(), '.config');
const STATE_FILE = path.join(appData, 'kimi-desktop-pet', 'agent-state.json');

let input = '';
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  let p = {};
  try { p = JSON.parse(input); } catch {}
  const ev = p.hook_event_name || '';
  const tool = p.tool_name || '';

  let state = null;
  if (ev === 'UserPromptSubmit') state = 'thinking';          // 收到任务，思考中
  else if (ev === 'PreToolUse') {                              // 调工具：提问/搜索/其他区分
    if (tool === 'AskUserQuestion') state = 'ask';
    else state = /^(WebSearch|FetchURL)$/.test(tool) ? 'searching' : 'working';
  }
  else if (ev === 'PermissionRequest') state = 'permission';   // 等待用户批准
  else if (ev === 'PostToolUse') state = 'working';            // 工具完成（含问题已回答），回岗位
  else if (ev === 'PermissionResult') state = 'thinking';      // 批准完继续想
  else if (ev === 'Stop') state = 'done';                      // 回合完成（只认 Stop，后台任务通知不算）
  else if (ev === 'StopFailure') state = 'error';              // 回合失败
  else if (ev === 'Interrupt' || ev === 'SessionEnd' || ev === 'SessionStart') state = 'idle';
  // SessionStart 也复位（参考 Clawd On Desk）：新会话不继承上一个死会话的残留状态

  if (!state) return; // 不关心的事件（PostToolUse 等）直接忽略
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ state, tool, ts: Date.now() }));
  } catch {}
});
