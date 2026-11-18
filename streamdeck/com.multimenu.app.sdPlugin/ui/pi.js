// Property inspector: per-key settings plus the shared API key and port.
let ws = null, uuid = null, action = null, settings = {}, globalCfg = {};
const $ = (id) => document.getElementById(id);
const FIELDS = {
  launch: ['who', 'game'], preset: ['name', 'mode'], close: ['who'], focus: ['who', 'thumb'], rejoin: ['who'],
};

function send(event, payload) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload === undefined ? { event, context: uuid } : { event, context: uuid, payload })); }
function saveSettings() {
  for (const f of FIELDS[action] || []) settings[f] = $(f).type === 'checkbox' ? $(f).checked : $(f).value.trim();
  send('setSettings', settings);
}
function saveGlobal() {
  globalCfg = { key: $('key').value.trim(), port: Number($('port').value) || 43822 };
  send('setGlobalSettings', globalCfg);
}
function show() {
  const kind = String(action || '').split('.').pop();
  for (const el of document.querySelectorAll('[class*="f-"]')) el.classList.add('hidden');
  for (const f of FIELDS[kind] || []) document.querySelector(`.f-${f}`)?.classList.remove('hidden');
  if (!(FIELDS[kind] || []).length) $('action-fields').querySelector('hr').classList.add('hidden');
  action = kind;
  for (const f of FIELDS[kind] || []) { const el = $(f); if (el.type === 'checkbox') el.checked = !!settings[f]; else el.value = settings[f] || (f === 'mode' ? 'start' : f === 'who' && kind === 'close' ? 'all' : ''); }
}

// Called by the Stream Deck app.
window.connectElgatoStreamDeckSocket = (port, inUUID, registerEvent, info, actionInfo) => {
  uuid = inUUID;
  const ai = JSON.parse(actionInfo || '{}');
  action = ai.action; settings = ai.payload?.settings || {};
  show();
  ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.onopen = () => { ws.send(JSON.stringify({ event: registerEvent, uuid })); send('getGlobalSettings'); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.event === 'didReceiveGlobalSettings') {
      globalCfg = m.payload.settings || {};
      $('key').value = globalCfg.key || ''; $('port').value = globalCfg.port || 43822;
      if (globalCfg.key) send('sendToPlugin', { type: 'lists' });
    }
    if (m.event === 'sendToPropertyInspector' && m.payload.type === 'lists') {
      const p = m.payload;
      $('msg').className = `msg ${p.ok ? 'ok' : 'err'}`;
      $('msg').textContent = p.ok ? `Connected · ${p.accounts.length} accounts` : p.error;
      const tags = [...new Set(p.accounts.flatMap(a => a.tags || []))];
      $('whos').innerHTML = ['all', ...p.accounts.map(a => a.name), ...tags.map(t => `tag:${t}`)].map(v => `<option value="${v.replace(/"/g, '&quot;')}">`).join('');
      $('presets').innerHTML = p.presets.map(v => `<option value="${v.replace(/"/g, '&quot;')}">`).join('');
    }
  };
};

for (const id of ['who', 'game', 'name', 'mode', 'thumb']) $(id).addEventListener('change', saveSettings);
for (const id of ['key', 'port']) $(id).addEventListener('change', saveGlobal);
$('test').addEventListener('click', () => { saveGlobal(); $('msg').textContent = 'Checking…'; $('msg').className = 'msg'; send('sendToPlugin', { type: 'test', globalCfg }); });
