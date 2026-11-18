'use strict';
// Admin codes: "MMA-<payload>.<signature>", both base64url.
// The payload is JSON { v: 1, id, name, iat, exp } and the signature is Ed25519
// over the payload text exactly as written. MultiMenu only ships public keys, so
// it can check a code but can never make one; codes are made with the private
// key in the MultiMenu Dev Console.
const crypto = require('crypto');

const PREFIX = 'MMA-';
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function publicKeyFrom(b64) {
  return crypto.createPublicKey({ key: Buffer.from(String(b64), 'base64'), format: 'der', type: 'spki' });
}
function privateKeyFrom(b64) {
  return crypto.createPrivateKey({ key: Buffer.from(String(b64), 'base64'), format: 'der', type: 'pkcs8' });
}

/** A new Ed25519 key pair as base64 DER (public: SPKI, private: PKCS#8). */
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

/** The public key that belongs to a private key (base64 DER in, base64 DER out). */
function publicFromPrivate(privateB64) {
  return crypto.createPublicKey(privateKeyFrom(privateB64)).export({ format: 'der', type: 'spki' }).toString('base64');
}

/** Short fingerprint of a public key, for showing which key is which. */
function fingerprint(publicB64) {
  return crypto.createHash('sha256').update(Buffer.from(String(publicB64), 'base64')).digest('hex').slice(0, 16);
}

/** Makes a code. days = null means it never expires. */
function sign(privateB64, { name = 'admin', days = null, now = Date.now(), id = crypto.randomBytes(6).toString('hex') } = {}) {
  const iat = Math.floor(now / 1000);
  const payload = { v: 1, id: String(id), name: String(name || 'admin').trim().slice(0, 60) || 'admin', iat, exp: days ? iat + Math.round(Number(days) * 86400) : null };
  const text = b64u(JSON.stringify(payload));
  const sig = crypto.sign(null, Buffer.from(text), privateKeyFrom(privateB64));
  return `${PREFIX}${text}.${b64u(sig)}`;
}

/** Reads a code without checking it (for showing what a code says). */
function peek(code) {
  const s = String(code || '').replace(/\s+/g, '');
  if (!s.startsWith(PREFIX)) return null;
  try {
    const p = JSON.parse(Buffer.from(s.slice(PREFIX.length).split('.')[0], 'base64url').toString('utf8'));
    return p && typeof p === 'object' ? p : null;
  } catch { return null; }
}

/**
 * Checks a code against the trusted public keys.
 * Returns { ok: true, id, name, iat, exp } or { ok: false, reason }.
 */
function verify(code, { keys = [], revoked = [], now = Date.now() } = {}) {
  const s = String(code || '').replace(/\s+/g, '');
  if (!s.startsWith(PREFIX)) return { ok: false, reason: 'That is not an admin code.' };
  const parts = s.slice(PREFIX.length).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0].length > 800 || parts[1].length > 200) return { ok: false, reason: 'That code is damaged.' };
  const [text, sigText] = parts;
  let sig;
  try { sig = Buffer.from(sigText, 'base64url'); } catch { return { ok: false, reason: 'That code is damaged.' }; }
  if (sig.length !== 64) return { ok: false, reason: 'That code is damaged.' };
  let good = false;
  for (const k of keys) {
    try { if (crypto.verify(null, Buffer.from(text), publicKeyFrom(k), sig)) { good = true; break; } } catch { /* a bad key in the list */ }
  }
  if (!good) return { ok: false, reason: 'That code is not valid for this version of MultiMenu.' };
  let p;
  try { p = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'That code is damaged.' }; }
  if (!p || p.v !== 1 || typeof p.id !== 'string' || typeof p.iat !== 'number') return { ok: false, reason: 'That code is from a newer version of MultiMenu.' };
  if (revoked.includes(p.id)) return { ok: false, reason: 'That code was switched off.' };
  if (p.exp && p.exp * 1000 < now) return { ok: false, reason: 'That code has expired.', expired: true };
  return { ok: true, id: p.id, name: String(p.name || 'admin').slice(0, 60), iat: p.iat * 1000, exp: p.exp ? p.exp * 1000 : null };
}

module.exports = { PREFIX, generateKeyPair, publicFromPrivate, fingerprint, sign, verify, peek };
