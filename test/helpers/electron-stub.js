// Lets main-process modules load under plain Node for unit tests.
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-test-'));
const stub = {
  app: { getPath: () => tmp, isPackaged: false, getVersion: () => '1.0.0', getName: () => 'MultiMenu' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`STUB:${s}`),
    decryptString: (b) => b.toString().replace(/^STUB:/, ''),
  },
  BrowserWindow: class {}, session: {}, shell: {}, Notification: class { static isSupported() { return false; } },
  globalShortcut: { register: () => true, unregisterAll() {} }, ipcMain: { handle() {} }, dialog: {}, clipboard: { writeText() {}, clear() {} },
};
const orig = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return stub;
  return orig.call(this, request, ...rest);
};
module.exports = { tmp, stub };
