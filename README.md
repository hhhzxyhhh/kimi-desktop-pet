# Kimi 桌宠

一只活的 Kimi 官方头像，住在你的桌面上。透明无边框置顶悬浮窗，全矢量绘制，无贴图。

![形象](https://img.shields.io/badge/%E5%BD%A2%E8%B1%A1-Kimi%E5%AE%98%E6%96%B9%E5%A4%B4%E5%83%8F-1983FC)

## 它会做什么

- **自主生活**：发呆（呼吸+眨眼）→ 蹦跶着散步 → 偶尔犯困摊成一滩冒 zzz，循环往复
- **戳它**（左键）：会疼，会抗议，有概率吓得瞪眼
- **拎起来**（按住拖动）：惊恐脸 + 果冻拉伸，松手 duang 地弹回
- **说话**（双击，或右键菜单）：原地蹦跶 + 冒气泡（它没有嘴，设定如此）
- **右键菜单**：睡觉 / 叫醒 / 说句话 / 大小（120–480px 五档）/ 退出
- 睡觉时戳它会被骂

## 本地运行

需要 Node.js ≥ 18（终端里 `node -v` 检查；没有的话到 [nodejs.org](https://nodejs.org) 装 LTS 版）：

```bash
npm install
npm start
```

> 只想快速看一眼长什么样？直接双击 `index.html` 用浏览器打开也行——
> 动画都在，只是没有桌面窗口，它不会满屏走。

## 操作一览

| 操作 | 效果 |
| --- | --- |
| 左键单击 | 戳，抗议 |
| 按住拖动 | 拎起来，果冻拉伸，松手回弹 |
| 双击 | 说话 |
| 滚轮 | 调节大小（96–600px） |
| 右键 | 菜单：睡觉/叫醒、说句话、大小调节、退出 |
| 睡觉时戳 | 被凶 |

## 自动化测试（开发用）

```bash
node_modules/.bin/electron . --remote-debugging-port=9223   # 先带调试端口启动
node test-cdp.mjs                                            # 再跑测试（缩放/拖拽/气泡共 24 项断言）
```

## 打包成应用（可选）

打包必须在对应系统上进行：

```bash
npm run dist:mac   # macOS → dist/ 里的 .app 和 .dmg
npm run dist:win   # Windows → dist/ 里的便携 exe
```

macOS 首次打开未签名应用：Finder 里**右键 → 打开 → 打开**即可。

## 传到 GitHub

**网页上传（零命令）**：github.com 右上角 `+` → `New repository`（比如叫 `kimi-desktop-pet`，不要勾初始化 README）→ 仓库页点 `uploading an existing file` → 把本文件夹里的文件全选拖进去 → Commit。

**命令行**：

```bash
git init
git add .
git commit -m "Kimi 桌宠 v0.2"
git branch -M main
git remote add origin https://github.com/你的用户名/kimi-desktop-pet.git
git push -u origin main
```

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `main.js` | 主进程：透明无边框窗口、置顶、右键菜单、窗口移动（走路/拖拽） |
| `preload.js` | 预加载：只暴露桌宠需要的 IPC 通道 |
| `index.html` | 渲染层：Kimi 矢量形象 + 行为状态机（发呆/散步/睡觉/戳/拖/说话） |
| `package.json` | 依赖与打包配置 |

## 已知边界（v0.2）

- 只在主显示器活动，不会爬窗口、没有掉落物理
- 配色/台词/行为概率都在 `index.html` 里，改起来直观，欢迎 PR（和吐槽）
