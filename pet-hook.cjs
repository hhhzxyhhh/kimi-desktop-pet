// Kimi Code hook → Kimi 桌宠状态桥
// 从 stdin 读 hook 事件 JSON，按会话写状态文件（每会话一个，桌宠主进程每 500ms 轮询整个目录做聚合）
// 安装位置：~/.kimi-code/hooks/pet-hook.cjs（由 config.toml 的 [[hooks]] 调用）
const fs = require('fs');
const os = require('os');
const path = require('path');

// 与 Electron userData 对齐的状态目录路径（跨平台）；KIMI_PET_STATE_DIR 可覆盖（测试隔离用）
const appData = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support')
  : process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
    : path.join(os.homedir(), '.config');
const STATE_DIR = process.env.KIMI_PET_STATE_DIR || path.join(appData, 'kimi-desktop-pet', 'agent-state');

let input = '';
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  let p = {};
  try { p = JSON.parse(input); } catch {}
  const ev = p.hook_event_name || '';
  const tool = p.tool_name || '';
  // 工具名归一化：CLI 可能给 PascalCase 也可能 snake_case（参考 Clawd 的 normalizeToolName）
  const normTool = tool.toLowerCase().replace(/[_-]/g, '');

  let state = null;
  if (ev === 'UserPromptSubmit') state = 'thinking';          // 收到任务，思考中
  else if (ev === 'PreToolUse') {                              // 调工具：提问/搜索/其他区分
    if (normTool === 'askuserquestion') state = 'ask';
    else state = /^(websearch|fetchurl)$/.test(normTool) ? 'searching' : 'working';
  }
  else if (ev === 'PermissionRequest') state = 'permission';   // 等待用户批准
  else if (ev === 'PostToolUse') state = 'working';            // 工具完成，继续干活（写东西/分析）
  else if (ev === 'PermissionResult') state = 'working';       // 批准完继续干
  else if (ev === 'Stop') state = 'done';                      // 回合完成（只认 Stop，后台任务通知不算）
  else if (ev === 'StopFailure') state = 'error';              // 回合失败
  else if (ev === 'Interrupt' || ev === 'SessionEnd' || ev === 'SessionStart') state = 'idle';
  // SessionStart 也复位（参考 Clawd On Desk）：新会话不继承上一个死会话的残留状态

  if (!state) return; // 不关心的事件（PostToolUseFailure 等）直接忽略
  // 每个会话一个文件：多窗口同时开时互不覆盖，主进程聚合；文件名只留安全字符
  const sessionId = String(p.session_id || 'unknown').replace(/[^\w-]/g, '_');
  const file = path.join(STATE_DIR, sessionId + '.json');
  try {
    // 会话结束：直接删掉它的状态文件，不残留占位
    if (ev === 'SessionEnd') { fs.rmSync(file, { force: true }); return; }
    fs.mkdirSync(STATE_DIR, { recursive: true });
    // ev 带给主进程：PostToolUse 的 working 超时无动作才降级为 thinking
    // proj 带给渲染层：完成播报/会话菜单显示项目名（cwd 末级目录）
    const proj = p.cwd ? path.basename(p.cwd) : '';
    fs.writeFileSync(file, JSON.stringify({ state, tool, ev, proj, ts: Date.now() }));
  } catch {}
});
