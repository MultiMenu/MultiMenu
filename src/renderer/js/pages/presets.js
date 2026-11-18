(function () {
  const MM = window.MM;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const LAYOUTS = { '': 'Keep current', auto: 'Smart grid', columns: 'Side by side', rows: 'Stacked', grid2: '2 × 2', grid3: '3 × 3', grid4: '4 × 4', main: 'Main + side', cascade: 'Cascade', fixed: 'Fixed size' };
  const CAPS = [30, 60, 75, 120, 144, 165, 240, -1];

  MM.pages.presets = {
    render(root, params = {}) {
      let presets = [], accounts = [], games = [], sched = { tasks: [], actions: {} };
      let draft = params.importDraft || null;
      root.innerHTML = `
        <div class="page-head"><div><h1>Presets & Schedule</h1><p>Save a whole setup — accounts, game, layout, graphics and watcher — and start it with one click or on a timetable.</p></div>
          <div class="actions"><button class="btn" data-act="importCode">${MM.icon('clipboard-paste')}Paste a code</button><button class="btn primary" data-act="newPreset">${MM.icon('plus')}New preset</button></div></div>
        <div class="acc-grid" id="p-list"></div>
        <div class="card" style="margin-top:18px">
          <h3>${MM.icon('calendar-clock')}Scheduled tasks<span class="right"><button class="btn sm primary" data-act="newTask">${MM.icon('plus', 14)}New task</button></span></h3>
          <p class="sub">Start or close presets at set times, restart every client to clear memory, or trim RAM. Quiet hours (no auto-rejoin) are set on the 24/7 Watcher page.</p>
          <div id="t-list"></div>
        </div>`;


      const renderPresets = () => {
        MM.$('#p-list', root).innerHTML = presets.length ? presets.map(p => {
          const accs = p.tag ? accounts.filter(a => (a.tags || []).includes(p.tag)) : p.accountIds.map(id => accounts.find(a => a.id === id)).filter(Boolean);
          return `<div class="card preset-card hover" data-id="${MM.esc(p.id)}">
            <div class="row nowrap"><div style="min-width:0"><div class="name" style="font:600 16px var(--display)">${MM.esc(p.name)}</div><div class="small muted">${p.tag ? `${MM.icon('tag', 12)} <span data-nt>${MM.esc(p.tag)}</span> · ` : ''}${accs.length} account${accs.length === 1 ? '' : 's'} · ${MM.esc(p.game ? (games.find(g => g.link === p.game)?.name || p.game).slice(0, 40) : 'each account\'s default game')}</div></div><span class="spacer"></span>
              <div class="avs">${accs.slice(0, 5).map(a => MM.avatar(a.avatarUrl, a.username, 'sm')).join('')}</div></div>
            <div class="row">${p.watch ? `<span class="badge ok">${MM.icon('radar', 12)}24/7</span>` : ''}${p.tile ? `<span class="badge">${MM.icon('layout-dashboard', 12)}Tile${p.layout ? ` · ${MM.esc(LAYOUTS[p.layout])}` : ''}</span>` : ''}${p.mode === 'sameServer' ? `<span class="badge">${MM.icon('users', 12)}Same server</span>` : ''}${p.graphics.enabled ? `<span class="badge dim">Gfx ${p.graphics.quality || 'Auto'} · ${p.graphics.fpsCap === -1 ? '∞' : p.graphics.fpsCap} FPS</span>` : ''}${p.limiter ? '<span class="badge dim">Limiter</span>' : ''}${p.antiAfk ? '<span class="badge dim">Anti-AFK</span>' : ''}${p.closeAfterHours ? `<span class="badge dim">${MM.icon('timer', 12)}${p.closeAfterHours}h</span>` : ''}</div>
            <div class="small dim">Last run ${MM.fmt.ago(p.lastRunAt)}</div>
            <div class="acts row"><button class="btn sm primary" data-act="run">${MM.icon('rocket', 14)}Start</button><button class="btn sm" data-act="stop">${MM.icon('square-stop', 14)}Close</button><button class="btn sm" data-act="edit">${MM.icon('pencil', 14)}Edit</button><button class="btn sm icon" data-act="shortcut" title="Desktop shortcut (also in the taskbar jump list)">${MM.icon('monitor', 14)}</button><button class="btn sm icon" data-act="share" title="Share code">${MM.icon('share-2', 14)}</button><span class="spacer"></span><button class="btn sm icon danger" data-act="del" title="Delete">${MM.icon('trash-2', 14)}</button></div>
          </div>`;
        }).join('') : `<div class="card" style="grid-column:1/-1">${MM.empty('save', 'No presets yet', 'Create one: pick accounts and a game, choose a layout, switch on the 24/7 Watcher, and launch the lot with one click.')}</div>`;
      };

      const describe = (t) => t.kind === 'every' ? `Every ${t.everyHours} h` : `${t.days.length === 7 ? 'Every day' : t.days.map(d => DAYS[d]).join(', ')} at ${t.time}`;
      const renderTasks = () => {
        const t = sched.tasks;
        MM.$('#t-list', root).innerHTML = t.length ? `<table class="tbl"><thead><tr><th>On</th><th>Task</th><th>When</th><th>Next run</th><th>Last result</th><th></th></tr></thead><tbody>${t.map(x => `<tr data-id="${MM.esc(x.id)}">
          <td><label class="toggle"><input type="checkbox" data-task-toggle ${x.enabled ? 'checked' : ''}><span class="sw"></span></label></td>
          <td><b>${MM.esc(x.name)}</b><div class="small muted">${MM.esc(sched.actions[x.action] || x.action)}${x.presetId ? ` · ${MM.esc(presets.find(p => p.id === x.presetId)?.name || 'missing preset')}` : ''}</div></td>
          <td>${MM.esc(describe(x))}</td><td>${x.nextRunAt ? MM.esc(new Date(x.nextRunAt).toLocaleString(MM.loc(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })) : '—'}</td>
          <td class="small">${x.lastRunAt ? `${MM.fmt.ago(x.lastRunAt)} · ${MM.esc(x.lastResult || '')}` : '—'}</td>
          <td><div class="row nowrap" style="justify-content:flex-end"><button class="btn sm" data-act="runTask">${MM.icon('play', 14)}Run now</button><button class="btn sm icon" data-act="editTask">${MM.icon('pencil', 14)}</button><button class="btn sm icon danger" data-act="delTask">${MM.icon('trash-2', 14)}</button></div></td></tr>`).join('')}</tbody></table>`
          : MM.empty('calendar-clock', 'No scheduled tasks', 'Example: start your farm preset at 08:00 on weekdays and restart all clients every 6 hours.');
      };

      const load = async () => {
        const [p, a, g, s] = await Promise.all([MM.call('presets:list'), MM.call('accounts:list'), MM.call('servers:games'), MM.call('schedule:list')]);
        presets = p || []; accounts = a?.accounts || []; games = g || []; sched = s || sched;
        renderPresets(); renderTasks();
        if (draft) { const d = draft; draft = null; if (accounts.length) presetEditor(null, d); else MM.toast('warn', 'Add an account first', 'The imported preset needs accounts to launch.'); }
      };

      const presetEditor = async (p, imported) => {
        const v = p || imported || { name: '', accountIds: [], tag: '', game: '', mode: 'default', layout: 'auto', tile: true, watch: true, limiter: false, antiAfk: false, graphics: { enabled: false, quality: 1, fpsCap: 60 }, closeAfterHours: 0 };
        let picker = null;
        const tog = (id, label, desc, on) => `<div class="setting-row"><div class="txt"><b>${label}</b><span>${desc}</span></div><div class="ctl"><label class="toggle"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="sw"></span></label></div></div>`;
        const ok = await MM.modal({
          title: p ? `Edit “${p.name}”` : imported ? 'Imported preset' : 'New preset', icon: 'save', wide: true,
          desc: imported ? (imported.tag ? 'Check the settings, then save. It uses everyone with the tag below.' : 'Codes don\'t include accounts. Pick yours, check the settings, then save.') : '',
          body: `<div class="stack">
            <div class="field"><label>Name</label><input class="input" id="pe-name" maxlength="50" value="${MM.esc(v.name)}" placeholder="e.g. Farm squad"></div>
            <div class="field"><label>Accounts</label><div class="seg" id="pe-who"><button data-w="pick" class="${v.tag ? '' : 'on'}">Pick accounts</button><button data-w="tag" class="${v.tag ? 'on' : ''}">Everyone with a tag</button></div></div>
            <div class="chips ${v.tag ? 'hidden' : ''}" id="pe-accs"></div>
            <div class="field ${v.tag ? '' : 'hidden'}" id="pe-tag-f"><input class="input" id="pe-tag" list="pe-tags" maxlength="24" value="${MM.esc(v.tag || '')}" placeholder="e.g. farm"><datalist id="pe-tags">${[...new Set(accounts.flatMap(a => a.tags || []))].map(t => `<option value="${MM.esc(t)}">`).join('')}</datalist><div class="small muted">Accounts you tag later join this preset automatically.</div></div>
            <div class="grid g2">
              <div class="field"><label>Game (place ID, link or private server)</label><input class="input" id="pe-game" list="pe-games" value="${MM.esc(v.game)}" placeholder="Blank = each account's default"><datalist id="pe-games">${games.map(g => `<option value="${MM.esc(g.link)}">${MM.esc(g.name)}</option>`).join('')}</datalist></div>
              <div class="field"><label>Where to join</label><select class="input" id="pe-mode"><option value="default" ${v.mode !== 'sameServer' ? 'selected' : ''}>Any server (Roblox picks)</option><option value="sameServer" ${v.mode === 'sameServer' ? 'selected' : ''}>All in the same server (follow the first account)</option></select></div>
              <div class="field"><label>Window layout</label><select class="input" id="pe-layout">${Object.entries(LAYOUTS).map(([k, l]) => `<option value="${k}" ${v.layout === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
              <div class="field"><label>Close automatically after (hours, 0 = never)</label><input class="input" type="number" min="0" max="168" step="0.5" id="pe-close" value="${v.closeAfterHours}"></div>
            </div>
            <div>
              ${tog('pe-tile', 'Auto-tile windows', 'Arrange windows as each client starts.', v.tile)}
              ${tog('pe-watch', '24/7 Watcher', 'Rejoin these accounts if they crash, disconnect or freeze.', v.watch)}
              ${tog('pe-limiter', 'Background limiter', 'Lower priority / mute for windows you aren\'t using.', v.limiter)}
              ${tog('pe-afk', 'Anti-AFK', 'Start Anti-AFK with this preset.', v.antiAfk)}
              ${tog('pe-gfx', 'Set Roblox graphics', 'Apply the quality and FPS cap below before launching.', v.graphics.enabled)}
            </div>
            <div class="grid g2"><div class="field"><label>Graphics quality (0 = Auto)</label><input class="input" type="number" min="0" max="10" id="pe-q" value="${v.graphics.quality}"></div>
              <div class="field"><label>FPS cap</label><select class="input" id="pe-fps">${CAPS.map(c => `<option value="${c}" ${v.graphics.fpsCap === c ? 'selected' : ''}>${c === -1 ? 'Unlimited' : c}</option>`).join('')}</select></div></div>
          </div>`,
          onMount: (m) => {
            picker = MM.accountPicker(m.querySelector('#pe-accs'), accounts, { selected: v.accountIds });
            m.querySelector('#pe-who').onclick = (e) => {
              const b = e.target.closest('[data-w]'); if (!b) return;
              m.querySelectorAll('#pe-who button').forEach(x => x.classList.toggle('on', x === b));
              m.querySelector('#pe-accs').classList.toggle('hidden', b.dataset.w === 'tag');
              m.querySelector('#pe-tag-f').classList.toggle('hidden', b.dataset.w !== 'tag');
            };
          },
          buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Save preset', value: true, cls: 'primary', icon: 'save', handler: async (m) => {
            const q = (s) => m.querySelector(s);
            const r = await MM.call('presets:save', {
              id: p?.id, name: q('#pe-name').value, accountIds: picker.get(), tag: q('#pe-tag-f').classList.contains('hidden') ? '' : q('#pe-tag').value, game: q('#pe-game').value, mode: q('#pe-mode').value, layout: q('#pe-layout').value,
              closeAfterHours: Number(q('#pe-close').value), tile: q('#pe-tile').checked, watch: q('#pe-watch').checked, limiter: q('#pe-limiter').checked, antiAfk: q('#pe-afk').checked,
              graphics: { enabled: q('#pe-gfx').checked, quality: Number(q('#pe-q').value), fpsCap: Number(q('#pe-fps').value) },
            });
            if (!r) return false;
          } }],
        });
        if (ok) { MM.toast('success', 'Preset saved'); load(); }
      };

      const taskEditor = async (t) => {
        const v = t || { name: '', action: 'launchPreset', presetId: presets[0]?.id || '', kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5], everyHours: 6, enabled: true };
        let days = new Set(v.days || []);
        const ok = await MM.modal({
          title: t ? 'Edit task' : 'New scheduled task', icon: 'calendar-clock',
          body: `<div class="stack">
            <div class="field"><label>What to do</label><select class="input" id="te-action">${Object.entries(sched.actions).map(([k, l]) => `<option value="${k}" ${v.action === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="field" id="te-preset-f"><label>Preset</label><select class="input" id="te-preset">${presets.map(p => `<option value="${MM.esc(p.id)}" ${v.presetId === p.id ? 'selected' : ''}>${MM.esc(p.name)}</option>`).join('') || '<option value="">Create a preset first</option>'}</select></div>
            <div class="field"><label>When</label><div class="seg" id="te-kind"><button data-k="daily" class="${v.kind !== 'every' ? 'on' : ''}">At a time</button><button data-k="every" class="${v.kind === 'every' ? 'on' : ''}">Repeat every…</button></div></div>
            <div id="te-daily" class="stack"><div class="field"><label>Time</label><input class="input" type="time" id="te-time" value="${MM.esc(v.time || '08:00')}"></div><div class="field"><label>Days</label><div class="days" id="te-days">${DAYS.map((d, i) => `<button data-d="${i}" class="${days.has(i) ? 'on' : ''}">${d}</button>`).join('')}</div></div></div>
            <div id="te-every" class="field"><label>Hours between runs</label><input class="input" type="number" min="0.25" max="168" step="0.25" id="te-hours" value="${v.everyHours || 6}"></div>
            <div class="field"><label>Name (optional)</label><input class="input" id="te-name" maxlength="50" value="${MM.esc(v.name)}"></div>
          </div>`,
          onMount: (m) => {
            let kind = v.kind === 'every' ? 'every' : 'daily';
            const sync = () => {
              m.querySelector('#te-daily').classList.toggle('hidden', kind !== 'daily');
              m.querySelector('#te-every').classList.toggle('hidden', kind !== 'every');
              m.querySelector('#te-preset-f').classList.toggle('hidden', !['launchPreset', 'closePreset'].includes(m.querySelector('#te-action').value));
              m.querySelectorAll('#te-kind button').forEach(b => b.classList.toggle('on', b.dataset.k === kind));
            };
            m.querySelector('#te-kind').onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { kind = b.dataset.k; m.dataset.kind = kind; sync(); } };
            m.querySelector('#te-days').onclick = (e) => { const b = e.target.closest('[data-d]'); if (!b) return; const d = +b.dataset.d; if (days.has(d)) days.delete(d); else days.add(d); b.classList.toggle('on', days.has(d)); };
            m.querySelector('#te-action').onchange = sync;
            m.dataset.kind = kind; sync();
          },
          buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Save task', value: true, cls: 'primary', handler: async (m) => {
            const q = (s) => m.querySelector(s);
            const r = await MM.call('schedule:save', { id: t?.id, name: q('#te-name').value, action: q('#te-action').value, presetId: q('#te-preset').value, kind: m.dataset.kind, time: q('#te-time').value, days: [...days], everyHours: Number(q('#te-hours').value), enabled: t ? t.enabled : true });
            if (!r) return false;
          } }],
        });
        if (ok) { MM.toast('success', 'Task saved'); load(); }
      };

      root.addEventListener('change', async (e) => {
        if (!e.target.matches('[data-task-toggle]')) return;
        const t = sched.tasks.find(x => x.id === e.target.closest('[data-id]').dataset.id);
        await MM.call('schedule:save', { ...t, enabled: e.target.checked });
        load();
      });
      const pid = (b) => b.closest('[data-id]').dataset.id;
      MM.delegate(root, {
        newPreset: () => (accounts.length ? presetEditor(null) : MM.toast('warn', 'Add an account first', 'Presets launch your saved accounts.')),
        edit: (b) => presetEditor(presets.find(p => p.id === pid(b))),
        share: (b) => MM.shareCode('preset', pid(b)),
        importCode: () => MM.importCode(),
        shortcut: async (b) => { const f = await MM.call('shortcuts:create', 'preset', pid(b)); if (f) MM.toast('success', 'Desktop shortcut created', 'Double-click it to start this preset — even with MultiMenu closed. Presets are also in the taskbar jump list.', 7000); },
        run: async (b) => { const r = await MM.busy(b, () => MM.call('presets:run', pid(b))); if (r) load(); },
        stop: (b) => MM.call('presets:close', pid(b)),
        del: async (b) => { const p = presets.find(x => x.id === pid(b)); if (await MM.confirm(`Delete “${p.name}”?`, 'Scheduled tasks that use it stop working.', { danger: true, ok: 'Delete' })) { await MM.call('presets:remove', p.id); load(); } },
        newTask: () => taskEditor(null),
        editTask: (b) => taskEditor(sched.tasks.find(t => t.id === pid(b))),
        runTask: async (b) => { const r = await MM.busy(b, () => MM.call('schedule:run', pid(b))); if (r) { MM.toast('success', 'Task ran', r.result); load(); } },
        delTask: async (b) => { if (await MM.confirm('Delete this task?', '', { danger: true, ok: 'Delete' })) { await MM.call('schedule:remove', pid(b)); load(); } },
      });

      load();
      const t = setInterval(load, 30000);
      const offs = [MM.on('presets:changed', load), MM.on('schedule:changed', load), MM.on('accounts:changed', load)];
      return () => { clearInterval(t); offs.forEach(f => f()); };
    },
  };
})();
