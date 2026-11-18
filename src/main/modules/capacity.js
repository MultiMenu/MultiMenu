'use strict';
// PC capacity test.
//  - Estimate: from the Roblox clients running right now, works out how many
//    more your RAM, CPU and GPU can take, and which one runs out first.
//  - Live test: launches the accounts you pick one at a time into a game, lets
//    each settle, measures, and stops as soon as the PC gets close to its limit
//    (RAM 85%, CPU 90% or GPU 95%). Optionally closes the test clients after.
const settings = require('./settings');
const sessions = require('./sessions');
const processes = require('./processes');
const system = require('./system');
const bus = require('../bus');
const log = require('../logger').scope('capacity');

const LIMITS = { ram: 85, cpu: 90, gpu: 95 };
const test = { running: false, cancelled: false, steps: [], result: null, message: '' };

/** Pure estimate (exported for tests). Inputs in MB / percent. */
function estimate({ totalMB, usedMB, cpu, gpu, clients }) {
  const n = clients.length;
  if (!n) return { possible: null, reason: 'Start at least one Roblox client so MultiMenu can measure what one costs on your PC.' };
  const memPer = clients.reduce((a, c) => a + c.memMB, 0) / n;
  const cpuPer = Math.max(0.5, clients.reduce((a, c) => a + c.cpu, 0) / n);
  const otherMem = Math.max(0, usedMB - memPer * n);
  const otherCpu = Math.max(0, cpu - cpuPer * n);
  const byRam = Math.floor((totalMB * LIMITS.ram / 100 - otherMem) / memPer);
  const byCpu = Math.floor((LIMITS.cpu - otherCpu) / cpuPer);
  const byGpu = gpu != null && gpu > 0 ? Math.floor(LIMITS.gpu / (gpu / n)) : null;
  const limits = [['RAM', byRam], ['CPU', byCpu], ...(byGpu != null ? [['GPU', byGpu]] : [])];
  limits.sort((a, b) => a[1] - b[1]);
  const possible = Math.max(n, limits[0][1]);
  return { possible, current: n, limitedBy: limits[0][0], perClient: { memMB: Math.round(memPer), cpu: +cpuPer.toFixed(1), gpu: gpu != null ? +(gpu / n).toFixed(1) : null }, byRam, byCpu, byGpu };
}

function currentEstimate() {
  const s = system.latest();
  if (!s) return { possible: null, reason: 'Waiting for the first measurement…' };
  const clients = processes.robloxProcesses().map(p => ({ memMB: p.workingSet / 1048576, cpu: p.cpuPercent }));
  return estimate({ totalMB: s.ramTotal / 1048576, usedMB: s.ramUsed / 1048576, cpu: s.cpu, gpu: s.gpu, clients });
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));
function emit() { bus.emit('capacity:update', status()); }

async function sample(seconds) {
  const out = [];
  for (let i = 0; i < seconds / 2 && !test.cancelled; i++) { await wait(2000); const s = system.latest(); if (s) out.push(s); }
  const avg = (k) => (out.length ? out.reduce((a, s) => a + (s[k] ?? 0), 0) / out.length : 0);
  return { ram: +avg('ramPercent').toFixed(1), cpu: +avg('cpu').toFixed(1), gpu: out.some(s => s.gpu != null) ? +avg('gpu').toFixed(1) : null };
}

async function runTest(accountIds, game, { closeAfter = true, settleSec = 60 } = {}) {
  if (test.running) throw new Error('A test is already running.');
  const ids = (accountIds || []).filter(Boolean).slice(0, 40);
  if (ids.length < 2) throw new Error('Pick at least two accounts for the test.');
  if (!game) throw new Error('Choose a game to test with (a busy game gives the most realistic result).');
  Object.assign(test, { running: true, cancelled: false, steps: [], result: null, message: 'Measuring your PC with no test clients…' });
  emit();
  const launched = [];
  try {
    const base = await sample(10);
    test.steps.push({ clients: 0, ...base });
    emit();
    for (const id of ids) {
      if (test.cancelled) break;
      test.message = `Launching client ${launched.length + 1} of ${ids.length}…`; emit();
      const before = new Set(sessions.listSessions().map(s => s.id));
      sessions.launch(id, game, { watch: false, label: `Test ${launched.length + 1}` });
      launched.push(id);
      // wait for it to start, then let it load and settle
      for (let i = 0; i < 60 && !test.cancelled; i++) { await wait(1500); if (sessions.listSessions().some(s => !before.has(s.id) && s.status === 'running')) break; }
      test.message = `Client ${launched.length} loading — measuring for ${settleSec}s…`; emit();
      await wait(Math.max(15, settleSec - 20) * 1000);
      const m = await sample(20);
      test.steps.push({ clients: launched.length, ...m });
      emit();
      const over = m.ram >= LIMITS.ram ? 'RAM' : m.cpu >= LIMITS.cpu ? 'CPU' : m.gpu != null && m.gpu >= LIMITS.gpu ? 'GPU' : null;
      if (over) { test.result = { maxClients: Math.max(1, launched.length - 1), limitedBy: over, reachedAt: launched.length }; break; }
    }
    if (!test.result) test.result = { maxClients: launched.length, limitedBy: null, reachedAt: null, note: test.cancelled ? 'Stopped early.' : 'Ran out of accounts before reaching a limit — your PC can probably take more.' };
    test.message = 'Done.';
    log.info(`Capacity test: ${JSON.stringify(test.result)}`);
  } finally {
    if (closeAfter) {
      for (const s of sessions.listSessions()) if (s.label?.startsWith('Test ') && launched.includes(s.accountId) && ['running', 'launching'].includes(s.status)) sessions.close(s.id);
    }
    test.running = false;
    emit();
  }
  return status();
}

function cancel() { test.cancelled = true; test.message = 'Stopping…'; emit(); return status(); }
function status() { return { estimate: currentEstimate(), test: { running: test.running, steps: test.steps, result: test.result, message: test.message }, limits: LIMITS, config: settings.get('performance') }; }

module.exports = { estimate, runTest, cancel, status };
