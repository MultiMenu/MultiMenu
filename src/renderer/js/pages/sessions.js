(function () {
  const MM = window.MM;
  const ST = { launching: ['warn', 'Launching'], running: ['ok', 'Running'], closing: ['warn', 'Closing'], closed: ['dim', 'Closed'], exited: ['err', 'Ended unexpectedly'], failed: ['err', 'Failed'] };

  // Mini icons for the layout picker (48×30 viewBox).
  const R = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5"/>`;
  const LAYOUT_ICONS = {
    auto: R(2, 2, 21, 12) + R(25, 2, 21, 12) + R(2, 16, 21, 12) + R(25, 16, 21, 12),
    columns: R(2, 2, 13, 26) + R(17.5, 2, 13, 26) + R(33, 2, 13, 26),
    rows: R(2, 2, 44, 7.5) + R(2, 11.25, 44, 7.5) + R(2, 20.5, 44, 7.5),
    grid2: R(2, 2, 21, 12) + R(25, 2, 21, 12) + R(2, 16, 21, 12) + R(25, 16, 21, 12),
    grid3: [0, 1, 2].map(r => [0, 1, 2].map(c => R(2 + c * 15, 2 + r * 9, 13.5, 7.5)).join('')).join(''),
    grid4: [0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => R(2 + c * 11.2, 2 + r * 6.8, 9.8, 5.6)).join('')).join(''),
    main: R(2, 2, 28, 26) + R(32, 2, 14, 12) + R(32, 16, 14, 12),
    cascade: R(2, 2, 26, 16) + R(9, 7, 26, 16) + R(16, 12, 26, 16),
    fixed: R(2, 2, 14, 10) + R(18, 2, 14, 10) + R(34, 2, 12, 10) + R(2, 14, 14, 10),
    tiny: [0, 1, 2].map(r => [0, 1, 2, 3, 4].map(c => R(2 + c * 9, 2 + r * 8, 7.5, 6.5)).join('')).join(''),
  };

  MM.pages.sessions = {
    render(root) {
      let sessions = [], accounts = [], tab = 'live', picked = new Set(), pv = null, selCell = null;
      root.innerHTML = `
        <div class="page-head"><div><h1>OpenMulti</h1><p>Run several Roblox accounts at once, tile their windows, label each one and keep an eye on every session.</p></div>
          <div class="actions">
            <button class="btn" data-act="tile">${MM.icon('layout-dashboard')}Tile windows</button>
            <button class="btn danger" data-act="closeAll">${MM.icon('circle-stop')}Close all</button>
          </div></div>
        ${MM.winOnly()}
        <div class="grid g3">
          <div class="card" id="om-card"></div>
          <div class="card span2">
            <h3>${MM.icon('rocket')}Launch accounts</h3>
            <div class="row nowrap" style="margin-bottom:12px">
              <input class="input" id="om-target" placeholder="Place ID, game link or private server link (blank = each account's default)">
              <button class="btn primary" data-act="launch" id="om-launch" disabled>${MM.icon('play')}Launch</button>
            </div>
            <div class="row" style="margin-bottom:8px"><span class="small muted" id="om-picked">Pick accounts below</span><span class="spacer"></span><button class="btn sm ghost" data-act="pickAll">Select all valid</button></div>
            <div class="list" id="om-accounts" style="max-height:230px;overflow:auto"></div>
          </div>
        </div>

        <div class="card" style="margin-top:16px" id="tile-card">
          <h3>${MM.icon('layout-dashboard')}Window tiling<span class="right" id="tile-status"></span></h3>
          <div class="tile-wrap">
            <div>
              <div class="monitor-frame"><div class="monitor" id="tile-monitor"></div></div>
              <div class="monitor-stand"></div><div class="monitor-base"></div>
              <p class="hint" style="text-align:center;margin-top:10px">Click one window, then another, to swap their places. ${MM.icon('keyboard', 12).replace('class="ic"', 'class="ic" style="display:inline;vertical-align:-2px"')} <span id="tile-hk"></span> tiles from anywhere.</p>
              <div class="lbl" style="margin:16px 0 8px">Windows in tiling order</div>
              <div class="list" id="tile-windows"></div>
            </div>
            <div class="stack">
              <div class="field"><label>Layout</label><div class="layout-grid" id="tile-layouts"></div></div>
              <div class="row hidden" id="tile-custom-f" style="gap:8px;margin-top:-4px"><span class="small muted grow" id="tile-custom-name" data-nt></span>
                <button class="btn sm" data-act="editLayout">${MM.icon('pencil', 14)}Edit</button><button class="btn sm ghost danger" data-act="delLayout">${MM.icon('trash-2', 14)}Delete</button></div>
              <div class="field"><label>Monitor</label><select class="input" id="tile-display"></select></div>
              <div class="field"><label>Gap between windows</label><div class="range-row"><input type="range" min="0" max="40" id="tile-gap"><b id="tile-gap-v"></b></div></div>
              <div class="field"><label>Screen edge margin</label><div class="range-row"><input type="range" min="0" max="80" id="tile-pad"><b id="tile-pad-v"></b></div></div>
              <div class="field hidden" id="tile-main-f"><label>Main window width</label><div class="range-row"><input type="range" min="30" max="85" id="tile-main"><b id="tile-main-v"></b></div></div>
              <div class="form-grid hidden" id="tile-fixed-f" style="grid-template-columns:1fr 1fr">
                <div class="field"><label>Window width (px)</label><input class="input" type="number" min="16" max="7680" data-setting="tiling.cellWidth"></div>
                <div class="field"><label>Window height (px)</label><input class="input" type="number" min="16" max="4320" data-setting="tiling.cellHeight"></div>
              </div>
              <div class="hidden" id="tile-tiny-f">
                <div class="form-grid" style="grid-template-columns:1fr 1fr">
                  <div class="field"><label>Tiny width (px)</label><input class="input" type="number" min="16" max="7680" data-setting="perf.tinyW"></div>
                  <div class="field"><label>Tiny height (px)</label><input class="input" type="number" min="16" max="4320" data-setting="perf.tinyH"></div>
                </div>
                <p class="hint">As small as you like: this is the size of each game picture, and Roblox's own minimum (816 × 638) doesn't stop it. Tiny windows stay tiny, even after you restore one. Use the shrink button next to a window to make just that one tiny or bring it back.</p>
              </div>
              <div>
                ${MM.settingRow('Auto-tile new clients', 'Re-tiles every time a Roblox client finishes starting.', MM.toggle('tiling.autoTile'))}
                ${MM.settingRow('Tile hotkey', 'Click the box and press the keys you want (F5, say). Works from anywhere, Roblox included.', '<input class="input sm" style="width:150px" data-setting="hotkeys.tileWindows" data-hotkey>')}
                ${MM.settingRow('Hide Roblox title bars', 'Game windows show only the game, with no title bar or border. Turn it off to get them back.', MM.toggle('tiling.hideTitleBars'))}
                ${MM.settingRow('Include Roblox opened elsewhere', 'Also arrange clients MultiMenu didn\'t launch.', MM.toggle('tiling.includeExternal'))}
                ${MM.settingRow('Centre an unfinished last row', 'With 3 windows in a 2×2, the third sits in the middle.', MM.toggle('tiling.centerLastRow'))}
              </div>
              <div class="tile-actions">
                <button class="btn primary big wide" data-act="tile">${MM.icon('layout-dashboard', 20)}Tile windows now</button>
                <button class="btn" data-act="restore" id="tile-restore">${MM.icon('history')}Restore positions</button>
                <button class="btn" data-act="showAll">${MM.icon('layers')}Show all</button>
                <button class="btn wide" data-act="minAll">${MM.icon('minus')}Minimise all Roblox windows</button>
                <button class="btn" data-act="shareLayout">${MM.icon('share-2')}Share layout</button>
                <button class="btn" data-act="importCode">${MM.icon('clipboard-paste')}Paste a code</button>
              </div>
              <div class="hint">Roblox can refuse sizes below its own minimum window size; very dense grids may then overlap slightly.</div>
            </div>
          </div>
          <div class="grid g3 tile-extras">
            <div class="xbox" id="fx-box">
              <div class="xhead">${MM.icon('focus', 18)}<b>Focus mode</b><span class="spacer"></span><span class="badge" id="fx-state">Off</span></div>
              <p class="small muted">One window big, the others in a side strip. Cycle which one is big with a hotkey.</p>
              <div class="row" style="gap:8px"><button class="btn sm primary" data-act="focusToggle" id="fx-btn">${MM.icon('focus', 14)}Turn on</button><button class="btn sm" data-act="focusNext">${MM.icon('skip-forward', 14)}Next window</button></div>
              <div class="row" style="gap:8px;margin-top:10px"><span class="small muted">Big window</span><div class="range-row" style="flex:1"><input type="range" min="50" max="85" id="fx-ratio"><b id="fx-ratio-v"></b></div>
                <select class="input sm" id="fx-side" style="width:auto"><option value="right">Strip on the right</option><option value="left">Strip on the left</option></select></div>
              <div class="small dim" style="margin-top:8px" id="fx-hk"></div>
            </div>
            <div class="xbox">
              <div class="xhead">${MM.icon('picture-in-picture-2', 18)}<b>Picture-in-picture</b><span class="spacer"></span><span class="badge" id="pip-state">Closed</span></div>
              <p class="small muted">A small always-on-top live view of one alt, so you can watch it while you play on your main. Click the view to jump to that window.</p>
              <div class="row" style="gap:8px"><button class="btn sm primary" data-act="pipOpen">${MM.icon('picture-in-picture-2', 14)}Open PiP</button><button class="btn sm" data-act="pipClose">${MM.icon('x', 14)}Close</button></div>
              <div class="small dim" style="margin-top:8px">The live view stays on this PC; nothing is recorded. A minimised window can't be shown.</div>
            </div>
            <div class="xbox">
              <div class="xhead">${MM.icon('monitor', 18)}<b>Layouts per monitor setup</b><span class="spacer"></span>${MM.toggle('tiling.perMonitorSetup')}</div>
              <p class="small muted">Remembers your layout for each monitor arrangement and switches by itself when you plug a screen in or out.</p>
              <div class="small" id="lay-now"></div>
              <div class="list" id="lay-list" style="margin-top:6px"></div>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:16px">
          <div class="tabs" id="om-tabs"></div>
          <div id="om-list"></div>
        </div>`;

      MM.bindSettings(MM.$('#tile-card', root));

      // ---------- OpenMulti status ----------
      const renderOM = async () => {
        const s = await MM.call('sessions:openMulti');
        if (!s) return;
        MM.$('#om-card', root).innerHTML = `<h3>${MM.icon('layers')}OpenMulti</h3>
          <div class="row"><span class="dot ${s.active ? 'live' : ''}"></span><b>${s.active ? 'Active' : 'Inactive'}</b></div>
          <p class="small muted">${MM.esc(s.message)}</p>
          <button class="btn ${s.active ? '' : 'primary'} big" style="width:100%" data-act="${s.active ? 'omOff' : 'omOn'}">${MM.icon('power')}${s.active ? 'Disable OpenMulti' : 'Enable OpenMulti'}</button>
          <div class="hint" style="margin-top:12px">Enable it with every Roblox window closed. MultiMenu then holds Roblox's single-instance lock so each client you start can run side by side. A Roblox update can change this behaviour.</div>
          <div class="small dim" style="margin-top:10px">Roblox client: ${s.playerPath ? MM.esc(s.playerPath.split('\\').slice(-2).join('\\')) : 'launched through the roblox-player link'}</div>`;
      };

      const renderAccounts = () => {
        MM.$('#om-accounts', root).innerHTML = accounts.length ? accounts.map(a => `<label class="item" style="cursor:pointer"><input type="checkbox" class="check" data-pick="${MM.esc(a.id)}" ${picked.has(a.id) ? 'checked' : ''} ${a.status === 'expired' ? 'disabled' : ''}>${MM.avatar(a.avatarUrl, a.username, 'sm')}<div class="grow"><div class="title">${MM.esc(a.alias || a.displayName || a.username)}</div><div class="meta">@${MM.esc(a.username)} · ${MM.esc(a.group)}${a.defaultPlace ? ` · default ${MM.esc(a.defaultPlace.slice(0, 30))}` : ''}</div></div>${a.status === 'expired' ? '<span class="badge err">Login expired</span>' : ''}</label>`).join('')
          : MM.empty('users', 'No accounts', 'Add accounts on the Accounts page first.');
        MM.$('#om-picked', root).textContent = picked.size ? `${picked.size} account${picked.size > 1 ? 's' : ''} selected` : 'Pick accounts below';
        MM.$('#om-launch', root).disabled = !picked.size;
      };

      // ---------- tiling box ----------
      const t = () => MM.state.settings.tiling;
      let customLayouts = [];
      const renderControls = () => {
        const zonesOf = (id) => customLayouts.find(l => `custom:${l.id}` === id)?.zones || [];
        MM.$('#tile-layouts', root).innerHTML = Object.entries(pv.layouts).map(([id, label]) => `<button class="layout-btn ${t().layout === id ? 'on' : ''}" data-layout="${MM.esc(id)}"><svg width="48" height="30" viewBox="0 0 48 30">${LAYOUT_ICONS[id] || (id.startsWith('custom:') ? MM.zonesIcon(zonesOf(id)) : '')}</svg><span ${id.startsWith('custom:') ? 'data-nt' : ''}>${MM.esc(label)}</span></button>`).join('')
          + `<button class="layout-btn dashed" data-act="drawLayout"><svg width="48" height="30" viewBox="0 0 48 30"><path d="M24 9v12M18 15h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>${MM.esc(MM.t('Draw your own'))}</button>`;
        const cur = customLayouts.find(l => `custom:${l.id}` === t().layout);
        MM.$('#tile-custom-f', root).classList.toggle('hidden', !cur);
        if (cur) MM.$('#tile-custom-name', root).textContent = cur.name;
        const sel = MM.$('#tile-display', root);
        sel.innerHTML = pv.displays.map(d => `<option value="${MM.esc(d.id)}" ${d.id === pv.display.id ? 'selected' : ''}>${MM.esc(d.label)}</option>`).join('');
        MM.$('#tile-gap', root).value = t().gap; MM.$('#tile-gap-v', root).textContent = `${t().gap}px`;
        MM.$('#tile-pad', root).value = t().padding; MM.$('#tile-pad-v', root).textContent = `${t().padding}px`;
        MM.$('#tile-main', root).value = Math.round(t().mainRatio * 100); MM.$('#tile-main-v', root).textContent = `${Math.round(t().mainRatio * 100)}%`;
        MM.$('#tile-main-f', root).classList.toggle('hidden', t().layout !== 'main');
        MM.$('#tile-fixed-f', root).classList.toggle('hidden', t().layout !== 'fixed');
        MM.$('#tile-tiny-f', root).classList.toggle('hidden', t().layout !== 'tiny');
        MM.$('#tile-hk', root).innerHTML = `<span class="kbd">${MM.esc(MM.state.settings.hotkeys.tileWindows || '—')}</span>`;
        const f = MM.state.settings.focus || { ratio: 0.78, stripSide: 'right' }, fo = pv.focus || {};
        MM.$('#fx-state', root).textContent = fo.on ? MM.t('On') : MM.t('Off');
        MM.$('#fx-state', root).className = `badge ${fo.on ? 'ok' : ''}`;
        MM.$('#fx-btn', root).innerHTML = `${MM.icon('focus', 14)}${fo.on ? 'Turn off' : 'Turn on'}`;
        MM.$('#fx-ratio', root).value = Math.round(f.ratio * 100); MM.$('#fx-ratio-v', root).textContent = `${Math.round(f.ratio * 100)}%`;
        MM.$('#fx-side', root).value = f.stripSide;
        const hk = MM.state.settings.hotkeys;
        MM.$('#fx-hk', root).innerHTML = `Hotkeys: <span class="kbd">${MM.esc(hk.focusMode || '—')}</span> on/off · <span class="kbd">${MM.esc(hk.focusNext || '—')}</span> next window`;
      };

      const renderLayouts = async () => {
        const st = await MM.call('layouts:status');
        if (!st) return;
        MM.$('#lay-now', root).innerHTML = `This setup: <b data-nt>${MM.esc(st.currentName)}</b>`;
        MM.$('#lay-list', root).innerHTML = st.saved.length ? st.saved.map(x => `<div class="item"><div class="grow"><div class="title" data-nt>${MM.esc(x.name)}</div><div class="meta">${MM.esc(pv?.layouts?.[x.layout] || x.layout)}${x.current ? ' · in use now' : ''}</div></div>
          <button class="btn sm icon" data-act="layForget" data-sig="${MM.esc(x.sig)}" title="Forget this setup">${MM.icon('trash-2', 14)}</button></div>`).join('') : '<div class="small muted">Nothing saved yet — tile once and it\'s remembered.</div>';
      };
      const renderPip = (st) => { const el = MM.$('#pip-state', root); if (!el || !st) return; el.textContent = st.open ? `${MM.t('Showing')} ${st.label || ''}` : MM.t('Closed'); el.className = `badge ${st.open ? 'ok' : ''}`; };

      const renderMonitor = () => {
        if (!pv) return;
        const m = MM.$('#tile-monitor', root);
        const d = pv.display;
        m.style.aspectRatio = `${d.width} / ${d.height}`;
        const wa = d.workArea;
        const tb = [];
        if (wa.y + wa.height < d.height) tb.push(`top:${((wa.y + wa.height) / d.height) * 100}%;bottom:0`);
        if (wa.y > 0) tb.push(`top:0;height:${(wa.y / d.height) * 100}%`);
        const width = m.clientWidth || 600;
        m.innerHTML = `<div class="workarea" style="left:${(wa.x / d.width) * 100}%;top:${(wa.y / d.height) * 100}%;width:${(wa.width / d.width) * 100}%;height:${(wa.height / d.height) * 100}%"></div>
          ${tb.map(s => `<div class="taskbar" style="${s}"></div>`).join('')}
          ${pv.cells.map((c, i) => `<div class="tile-cell ${c.placeholder ? 'ph' : ''} ${c.sessionId && c.sessionId === selCell ? 'sel' : ''} ${c.w * width < 110 || c.h * width * (d.height / d.width) < 70 ? 'small' : ''}" data-cell="${MM.esc(c.sessionId || '')}" style="left:${c.x * 100}%;top:${c.y * 100}%;width:${c.w * 100}%;height:${c.h * 100}%;z-index:${i + 1}">
            <span class="num">${i + 1}</span>${c.placeholder ? '' : MM.avatar(c.avatarUrl, c.label)}<span class="lbl">${MM.esc(c.placeholder ? 'Window ' + (i + 1) : c.label)}</span></div>`).join('')}`;
        const live = pv.windows.length;
        MM.$('#tile-status', root).innerHTML = live ? `${live} Roblox window${live > 1 ? 's' : ''}${pv.autoTile ? ' · <span style="color:var(--ok)">auto-tile on</span>' : ''}` : 'Preview — no Roblox windows open';
        MM.$('#tile-restore', root).disabled = !pv.savedCount;
        MM.$('#tile-windows', root).innerHTML = live ? pv.windows.map((w, i) => `<div class="item" data-id="${MM.esc(w.id)}"><span class="badge">${i + 1}</span><div class="grow"><div class="title">${MM.esc(w.label)}</div><div class="meta">PID ${w.pid}${w.external ? ' · opened outside MultiMenu' : ''}${w.topmost ? ' · always on top' : ''}${w.tiny ? ' · tiny' : ''}</div></div>
          <button class="btn sm icon" data-act="moveUp" title="Move earlier" ${i === 0 ? 'disabled' : ''}>${MM.icon('chevrons-left', 14).replace('<svg', '<svg style="transform:rotate(90deg)"')}</button>
          <button class="btn sm icon" data-act="focus" title="Bring to front">${MM.icon('eye', 14)}</button>
          <button class="btn sm icon" data-act="minimize" title="Minimise">${MM.icon('minus', 14)}</button>
          <button class="btn sm icon ${w.topmost ? 'on' : ''}" data-act="pin" title="Always on top">${MM.icon('layers', 14)}</button>
          <button class="btn sm icon ${w.tiny ? 'on' : ''}" data-act="tinyThis" title="${w.tiny ? 'Back to normal size' : 'Make it tiny'}">${MM.icon(w.tiny ? 'maximize-2' : 'minimize-2', 14)}</button>
          <button class="btn sm icon ${pv.focus?.on && pv.focus.sessionId === w.id ? 'on' : ''}" data-act="focusThis" title="Make this the big window (focus mode)">${MM.icon('focus', 14)}</button>
          <button class="btn sm icon" data-act="pipThis" title="Picture-in-picture">${MM.icon('picture-in-picture-2', 14)}</button></div>`).join('')
          : `<div class="small muted">Launch accounts and their windows appear here. The preview shows how ${pv.cells.length} windows would be arranged.</div>`;
      };

      const loadPreview = async () => {
        const [r, cl] = await Promise.all([MM.call('tiler:preview', { sampleCount: 4 }), MM.call('customlayouts:list')]);
        if (!r) return;
        customLayouts = cl || [];
        pv = r;
        if (pv.windows.length) pv.cells = pv.cells.filter(c => !c.placeholder);
        renderControls(); renderMonitor();
      };

      const tileNow = async (b) => {
        const r = await MM.busy(b, () => MM.call('tiler:tile'));
        if (r) MM.toast('success', 'Windows tiled', `${r.placed} of ${r.total} Roblox window${r.total > 1 ? 's' : ''} arranged${r.missing.length ? ` — still loading: ${r.missing.join(', ')}` : ''}.`);
        loadPreview();
      };

      MM.$('#tile-layouts', root).addEventListener('click', async (e) => {
        const b = e.target.closest('[data-layout]');
        if (!b) return;
        await MM.setSetting('tiling.layout', b.dataset.layout);
        loadPreview();
      });
      MM.$('#tile-display', root).addEventListener('change', async (e) => { await MM.setSetting('tiling.display', e.target.value); loadPreview(); });
      const range = (id, key, fmt, conv = Number) => {
        const el = MM.$(id, root);
        el.addEventListener('input', () => { MM.$(`${id}-v`, root).textContent = fmt(el.value); });
        el.addEventListener('change', async () => { await MM.setSetting(key, conv(el.value)); loadPreview(); });
      };
      range('#tile-gap', 'tiling.gap', v => `${v}px`);
      range('#tile-pad', 'tiling.padding', v => `${v}px`);
      range('#tile-main', 'tiling.mainRatio', v => `${v}%`, v => Number(v) / 100);
      range('#fx-ratio', 'focus.ratio', v => `${v}%`, v => Number(v) / 100);
      MM.$('#fx-side', root).addEventListener('change', async (e) => { await MM.setSetting('focus.stripSide', e.target.value); loadPreview(); });
      MM.$('#tile-monitor', root).addEventListener('click', async (e) => {
        const c = e.target.closest('[data-cell]');
        if (!c || !c.dataset.cell) return;
        const id = c.dataset.cell;
        if (!selCell) { selCell = id; renderMonitor(); return; }
        if (selCell === id) { selCell = null; renderMonitor(); return; }
        const r = await MM.call('tiler:swap', selCell, id);
        selCell = null;
        if (r) { pv = r; pv.cells = pv.cells.filter(x => !x.placeholder); renderMonitor(); MM.toast('info', 'Order swapped', 'Press Tile windows now to apply it.'); }
      });
      const onSetting = (e) => { if (e.detail.key.startsWith('tiling.') || e.detail.key.startsWith('perf.tiny')) loadPreview(); };
      document.addEventListener('mm:setting', onSetting);

      // ---------- sessions list ----------
      const renderList = () => {
        const live = sessions.filter(s => ['launching', 'running', 'closing'].includes(s.status));
        const ended = sessions.filter(s => !['launching', 'running', 'closing'].includes(s.status));
        const pinned = new Set((pv?.windows || []).filter(w => w.topmost).map(w => w.id));
        MM.$('#om-tabs', root).innerHTML = `<button class="tab ${tab === 'live' ? 'on' : ''}" data-act="tab" data-tab="live">${MM.icon('circle-dot', 14)}Active<span class="count">${live.length}</span></button>
          <button class="tab ${tab === 'ended' ? 'on' : ''}" data-act="tab" data-tab="ended">${MM.icon('history', 14)}Ended<span class="count">${ended.length}</span></button>`;
        const rows = tab === 'live' ? live : ended;
        MM.$('#om-list', root).innerHTML = rows.length ? `<table class="tbl"><thead><tr><th>Session</th><th>Game</th><th>Status</th><th>PID</th><th>RAM</th><th>CPU</th><th>Ping</th><th>Uptime</th><th></th></tr></thead><tbody>
          ${rows.map(s => { const [c, l] = ST[s.status] || ['dim', s.status]; const run = s.status === 'running'; return `<tr data-id="${MM.esc(s.id)}">
            <td><div class="row nowrap" ${s.color && MM.ACCOUNT_COLORS ? `style="box-shadow:inset 3px 0 0 ${MM.ACCOUNT_COLORS[s.color]};padding-left:8px"` : ''}>${MM.avatar(s.avatarUrl, s.label, 'sm')}<div><b>${MM.esc(s.label)}</b>${pinned.has(s.id) ? ` <span class="badge" title="Always on top">${MM.icon('tag', 11)}Pinned</span>` : ''}<div class="small muted">${s.username ? '@' + MM.esc(s.username) : 'Not started by MultiMenu'}</div></div></div></td>
            <td>${MM.esc(s.placeName || s.placeId || '—')}</td>
            <td><span class="badge ${c}">${MM.esc(l)}</span>${s.watch && run ? ` <span class="badge ${s.watchState === 'not responding' ? 'err' : 'ok'}" title="24/7 Watcher">${MM.icon('radar', 11)}${MM.esc(s.watchState || 'watched')}</span>` : ''}${s.error ? `<div class="small" style="color:var(--err);max-width:260px">${MM.esc(s.error)}</div>` : ''}</td>
            <td class="mono">${s.pid || '—'}</td><td>${s.memMB ? MM.fmt.mb(s.memMB) : '—'}</td><td>${run ? `${s.cpu}%` : '—'}</td><td>${run ? MM.pingCell(s.ping) : '—'}</td>
            <td>${run ? MM.fmt.dur(Date.now() - s.startedAt) : '—'}</td>
            <td><div class="row nowrap" style="justify-content:flex-end">
              ${!s.external && ['running', 'launching'].includes(s.status) ? `<button class="btn sm icon ${s.watch ? 'on' : ''}" data-act="watch" title="${s.watch ? '24/7 Watcher: on' : '24/7 Watcher: off'}">${MM.icon('radar', 14)}</button>` : ''}
              ${s.hasLog ? `<button class="btn sm icon" data-act="log" title="Roblox log">${MM.icon('scroll-text', 14)}</button>` : ''}
              ${run ? `<button class="btn sm icon" data-act="focus" title="Bring to front">${MM.icon('eye', 14)}</button>
                <button class="btn sm icon" data-act="minimize" title="Minimise">${MM.icon('minus', 14)}</button>
                <button class="btn sm icon ${pinned.has(s.id) ? 'on' : ''}" data-act="pin" title="Always on top">${MM.icon('layers', 14)}</button>` : ''}
              ${!s.external && ['running', 'launching'].includes(s.status) ? `<button class="btn sm icon" data-act="label" title="Rename label">${MM.icon('tag', 14)}</button>` : ''}
              ${run ? `<button class="btn sm danger" data-act="close">${MM.icon('x', 14)}Close</button>` : ''}
              ${s.accountId && !['running', 'launching', 'closing'].includes(s.status) ? `<button class="btn sm" data-act="again" title="Launch this account into the same game again">${MM.icon('play', 14)}Play again</button>` : ''}
              ${!['running', 'launching', 'closing'].includes(s.status) ? `<button class="btn sm ghost" data-act="dismiss">Dismiss</button>` : ''}
            </div></td></tr>`; }).join('')}</tbody></table>`
          : MM.empty(tab === 'live' ? 'monitor-play' : 'history', tab === 'live' ? 'No active sessions' : 'Nothing here yet', tab === 'live' ? 'Pick accounts above and press Launch.' : 'Closed, crashed and failed sessions show up here for 10 minutes.');
      };

      const loadAccounts = async () => { const r = await MM.call('accounts:list'); if (r) { accounts = r.accounts; renderAccounts(); } };
      let lastLiveIds = '';
      const onSessions = (l) => {
        sessions = l || [];
        renderList();
        const ids = sessions.filter(s => s.status === 'running').map(s => s.id).join(',');
        if (ids !== lastLiveIds) { lastLiveIds = ids; loadPreview(); }
      };

      root.addEventListener('change', (e) => {
        const id = e.target.dataset.pick;
        if (!id) return;
        if (e.target.checked) picked.add(id); else picked.delete(id);
        renderAccounts();
      });

      const sid = (b) => b.closest('[data-id]').dataset.id;
      MM.delegate(root, {
        shareLayout: () => MM.shareCode('layout', 'current'),
        drawLayout: async () => { if (await MM.openLayoutEditor(null)) loadPreview(); },
        editLayout: async () => { const cur = customLayouts.find(l => `custom:${l.id}` === t().layout); if (cur && await MM.openLayoutEditor(cur)) loadPreview(); },
        delLayout: async () => {
          const cur = customLayouts.find(l => `custom:${l.id}` === t().layout);
          if (cur && await MM.confirm(MM.t('Delete "{0}"?').replace('{0}', cur.name), 'Windows go back to the smart grid.', { danger: true, ok: 'Delete' })) { await MM.call('customlayouts:remove', cur.id); await MM.reloadSettings?.(); loadPreview(); }
        },
        importCode: () => MM.importCode(),
        again: async (el) => {
          const s = sessions.find(x => x.id === el.closest('[data-id]').dataset.id);
          if (!s) return;
          await MM.call('sessions:launch', s.accountId, s.placeId || null);
          MM.toast('info', `Launching ${s.label}`);
        },
        omOn: async (b) => { await MM.busy(b, () => MM.call('sessions:enableOpenMulti')); renderOM(); },
        omOff: async (b) => { await MM.busy(b, () => MM.call('sessions:disableOpenMulti')); renderOM(); },
        pickAll: () => { accounts.filter(a => a.status !== 'expired').forEach(a => picked.add(a.id)); renderAccounts(); },
        launch: async (b) => {
          const target = MM.$('#om-target', root).value.trim() || null;
          await MM.busy(b, () => MM.call('sessions:launchMany', [...picked], target));
          MM.toast('info', `Launching ${picked.size} account${picked.size > 1 ? 's' : ''}`, picked.size > 1 ? `One every ${MM.getSetting('accounts.launchDelaySec')}s after each client starts.${t().autoTile ? ' Windows tile automatically.' : ''}` : '');
          picked.clear(); renderAccounts();
        },
        tile: tileNow,
        restore: async (b) => { const r = await MM.busy(b, () => MM.call('tiler:restore')); if (r) MM.toast('success', 'Positions restored', `${r.restored} window${r.restored === 1 ? '' : 's'} moved back.`); loadPreview(); },
        showAll: async (b) => { const r = await MM.busy(b, () => MM.call('tiler:showAll')); if (r) MM.toast('info', 'Windows shown', `${r.count} Roblox window${r.count === 1 ? '' : 's'}.`); },
        minAll: async (b) => { const r = await MM.busy(b, () => MM.call('tiler:minimizeAll')); if (r) MM.toast('info', 'Minimised', `${r.count} Roblox window${r.count === 1 ? '' : 's'}.`); },
        moveUp: async (b) => {
          const ids = pv.windows.map(w => w.id), i = ids.indexOf(sid(b));
          if (i > 0) { [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; const r = await MM.call('tiler:order', ids); if (r) { pv = r; pv.cells = pv.cells.filter(c => !c.placeholder); renderMonitor(); } }
        },
        watch: async (b) => { const s = sessions.find(x => x.id === sid(b)); await MM.call('sessions:setWatch', s.id, !s.watch); MM.toast('info', !s.watch ? `Watching ${s.label}` : `Stopped watching ${s.label}`, !s.watch && !MM.getSetting('watcher.enabled') ? 'Turn the 24/7 Watcher on for auto-rejoin.' : ''); },
        log: (b) => { const s = sessions.find(x => x.id === sid(b)); MM.showSessionLog(s.id, s.label); },
        focus: (b) => MM.call('tiler:focus', sid(b)),
        focusToggle: async (b) => { const r = await MM.busy(b, () => MM.call('tiler:focusMode', !pv?.focus?.on)); if (r) MM.toast('info', r.on ? 'Focus mode on' : 'Focus mode off', r.on ? `${r.label || ''}` : ''); },
        focusNext: (b) => MM.busy(b, () => MM.call('tiler:focusNext', 1)),
        focusThis: (b) => MM.call('tiler:focusMode', true, sid(b)),
        pipOpen: async (b) => { const r = await MM.busy(b, () => MM.call('pip:open')); if (r) renderPip({ open: true, label: r.label }); },
        pipThis: async (b) => { const r = await MM.call('pip:open', sid(b)); if (r) renderPip({ open: true, label: r.label }); },
        pipClose: () => MM.call('pip:close'),
        layForget: async (b) => { await MM.call('layouts:forget', b.dataset.sig); renderLayouts(); },
        minimize: (b) => MM.call('tiler:minimize', sid(b)),
        tinyThis: async (b) => { const w = pv?.windows.find(x => x.id === sid(b)); const r = await MM.busy(b, () => MM.call('tiler:tiny', sid(b), !w?.tiny)); if (r) MM.toast('info', r.tiny ? 'Window made tiny' : 'Window back to normal size'); },
        pin: async (b) => { const r = await MM.call('tiler:topmost', sid(b)); if (r) { MM.toast('info', r.topmost ? 'Pinned on top' : 'Unpinned'); await loadPreview(); renderList(); } },
        tab: (b) => { tab = b.dataset.tab; renderList(); },
        close: (b) => MM.call('sessions:close', sid(b)),
        dismiss: (b) => MM.call('sessions:dismiss', sid(b)),
        label: async (b) => {
          const id = sid(b);
          const s = sessions.find(x => x.id === id);
          const n = await MM.prompt('Session label', 'Shown in MultiMenu, on the tile and on the Roblox window title', s.label);
          if (n) { await MM.call('sessions:relabel', id, n); loadPreview(); }
        },
        closeAll: async () => { if (await MM.confirm('Close every Roblox session?', 'All Roblox clients started by MultiMenu are asked to close.', { danger: true, ok: 'Close all' })) MM.call('sessions:closeAll'); },
      });

      renderOM(); loadAccounts(); loadPreview().then(renderLayouts);
      MM.bindSettings(MM.$('.tile-extras', root));
      MM.api('pip:status').then(renderPip).catch(() => {});
      MM.call('sessions:list').then(onSessions);
      const onResize = () => renderMonitor();
      addEventListener('resize', onResize);
      const offs = [MM.on('sessions:changed', onSessions), MM.on('sessions:stats', l => { sessions = l || []; renderList(); }), MM.on('accounts:changed', loadAccounts),
        MM.on('tiler:update', r => { pv = r; if (pv.windows.length) pv.cells = pv.cells.filter(c => !c.placeholder); renderControls(); renderMonitor(); renderLayouts(); }),
        MM.on('pip:update', renderPip)];
      return () => { offs.forEach(f => f()); removeEventListener('resize', onResize); document.removeEventListener('mm:setting', onSetting); };
    },
  };
})();
