'use strict';
// Virtual-key code names used by macros, anti-AFK and hotkey display.
const VK = {
  Backspace: 0x08, Tab: 0x09, Enter: 0x0D, Pause: 0x13, CapsLock: 0x14, Escape: 0x1B, Space: 0x20,
  PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24, Left: 0x25, Up: 0x26, Right: 0x27, Down: 0x28,
  Insert: 0x2D, Delete: 0x2E, LWin: 0x5B, RWin: 0x5C,
  Num0: 0x60, Num1: 0x61, Num2: 0x62, Num3: 0x63, Num4: 0x64, Num5: 0x65, Num6: 0x66, Num7: 0x67, Num8: 0x68, Num9: 0x69,
  NumMultiply: 0x6A, NumAdd: 0x6B, NumSubtract: 0x6D, NumDecimal: 0x6E, NumDivide: 0x6F,
  LShift: 0xA0, RShift: 0xA1, LCtrl: 0xA2, RCtrl: 0xA3, LAlt: 0xA4, RAlt: 0xA5,
  ';': 0xBA, '=': 0xBB, ',': 0xBC, '-': 0xBD, '.': 0xBE, '/': 0xBF, '`': 0xC0, '[': 0xDB, '\\': 0xDC, ']': 0xDD, "'": 0xDE,
};
for (let i = 0; i < 26; i++) VK[String.fromCharCode(65 + i)] = 0x41 + i;
for (let i = 0; i < 10; i++) VK[String(i)] = 0x30 + i;
for (let i = 1; i <= 24; i++) VK[`F${i}`] = 0x6F + i;

const NAME = Object.fromEntries(Object.entries(VK).map(([n, v]) => [v, n]));

/** Keys the macro recorder watches (generic Shift/Ctrl/Alt are skipped: the L/R variants are recorded). */
const RECORDABLE = [...new Set(Object.values(VK))].filter(v => ![0x10, 0x11, 0x12].includes(v));

module.exports = { VK, NAME, RECORDABLE };
