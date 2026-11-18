'use strict';
// Win32 API bindings via koffi (FFI). Only loaded on Windows; on other
// platforms `available` is false and every caller must check it first.
//
// Everything here is documented, public Win32 API:
//  - SendInput / GetAsyncKeyState / cursor APIs   -> auto clicker, macros, anti-AFK
//  - K32EnumProcesses / K32GetProcessMemoryInfo    -> process + RAM monitoring
//  - K32EmptyWorkingSet                            -> RAM trimmer (asks Windows to page out
//                                                     unused memory; never kills anything)
//  - CreateMutexW                                  -> multi-instance (OpenMulti)
//  - EnumWindows / SetWindowTextW                  -> session labels on Roblox windows

const isWin = process.platform === 'win32';
let k = null; // koffi
let api = null;

const consts = {
  INPUT_MOUSE: 0,
  INPUT_KEYBOARD: 1,
  MOUSEEVENTF_MOVE: 0x0001,
  MOUSEEVENTF_LEFTDOWN: 0x0002,
  MOUSEEVENTF_LEFTUP: 0x0004,
  MOUSEEVENTF_RIGHTDOWN: 0x0008,
  MOUSEEVENTF_RIGHTUP: 0x0010,
  MOUSEEVENTF_MIDDLEDOWN: 0x0020,
  MOUSEEVENTF_MIDDLEUP: 0x0040,
  MOUSEEVENTF_WHEEL: 0x0800,
  KEYEVENTF_EXTENDEDKEY: 0x0001,
  KEYEVENTF_KEYUP: 0x0002,
  KEYEVENTF_SCANCODE: 0x0008,
  PROCESS_TERMINATE: 0x0001,
  PROCESS_SET_QUOTA: 0x0100,
  PROCESS_QUERY_INFORMATION: 0x0400,
  PROCESS_VM_READ: 0x0010,
  PROCESS_QUERY_LIMITED_INFORMATION: 0x1000,
  SW_RESTORE: 9,
  SW_MINIMIZE: 6,
  SW_SHOWNOACTIVATE: 4,
  SW_SHOWMINNOACTIVE: 7,
  HWND_TOPMOST: -1,
  HWND_NOTOPMOST: -2,
  SWP_NOSIZE: 0x0001,
  SWP_NOMOVE: 0x0002,
  SWP_NOZORDER: 0x0004,
  SWP_NOACTIVATE: 0x0010,
  SWP_FRAMECHANGED: 0x0020,
  SWP_NOOWNERZORDER: 0x0200,
  SWP_ASYNCWINDOWPOS: 0x4000,
  WM_SETTEXT: 0x000C,
  SMTO_ABORTIFHUNG: 0x0002,
  DWMWA_CLOAKED: 14,
  DWMWA_EXTENDED_FRAME_BOUNDS: 9,
  PROCESS_SET_INFORMATION: 0x0200,
  PRIORITY: { idle: 0x40, below: 0x4000, normal: 0x20, above: 0x8000, high: 0x80 },
  WM_CLOSE: 0x0010,
  ERROR_ALREADY_EXISTS: 183,
  GWL_STYLE: -16,
  GWL_EXSTYLE: -20,
  WS_EX_TRANSPARENT: 0x00000020,
  WS_POPUP: 0x80000000,
  WS_CAPTION: 0x00C00000,
  WS_SYSMENU: 0x00080000,
  WS_THICKFRAME: 0x00040000,
  WS_MINIMIZEBOX: 0x00020000,
  WS_MAXIMIZEBOX: 0x00010000,
  VK_LBUTTON: 0x01,
};

function load() {
  if (!isWin || api) return api;
  k = require('koffi');

  // Struct types are registered by name and used inside the signatures below.
  const POINT = k.struct('MM_POINT', { x: 'int32_t', y: 'int32_t' }); // eslint-disable-line no-unused-vars
  const MOUSEINPUT = k.struct('MM_MOUSEINPUT', {
    dx: 'int32_t', dy: 'int32_t', mouseData: 'uint32_t', dwFlags: 'uint32_t', time: 'uint32_t', dwExtraInfo: 'uintptr_t',
  });
  const KEYBDINPUT = k.struct('MM_KEYBDINPUT', {
    wVk: 'uint16_t', wScan: 'uint16_t', dwFlags: 'uint32_t', time: 'uint32_t', dwExtraInfo: 'uintptr_t',
  });
  const HARDWAREINPUT = k.struct('MM_HARDWAREINPUT', { uMsg: 'uint32_t', wParamL: 'uint16_t', wParamH: 'uint16_t' });
  const INPUT_UNION = k.union('MM_INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT });
  const INPUT = k.struct('MM_INPUT', { type: 'uint32_t', u: INPUT_UNION });
  const PMC = k.struct('MM_PROCESS_MEMORY_COUNTERS', {
    cb: 'uint32_t', PageFaultCount: 'uint32_t', PeakWorkingSetSize: 'size_t', WorkingSetSize: 'size_t',
    QuotaPeakPagedPoolUsage: 'size_t', QuotaPagedPoolUsage: 'size_t', QuotaPeakNonPagedPoolUsage: 'size_t',
    QuotaNonPagedPoolUsage: 'size_t', PagefileUsage: 'size_t', PeakPagefileUsage: 'size_t',
  });
  const MEMSTATUS = k.struct('MM_MEMORYSTATUSEX', {
    dwLength: 'uint32_t', dwMemoryLoad: 'uint32_t', ullTotalPhys: 'uint64_t', ullAvailPhys: 'uint64_t',
    ullTotalPageFile: 'uint64_t', ullAvailPageFile: 'uint64_t', ullTotalVirtual: 'uint64_t',
    ullAvailVirtual: 'uint64_t', ullAvailExtendedVirtual: 'uint64_t',
  });
  const FILETIME = k.struct('MM_FILETIME', { low: 'uint32_t', high: 'uint32_t' }); // eslint-disable-line no-unused-vars
  const RECT = k.struct('MM_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' }); // eslint-disable-line no-unused-vars

  const user32 = k.load('user32.dll');
  const dwmapi = k.load('dwmapi.dll');
  const kernel32 = k.load('kernel32.dll');

  const EnumWindowsProc = k.proto('bool __stdcall MM_EnumWindowsProc(void *hwnd, intptr_t lParam)');

  api = {
    sizes: { INPUT: k.sizeof(INPUT), PMC: k.sizeof(PMC), MEMSTATUS: k.sizeof(MEMSTATUS) },
    SendInput: user32.func('uint32_t __stdcall SendInput(uint32_t cInputs, MM_INPUT *pInputs, int cbSize)'),
    GetCursorPos: user32.func('bool __stdcall GetCursorPos(_Out_ MM_POINT *lpPoint)'),
    SetCursorPos: user32.func('bool __stdcall SetCursorPos(int X, int Y)'),
    GetAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)'),
    MapVirtualKeyW: user32.func('uint32_t __stdcall MapVirtualKeyW(uint32_t uCode, uint32_t uMapType)'),
    EnumWindows: user32.func('bool __stdcall EnumWindows(MM_EnumWindowsProc *cb, intptr_t lParam)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void *hwnd)'),
    IsIconic: user32.func('bool __stdcall IsIconic(void *hwnd)'),
    SetWindowTextW: user32.func('bool __stdcall SetWindowTextW(void *hwnd, const char16_t *text)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void *hwnd, _Out_ uint16_t *buf, int max)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(void *hwnd, _Out_ uint16_t *buf, int max)'),
    GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
    SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(void *hwnd)'),
    ShowWindow: user32.func('bool __stdcall ShowWindow(void *hwnd, int cmd)'),
    SetWindowPos: user32.func('bool __stdcall SetWindowPos(void *hwnd, intptr_t insertAfter, int x, int y, int cx, int cy, uint32_t flags)'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(void *hwnd, _Out_ MM_RECT *rect)'),
    IsZoomed: user32.func('bool __stdcall IsZoomed(void *hwnd)'),
    IsWindow: user32.func('bool __stdcall IsWindow(void *hwnd)'),
    IsHungAppWindow: user32.func('bool __stdcall IsHungAppWindow(void *hwnd)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(void *hwnd, int index)'),
    SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(void *hwnd, int index, intptr_t value)'),
    SetPriorityClass: kernel32.func('bool __stdcall SetPriorityClass(void *h, uint32_t cls)'),
    GetPriorityClass: kernel32.func('uint32_t __stdcall GetPriorityClass(void *h)'),
    SetProcessAffinityMask: kernel32.func('bool __stdcall SetProcessAffinityMask(void *h, uintptr_t mask)'),
    GetProcessAffinityMask: kernel32.func('bool __stdcall GetProcessAffinityMask(void *h, _Out_ uintptr_t *proc, _Out_ uintptr_t *sys)'),
    DwmGetWindowAttribute: dwmapi.func('long __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attr, _Out_ MM_RECT *rect, uint32_t size)'),
    PostMessageW: user32.func('bool __stdcall PostMessageW(void *hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam)'),
    GetClientRect: user32.func('bool __stdcall GetClientRect(void *hwnd, _Out_ MM_RECT *rect)'),
    ClientToScreen: user32.func('bool __stdcall ClientToScreen(void *hwnd, _Inout_ MM_POINT *pt)'),
    ShowWindowAsync: user32.func('bool __stdcall ShowWindowAsync(void *hwnd, int cmd)'),
    SendMessageTimeoutW: user32.func('intptr_t __stdcall SendMessageTimeoutW(void *hwnd, uint32_t msg, uintptr_t wParam, const char16_t *lParam, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)'),
    DwmGetCloaked: dwmapi.func('long __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attr, _Out_ uint32_t *value, uint32_t size)'),

    OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *h)'),
    TerminateProcess: kernel32.func('bool __stdcall TerminateProcess(void *h, uint32_t code)'),
    CreateMutexW: kernel32.func('void * __stdcall CreateMutexW(void *attrs, bool initialOwner, const char16_t *name)'),
    GetLastError: kernel32.func('uint32_t __stdcall GetLastError()'),
    K32EnumProcesses: kernel32.func('bool __stdcall K32EnumProcesses(_Out_ uint32_t *pids, uint32_t cb, _Out_ uint32_t *needed)'),
    K32GetProcessMemoryInfo: kernel32.func('bool __stdcall K32GetProcessMemoryInfo(void *h, _Inout_ MM_PROCESS_MEMORY_COUNTERS *pmc, uint32_t cb)'),
    K32EmptyWorkingSet: kernel32.func('bool __stdcall K32EmptyWorkingSet(void *h)'),
    QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *h, uint32_t flags, _Out_ uint16_t *buf, _Inout_ uint32_t *size)'),
    GlobalMemoryStatusEx: kernel32.func('bool __stdcall GlobalMemoryStatusEx(_Inout_ MM_MEMORYSTATUSEX *st)'),
    GetProcessTimes: kernel32.func('bool __stdcall GetProcessTimes(void *h, _Out_ MM_FILETIME *c, _Out_ MM_FILETIME *e, _Out_ MM_FILETIME *k, _Out_ MM_FILETIME *u)'),
    EnumWindowsProc,
  };
  api.sizes.PMC_VALUE = k.sizeof(PMC);
  // Newer functions are loaded one by one so an older Windows (or Wine) can't break everything else.
  const THROTTLE = k.struct('MM_POWER_THROTTLING', { Version: 'uint32_t', ControlMask: 'uint32_t', StateMask: 'uint32_t' });
  api.optional = {};
  try { api.optional.SetProcessInformation = kernel32.func('bool __stdcall SetProcessInformation(void *h, int infoClass, MM_POWER_THROTTLING *info, uint32_t size)'); api.sizes.THROTTLE = k.sizeof(THROTTLE); } catch { /* Windows 7 / old Wine */ }
  return api;
}

const available = (() => {
  if (!isWin) return false;
  try { load(); return true; } catch (e) { console.error('[win32] koffi failed to load', e); return false; }
})();

/** True when running under Wine (used by the self-test only). */
function isWine() {
  if (!available) return false;
  try { k.load('ntdll.dll').func('const char * wine_get_version()'); return true; } catch { return false; }
}

function need() { if (!available) throw new Error('This feature needs Windows.'); return api; }

// ---------- input ----------
function sendMouse(flags, data = 0) {
  const a = need();
  const inp = { type: consts.INPUT_MOUSE, u: { mi: { dx: 0, dy: 0, mouseData: data >>> 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } };
  return a.SendInput(1, inp, a.sizes.INPUT) === 1;
}

const BUTTONS = {
  left: [consts.MOUSEEVENTF_LEFTDOWN, consts.MOUSEEVENTF_LEFTUP],
  right: [consts.MOUSEEVENTF_RIGHTDOWN, consts.MOUSEEVENTF_RIGHTUP],
  middle: [consts.MOUSEEVENTF_MIDDLEDOWN, consts.MOUSEEVENTF_MIDDLEUP],
};

function mouseButton(button, down) {
  const pair = BUTTONS[button];
  if (!pair) throw new Error(`Unknown mouse button ${button}`);
  return sendMouse(down ? pair[0] : pair[1]);
}

function click(button) { mouseButton(button, true); return mouseButton(button, false); }

function wheel(delta) { return sendMouse(consts.MOUSEEVENTF_WHEEL, delta | 0); }

// Extended keys need the E0 prefix flag when sent by scancode.
const EXTENDED_VKS = new Set([0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5C, 0x5D, 0x6F, 0x90, 0xA3, 0xA5]);

function key(vk, down) {
  const a = need();
  const scan = a.MapVirtualKeyW(vk, 0) & 0xff; // MAPVK_VK_TO_VSC
  let flags = scan ? consts.KEYEVENTF_SCANCODE : 0;
  if (EXTENDED_VKS.has(vk)) flags |= consts.KEYEVENTF_EXTENDEDKEY;
  if (!down) flags |= consts.KEYEVENTF_KEYUP;
  const inp = { type: consts.INPUT_KEYBOARD, u: { ki: { wVk: scan ? 0 : vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } } };
  return a.SendInput(1, inp, a.sizes.INPUT) === 1;
}

function tapKey(vk, holdMs = 40) {
  key(vk, true);
  return new Promise(r => setTimeout(() => { key(vk, false); r(); }, holdMs));
}

function getCursor() { const p = {}; need().GetCursorPos(p); return { x: p.x, y: p.y }; }
function setCursor(x, y) { return need().SetCursorPos(x | 0, y | 0); }
function isKeyDown(vk) { return (need().GetAsyncKeyState(vk) & 0x8000) !== 0; }

// ---------- processes ----------
function utf16(buf, chars) { return Buffer.from(buf.buffer, buf.byteOffset, chars * 2).toString('utf16le'); }

function listPids() {
  const a = need();
  let size = 4096;
  for (;;) {
    const pids = new Uint32Array(size);
    const needed = [0];
    if (!a.K32EnumProcesses(pids, size * 4, needed)) return [];
    const n = needed[0] / 4;
    if (n < size) return Array.from(pids.subarray(0, n)).filter(Boolean);
    size *= 2;
  }
}

function withProcess(pid, access, fn) {
  const a = need();
  const h = a.OpenProcess(access, false, pid);
  if (!h) return null;
  try { return fn(h); } finally { a.CloseHandle(h); }
}

function imagePathOf(h) {
  const a = need();
  const buf = new Uint16Array(1024);
  const size = [1024];
  if (!a.QueryFullProcessImageNameW(h, 0, buf, size)) return null;
  return utf16(buf, size[0]);
}

function memoryOf(h) {
  const a = need();
  const pmc = { cb: a.sizes.PMC };
  if (!a.K32GetProcessMemoryInfo(h, pmc, a.sizes.PMC)) return null;
  return { workingSet: Number(pmc.WorkingSetSize), privateBytes: Number(pmc.PagefileUsage) };
}

function cpuTimeOf(h) {
  const a = need();
  const c = {}, e = {}, kt = {}, u = {};
  if (!a.GetProcessTimes(h, c, e, kt, u)) return null;
  const ft = t => (t.high * 4294967296 + t.low) / 10000; // 100ns -> ms
  return ft(kt) + ft(u);
}

/** When a process started (ms since 1970), or null. */
function processStartTime(pid) {
  return withProcess(pid, consts.PROCESS_QUERY_LIMITED_INFORMATION, h => {
    const a = need();
    const c = {}, e = {}, kt = {}, u = {};
    if (!a.GetProcessTimes(h, c, e, kt, u)) return null;
    return (c.high * 4294967296 + c.low) / 10000 - 11644473600000;
  });
}

/** Snapshot every process we are allowed to query. */
function snapshotProcesses() {
  const out = [];
  for (const pid of listPids()) {
    withProcess(pid, consts.PROCESS_QUERY_LIMITED_INFORMATION, h => {
      const p = imagePathOf(h);
      if (!p) return;
      const mem = memoryOf(h) || { workingSet: 0, privateBytes: 0 };
      out.push({ pid, name: p.split('\\').pop(), path: p, ...mem, cpuMs: cpuTimeOf(h) ?? 0 });
    });
  }
  return out;
}

function processInfo(pid) {
  return withProcess(pid, consts.PROCESS_QUERY_LIMITED_INFORMATION, h => {
    const p = imagePathOf(h);
    if (!p) return null;
    return { pid, name: p.split('\\').pop(), path: p, ...(memoryOf(h) || {}), cpuMs: cpuTimeOf(h) ?? 0 };
  });
}

/** Asks Windows to trim a process's working set. Returns bytes before/after. */
function trimWorkingSet(pid) {
  const a = need();
  // Only the rights trimming needs: Roblox refuses handles that ask to read its memory.
  const trim = h => {
    const before = memoryOf(h);
    const ok = a.K32EmptyWorkingSet(h);
    const after = memoryOf(h);
    return { ok, before: before?.workingSet ?? 0, after: after?.workingSet ?? 0 };
  };
  const r = withProcess(pid, consts.PROCESS_QUERY_LIMITED_INFORMATION | consts.PROCESS_SET_QUOTA, trim)
    || withProcess(pid, consts.PROCESS_QUERY_INFORMATION | consts.PROCESS_SET_QUOTA, trim);
  return r || { ok: false, before: 0, after: 0, error: 'Access denied' };
}

function terminate(pid) {
  const a = need();
  return withProcess(pid, consts.PROCESS_TERMINATE, h => a.TerminateProcess(h, 0)) === true;
}

function memoryStatus() {
  const a = need();
  const st = { dwLength: a.sizes.MEMSTATUS };
  if (!a.GlobalMemoryStatusEx(st)) return null;
  return { loadPercent: st.dwMemoryLoad, total: Number(st.ullTotalPhys), available: Number(st.ullAvailPhys) };
}

// ---------- windows ----------
function windowsOfPids(pidSet) {
  const a = need();
  const found = [];
  const cb = k.register((hwnd) => {
    const pid = [0];
    a.GetWindowThreadProcessId(hwnd, pid);
    if (pidSet.has(pid[0]) && a.IsWindowVisible(hwnd)) {
      const cls = new Uint16Array(256);
      const n = a.GetClassNameW(hwnd, cls, 256);
      found.push({ hwnd, pid: pid[0], className: utf16(cls, n) });
    }
    return true;
  }, k.pointer(a.EnumWindowsProc));
  try { a.EnumWindows(cb, 0); } finally { k.unregister(cb); }
  return found;
}

/** Every visible top-level window: { hwnd, pid, className, title }. */
function allWindows() {
  const a = need();
  const found = [];
  const cb = k.register((hwnd) => {
    if (!a.IsWindowVisible(hwnd)) return true;
    const pid = [0];
    a.GetWindowThreadProcessId(hwnd, pid);
    const cls = new Uint16Array(256), ttl = new Uint16Array(512);
    const n = a.GetClassNameW(hwnd, cls, 256), t = a.GetWindowTextW(hwnd, ttl, 512);
    found.push({ hwnd, pid: pid[0], className: utf16(cls, n), title: utf16(ttl, t) });
    return true;
  }, k.pointer(a.EnumWindowsProc));
  try { a.EnumWindows(cb, 0); } finally { k.unregister(cb); }
  return found;
}

/** Roblox's main game window uses the WINDOWSCLIENT class. */
function robloxWindows(pids) {
  return windowsOfPids(new Set(pids)).filter(w => w.className === 'WINDOWSCLIENT');
}

/** True when the window belongs to another program (calls to it can wait on that program). */
function foreign(hwnd) {
  const pid = [0];
  need().GetWindowThreadProcessId(hwnd, pid);
  return pid[0] !== process.pid;
}
/** ShowWindow that never waits for a busy program: another program's window gets the request posted. */
function show(hwnd, cmd) { const a = need(); return foreign(hwnd) ? a.ShowWindowAsync(hwnd, cmd) : a.ShowWindow(hwnd, cmd); }
/** Extra SetWindowPos flag for another program's window, so a busy Roblox can't freeze MultiMenu. */
const asyncFlag = (hwnd) => (foreign(hwnd) ? consts.SWP_ASYNCWINDOWPOS : 0);

/** Renames a window. Runs on a worker thread and gives up after 2 s, so a Roblox
 *  window that is busy loading can't freeze MultiMenu (SetWindowText waits for it). */
async function setWindowTitle(hwnd, title) {
  const a = need();
  if (!a.IsWindow(hwnd) || a.IsHungAppWindow(hwnd)) return false;
  const out = [0];
  return !!(await later(a.SendMessageTimeoutW, hwnd, consts.WM_SETTEXT, 0, String(title), consts.SMTO_ABORTIFHUNG, 2000, out));
}

function postClose(hwnd) { return need().PostMessageW(hwnd, consts.WM_CLOSE, 0, 0); }

/** Brings a window to the front. Windows blocks focus stealing unless an input
 *  event was just sent, so we tap ALT first (documented, widely used workaround). */
function focusWindow(hwnd) {
  const a = need();
  if (a.IsIconic(hwnd)) show(hwnd, consts.SW_RESTORE);
  key(0x12, true); key(0x12, false);
  return a.SetForegroundWindow(hwnd);
}

function foregroundWindow() { return need().GetForegroundWindow(); }

// ---------- window placement (tiling) ----------
function windowRect(hwnd) {
  const r = {};
  if (!need().GetWindowRect(hwnd, r)) return null;
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

/** Windows 10/11 windows have invisible resize borders. Returns how much bigger
 *  the real window rect is than what's visible, so tiles line up edge to edge. */
function invisibleBorders(hwnd) {
  const a = need();
  const outer = windowRect(hwnd);
  const vis = {};
  if (!outer || a.DwmGetWindowAttribute(hwnd, consts.DWMWA_EXTENDED_FRAME_BOUNDS, vis, 16) !== 0) return { left: 0, top: 0, right: 0, bottom: 0 };
  return {
    left: Math.max(0, vis.left - outer.x), top: Math.max(0, vis.top - outer.y),
    right: Math.max(0, outer.x + outer.width - vis.right), bottom: Math.max(0, outer.y + outer.height - vis.bottom),
  };
}

/** Moves/resizes a window so its VISIBLE area matches rect (physical pixels). */
function placeWindow(hwnd, rect) {
  const a = need();
  if (a.IsIconic(hwnd) || a.IsZoomed(hwnd)) show(hwnd, consts.SW_RESTORE);
  const b = invisibleBorders(hwnd);
  return a.SetWindowPos(hwnd, 0, Math.round(rect.x - b.left), Math.round(rect.y - b.top),
    Math.round(rect.width + b.left + b.right), Math.round(rect.height + b.top + b.bottom),
    consts.SWP_NOZORDER | consts.SWP_NOACTIVATE | consts.SWP_NOOWNERZORDER | asyncFlag(hwnd));
}

function setOuterRect(hwnd, rect) {
  const a = need();
  if (a.IsIconic(hwnd) || a.IsZoomed(hwnd)) show(hwnd, consts.SW_RESTORE);
  return a.SetWindowPos(hwnd, 0, rect.x, rect.y, rect.width, rect.height, consts.SWP_NOZORDER | consts.SWP_NOACTIVATE | consts.SWP_NOOWNERZORDER | asyncFlag(hwnd));
}

// ---------- windows smaller than Roblox allows ----------
// Adapted from RoALT 1.1.0 (src-tauri/src/instances/window.rs, free_resize), MIT License,
// Copyright (c) 2026 inspectsoftware. See NOTICE.md.
// Roblox holds its window to a minimum size (WM_GETMINMAXINFO). Windows only applies that
// minimum while the window has a sizing frame, so the frame comes off for the one resize and
// goes straight back on: the window keeps its title bar and edges, at any size.

/** A window style without the sizing frame and title bar, as a popup (pure). */
function borderlessStyle(style) {
  const off = consts.WS_CAPTION | consts.WS_THICKFRAME | consts.WS_SYSMENU | consts.WS_MINIMIZEBOX | consts.WS_MAXIMIZEBOX;
  return ((style & ~off) | consts.WS_POPUP) | 0;
}
const int32 = (v) => (typeof v === 'bigint' ? Number(BigInt.asIntN(32, v)) : (Number(v) | 0));
/** Runs a Win32 call on a worker thread: changing another program's window waits for that
 *  program, and a busy Roblox must not freeze MultiMenu meanwhile. */
const later = (fn, ...args) => new Promise((resolve, reject) => fn.async(...args, (err, res) => (err ? reject(err) : resolve(res))));
const resizing = new Set();

/** Sets a window's outer rectangle (physical pixels), past the program's minimum size if need be.
 *  keepPlace: only the size changes. One resize per window at a time. */
async function freeResize(hwnd, rect, keepPlace = false) {
  const a = need();
  const key = String(k.address(hwnd));
  if (resizing.has(key) || !a.IsWindow(hwnd) || a.IsHungAppWindow(hwnd)) return false;
  resizing.add(key);
  try {
    const style = int32(a.GetWindowLongPtrW(hwnd, consts.GWL_STYLE)); // reading sends nothing to the window
    await later(a.SetWindowLongPtrW, hwnd, consts.GWL_STYLE, borderlessStyle(style));
    let ok = false;
    try {
      ok = await later(a.SetWindowPos, hwnd, 0, Math.round(rect.x || 0), Math.round(rect.y || 0), Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)),
        consts.SWP_NOZORDER | consts.SWP_NOACTIVATE | consts.SWP_NOOWNERZORDER | (keepPlace ? consts.SWP_NOMOVE : 0));
    } finally {
      // The frame goes back without a size change, so Windows doesn't apply the minimum again.
      await later(a.SetWindowLongPtrW, hwnd, consts.GWL_STYLE, style);
      await later(a.SetWindowPos, hwnd, 0, 0, 0, 0, 0, consts.SWP_NOMOVE | consts.SWP_NOSIZE | consts.SWP_NOZORDER | consts.SWP_NOACTIVATE | consts.SWP_FRAMECHANGED);
    }
    return !!ok;
  } finally { resizing.delete(key); }
}

/** Pure: the window style without its title bar and sizing border (the minimise box stays,
 *  so the taskbar can still minimise it). */
function titlelessStyle(style) { return (style & ~(consts.WS_CAPTION | consts.WS_THICKFRAME)) | 0; }
/** Hides or brings back a window's title bar, on a worker thread. Returns the style it had. */
async function setTitleBar(hwnd, show, original) {
  const a = need();
  if (!a.IsWindow(hwnd) || a.IsHungAppWindow(hwnd)) return null;
  const style = int32(a.GetWindowLongPtrW(hwnd, consts.GWL_STYLE));
  const want = show ? (original != null ? original | 0 : (style | consts.WS_CAPTION | consts.WS_THICKFRAME) | 0) : titlelessStyle(style);
  if (want === style) return style;
  await later(a.SetWindowLongPtrW, hwnd, consts.GWL_STYLE, want);
  await later(a.SetWindowPos, hwnd, 0, 0, 0, 0, 0, consts.SWP_NOMOVE | consts.SWP_NOSIZE | consts.SWP_NOZORDER | consts.SWP_NOACTIVATE | consts.SWP_FRAMECHANGED);
  return style;
}

/** placeWindow, on a worker thread (see later()). */
async function placeWindowAsync(hwnd, rect) {
  const a = need();
  if (!a.IsWindow(hwnd) || a.IsHungAppWindow(hwnd)) return false;
  if (a.IsIconic(hwnd) || a.IsZoomed(hwnd)) await later(a.ShowWindow, hwnd, consts.SW_RESTORE);
  const b = invisibleBorders(hwnd);
  return !!(await later(a.SetWindowPos, hwnd, 0, Math.round(rect.x - b.left), Math.round(rect.y - b.top),
    Math.round(rect.width + b.left + b.right), Math.round(rect.height + b.top + b.bottom),
    consts.SWP_NOZORDER | consts.SWP_NOACTIVATE | consts.SWP_NOOWNERZORDER));
}

/** Brings a minimised or maximised window back to normal (worker thread). */
async function unhideAsync(hwnd) {
  const a = need();
  if (a.IsIconic(hwnd) || a.IsZoomed(hwnd)) await later(a.ShowWindow, hwnd, consts.SW_RESTORE);
}

/** Title bar and borders: how much bigger the window is than its inside. */
function frameSize(hwnd) {
  const outer = windowRect(hwnd), inner = clientRect(hwnd);
  if (!outer || !inner) return null;
  return { w: Math.max(0, outer.width - inner.width), h: Math.max(0, outer.height - inner.height) };
}
function isMaximized(hwnd) { return need().IsZoomed(hwnd); }
function windowStyle(hwnd) { return int32(need().GetWindowLongPtrW(hwnd, consts.GWL_STYLE)); }
function isWindow(hwnd) { return need().IsWindow(hwnd); }
function leftButtonDown() { return (need().GetAsyncKeyState(consts.VK_LBUTTON) & 0x8000) !== 0; }

function minimizeWindow(hwnd) { return show(hwnd, consts.SW_MINIMIZE); }
/** Minimises without moving keyboard focus to another window. */
function minimizeNoActivate(hwnd) { return show(hwnd, consts.SW_SHOWMINNOACTIVE); }
function restoreWindow(hwnd) { const a = need(); return a.IsIconic(hwnd) ? show(hwnd, consts.SW_RESTORE) : true; }
function setTopmost(hwnd, on) {
  return need().SetWindowPos(hwnd, on ? consts.HWND_TOPMOST : consts.HWND_NOTOPMOST, 0, 0, 0, 0, consts.SWP_NOMOVE | consts.SWP_NOSIZE | consts.SWP_NOACTIVATE | asyncFlag(hwnd));
}

/** Every visible top-level window from front to back: { hwnd, key, pid, rect } (visible part,
 *  physical pixels). Minimised, hidden (cloaked) and click-through windows are left out. Sends nothing
 *  to any window, so busy programs can't slow it down. */
function windowStack() {
  const a = need();
  const out = [];
  const cb = k.register((hwnd) => {
    if (!a.IsWindowVisible(hwnd) || a.IsIconic(hwnd)) return true;
    // Click-through windows (game overlays, screen recorders' frames) cover nothing.
    if (int32(a.GetWindowLongPtrW(hwnd, consts.GWL_EXSTYLE)) & consts.WS_EX_TRANSPARENT) return true;
    const cloaked = [0];
    if (a.DwmGetCloaked(hwnd, consts.DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0]) return true;
    const r = {};
    if (a.DwmGetWindowAttribute(hwnd, consts.DWMWA_EXTENDED_FRAME_BOUNDS, r, 16) !== 0 && !a.GetWindowRect(hwnd, r)) return true;
    if (r.right - r.left <= 0 || r.bottom - r.top <= 0) return true;
    const pid = [0];
    a.GetWindowThreadProcessId(hwnd, pid);
    out.push({ hwnd, key: String(k.address(hwnd)), pid: pid[0], rect: { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top } });
    return true;
  }, k.pointer(a.EnumWindowsProc));
  try { a.EnumWindows(cb, 0); } finally { k.unregister(cb); }
  return out;
}
function isMinimized(hwnd) { return need().IsIconic(hwnd); }
/** The inside of a window (no title bar or borders), in screen pixels. */
function clientRect(hwnd) {
  const a = need();
  const r = {};
  if (!a.GetClientRect(hwnd, r)) return null;
  const p = { x: 0, y: 0 };
  if (!a.ClientToScreen(hwnd, p)) return null;
  return { x: p.x, y: p.y, width: r.right - r.left, height: r.bottom - r.top };
}
function isHung(hwnd) { return need().IsHungAppWindow(hwnd); }

function foregroundPid() {
  const a = need();
  const h = a.GetForegroundWindow();
  if (!h) return 0;
  const pid = [0];
  a.GetWindowThreadProcessId(h, pid);
  return pid[0];
}

const ACCESS_SETINFO = () => consts.PROCESS_SET_INFORMATION | consts.PROCESS_QUERY_INFORMATION;

/** cls: 'idle' | 'below' | 'normal' | 'above' | 'high' */
function setPriority(pid, cls) {
  const v = consts.PRIORITY[cls];
  if (!v) throw new Error(`Unknown priority ${cls}`);
  return withProcess(pid, ACCESS_SETINFO(), h => need().SetPriorityClass(h, v)) === true;
}

function getPriority(pid) {
  const v = withProcess(pid, consts.PROCESS_QUERY_LIMITED_INFORMATION, h => need().GetPriorityClass(h));
  return Object.entries(consts.PRIORITY).find(([, x]) => x === v)?.[0] || null;
}

/** Returns { process, system } affinity masks as Numbers (supports up to 52 logical cores). */
function getAffinity(pid) {
  return withProcess(pid, consts.PROCESS_QUERY_LIMITED_INFORMATION, h => {
    const p = [0], s = [0];
    if (!need().GetProcessAffinityMask(h, p, s)) return null;
    return { process: Number(p[0]), system: Number(s[0]) };
  });
}

function setAffinity(pid, mask) {
  if (!(mask > 0)) throw new Error('Affinity mask must include at least one core');
  return withProcess(pid, ACCESS_SETINFO(), h => need().SetProcessAffinityMask(h, mask)) === true;
}

/** Windows 11 efficiency mode (EcoQoS): the process runs on slower, low-power CPU time.
 *  on=false hands the decision back to Windows. Returns false when Windows doesn't support it. */
function setEco(pid, on) {
  const fn = available && api.optional?.SetProcessInformation;
  if (!fn) return false;
  const info = on ? { Version: 1, ControlMask: 1, StateMask: 1 } : { Version: 1, ControlMask: 0, StateMask: 0 };
  return withProcess(pid, consts.PROCESS_SET_INFORMATION, h => fn(h, 4, info, api.sizes.THROTTLE)) === true;
}
const ecoSupported = () => !!(available && api.optional?.SetProcessInformation);

/** Electron's getNativeWindowHandle() Buffer -> HWND pointer. */
function hwndFromBuffer(buf) { need(); return k.decode(buf, 'void *'); }

// ---------- mutex ----------
function createMutex(name) {
  const a = need();
  const h = a.CreateMutexW(null, true, name);
  const already = a.GetLastError() === consts.ERROR_ALREADY_EXISTS;
  return { handle: h, alreadyExisted: already };
}
function closeHandle(h) { if (h) need().CloseHandle(h); }

module.exports = {
  available, consts, load, isWine,
  click, mouseButton, wheel, key, tapKey, getCursor, setCursor, isKeyDown,
  listPids, snapshotProcesses, processInfo, processStartTime, trimWorkingSet, terminate, memoryStatus,
  robloxWindows, allWindows, windowStack, setTitleBar, titlelessStyle, setWindowTitle, postClose, focusWindow, foregroundWindow,
  windowRect, invisibleBorders, placeWindow, setOuterRect, minimizeWindow, minimizeNoActivate, restoreWindow, setTopmost, isMinimized, hwndFromBuffer,
  borderlessStyle, freeResize, placeWindowAsync, unhideAsync, frameSize, isMaximized, isWindow, leftButtonDown, windowStyle,
  isHung, foregroundPid, setPriority, getPriority, getAffinity, setAffinity, clientRect, setEco, ecoSupported,
  createMutex, closeHandle,
};
