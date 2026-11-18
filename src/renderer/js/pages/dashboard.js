(function () {
  const MM = window.MM;

  function statTile(id, icon, label) {
    return `<div class="card stat hover" id="st-${id}"><div class="label">${MM.icon(icon, 15)}${label}</div><div class="value">—</div><div class="meter"><i style="width:0%"></i></div><div class="small muted sub-line">&nbsp;</div></div>`;
  }

  // Dashboard widgets: id -> [title, default size]. The layout is saved as "id:size" in dashboard.widgets.
  const WIDGETS = {
    pc: { title: 'PC at a glance', size: 3 }, usage: { title: 'System usage', size: 2 }, quick: { title: 'Quick actions', size: 1 },
    insights: { title: 'Insights', size: 2 }, presets: { title: 'Presets', size: 1 }, sessions: { title: 'Running sessions', size: 1 },
    accounts: { title: 'Accounts', size: 1 }, health: { title: 'Alt health', size: 1 }, watcher: { title: '24/7 Watcher', size: 1 },
    notes: { title: 'Latest notifications', size: 2 }, trim: { title: 'RAM Trimmer', size: 1 }, macros: { title: 'Recent macros', size: 1 },
    achievements: { title: 'Achievements', size: 1 },
  };
  const DEFAULT = ['pc:3', 'usage:2', 'quick:1', 'insights:2', 'presets:1', 'sessions:1', 'accounts:1', 'health:1', 'notes:2', 'trim:1'];
  MM.DASH_WIDGETS = WIDGETS;

  MM.pages.dashboard = {
    render(root, params = {}) {
      const info = MM.state.info;
      const saved = (MM.getSetting('dashboard.widgets') || []).map(x => String(x).split(':')).filter(([id]) => WIDGETS[id]);
      let layout = (saved.length ? saved : DEFAULT.map(x => x.split(':'))).map(([id, n]) => ({ id, size: Math.min(3, Math.max(1, Number(n) || WIDGETS[id].size)) }));
      const editing = !!params.edit;
      const has = (id) => layout.some(w => w.id === id);
      const HTML = {
        pc: () => `<div class="dash-pc">${statTile('cpu', 'cpu', 'CPU')}${statTile('ram', 'memory-stick', 'RAM')}${statTile('gpu', 'monitor', 'GPU')}${statTile('rbx', 'gamepad-2', 'Roblox')}</div>`,
        usage: () => `
          <div class="card">
              <h3>${MM.icon('activity')}System usage<span class="right legend"><span><i style="background:${MM.accent()}"></i>CPU</span><span><i style="background:#e9d5ff"></i>RAM</span><span><i style="background:#f0abfc"></i>GPU</span></span></h3>
              <canvas class="chart" id="dash-chart"></canvas>
            </div>
        `,
        quick: () => `
          <div class="card">
              <h3>${MM.icon('zap')}Quick actions</h3>
              <div class="qa">
                <button class="btn" data-act="go" data-page="accounts">${MM.icon('log-in')}Add account</button>
                <button class="btn" data-act="go" data-page="sessions">${MM.icon('rocket')}Launch</button>
                <button class="btn" data-act="trim">${MM.icon('memory-stick')}Trim RAM now</button>
                <button class="btn" data-act="go" data-page="automation">${MM.icon('mouse-pointer-click')}Auto clicker</button>
                <button class="btn" data-act="go" data-page="performance">${MM.icon('gauge')}FPS Centre</button>
                <button class="btn" data-act="update">${MM.icon('refresh-cw')}Check updates</button>
              </div>
            </div>
        `,
        sessions: () => `
          <div class="card">
              <h3>${MM.icon('monitor-play')}Running sessions<span class="right"><button class="btn sm ghost" data-act="go" data-page="sessions">Manage</button></span></h3>
              <div class="list" id="dash-sessions"></div>
            </div>
        `,
        accounts: () => `
          <div class="card">
              <h3>${MM.icon('users')}Accounts<span class="right"><button class="btn sm ghost" data-act="go" data-page="accounts">Open</button></span></h3>
              <div id="dash-accounts"></div>
            </div>
        `,
        macros: () => `
          <div class="card">
              <h3>${MM.icon('bot')}Recent macros<span class="right"><button class="btn sm ghost" data-act="go" data-page="automation" data-tab="macros">Library</button></span></h3>
              <div class="list" id="dash-macros"></div>
            </div>
        `,
        notes: () => `
          <div class="card">
              <h3>${MM.icon('bell')}Latest notifications</h3>
              <div class="list" id="dash-notes"></div>
            </div>
        `,
        trim: () => `
          <div class="card">
              <h3>${MM.icon('memory-stick')}RAM Trimmer</h3>
              <div id="dash-trim"></div>
            </div>
        `,
        insights: () => `<div class="card"><h3>${MM.icon('lightbulb')}Insights<span class="right"><button class="btn sm ghost" data-act="go" data-page="stats">Stats</button></span></h3><div class="list" id="dash-insights"></div></div>`,
        presets: () => `<div class="card"><h3>${MM.icon('bookmark')}Presets<span class="right"><button class="btn sm ghost" data-act="go" data-page="presets">All</button></span></h3><div class="list" id="dash-presets"></div></div>`,
        health: () => `<div class="card"><h3>${MM.icon('heart-pulse')}Alt health<span class="right"><button class="btn sm ghost" data-act="go" data-page="accounts">Accounts</button></span></h3><div class="list" id="dash-health"></div></div>`,
        achievements: () => `<div class="card"><h3>${MM.icon('trophy')}Achievements<span class="right"><button class="btn sm ghost" data-act="go" data-page="achievements">All</button></span></h3><div id="dash-ach"></div></div>`,
        watcher: () => `<div class="card"><h3>${MM.icon('radar')}24/7 Watcher<span class="right"><button class="btn sm ghost" data-act="go" data-page="watcher">Open</button></span></h3><div id="dash-watch"></div></div>`,
      };
      const editBar = (w, i) => `<div class="w-edit" role="group" aria-label="${MM.esc(MM.t(WIDGETS[w.id].title))}">
        <span class="w-grip" title="Drag to move">${MM.icon('grip-vertical', 15)}</span>
        <button class="btn sm icon" data-act="wMove" data-d="-1" title="Move earlier" ${i === 0 ? 'disabled' : ''}>${MM.icon('chevrons-left', 14)}</button>
        <button class="btn sm icon" data-act="wMove" data-d="1" title="Move later" ${i === layout.length - 1 ? 'disabled' : ''}>${MM.icon('chevrons-right', 14)}</button>
        <span class="seg w-size">${[1, 2, 3].map(n => `<button data-act="wSize" data-n="${n}" class="${w.size === n ? 'on' : ''}" title="${MM.esc(MM.t(['Small', 'Medium', 'Wide'][n - 1]))}">${['S', 'M', 'L'][n - 1]}</button>`).join('')}</span>
        <button class="btn sm icon danger" data-act="wRemove" title="Remove">${MM.icon('x', 14)}</button></div>`;
      root.innerHTML = `
        <div class="card hero">
          <div class="logo-mark">M</div>
          <div><h2>Welcome to <span>MultiMenu</span></h2><p>Accounts, multi-instance, performance and automation — all in one place.</p></div>
          <div class="meta">v${MM.esc(info.version)} · ${info.portable ? 'Portable' : 'Installed'}<br><span id="dash-clock"></span>
            ${editing ? '' : `<br><button class="btn sm ghost" data-act="customise" style="margin-top:8px">${MM.icon('layout-dashboard', 14)}Customise</button>`}</div>
        </div>
        ${editing ? `<div class="callout dash-editbar">${MM.icon('layout-dashboard')}<div class="grow">${MM.esc(MM.t('Drag widgets to move them, pick a size, or remove ones you don\'t need.'))}</div>
          <button class="btn sm" data-act="wAdd" ${layout.length >= Object.keys(WIDGETS).length ? 'disabled' : ''}>${MM.icon('plus', 14)}Add widget</button><button class="btn sm ghost" data-act="wReset">${MM.icon('undo-2', 14)}Reset</button><button class="btn sm primary" data-act="wDone">${MM.icon('check', 14)}Done</button></div>` : ''}
        <div class="dash-grid ${editing ? 'editing' : ''}" id="dash-grid">
          ${layout.map((w, i) => `<section class="dash-w s${w.size}" data-w="${w.id}" aria-label="${MM.esc(MM.t(WIDGETS[w.id].title))}" ${editing ? 'draggable="true"' : ''}>${editing ? editBar(w, i) : ''}${HTML[w.id]()}</section>`).join('')}
          ${layout.length ? '' : `<div class="card" style="grid-column:1/-1">${MM.empty('layout-dashboard', 'Your dashboard is empty', 'Press Customise, then Add widget.')}</div>`}
        </div>`;

      // ---------- customising ----------
      const save = async (list) => { await MM.setSetting('dashboard.widgets', list.map(w => `${w.id}:${w.size}`)); MM.go('dashboard', { edit: true }); };
      const idx = (el) => layout.findIndex(w => w.id === el.closest('[data-w]').dataset.w);
      const grid = MM.$('#dash-grid', root);
      if (editing) {
        let dragId = null;
        grid.addEventListener('dragstart', (e) => { const w = e.target.closest('[data-w]'); if (!w) return; dragId = w.dataset.w; w.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
        grid.addEventListener('dragend', () => { dragId = null; MM.$$('.dash-w', grid).forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after')); });
        grid.addEventListener('dragover', (e) => {
          const w = e.target.closest('[data-w]'); if (!w || !dragId || w.dataset.w === dragId) return;
          e.preventDefault();
          const r = w.getBoundingClientRect(), after = (e.clientX - r.left) / r.width > 0.5;
          MM.$$('.dash-w', grid).forEach(x => x.classList.remove('drop-before', 'drop-after'));
          w.classList.add(after ? 'drop-after' : 'drop-before');
        });
        grid.addEventListener('drop', (e) => {
          const w = e.target.closest('[data-w]'); if (!w || !dragId) return;
          e.preventDefault();
          const after = w.classList.contains('drop-after');
          const moving = layout.find(x => x.id === dragId);
          const rest = layout.filter(x => x.id !== dragId);
          const at = rest.findIndex(x => x.id === w.dataset.w) + (after ? 1 : 0);
          rest.splice(at, 0, moving);
          save(rest);
        });
      }

      const chartEl = MM.$('#dash-chart', root);
      let hist = [];
      const draw = () => chartEl && MM.chart(chartEl, [
        { data: hist.map(h => h.cpu), color: MM.accent(), fill: MM.accent(0.25), capacity: 150 },
        { data: hist.map(h => h.ram), color: '#e9d5ff', capacity: 150 },
        { data: hist.map(h => h.gpu), color: '#f0abfc', capacity: 150 },
      ], { labels: true });

      const setTile = (id, value, unit, pct, sub) => {
        const t = MM.$(`#st-${id}`, root);
        if (!t) return;
        t.querySelector('.value').innerHTML = value == null ? '<span class="muted">—</span>' : `${MM.esc(value)}<small>${MM.esc(unit)}</small>`;
        const m = t.querySelector('.meter');
        m.className = `meter ${MM.meterCls(pct || 0)}`;
        m.firstChild.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
        t.querySelector('.sub-line').textContent = sub;
      };

      const onSample = (s) => {
        if (!s) return;
        setTile('cpu', Math.round(s.cpu), '%', s.cpu, `MultiMenu itself: ${s.appMemMB} MB`);
        setTile('ram', Math.round(s.ramPercent), '%', s.ramPercent, `${MM.fmt.bytes(s.ramUsed)} of ${MM.fmt.bytes(s.ramTotal)}`);
        const gpuSub = { ok: '3D engine utilisation', off: 'Disabled in settings', starting: 'Starting monitor…', unavailable: 'Not available on this PC', unsupported: 'Windows only' }[s.gpuStatus] || '';
        setTile('gpu', s.gpu == null ? null : Math.round(s.gpu), '%', s.gpu || 0, gpuSub);
        setTile('rbx', s.roblox.count, s.roblox.count === 1 ? ' client' : ' clients', Math.min(100, s.roblox.memMB / 40), `${MM.fmt.mb(s.roblox.memMB)} RAM · ${Math.round(s.roblox.cpu)}% CPU`);
        hist.push({ cpu: s.cpu, ram: s.ramPercent, gpu: s.gpu });
        if (hist.length > 150) hist.shift();
        draw();
      };

      const renderSessions = (list) => {
        const el = MM.$('#dash-sessions', root);
        if (!el) return;
        const live = (list || []).filter(s => ['running', 'launching', 'closing'].includes(s.status));
        el.innerHTML = live.length ? live.slice(0, 5).map(s => `<div class="item">${MM.avatar(s.avatarUrl, s.label, 'sm')}<div class="grow"><div class="title">${MM.esc(s.label)}</div><div class="meta">${MM.esc(s.placeName || s.placeId || (s.external ? 'Opened outside MultiMenu' : ''))}</div></div><span class="dot ${s.status === 'running' ? 'live' : 'warn'}"></span></div>`).join('')
          : MM.empty('monitor-play', 'No sessions running', 'Launch accounts from OpenMulti.');
      };

      const renderAccounts = async () => {
        if (!MM.$('#dash-accounts', root)) return;
        const r = await MM.call('accounts:list');
        if (!r) return;
        const a = r.accounts;
        const valid = a.filter(x => x.status === 'valid').length, exp = a.filter(x => x.status === 'expired').length;
        MM.$('#dash-accounts', root).innerHTML = a.length ? `
          <div class="row" style="gap:18px;margin-bottom:12px"><div class="stat"><div class="value">${a.length}</div><div class="small muted">saved</div></div>
          <div class="stat"><div class="value" style="color:var(--ok)">${valid}</div><div class="small muted">valid</div></div>
          <div class="stat"><div class="value" style="color:${exp ? 'var(--err)' : 'var(--dim)'}">${exp}</div><div class="small muted">need login</div></div></div>
          <div class="list">${a.filter(x => x.favourite).concat(a.filter(x => !x.favourite)).slice(0, 3).map(x => `<div class="item">${MM.avatar(x.avatarUrl, x.username, 'sm')}<div class="grow"><div class="title">${MM.esc(x.alias || x.displayName || x.username)}</div><div class="meta">@${MM.esc(x.username)} · ${MM.esc(x.group)}</div></div>${x.favourite ? `<span style="color:#fcd34d">${MM.icon('star', 14)}</span>` : ''}</div>`).join('')}</div>`
          : MM.empty('users', 'No accounts yet', 'Add one with the official Roblox login.');
      };

      const renderMacros = async () => {
        if (!MM.$('#dash-macros', root)) return;
        const list = await MM.call('macros:list') || [];
        MM.$('#dash-macros', root).innerHTML = list.length ? list.slice(0, 4).map(m => `<div class="item">${MM.icon('bot')}<div class="grow"><div class="title">${MM.esc(m.name)}</div><div class="meta">${MM.fmt.dur(m.durationMs)} · used ${MM.fmt.ago(m.lastUsedAt)}</div></div><button class="btn sm icon" data-act="play" data-id="${MM.esc(m.id)}" title="Play">${MM.icon('play', 14)}</button></div>`).join('')
          : MM.empty('bot', 'No macros yet', 'Record one in Automation.');
      };

      const renderNotes = async () => {
        if (!MM.$('#dash-notes', root)) return;
        const list = await MM.call('notifications:list') || [];
        MM.$('#dash-notes', root).innerHTML = list.length ? list.slice(0, 5).map(n => `<div class="item"><span class="dot ${n.level === 'error' ? 'err' : n.level === 'warn' ? 'warn' : n.level === 'success' ? 'ok' : ''}"></span><div class="grow"><div class="title">${MM.esc(n.title)}</div><div class="meta">${MM.esc(n.message)}</div></div><span class="small dim">${MM.fmt.ago(n.at)}</span></div>`).join('')
          : MM.empty('bell', 'Nothing yet', 'Launches, alerts and updates will appear here.');
      };

      const renderTrim = (s) => {
        if (!s || !MM.$('#dash-trim', root)) return;
        MM.$('#dash-trim', root).innerHTML = `<div class="row"><span class="dot ${s.running ? 'live' : ''}"></span><b>${s.running ? 'Running' : 'Stopped'}</b><span class="spacer"></span><span class="badge">${s.runs} runs</span></div>
          <div class="row" style="margin-top:12px;gap:24px"><div class="stat"><div class="value">${MM.fmt.mb(s.totalFreedMB)}</div><div class="small muted">freed total</div></div><div class="stat"><div class="value">${MM.fmt.mb(s.lastFreedMB)}</div><div class="small muted">last run</div></div></div>
          <div class="small muted" style="margin-top:8px">Last run: ${MM.fmt.ago(s.lastRun)}</div>`;
      };

      // ---------- 2.0 widgets ----------
      const renderPresets = async () => {
        const el = MM.$('#dash-presets', root); if (!el) return;
        const list = await MM.call('presets:list') || [];
        if (!el.isConnected) return;
        el.innerHTML = list.length ? list.slice(0, 4).map(p => `<div class="item" data-id="${MM.esc(p.id)}">${MM.icon('bookmark', 16)}<div class="grow"><div class="title" data-nt>${MM.esc(p.name)}</div><div class="meta">${p.lastRunAt ? `${MM.esc(MM.t('last run'))} ${MM.fmt.ago(p.lastRunAt)}` : MM.esc(MM.t('not run yet'))}</div></div><button class="btn sm primary" data-act="runPreset" title="Start">${MM.icon('play', 13)}</button></div>`).join('')
          : MM.empty('bookmark', 'No presets yet', 'Save a setup in Presets & Schedule.');
      };
      const renderHealth = async () => {
        const el = MM.$('#dash-health', root); if (!el) return;
        const [scores, accs] = await Promise.all([MM.call('health:scores'), MM.call('accounts:list')]);
        if (!el.isConnected) return;
        const rows = (accs?.accounts || []).filter(a => scores?.[a.id]).map(a => ({ a, h: scores[a.id] })).sort((x, y) => x.h.score - y.h.score).slice(0, 4);
        el.innerHTML = rows.length ? rows.map(({ a, h }) => `<div class="item">${MM.healthRing(h, 30)}<div class="grow"><div class="title" data-nt>${MM.esc(a.alias || a.displayName || a.username)}</div><div class="meta">${MM.esc(h.reasons?.[0]?.text || MM.t('All good'))}</div></div></div>`).join('')
          : MM.empty('heart-pulse', 'No health scores yet', 'Scores appear once your alts have run for a while.');
      };
      const renderAch = async () => {
        const el = MM.$('#dash-ach', root); if (!el) return;
        const st = await MM.call('achievements:status');
        if (!st || !el.isConnected) return;
        const next = st.list.filter(a => !a.done).sort((x, y) => (y.current / y.goal) - (x.current / x.goal)).slice(0, 3);
        el.innerHTML = `<div class="row" style="gap:10px"><b style="font:700 24px var(--display)">${st.unlocked}</b><span class="muted">${MM.esc(MM.t('of {0} unlocked').replace('{0}', st.total))}</span></div>
          <div class="meter" style="margin:8px 0 12px"><i style="width:${Math.round(st.unlocked / Math.max(1, st.total) * 100)}%"></i></div>
          <div class="list">${next.map(a => `<div class="item">${MM.icon(a.icon, 16)}<div class="grow"><div class="title">${MM.esc(a.title)}</div><div class="meta">${Math.min(a.current, a.goal)} / ${a.goal}</div></div></div>`).join('')}</div>`;
      };
      const renderWatch = async () => {
        const el = MM.$('#dash-watch', root); if (!el) return;
        const w = await MM.call('watcher:status');
        if (!w || !el.isConnected) return;
        el.innerHTML = `<div class="row"><span class="dot ${w.enabled ? 'live' : ''}"></span><b>${MM.esc(MM.t(w.enabled ? 'On' : 'Off'))}</b><span class="spacer"></span><label class="toggle"><input type="checkbox" data-watch-toggle ${w.enabled ? 'checked' : ''} aria-label="${MM.esc(MM.t('24/7 Watcher'))}"><span class="sw"></span></label></div>
          <div class="row" style="margin-top:12px;gap:24px"><div class="stat"><div class="value">${w.watched ?? 0}</div><div class="small muted">${MM.esc(MM.t('watched'))}</div></div><div class="stat"><div class="value">${(w.pending || []).length}</div><div class="small muted">${MM.esc(MM.t('rejoins queued'))}</div></div></div>`;
      };
      root.addEventListener('change', async (e) => { if (e.target.matches('[data-watch-toggle]')) { await MM.call('watcher:enable', e.target.checked); renderWatch(); } });
      if (has('insights')) MM.renderInsights(MM.$('#dash-insights', root), { limit: 3 });

      MM.delegate(root, {
        go: (el) => MM.go(el.dataset.page, { tab: el.dataset.tab }),
        runPreset: async (el) => { const r = await MM.busy(el, () => MM.call('presets:run', el.closest('[data-id]').dataset.id)); if (r) renderPresets(); },
        customise: () => MM.go('dashboard', { edit: true }),
        wDone: () => MM.go('dashboard'),
        wReset: () => { MM.setSetting('dashboard.widgets', []).then(() => MM.go('dashboard', { edit: true })); },
        wRemove: (el) => save(layout.filter((_, i) => i !== idx(el))),
        wSize: (el) => { layout[idx(el)].size = Number(el.dataset.n); save(layout); },
        wMove: (el) => { const i = idx(el), j = i + Number(el.dataset.d); if (j < 0 || j >= layout.length) return; [layout[i], layout[j]] = [layout[j], layout[i]]; save(layout); },
        wAdd: (el) => MM.menu(el, Object.entries(WIDGETS).filter(([id]) => !has(id)).map(([id, w]) => ({ label: MM.t(w.title), icon: 'plus', run: () => save([...layout, { id, size: w.size }]) }))),
        trim: async (el) => { const s = await MM.busy(el, () => MM.call('trimmer:trimNow')); if (s) { renderTrim(s); MM.toast('success', 'RAM trimmed', `Freed ${MM.fmt.mb(s.lastFreedMB)} from ${s.lastResults.length} processes.`); } },
        update: async (el) => { const s = await MM.busy(el, () => MM.call('updates:check')); if (!s) return; if (s.status === 'available') MM.showUpdatePopup(s); else MM.toast(s.status === 'error' || s.status === 'unconfigured' ? 'warn' : 'success', 'Updates', s.message); },
        play: async (el) => { if (await MM.call('macros:play', el.dataset.id)) MM.toast('info', 'Macro playing', `Press ${MM.getSetting('hotkeys.emergencyStop')} to stop.`); },
      });

      const clock = () => { const c = MM.$('#dash-clock', root); if (c) c.textContent = new Date().toLocaleString(MM.loc(), { weekday: 'long', hour: '2-digit', minute: '2-digit' }); };
      clock();
      const clockTimer = setInterval(clock, 30000);

      MM.call('system:history').then(h => { hist = (h || []).map(x => ({ cpu: x.cpu, ram: x.ram, gpu: x.gpu })); draw(); });
      MM.call('system:latest').then(onSample);
      MM.call('sessions:list').then(renderSessions);
      MM.call('trimmer:status').then(renderTrim);
      renderAccounts(); renderMacros(); renderNotes(); renderPresets(); renderHealth(); renderAch(); renderWatch();
      const offs = [
        MM.on('presets:changed', renderPresets), MM.on('achievements:update', renderAch), MM.on('watcher:update', renderWatch),
        MM.on('system:sample', onSample), MM.on('sessions:changed', renderSessions), MM.on('sessions:stats', renderSessions),
        MM.on('accounts:changed', renderAccounts), MM.on('macros:changed', renderMacros), MM.on('notifications:new', renderNotes),
        MM.on('trimmer:update', renderTrim),
      ];
      const onResize = () => draw();
      addEventListener('resize', onResize);
      return () => { offs.forEach(f => f()); clearInterval(clockTimer); removeEventListener('resize', onResize); };
    },
  };
})();
