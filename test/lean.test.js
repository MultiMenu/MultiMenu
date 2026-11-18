// Using less CPU and RAM: slower background checks, held page updates, the lightest preset.
const { test } = require('node:test');
const assert = require('node:assert');
require('./helpers/electron-stub');
const settings = require('../src/main/modules/settings');
settings.init();
const lean = require('../src/main/modules/lean');

test('background checks: normal, relaxed or slow, and low-resource mode is at least relaxed', () => {
  assert.equal(lean.factorFor('normal', false), 1);
  assert.equal(lean.factorFor('relaxed', false), 2);
  assert.equal(lean.factorFor('slow', false), 4);
  assert.equal(lean.factorFor('normal', true), 2);
  assert.equal(lean.factorFor('slow', true), 4);
  assert.equal(lean.factorFor('nonsense', false), 1);
});

test('a paced check runs on the first tick, then every 2nd or 4th, and follows the setting at once', () => {
  let runs = 0;
  const fn = lean.paced(() => { runs++; });
  settings.set('performance.checkSpeed', 'slow');
  for (let i = 0; i < 8; i++) fn();
  assert.equal(runs, 2);
  settings.set('performance.checkSpeed', 'normal');
  for (let i = 0; i < 3; i++) fn();
  assert.equal(runs, 5);
});

test('live numbers wait while a window is hidden; everything else is sent right away', () => {
  const sent = [];
  const handlers = {};
  const w = { visible: false, isVisible() { return this.visible; }, isMinimized: () => false, isDestroyed: () => false, on: (e, f) => { handlers[e] = f; }, webContents: { send: (ch, p) => sent.push([ch, p]) } };
  settings.set('performance.pauseHidden', true);
  lean.send(w, 'system:sample', 1);
  lean.send(w, 'system:sample', 2);
  lean.send(w, 'sessions:changed', 'x');
  assert.deepEqual(sent, [['evt:sessions:changed', 'x']]);
  w.visible = true;
  lean.send(w, 'system:sample', 3);
  assert.deepEqual(sent.at(-1), ['evt:system:sample', 3]);
  assert.ok(handlers.show && handlers.restore, 'the held numbers are sent when the window comes back');
});

test('defaults: on for the free savings, off for ending crash reporters', () => {
  assert.equal(settings.get('performance.pauseHidden'), true);
  assert.equal(settings.get('performance.trimSelf'), true);
  assert.equal(settings.get('performance.endCrashHandlers'), false);
  assert.equal(settings.get('appearance.pauseUnfocused'), true);
  for (const k of Object.keys(lean.LIGHTEST)) assert.notEqual(settings.get(k), undefined, k);
});
