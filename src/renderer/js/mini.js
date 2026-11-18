// Compact always-on-top panel: session status, watcher, quick actions, presets.
(function () {
  const MM = window.MM;
  const root = document.getElementById('mini-root');
  let sessions = [], presets = [], watcher = null;

  MM.$('#m-main').innerHTML = MM.icon('external-link', 15);
  MM.$('#m-close').innerHTML = MM.icon('x', 16);
  MM.$('#m-main').onclick = () => MM.api('app:showMain');
  // Compact strip: one dot per account (green in game, amber starting/rejoining, red not responding).
  let compact = false;
  const setCompact = (on) => {
    compact = !!on;
    document.body.classList.toggle('compact', compact);
    MM.$('#m-compact').innerHTML = MM.icon(compact ? 'maximize-2' : 'minimize-2', 14);
    MM.$('#m-compact').title = MM.t ? MM.t(compact ? 'Full panel' : 'Compact strip') : (compact ? 'Full panel' : 'Compact strip');
    renderStrip();
  };
  MM.$('#m-compact').onclick = async () => setCompact(await MM.call('app:miniCompact', !compact));
  MM.$('#m-close').onclick = () => MM.api('app:closeMini');

  root.innerHTML = `
    <div class="row nowrap" style="gap:8px;margin-bottom:10px">
      <div class="statpill" style="flex:1;min-width:0"><b id="mi-run">0</b><span>running</span></div>
      <div class="statpill" style="flex:1;min-width:0"><b id="mi-cpu">—</b><span>CPU</span></div>
      <div class="statpill" style="flex:1;min-width:0"><b id="mi-ram">—</b><span>RAM</span></div>
    </div>
    <div class="row nowrap" style="margin-bottom:10px">
      <label class="toggle"><input type="checkbox" id="mi-watch"><span class="sw"></span><b>24/7 Watcher</b></label><span class="spacer"></span><span class="small muted" id="mi-pending"></span>
    </div>
    <div class="row nowrap" style="gap:6px;margin-bottom:10px">
      <button class="btn sm" style="flex:1" data-act="tile">${MM.icon('layout-dashboard', 14)}Tile</button>
      <button class="btn sm" style="flex:1" data-act="minAll">${MM.icon('minus', 14)}Hide</button>
      <button class="btn sm danger" style="flex:1" data-act="estop">${MM.icon('octagon-x', 14)}Stop</button>
    </div>
    <div class="row nowrap" style="gap:6px;margin-bottom:12px">
      <select class="input sm" id="mi-preset"></select>
      <button class="btn sm primary" data-act="preset">${MM.icon('rocket', 14)}</button>
    </div>
    <div class="list" id="mi-list"></div>`;

  const renderList = () => {
    renderStrip();
    const live = sessions.filter(s => ['running', 'launching', 'closing'].includes(s.status));
    MM.$('#mi-run').textContent = live.filter(s => s.status === 'running').length;
    MM.$('#mi-list').innerHTML = live.length ? live.map(s => `<div class="item" data-id="${MM.esc(s.id)}">
      <span class="dot ${s.status !== 'running' ? 'warn' : s.watchState === 'not responding' ? 'err' : 'live'}"></span>
      <div class="grow"><div class="title">${MM.esc(s.label)}</div><div class="meta">${s.status === 'running' ? `${MM.fmt.dur(Date.now() - s.startedAt)} · ${MM.fmt.mb(s.memMB || 0)}` : MM.esc(s.status)}${s.watch ? ' · watched' : ''}</div></div>
      ${s.status === 'running' ? `<button class="btn sm icon" data-act="focus" title="Bring to front">${MM.icon('eye', 13)}</button>` : ''}</div>`).join('')
      : MM.empty('monitor-play', 'Nothing running', 'Start a preset above.');
  };
  const dotState = (s) => (s.status !== 'running' ? 'warn' : s.watchState === 'not responding' ? 'err' : 'live');
  function renderStrip() {
    const el = MM.$('#mini-strip');
    if (!compact) { el.innerHTML = ''; return; }
    const live = sessions.filter(s => ['running', 'launching', 'closing'].includes(s.status));
    const pend = watcher?.pending?.length || 0;
    const bad = live.filter(s => dotState(s) === 'err').length;
    el.innerHTML = `<div class="strip-dots">${live.length ? live.map(s => `<span class="sdot ${dotState(s)}" title="${MM.esc(s.label)} · ${MM.esc(s.status === 'running' ? (s.watchState || 'running') : s.status)}" data-id="${MM.esc(s.id)}" data-nt></span>`).join('') : '<span class="small muted">Nothing running</span>'}</div>
      <div class="strip-sum"><b>${live.filter(s => s.status === 'running').length}</b> running${bad ? ` · <b class="err">${bad}</b> not responding` : ''}${pend ? ` · <b class="warn">${pend}</b> rejoining` : ''}</div>`;
  }
  MM.$('#mini-strip').addEventListener('click', (e) => { const d = e.target.closest('.sdot'); if (d) MM.call('tiler:focus', d.dataset.id); });
  const renderWatcher = (w) => {
    if (!w) return;
    watcher = w;
    MM.$('#mi-watch').checked = w.enabled;
    renderStrip();
    MM.$('#mi-pending').textContent = w.pending.length ? `${w.pending.length} rejoin${w.pending.length > 1 ? 's' : ''} queued` : w.quiet ? 'quiet hours' : '';
  };
  const renderPresets = () => {
    MM.$('#mi-preset').innerHTML = presets.length ? presets.map(p => `<option value="${MM.esc(p.id)}">${MM.esc(p.name)}</option>`).join('') : '<option value="">No presets yet</option>';
  };
  const onSample = (s) => { if (!s) return; MM.$('#mi-cpu').textContent = `${Math.round(s.cpu)}%`; MM.$('#mi-ram').textContent = `${Math.round(s.ramPercent)}%`; };

  MM.$('#mi-watch').addEventListener('change', async (e) => renderWatcher(await MM.call('watcher:enable', e.target.checked)));
  MM.delegate(root, {
    tile: async () => { const r = await MM.call('tiler:tile'); if (r) MM.toast('success', 'Tiled', `${r.placed} windows`); },
    minAll: () => MM.call('tiler:minimizeAll'),
    estop: () => MM.call('automation:emergencyStop'),
    preset: async (b) => { const id = MM.$('#mi-preset').value; if (id) await MM.busy(b, () => MM.call('presets:run', id)); },
    focus: (b) => MM.call('tiler:focus', b.closest('[data-id]').dataset.id),
  });

  (async () => {
    try {
      await window.MMI18NReady;
      MM.state.settings = await MM.api('settings:get');
      document.documentElement.style.setProperty('--hue', MM.state.settings.appearance.accentHue);
      if (MM.state.settings.appearance.reducedMotion || MM.state.settings.performance.lowResourceMode) document.body.classList.add('reduce-motion');
      setCompact(MM.state.settings.mini?.compact);
    } catch { /* defaults */ }
    sessions = await MM.call('sessions:list') || []; renderList();
    presets = await MM.call('presets:list') || []; renderPresets();
    renderWatcher(await MM.call('watcher:status'));
    onSample(await MM.call('system:latest'));
  })();
  MM.on('sessions:changed', l => { sessions = l || []; renderList(); });
  MM.on('sessions:stats', l => { sessions = l || []; renderList(); });
  MM.on('system:sample', onSample);
  MM.on('watcher:update', renderWatcher);
  MM.on('presets:changed', async () => { presets = await MM.call('presets:list') || []; renderPresets(); });
  MM.on('notifications:new', n => { if (['error', 'warn'].includes(n.level)) MM.toast(n.level, n.title, n.message, 3500); });
})();
