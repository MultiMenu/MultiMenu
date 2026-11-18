'use strict';
// Reads text from screenshots with Windows' own text recognition (Windows.Media.Ocr,
// built into Windows 10 and 11). One PowerShell process stays open and reads image
// paths from stdin, one per line, answering with one JSON line each. Nothing is sent
// anywhere: recognition happens on this PC.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const log = require('../logger').scope('ocr');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Foundation.IAsyncOperation` + '`' + String.raw`1, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' })[0]
  function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $null = $task.Wait(-1); $task.Result }
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US')) }
  if (-not $engine) { [Console]::Out.WriteLine('{"ready":false,"error":"Windows text recognition has no language installed"}'); exit 1 }
  [Console]::Out.WriteLine('{"ready":true}')
} catch { [Console]::Out.WriteLine((@{ ready = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)); exit 1 }
while ($true) {
  $p = [Console]::In.ReadLine()
  if ($p -eq $null) { break }
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($p)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $stream.Dispose()
    $text = ($res.Lines | ForEach-Object { $_.Text }) -join [string][char]10
    $lines = @($res.Lines | ForEach-Object {
      $ws = @($_.Words | ForEach-Object { $_.BoundingRect })
      $x1 = ($ws | Measure-Object -Property X -Minimum).Minimum; $y1 = ($ws | Measure-Object -Property Y -Minimum).Minimum
      $x2 = ($ws | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum; $y2 = ($ws | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum
      @{ t = $_.Text; x = [int]$x1; y = [int]$y1; w = [int]($x2 - $x1); h = [int]($y2 - $y1) }
    })
    [Console]::Out.WriteLine((@{ ok = $true; text = $text; lines = $lines } | ConvertTo-Json -Compress -Depth 4))
  } catch { [Console]::Out.WriteLine((@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)) }
}
`;

let proc = null, ready = null, buf = '', queue = [], failed = null, scriptFile = null;

function available() { return process.platform === 'win32'; }

function start() {
  if (proc) return ready;
  if (!available()) return Promise.reject(new Error('Text recognition needs Windows 10 or 11.'));
  scriptFile = require('./pshelper').scriptFile('ocr', SCRIPT);
  proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Windows text recognition did not start.')), 30000);
    queue.push({ ready: true, resolve: (r) => { clearTimeout(t); if (r.ready) resolve(true); else reject(new Error(r.error || 'Windows text recognition is not available.')); }, reject: (e) => { clearTimeout(t); reject(e); } });
  });
  ready.catch((e) => { failed = e.message; log.warn(`OCR unavailable: ${e.message}`); });
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      const job = queue.shift();
      if (!job) continue;
      try { job.resolve(JSON.parse(line)); } catch (e) { job.reject(e); }
    }
  });
  proc.stderr.on('data', () => {});
  proc.on('exit', () => {
    const q = queue; queue = []; proc = null; buf = '';
    for (const j of q) j.reject(new Error('Text recognition stopped.'));
  });
  proc.on('error', (e) => { failed = e.message; });
  return ready;
}

function stop() { if (proc) { try { proc.stdin.end(); proc.kill(); } catch { /* gone */ } proc = null; } }

/** Text in a PNG (Buffer). Resolves '' when nothing is readable. */
async function read(png, name = 'shot') { return (await readLines(png, name)).text; }

/** Text plus where each line is: { text, lines: [{ t, x, y, w, h }] } in the image's pixels. */
async function readLines(png, name = 'shot') {
  await start();
  const file = path.join(os.tmpdir(), `multimenu-ocr-${String(name).replace(/[^\w-]/g, '')}.png`);
  fs.writeFileSync(file, png);
  const r = await new Promise((resolve, reject) => {
    const t = setTimeout(() => { reject(new Error('Text recognition timed out.')); stop(); }, 15000);
    queue.push({ resolve: (x) => { clearTimeout(t); resolve(x); }, reject: (e) => { clearTimeout(t); reject(e); } });
    proc.stdin.write(`${file}\n`);
  });
  if (!r.ok) throw new Error(r.error || 'Could not read that image.');
  const lines = (Array.isArray(r.lines) ? r.lines : r.lines ? [r.lines] : []).filter(l => l && typeof l.t === 'string');
  return { text: String(r.text || ''), lines };
}

const status = () => ({ available: available(), running: !!proc, error: failed });

module.exports = { read, readLines, start, stop, status, available };
