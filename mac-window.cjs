// mac-window.cjs - macOS 专属 NSWindow 调整（Electron 不暴露的能力）
// 移植自 Clawd On Desk 的 src/mac-window.js（同一台机器上的姊妹项目）
// 用途：让窗口豁免台前调度的左侧保留区钳制、全屏 Space 覆盖、切 Space 动画隐藏
const isMac = process.platform === 'darwin';

// AppKit NSWindowCollectionBehavior 枚举值
const NSWindowCollectionBehaviorCanJoinAllSpaces = 1 << 0;
const NSWindowCollectionBehaviorMoveToActiveSpace = 1 << 1;
const NSWindowCollectionBehaviorManaged = 1 << 2;
const NSWindowCollectionBehaviorTransient = 1 << 3;
const NSWindowCollectionBehaviorStationary = 1 << 4;
const NSWindowCollectionBehaviorParticipatesInCycle = 1 << 5;
const NSWindowCollectionBehaviorIgnoresCycle = 1 << 6;
const NSWindowCollectionBehaviorFullScreenPrimary = 1 << 7;
const NSWindowCollectionBehaviorFullScreenAuxiliary = 1 << 8;
const NSWindowCollectionBehaviorFullScreenNone = 1 << 9;
const NSWindowCollectionBehaviorFullScreenAllowsTiling = 1 << 11;
const NSWindowCollectionBehaviorFullScreenDisallowsTiling = 1 << 12;
const NSWindowCollectionBehaviorPrimary = 1 << 16;
const NSWindowCollectionBehaviorAuxiliary = 1 << 17;
const NSWindowCollectionBehaviorCanJoinAllApplications = 1 << 18;
const NSWindowAnimationBehaviorNone = 2;
const CGAssistiveTechHighWindowLevel = 1500;

let objc = null;
let selWindow, selCollectionBehavior, selSetCollectionBehavior, selSetAnimationBehavior,
  selSetCanHide, selSetHidesOnDeactivate, selSetMovable, selSetLevel, selWindowNumber,
  selNumberWithInt, selArrayWithObject;
let warnedApplyFailure = false;
let warnedSkyLightFailure = false;
let skyLight = null;

function initObjc() {
  if (objc) return objc;
  const koffi = require('koffi');
  const libobjc = koffi.load('/usr/lib/libobjc.A.dylib');
  const objc_getClass = libobjc.func('void *objc_getClass(const char *name)');
  const sel_registerName = libobjc.func('void *sel_registerName(const char *name)');
  objc = {
    NSNumber: objc_getClass('NSNumber'),
    NSArray: objc_getClass('NSArray'),
    msgPtr: libobjc.func('objc_msgSend', 'void *', ['void *', 'void *']),
    msgULong: libobjc.func('objc_msgSend', 'ulong', ['void *', 'void *']),
    msgLong: libobjc.func('objc_msgSend', 'long', ['void *', 'void *']),
    msgPtrInt: libobjc.func('objc_msgSend', 'void *', ['void *', 'void *', 'int']),
    msgPtrPtr: libobjc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *']),
    msgVoidULong: libobjc.func('objc_msgSend', 'void', ['void *', 'void *', 'ulong']),
    msgVoidLong: libobjc.func('objc_msgSend', 'void', ['void *', 'void *', 'long']),
    msgVoidBool: libobjc.func('objc_msgSend', 'void', ['void *', 'void *', 'bool']),
  };
  selWindow = sel_registerName('window');
  selCollectionBehavior = sel_registerName('collectionBehavior');
  selSetCollectionBehavior = sel_registerName('setCollectionBehavior:');
  selSetAnimationBehavior = sel_registerName('setAnimationBehavior:');
  selSetCanHide = sel_registerName('setCanHide:');
  selSetHidesOnDeactivate = sel_registerName('setHidesOnDeactivate:');
  selSetMovable = sel_registerName('setMovable:');
  selSetLevel = sel_registerName('setLevel:');
  selWindowNumber = sel_registerName('windowNumber');
  selNumberWithInt = sel_registerName('numberWithInt:');
  selArrayWithObject = sel_registerName('arrayWithObject:');
  return objc;
}

function initSkyLight() {
  if (skyLight) return skyLight;
  // SkyLight 私有框架：建一个 stationary 私有 Space 把窗口挪进去，
  // 脱离常规窗口管理（台前调度钳制、切 Space 动画隐藏都管不着它）
  const koffi = require('koffi');
  const lib = koffi.load('/System/Library/PrivateFrameworks/SkyLight.framework/Versions/A/SkyLight');
  const SLSMainConnectionID = lib.func('SLSMainConnectionID', 'int', []);
  const SLSSpaceCreate = lib.func('SLSSpaceCreate', 'int', ['int', 'int', 'int']);
  const SLSSpaceSetAbsoluteLevel = lib.func('SLSSpaceSetAbsoluteLevel', 'int', ['int', 'int', 'int']);
  const SLSShowSpaces = lib.func('SLSShowSpaces', 'int', ['int', 'void *']);
  const SLSSpaceAddWindowsAndRemoveFromSpaces = lib.func('SLSSpaceAddWindowsAndRemoveFromSpaces', 'int', ['int', 'int', 'void *', 'int']);
  const connection = SLSMainConnectionID();
  const space = SLSSpaceCreate(connection, 1, 0);
  skyLight = { connection, space, SLSSpaceAddWindowsAndRemoveFromSpaces };
  SLSSpaceSetAbsoluteLevel(connection, space, 100);
  SLSShowSpaces(connection, makeNSNumberArray(space));
  return skyLight;
}

function nativeHandleToPointer(handle) {
  if (!handle || handle.length < 8) return null;
  const ptr = handle.readBigUInt64LE(0);
  return ptr === 0n ? null : ptr;
}

function makeNSNumberArray(value) {
  const { NSNumber, NSArray, msgPtrInt, msgPtrPtr } = initObjc();
  const number = msgPtrInt(NSNumber, selNumberWithInt, value);
  return msgPtrPtr(NSArray, selArrayWithObject, number);
}

function delegateWindowToStationarySpace(nsWindow) {
  try {
    const { msgLong } = initObjc();
    const { connection, space, SLSSpaceAddWindowsAndRemoveFromSpaces } = initSkyLight();
    const windowNumber = Number(msgLong(nsWindow, selWindowNumber)) || 0;
    if (!windowNumber) return false;
    SLSSpaceAddWindowsAndRemoveFromSpaces(connection, space, makeNSNumberArray(windowNumber), 7);
    return true;
  } catch (err) {
    if (!warnedSkyLightFailure) {
      console.warn('[mac-window] 挪进 stationary Space 失败:', err.message);
      warnedSkyLightFailure = true;
    }
    return false;
  }
}

// 给窗口施加 stationary 行为（台前调度钳制豁免 + 跨 Space 可见）。
// 注意：照搬 Clawd 的 setMovable(false)——我们的拖拽是程序化 setPosition，不受影响，
// 而系统侧（台前调度等）从此挪不动这个窗口，这正是豁免的关键之一。
function applyStationaryCollectionBehavior(browserWindow) {
  if (!isMac || !browserWindow || browserWindow.isDestroyed()) return false;
  try {
    const { msgPtr, msgULong, msgVoidULong, msgVoidLong, msgVoidBool } = initObjc();
    const nsView = nativeHandleToPointer(browserWindow.getNativeWindowHandle());
    if (!nsView) return false;
    const nsWindow = msgPtr(nsView, selWindow);
    if (!nsWindow) return false;
    const current = Number(msgULong(nsWindow, selCollectionBehavior)) || 0;
    const clearMask =
      NSWindowCollectionBehaviorMoveToActiveSpace |
      NSWindowCollectionBehaviorManaged |
      NSWindowCollectionBehaviorTransient |
      NSWindowCollectionBehaviorParticipatesInCycle |
      NSWindowCollectionBehaviorFullScreenPrimary |
      NSWindowCollectionBehaviorFullScreenNone |
      NSWindowCollectionBehaviorFullScreenAllowsTiling |
      NSWindowCollectionBehaviorPrimary |
      NSWindowCollectionBehaviorAuxiliary |
      NSWindowCollectionBehaviorCanJoinAllApplications;
    const setMask =
      NSWindowCollectionBehaviorCanJoinAllSpaces |
      NSWindowCollectionBehaviorStationary |
      NSWindowCollectionBehaviorFullScreenAuxiliary |
      NSWindowCollectionBehaviorIgnoresCycle |
      NSWindowCollectionBehaviorFullScreenDisallowsTiling;
    const next = (current & ~clearMask) | setMask;
    if (next !== current) msgVoidULong(nsWindow, selSetCollectionBehavior, next);
    msgVoidBool(nsWindow, selSetCanHide, false);
    msgVoidBool(nsWindow, selSetHidesOnDeactivate, false);
    msgVoidBool(nsWindow, selSetMovable, false);
    msgVoidLong(nsWindow, selSetAnimationBehavior, NSWindowAnimationBehaviorNone);
    msgVoidLong(nsWindow, selSetLevel, CGAssistiveTechHighWindowLevel);
    delegateWindowToStationarySpace(nsWindow);
    return true;
  } catch (err) {
    if (!warnedApplyFailure) {
      console.warn('[mac-window] 施加 stationary 行为失败:', err.message);
      warnedApplyFailure = true;
    }
    return false;
  }
}

module.exports = { applyStationaryCollectionBehavior };
