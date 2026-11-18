'use strict';
// Per-process mute. A single PowerShell process compiles native/AudioMute.cs
// (Windows Core Audio API) once and then takes "MUTE <0|1> <pid,pid>" commands
// on stdin. Started only when muting is first needed; stopped on exit.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = `$ErrorActionPreference = 'Stop'
try { Add-Type -TypeDefinition $env:MM_AUDIO_SRC -Language CSharp } catch { [Console]::Out.WriteLine('FATAL ' + $_.Exception.Message); exit 1 }
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $p = $line.Split(' ')
    $ids = @()
    if ($p.Length -gt 2 -and $p[2]) { $ids = $p[2].Split(',') | ForEach-Object { [int]$_ } }
    if ($p[0] -eq 'VOL') { $n = [MMAudio.Mixer]::SetVolume([int[]]$ids, [float]([int]$p[1]) / 100) }
    else { $n = [MMAudio.Mixer]::SetMute([int[]]$ids, $p[1] -eq '1') }
    [Console]::Out.WriteLine("OK $n")
  } catch { [Console]::Out.WriteLine('ERR ' + $_.Exception.Message) }
  [Console]::Out.Flush()
}`;

let proc = null, ready = null, queue = [], buf = '', lastError = null, state = 'off';

function startHelper() {
  if (process.platform !== 'win32') return Promise.reject(new Error('Muting needs Windows.'));
  if (ready) return ready;
  const src = fs.readFileSync(path.join(__dirname, '..', 'native', 'AudioMute.cs'), 'utf8');
  state = 'starting';
  ready = new Promise((resolve, reject) => {
    proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { windowsHide: true, env: { ...process.env, MM_AUDIO_SRC: src } });
    const fail = (msg) => { lastError = msg; state = 'error'; proc = null; ready = null; queue.splice(0).forEach(q => q.reject(new Error(msg))); reject(new Error(msg)); };
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const l of lines) {
        if (l === 'READY') { state = 'ok'; resolve(); }
        else if (l.startsWith('FATAL')) fail(`Audio helper failed to start: ${l.slice(6)}`);
        else if (l.startsWith('OK') || l.startsWith('ERR')) {
          const q = queue.shift();
          if (!q) continue;
          if (l.startsWith('OK')) q.resolve(Number(l.slice(3)) || 0); else { lastError = l.slice(4); q.reject(new Error(lastError)); }
        }
      }
    });
    proc.stdin.on('error', () => { /* the helper closed: 'exit' below rejects what's waiting */ });
    proc.on('exit', () => { if (state !== 'error') { state = 'off'; } proc = null; ready = null; queue.splice(0).forEach(q => q.reject(new Error('Audio helper stopped'))); });
    proc.on('error', (e) => fail(e.message));
    setTimeout(() => { if (state === 'starting') fail('Audio helper took too long to start.'); }, 30000);
  });
  return ready;
}

async function setMute(pids, mute) {
  const ids = (pids || []).filter(p => Number.isInteger(p) && p > 0);
  if (!ids.length) return 0;
  await startHelper();
  return new Promise((resolve, reject) => {
    if (!proc) { reject(new Error('Audio helper stopped')); return; }
    queue.push({ resolve, reject });
    proc.stdin.write(`MUTE ${mute ? 1 : 0} ${ids.join(',')}\n`);
  });
}

/** Volume Mixer level (0-100) for these processes. */
async function setVolume(pids, level) {
  const ids = (pids || []).filter(p => Number.isInteger(p) && p > 0);
  const v = Math.max(0, Math.min(100, Math.round(Number(level))));
  if (!ids.length || !Number.isFinite(v)) return 0;
  await startHelper();
  return new Promise((resolve, reject) => {
    if (!proc) { reject(new Error('Audio helper stopped')); return; }
    queue.push({ resolve, reject });
    proc.stdin.write(`VOL ${v} ${ids.join(',')}\n`);
  });
}

function stop() { if (proc) { try { proc.stdin.end(); proc.kill(); } catch { /* gone */ } } proc = null; ready = null; state = 'off'; }
function status() { return { state, lastError }; }

module.exports = { setMute, setVolume, stop, status, SCRIPT };
