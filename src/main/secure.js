'use strict';
// Encryption for secrets (Roblox cookies, saved passwords, webhook URLs).
// On Windows Electron's safeStorage uses DPAPI, which ties the data to the
// current Windows user account. Secrets are never stored in plain text: if
// encryption is unavailable we refuse to save them.
const { safeStorage } = require('electron');

const PREFIX = 'enc:v1:';

function available() {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function encrypt(plain) {
  if (plain == null || plain === '') return null;
  if (!available()) throw new Error('Secure storage is not available on this system, so the secret was not saved.');
  return PREFIX + safeStorage.encryptString(String(plain)).toString('base64');
}

function decrypt(blob) {
  if (!blob) return null;
  if (!blob.startsWith(PREFIX)) throw new Error('Unrecognised secret format');
  return safeStorage.decryptString(Buffer.from(blob.slice(PREFIX.length), 'base64'));
}

module.exports = { encrypt, decrypt, available };
