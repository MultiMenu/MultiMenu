'use strict';
// Spoken alerts: Windows reads short alerts out loud with its built-in voices
// (System.Speech). One hidden PowerShell process starts with the first alert and
// closes after two quiet minutes. Text goes in over stdin, never on a command line.
const { spawn } = require('child_process');
const settings = require('./settings');
const bus = require('../bus');
const log = require('../logger').scope('speech');

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    $m = $line | ConvertFrom-Json
    if ($m.cmd -eq 'voices') {
      $v = @($s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { [pscustomobject]@{ name = $_.VoiceInfo.Name; culture = $_.VoiceInfo.Culture.Name } })
      [Console]::Out.WriteLine((ConvertTo-Json -InputObject $v -Compress)); continue
    }
    if ($m.voice) { try { $s.SelectVoice([string]$m.voice) } catch {} }
    $s.Volume = [int]$m.volume; $s.Rate = [int]$m.rate
    $s.Speak([string]$m.text)
    [Console]::Out.WriteLine('{"done":true}')
  } catch { [Console]::Out.WriteLine('{"error":true}') }
}`;

let proc = null, idleTimer = null, buf = '';
const waiting = [];
let voicesCache = null;

function ensure() {
  if (proc) return proc;
  if (process.platform !== 'win32') throw new Error('Spoken alerts need Windows.');
  // A readable script file in MultiMenu's own folder (not an encoded command line, which
  // antivirus programs rightly distrust). -File needs the policy flag for this one script.
  proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', require('./pshelper').scriptFile('speech', SCRIPT)], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      const w = waiting.shift();
      if (w) { try { w(JSON.parse(line)); } catch { w(null); } }
    }
  });
  proc.on('exit', () => { proc = null; buf = ''; while (waiting.length) waiting.shift()(null); });
  proc.on('error', (e) => { log.warn(e.message); proc = null; });
  return proc;
}
function send(msg, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    let p;
    try { p = ensure(); } catch (e) { resolve({ error: e.message }); return; }
    const t = setTimeout(() => { const i = waiting.indexOf(done); if (i >= 0) waiting.splice(i, 1); resolve(null); }, timeoutMs);
    const done = (v) => { clearTimeout(t); resolve(v); };
    waiting.push(done);
    p.stdin.write(`${JSON.stringify(msg)}\n`);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stop, 120_000);
  });
}
function stop() { clearTimeout(idleTimer); if (proc) { try { proc.stdin.end(); proc.kill(); } catch { /* gone */ } } proc = null; }

async function voices() {
  if (voicesCache) return voicesCache;
  const r = await send({ cmd: 'voices' }, 15_000);
  voicesCache = Array.isArray(r) ? r.filter(v => v && v.name) : (r && r.name ? [r] : []);
  return voicesCache;
}

/** A voice for the app's language when none is chosen, so translated alerts sound right. */
async function pickVoice() {
  const c = settings.get('speech');
  if (c.voice) return { voice: c.voice, translate: true };
  const lang = require('../i18n').lang;
  if (lang === 'en') return { voice: '', translate: true };
  const want = { pt: 'pt-br', nb: 'nb', zh: 'zh-cn', fil: 'fil' }[lang] || lang;
  const v = (await voices()).find(x => String(x.culture || '').toLowerCase().startsWith(want));
  return v ? { voice: v.name, translate: true } : { voice: '', translate: false }; // no voice for the language: speak English
}

let queued = 0;
/** Speaks text (English; translated when a voice for your language exists). */
async function speak(text, { force = false } = {}) {
  const c = settings.get('speech');
  if (!force && !c.enabled) return { spoken: false, reason: 'off' };
  if (!force && c.quiet && require('./watcher').isQuiet()) return { spoken: false, reason: 'quiet hours' };
  if (queued >= 5) return { spoken: false, reason: 'busy' };
  const clean = String(text || '').replace(/[\r\n]+/g, ' ').slice(0, 300);
  if (!clean) return { spoken: false, reason: 'empty' };
  queued++;
  try {
    const { voice, translate } = await pickVoice();
    const out = translate ? require('../i18n').t(clean) : clean;
    const r = await send({ text: out, voice, volume: Math.max(0, Math.min(100, Number(c.volume) || 0)), rate: Math.max(-10, Math.min(10, Number(c.rate) || 0)) });
    return { spoken: !!r?.done, error: r?.error || null };
  } finally { queued--; }
}

/** Pure: the sentence for an app event, or null (unit-tested). */
function sentence(e) {
  const who = e.account || '';
  switch (e.type) {
    case 'accountCrashed': return `${who} crashed`;
    case 'watcherGaveUp': return `${who}: the watcher stopped retrying`;
    case 'launchFailed': return `${who} failed to launch`;
    case 'loginWarning': return 'Some logins need refreshing';
    case 'highUsage': return 'Your PC is running very high';
    case 'robloxOutage': return 'Roblox is having an outage';
    case 'internetBack': return 'The internet is back';
    case 'gameUpdated': return 'Your game just updated';
    case 'achievement': return `Achievement unlocked: ${e.detail || ''}`;
    case 'secretHatched': return String(e.detail || 'Secret hatched').replace(/^\[TEST\]\s*/, 'Test. ');
    default: return null;
  }
}

function init() {
  bus.on('event', (e) => {
    const c = settings.get('speech');
    if (!c?.enabled || !c.events?.[e.type]) return;
    const text = sentence(e);
    if (text) speak(text).catch(() => {});
  });
}

module.exports = { init, speak, voices, stop, sentence };
