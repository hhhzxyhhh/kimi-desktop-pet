# 非官方小蓝球

一只活的蓝色小球，住在你的桌面上。透明无边框置顶悬浮窗，全矢量绘制，无贴图。

![非官方](https://img.shields.io/badge/%E9%9D%9E%E5%AE%98%E6%96%B9-%E7%B2%89%E4%B8%9D%E4%BD%9C%E5%93%81-1983FC)

## 它会做什么

- **自主生活**：发呆（呼吸+眨眼）→ 蹦跶着散步（支持多显示器，跨屏沿边滑行）→ 偶尔犯困摊成一滩冒 zzz，循环往复
- **戳它**（左键）：会疼，会抗议，有概率冒爱心眼或吓得瞪眼
- **拎起来**（按住拖动）：惊恐脸 + 果冻拉伸；拎超过 3 秒会流汗，松手落地有 20% 概率头晕
- **说话**（右键菜单）：原地蹦跶 + 冒气泡（它没有嘴，设定如此）
- **双击**：打开一个 Ghostty 终端跑 Kimi Code（可在右键菜单"双击"里改成打开官网 kimi.com）；没装 Ghostty 会先用气泡说一声再自动装（有 Homebrew 直接装；没有 Homebrew 会弹出终端引导你装，输一次密码后全自动）

> ⚠️ **注意：双击 = 自动下载**。双击球时如果你没装 Ghostty，它会**自动通过 Homebrew 下载安装 Ghostty**（气泡和系统通知都会提示，装完自动开终端）。不想让任何东西自动下载的话，只用右键菜单，别双击。
- **表情丰富**：自然睡醒会开心，被戳醒会生气，睡觉得打呼噜冒 zzz
- **滚轮缩放**：96–600px 无级调节，以鼠标为中心，气泡始终固定大小贴头顶
- **眼睛看向鼠标**：你在它旁边晃，它会看你
- **记住状态**：大小、位置和模式重启后自动恢复
- **两种模式**：`stay` 乖乖待着（原地生活，不散步）/ `kolo` 到处乱跑（kimi only live once，台球式全屏游走，撞四边按轴反弹）
- **联动 Kimi Code**：你给它派活时它会同步"上班"（见下）
- **托盘图标**：macOS 菜单栏 / Windows 系统托盘，和右键同一套菜单
- **超强提醒**：Kimi Code 等你批准 / 向你提问超过设定时间没人理，它就闪现到鼠标旁边上蹿下跳（右键菜单"超强提醒"设 1/5/10 分钟，默认关）
- **右键菜单**：模式 / 双击 / 超强提醒 / 会话状态 / 退出
- 睡觉时戳它会被骂

## 下载与使用

**方式一：下载打包好的应用（零命令，推荐）**

到 [Actions](../../../actions) 页面点最新一次成功的构建，在底部 Artifacts 下载（需登录 GitHub）：

- `kimi-desktop-pet-macos-latest`：macOS 的 .app / .dmg，首次打开在 Finder 里**右键 → 打开 → 打开**
- `kimi-desktop-pet-windows-latest`：Windows 便携 exe，首次运行 SmartScreen 选**"更多信息 → 仍要运行"**

**方式二：源码运行**

需要 Node.js ≥ 18（终端里 `node -v` 检查；没有的话到 [nodejs.org](https://nodejs.org) 装 LTS 版）：

```bash
git clone https://github.com/hhhzxyhhh/kimi-desktop-pet.git   # 或网页上 Code → Download ZIP 解压
cd kimi-desktop-pet
npm install
npm start
```

> 只想快速看一眼长什么样？直接双击 `index.html` 用浏览器打开也行——
> 动画都在，只是没有桌面窗口，它不会满屏走。

## 操作一览

| 操作 | 效果 |
| --- | --- |
| 左键单击 | 戳，抗议（概率爱心眼/惊吓眼） |
| 按住拖动 | 拎起来，果冻拉伸，松手回弹 |
| 双击 | 打开 Ghostty 终端跑 Kimi Code（没装会先说一声再自动装；没有 Homebrew 会引导你先装它） |
| 滚轮 | 调节大小（96–600px） |
| 右键 | 菜单：打开终端、模式、双击、超强提醒、开机自启（打包版生效）、会话状态、退出 |
| 菜单栏/托盘图标 | 同一套菜单（找不到右键入口时用） |
| 睡觉时戳 | 被凶 |

## 联动 Kimi Code（可选，默认开启）

**开箱自动安装**：首次启动时若检测到 `~/.kimi-code`（即你装了 Kimi Code CLI），会自动把 hook 脚本和 `config.toml` 规则配好，无需任何手动操作；如果你之后手动卸掉，它不会再来烦你（不重复自动装）。没装 Kimi Code 则自动跳过。

联动原理：Kimi Code hooks 事件 → `~/.kimi-code/hooks/pet-hook.cjs` → 状态目录（每会话一个文件）→ 桌宠轮询聚合：

| Kimi Code 状态 | 桌宠表情 |
| --- | --- |
| 你发出任务 / 工具间隙的思考 | 思考脸（眯眯眼 + 头顶大齿轮旋转） |
| 调用搜索类工具 | 默认眼 + 头顶大放大镜 |
| 调用其他工具 | 斜眼坚定 + 身前大键盘（按键波浪亮起） |
| 向你提问（AskUserQuestion） | 挑眉 + 头顶红色问号 |
| 请求权限 | 挑眉 + 头顶红色感叹号 |
| 回合完成 | 开心脸 + 气泡"搞定！"（3.5s 后恢复） |
| 回合失败 | 晕眩脸 |
| 打断 / 会话结束 | 恢复默认 |

开工期间它会原地"上班"不散步（来活了还会把它叫醒）；状态一直保持到下一个信号（工作几小时也不怕），完成/出错只是闪一下，CLI 退出或新会话开始立即恢复。
**同时开多个 Kimi Code 窗口也没问题**：每个会话单独跟踪，按优先级汇总——任何一个会话在等你批准或回答最优先，其次出错，再其次只要有会话在忙就上班，全部空闲才恢复默认；某个会话结束立即收点，终端被直接强杀（收不到 SessionEnd）时空闲状态 5 分钟、活跃状态 24 小时兜底清理。
多会话时它还会主动报告进度：**脚下一排指示点，数量 = 开着的会话窗口数**（绿点 = 在干活，灰点 = 空闲，红点 = 出错或在等你批准/回答）；**哪个会话完成**，气泡直接点名（「项目名」搞定！）；右键菜单的"会话状态"里能看到每个会话在干嘛。
想关闭联动：删掉 `~/.kimi-code/config.toml` 里 `pet-hook.cjs` 相关的 `[[hooks]]` 条目即可。

## 自动化测试（开发用）

```bash
npm test                                                   # 纯 Node 单测（hook 安装 + 多会话聚合 + pet-hook 事件桥）
export KIMI_PET_ALLOW_MULTI=1 KIMI_PET_STATE_DIR=/tmp/pet-test-agent-state KIMI_PET_REMIND_MIN=1   # Windows 用 set，路径换 %TEMP%
node_modules/.bin/electron . --remote-debugging-port=9223 &                  # 带调试端口启动（隔离联动状态）
node test-cdp.mjs                                                            # 再跑 CDP 行为回归
```

## 打包成应用（可选）

打包必须在对应系统上进行（没有 Windows 机器？push 到 GitHub 后，Actions 会自动双平台构建，在运行页的 Artifacts 里下载 dmg 和 exe）：

```bash
npm run dist:mac   # macOS → dist/ 里的 .app 和 .dmg
npm run dist:win   # Windows → dist/ 里的便携 exe
```

macOS 首次打开未签名应用：Finder 里**右键 → 打开 → 打开**即可。
Windows 未签名 exe 首次运行：SmartScreen 选**"更多信息 → 仍要运行"**。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `main.js` | 主进程：透明无边框窗口、置顶、托盘、右键菜单、窗口移动（走路/拖拽）、大小位置模式持久化、联动轮询 |
| `agent-hook.cjs` | Kimi Code hook 自动安装逻辑（纯 Node 模块，可单测） |
| `agent-state.cjs` | 多会话 agent 状态聚合（纯 Node 模块，可单测） |
| `preload.js` | 预加载：只暴露桌宠需要的 IPC 通道 |
| `index.html` | 渲染层：Kimi 矢量形象 + 行为状态机（发呆/散步/睡觉/戳/拖/说话/眼睛追踪/联动表情） |
| `pet-hook.cjs` | Kimi Code hooks 桥接脚本（事件 → 按会话写状态文件） |
| `gen-icon.cjs` | 图标生成（从 SVG 离屏栅格化出 `assets/`） |
| `assets/` | 图标 |
| `test-hook.cjs` | agent-hook 单元测试（纯 Node，跨平台） |
| `test-agent-state.cjs` | 多会话聚合单元测试（纯 Node，跨平台） |
| `test-pet-hook.cjs` | pet-hook 事件桥单元测试（stdin 驱动，纯 Node） |
| `test-cdp.mjs` | CDP 自动化回归测试 |
| `.github/workflows/build.yml` | GitHub Actions 双平台打包 |
| `package.json` | 依赖与打包配置 |

## 已知边界（v0.2）

- 配色/台词/行为概率都在 `index.html` 里，改起来直观，欢迎 PR（和吐槽）
