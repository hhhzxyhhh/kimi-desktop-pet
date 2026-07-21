// 预加载脚本：只暴露桌宠需要的几个通道，不开 nodeIntegration
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  // 宠物走一步（{dx,dy} 像素，可为小数），主进程移动窗口并钳回屏幕内
  step: (d) => ipcRenderer.send('pet-step', d),
  // 拖拽开始：主进程记下窗口当前位置和尺寸
  dragStart: () => ipcRenderer.send('pet-drag-start'),
  // 拖拽中：鼠标在屏幕坐标系的绝对位移，主进程直接叠加
  dragTo: (payload) => ipcRenderer.send('pet-drag', payload),
  // 滚轮调节大小（dy 正负决定方向，ax/ay 为鼠标视口坐标，vw/vh 为视口宽高）
  resize: (payload) => ipcRenderer.send('pet-resize', payload),
  // 双击：打开一个 Kimi Code 终端
  openTerminal: () => ipcRenderer.send('pet-open-terminal'),
  // 主进程通报当前缩放倍数（气泡反向补偿用）
  onScale: (cb) => ipcRenderer.on('pet-scale', (_e, s) => cb(s)),
  // 主进程通报光标屏幕坐标（眼睛追踪用）
  onCursor: (cb) => ipcRenderer.on('cursor-pos', (_e, p) => cb(p)),
  // 主进程通报行为模式（stay / kolo）
  onMode: (cb) => ipcRenderer.on('set-mode', (_e, m) => cb(m)),
  // 主进程通报 Kimi Code agent 状态（thinking/working/searching/permission/done/error/idle）
  onAgentState: (cb) => ipcRenderer.on('agent-state', (_e, p) => cb(p)),
  // 调试用：查询主进程权威状态
  debugState: () => ipcRenderer.invoke('pet-debug-state'),
  // 调试用：测试时开关鼠标穿透
  debugIgnoreMouse: (flag) => ipcRenderer.invoke('pet-debug-ignore-mouse', flag),
  // 调试用：重置 agent 状态跟踪
  debugResetAgent: () => ipcRenderer.invoke('pet-debug-reset-agent'),
  // 右键菜单事件
  onToggleSleep: (cb) => ipcRenderer.on('toggle-sleep', () => cb()),
  // 主进程气泡通报（装终端进度等；sticky 时气泡常驻等用户点掉）
  onToast: (cb) => ipcRenderer.on('pet-toast', (_e, p) => cb(p)),
  // 超强提醒开关：permission/ask 超时没人理，宠物闪现到光标旁上蹿下跳
  onSuperRemind: (cb) => ipcRenderer.on('super-remind', (_e, on) => cb(on)),
  // 拖拽时抑制提醒闪现（不然球会从手里被抢走）
  remindSuppress: (f) => ipcRenderer.send('pet-remind-suppress', f)
});
