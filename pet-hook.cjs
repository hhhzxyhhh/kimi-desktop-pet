// Kimi Code hook → Kimi 桌宠状态桥
// 从 stdin 读 hook 事件 JSON，按会话写状态文件（每会话一个，桌宠主进程每 500ms 轮询整个目录做聚合）
// 顺带记录调用方进程 pid 链（父/祖），主进程探活：CLI 死了点立刻消失，不靠 TTL
// 安装位置：~/.kimi-code/hooks/pet-hook.cjs（由 config.toml 的 [[hooks]] 调用）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// 与 Electron userData 对齐的状态目录路径（跨平台）；KIMI_PET_STATE_DIR 可覆盖（测试隔离用）
const appData = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support')
  : process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
    : path.join(os.homedir(), '.config');
const STATE_DIR = process.env.KIMI_PET_STATE_DIR || path.join(appData, 'kimi-desktop-pet', 'agent-state');

// 调用方进程链：父进程 + 祖父进程（CLI 可能直接拉起 node，也可能经 sh -c，两级都记，主进程任一存活即算活）
function ancestorPids() {
  const pids = [process.ppid].filter(Boolean);
  if (process.platform !== 'win32') {
    try {
      const out = execSync(`ps -o ppid= -p ${process.ppid} 2>/dev/null`, { timeout: 1000 }).toString().trim();
      const gp = parseInt(out, 10);
      if (Number.isFinite(gp) && gp > 0 && !pids.includes(gp)) pids.push(gp);
    } catch {}
  }
  return pids;
}

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
  else if (ev === 'Stop') state = 'done';                      // 回合完成（只认主回合 Stop，后台任务/子代理不算）
  else if (ev === 'StopFailure') state = 'error';              // 回合失败
  else if (ev === 'SubagentStart' || ev === 'SubagentStop') state = 'working'; // 子代理开工/收工：主回合仍在工作，done 只认主回合 Stop
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
    // pids 带给主进程：调用方进程链探活（CLI 死了立刻清场）
    const proj = p.cwd ? path.basename(p.cwd) : '';
    fs.writeFileSync(file, JSON.stringify({ state, tool, ev, proj, cwd: p.cwd || '', pids: ancestorPids(), ts: Date.now() }));
  } catch {}
});
