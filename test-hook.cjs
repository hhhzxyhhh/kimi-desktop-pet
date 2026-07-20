// agent-hook.cjs 单元测试：纯 Node，不需要 Electron 和显示器，任何平台都能跑
// Windows 路径用例在此常驻（字符串模拟）；CI 的 windows runner 上跑的就是真 Windows 环境
// 用法: node test-hook.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureAgentHook, hookBlock, EVENTS, MARK } = require('./agent-hook.cjs');

let failures = 0;
function checkTrue(name, cond, detail = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

// TOML 基础字符串反转义：只覆盖我们会生成的转义（\\ 和 \"），遇到其他转义直接暴露
function tomlUnescape(s) {
  return s.replace(/\\(.)/g, (_, c) => ({ '\\': '\\', '"': '"' }[c] ?? `<非法转义\\${c}>`));
}
// 从配置文本抽出第一条 command 并按 TOML 规则还原成真实命令
function extractCommand(cfgText) {
  const m = cfgText.match(/command = "((?:[^"\\]|\\.)*)"/);
  return m ? tomlUnescape(m[1]) : null;
}

// 造一个隔离环境：临时目录当 fake Kimi Code 家目录 + 假 hook 源文件 + 内存 settings
function makeEnv({ settings = {}, withKimiHome = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-hook-test-'));
  const kimiHome = path.join(dir, '.kimi-code');
  if (withKimiHome) fs.mkdirSync(kimiHome, { recursive: true });
  const hookSrc = path.join(dir, 'src', MARK);
  fs.mkdirSync(path.dirname(hookSrc), { recursive: true });
  fs.writeFileSync(hookSrc, '// hook 源文件 v1\n');
  return {
    kimiHome, hookSrc, settings,
    run() {
      ensureAgentHook({
        kimiHome: this.kimiHome, hookSrc: this.hookSrc,
        loadSettings: () => this.settings,
        patchSettings: (p) => { this.settings = { ...this.settings, ...p }; },
        log: () => {},
      });
    },
    cfgText: () => {
      const cfg = path.join(kimiHome, 'config.toml');
      return fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : '';
    },
    hookDst: () => path.join(kimiHome, 'hooks', MARK),
  };
}

// T1: Windows 路径 → 写出的 TOML 合法，按规则还原后路径一个字都不差
const winDst = 'C:\\Users\\小明\\.kimi-code\\hooks\\pet-hook.cjs';
const cmd1 = extractCommand(hookBlock(['Stop'], winDst));
checkTrue('T1 Windows 路径 TOML 还原后一致', cmd1 === `node "${winDst}"`, cmd1 || '');

// T2: POSIX 路径不受影响
const posixDst = '/Users/t/.kimi-code/hooks/pet-hook.cjs';
const cmd2 = extractCommand(hookBlock(['Stop'], posixDst));
checkTrue('T2 POSIX 路径 TOML 还原后一致', cmd2 === `node "${posixDst}"`, cmd2 || '');

// T3: 首次安装：事件齐全 + hook 文件落地 + 设置打标且保留其他键
let env = makeEnv({ settings: { scale: 0.4 } });
env.run();
const cfg3 = env.cfgText();
checkTrue('T3 全部事件已安装', EVENTS.every(e => cfg3.includes(`event = "${e}"`)));
checkTrue('T3 hook 文件已复制', fs.readFileSync(env.hookDst(), 'utf8') === '// hook 源文件 v1\n');
checkTrue('T3 设置已标记且保留原键', env.settings.agentLinkInstalled === true && env.settings.scale === 0.4);
checkTrue('T3 command 路径还原正确', extractCommand(cfg3) === `node "${env.hookDst()}"`, extractCommand(cfg3) || '');

// T4: 幂等：再跑一次不产生重复块
env.run();
const count4 = (env.cfgText().match(/\[\[hooks\]\]/g) || []).length;
checkTrue('T4 重复运行不重复安装', count4 === EVENTS.length, `块数=${count4}`);

// T5: 老配置升级：只剩 2 个事件 → 补齐到全套，已有事件不重复
env = makeEnv();
fs.writeFileSync(path.join(env.kimiHome, 'config.toml'), hookBlock(['Stop', 'Notification'], env.hookDst()));
env.run();
const cfg5 = env.cfgText();
const count5 = (cfg5.match(/\[\[hooks\]\]/g) || []).length;
checkTrue('T5 老配置补齐缺失事件', count5 === EVENTS.length && EVENTS.every(e => cfg5.includes(`event = "${e}"`)), `块数=${count5}`);

// T6: 用户手动卸载过（标记在、配置没了）→ 尊重，不再自动装
env = makeEnv({ settings: { agentLinkInstalled: true } });
env.run();
checkTrue('T6 手动卸载后不再自动装', env.cfgText() === '' && !fs.existsSync(env.hookDst()));

// T7: 没装 Kimi Code → 完全不动
env = makeEnv({ withKimiHome: false });
env.run();
checkTrue('T7 无 Kimi Code 目录则跳过', !fs.existsSync(env.kimiHome) && env.settings.agentLinkInstalled === undefined);

// T8: 已安装但 hook 文件内容过时 → 同步成最新
env = makeEnv();
fs.mkdirSync(path.dirname(env.hookDst()), { recursive: true });
fs.writeFileSync(env.hookDst(), '// 旧版 hook\n');
fs.writeFileSync(path.join(env.kimiHome, 'config.toml'), hookBlock(EVENTS, env.hookDst()));
env.run();
checkTrue('T8 过时 hook 文件被同步', fs.readFileSync(env.hookDst(), 'utf8') === '// hook 源文件 v1\n');

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
