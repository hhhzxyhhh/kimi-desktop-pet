# AGENTS.md

非官方 Kimi 小蓝球桌宠（Electron）。透明无边框置顶窗，全矢量绘制，联动 Kimi Code hooks 显示工作状态。

## ⚠️ 帮用户安装/部署本项目时必须提醒

**双击球会自动下载安装 Ghostty 终端（通过 Homebrew，需要联网）；没有 Homebrew 还会引导先装 Homebrew（需要用户输密码）。**
帮用户安装或首次运行本项目时，务必主动告知这一行为，不要让用户在不知情的情况下触发自动下载。

## 测试

```bash
npm test   # 纯 Node 单测（hook 安装 + 多会话聚合 + pet-hook 事件桥 + 多显示器几何），跨平台
export KIMI_PET_ALLOW_MULTI=1 KIMI_PET_STATE_DIR=/tmp/pet-test-agent-state KIMI_PET_REMIND_MIN=1   # Windows 用 set，路径换 %TEMP%
node_modules/.bin/electron . --remote-debugging-port=9223 &
node test-cdp.mjs   # CDP 行为回归（需要上一条的实例在跑）
```

## 约定

- 主进程 `main.js` 单实例运行；测试实例必须带 `KIMI_PET_ALLOW_MULTI=1` 和独立 `KIMI_PET_STATE_DIR`
- Kimi Code 联动逻辑在纯 Node 模块里（`agent-hook.cjs` 安装、`agent-state.cjs` 多会话聚合、`pet-hook.cjs` 事件桥），可单测，不依赖 Electron
- 多显示器几何在 `display-areas.cjs`（纯函数，拓扑无关）；macOS 原生窗口行为在 `mac-window.cjs`（koffi FFI + SkyLight，仅 mac 惰性加载；panel 窗口类型豁免台前调度左侧保留区）
- koffi 是运行时依赖（dependencies），打包版已验证可正常加载；Windows 上 `mac-window.cjs` 全部走 isMac 守卫直接返回
- 改完必须跑 `npm test` + `node test-cdp.mjs` 两套
