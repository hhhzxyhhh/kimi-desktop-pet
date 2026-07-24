// Kimi Code 联动自动安装：检测到 Kimi Code 家目录就把 hook 装好。
// 用户手动卸载过（settings 有安装标记但配置已没了）则尊重，不再自动装。
// 纯 Node 模块（不碰 Electron）：main.js 启动时调用，test-hook.cjs 单测直接驱动
const fs = require('fs');
const path = require('path');

const MARK = 'pet-hook.cjs';
const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'PermissionResult',
  'Stop', 'StopFailure', 'Interrupt', 'SessionStart', 'SessionEnd', 'Notification', 'SubagentStart', 'SubagentStop'];

// TOML 基础字符串里反斜杠是转义符：Windows 路径必须双写，否则写出的 config.toml 直接解析失败
function hookBlock(events, hookDst) {
  const dstToml = hookDst.replace(/\\/g, '\\\\');
  return events.map(e =>
    `\n[[hooks]]\nevent = "${e}"\ncommand = "node \\"${dstToml}\\""\ntimeout = 3\n`).join('');
}

// opts: { kimiHome, hookSrc, loadSettings, patchSettings, log? }
function ensureAgentHook({ kimiHome, hookSrc, loadSettings, patchSettings, log = console.log }) {
  try {
    if (!fs.existsSync(kimiHome)) return; // 没装 Kimi Code，跳过
    const hookDst = path.join(kimiHome, 'hooks', MARK);
    const cfg = path.join(kimiHome, 'config.toml');
    const cfgText = fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : '';
    const st = loadSettings();
    if (cfgText.includes(MARK)) {
      // 已安装：同步脚本内容，并补齐新增事件（老配置自动升级）
      const src = fs.readFileSync(hookSrc, 'utf8');
      const dst = fs.existsSync(hookDst) ? fs.readFileSync(hookDst, 'utf8') : '';
      // hooks 目录可能整个被用户清掉（配置还在），不先建目录 copyFileSync 会直接抛错中断后续补齐
      if (src !== dst) {
        fs.mkdirSync(path.dirname(hookDst), { recursive: true });
        fs.copyFileSync(hookSrc, hookDst);
      }
      // 注意按"同一 hook 块内既有事件名又有 pet-hook.cjs"判断，别家 hook 的同名事件不算
      const missing = EVENTS.filter(e =>
        !new RegExp(`event\\s*=\\s*"${e}"[\\s\\S]{0,200}pet-hook\\.cjs`).test(cfgText));
      if (missing.length) {
        fs.appendFileSync(cfg, hookBlock(missing, hookDst));
        log('[agent-link] 已补充 hook 事件:', missing.join(', '));
      }
      if (!st.agentLinkInstalled) patchSettings({ agentLinkInstalled: true });
      return;
    }
    if (st.agentLinkInstalled) return; // 用户手动卸载过，不再自动装
    fs.mkdirSync(path.dirname(hookDst), { recursive: true });
    fs.copyFileSync(hookSrc, hookDst);
    fs.appendFileSync(cfg, hookBlock(EVENTS, hookDst));
    patchSettings({ agentLinkInstalled: true });
    log('[agent-link] hook 已自动安装到', hookDst);
  } catch (e) {
    log('[agent-link] 自动安装跳过:', e.message);
  }
}

module.exports = { ensureAgentHook, hookBlock, EVENTS, MARK };
