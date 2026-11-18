(function () {
  const MM = window.MM;
  const kbd = (k) => `<span class="kbd">${MM.esc(k || '—')}</span>`;

  function clickerTab(root) {
    root.innerHTML = `<div class="grid g3">
      <div class="card" id="ck-ctl"></div>
      <div class="card span2"><h3>${MM.icon('sliders-horizontal')}Clicker settings</h3>
        <div class="form-grid">
          <div class="field"><label>Mouse button</label><select class="input" data-setting="clicker.button"><option value="left">Left</option><option value="right">Right</option><option value="middle">Middle</option></select></div>
          <div class="field"><label>Interval (milliseconds)</label><input class="input" type="number" min="10" max="3600000" data-setting="clicker.intervalMs"><span class="hint" id="ck-cps"></span></div>
          <div class="field"><label>Mode</label><select class="input" data-setting="clicker.mode"><option value="continuous">Continuous until stopped</option><option value="count">Fixed number of clicks</option></select></div>
          <div class="field"><label>Click count</label><input class="input" type="number" min="1" max="1000000" data-setting="clicker.count"></div>
          <div class="field"><label>Where to click</label><select class="input" data-setting="clicker.positionMode"><option value="cursor">Wherever the cursor is</option><option value="fixed">A fixed screen position</option></select></div>
          <div class="field"><label>Fixed position</label><div class="row nowrap"><input class="input" type="number" data-setting="clicker.x" placeholder="X"><input class="input" type="number" data-setting="clicker.y" placeholder="Y"><button class="btn icon" data-act="capture" title="Pick position (move the mouse there within 3 seconds)">${MM.icon('circle-dot')}</button></div></div>
        </div>
        ${MM.settingRow('Double-click', 'Sends two clicks at each interval.', MM.toggle('clicker.doubleClick'))}
      </div></div>`;
    MM.bindSettings(root);
    const cps = () => { const iv = MM.getSetting('clicker.intervalMs'); MM.$('#ck-cps', root).textContent = `≈ ${(1000 / iv).toFixed(iv < 100 ? 1 : 2)} clicks per second`; };
    cps();
    const render = (s) => {
      if (!s) return;
      const h = MM.state.settings.hotkeys;
      MM.$('#ck-ctl', root).innerHTML = `<h3>${MM.icon('mouse-pointer-click')}Auto clicker</h3>
        <div class="row"><span class="dot ${s.running ? 'live' : ''}"></span><b style="font-size:16px">${s.running ? 'Clicking' : 'Idle'}</b></div>
        <div class="stat" style="margin:16px 0"><div class="label">Clicks this run</div><div class="value">${s.clicks.toLocaleString()}${s.target ? `<small>/ ${s.target.toLocaleString()}</small>` : ''}</div></div>
        ${s.error ? `<div class="callout err" style="margin-bottom:12px">${MM.icon('circle-alert')}<div>${MM.esc(s.error)}</div></div>` : ''}
        <button class="btn ${s.running ? 'danger' : 'primary'} big-toggle" data-act="${s.running ? 'stop' : 'start'}" ${s.available ? '' : 'disabled'}>${MM.icon(s.running ? 'square-stop' : 'play', 20)}${s.running ? 'Stop' : 'Start clicking'}</button>
        <div class="small muted" style="margin-top:12px">Toggle ${kbd(h.clickerToggle)} · Emergency stop ${kbd(h.emergencyStop)}</div>`;
    };
    MM.delegate(root, {
      start: async (b) => render(await MM.busy(b, () => MM.call('clicker:start'))),
      stop: async () => render(await MM.call('clicker:stop')),
      capture: async (b) => {
        MM.toast('info', 'Move your mouse to the spot', 'The position is captured in 3 seconds.', 3000);
        const p = await MM.busy(b, () => MM.call('clicker:capture'));
        if (p) { await MM.setSetting('clicker.x', p.x); await MM.setSetting('clicker.y', p.y); await MM.setSetting('clicker.positionMode', 'fixed'); MM.bindSettings(root); MM.toast('success', 'Position saved', `X ${p.x}, Y ${p.y}`); }
      },
    });
    const onSet = (e) => { if (e.detail.key === 'clicker.intervalMs') cps(); };
    document.addEventListener('mm:setting', onSet);
    MM.call('clicker:status').then(render);
    const off = MM.on('clicker:update', render);
    return () => { off(); document.removeEventListener('mm:setting', onSet); };
  }

  function macrosTab(root) {
    let list = [], selectedId = null, status = null;
    root.innerHTML = `<div class="grid g3">
      <div class="card" id="mc-ctl"></div>
      <div class="card span2"><h3>${MM.icon('bot')}Macro library<span class="right"><button class="btn sm" data-act="import">${MM.icon('file-up', 14)}Import</button></span></h3><div class="list" id="mc-list"></div></div>
      <div class="card span3" id="mc-detail"></div>
    </div>`;

    const renderCtl = (s) => {
      if (!s) return;
      status = s;
      const h = MM.state.settings.hotkeys;
      MM.$('#mc-ctl', root).innerHTML = `<h3>${MM.icon('circle-dot')}Recorder</h3>
        <div class="row"><span class="dot ${s.recording ? (s.paused ? 'warn' : 'err') : s.playing ? 'live' : ''}"></span><b style="font-size:16px">${s.recording ? (s.paused ? 'Paused' : 'Recording') : s.playing ? `Playing “${MM.esc(s.playingName)}”` : 'Ready'}</b></div>
        ${s.recording ? `<div class="stat" style="margin:14px 0"><div class="value">${MM.fmt.dur(s.recordingMs)}<small>${s.recordedEvents} events</small></div></div>` : ''}
        ${s.playing ? `<div class="progress"><i style="width:${Math.round(s.progress * 100)}%"></i></div><div class="small muted">Loop ${s.loop}${s.repeat ? ` of ${s.repeat}` : ' (repeating)'}</div>` : ''}
        <div class="stack" style="margin-top:14px">
          ${s.recording ? `<div class="row nowrap"><button class="btn" style="flex:1" data-act="pause">${MM.icon(s.paused ? 'play' : 'pause')}${s.paused ? 'Resume' : 'Pause'}</button><button class="btn primary" style="flex:1" data-act="stopRec">${MM.icon('square-stop')}Stop & save</button></div><button class="btn ghost" data-act="discard">Discard recording</button>`
            : s.playing ? `<button class="btn danger big-toggle" data-act="stopPlay">${MM.icon('square-stop', 20)}Stop playback</button>`
            : `<button class="btn primary big-toggle" data-act="record" ${s.available ? '' : 'disabled'}>${MM.icon('circle-dot', 20)}Start recording</button>`}
        </div>
        <div class="form-grid" style="margin-top:16px">
          <div class="field"><label>Playback speed</label><select class="input" data-setting="macros.playbackSpeed" data-type="number"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option><option value="4">4×</option></select></div>
          <div class="field"><label>Repeat (0 = forever)</label><input class="input" type="number" min="0" max="100000" data-setting="macros.repeat"></div>
        </div>
        ${MM.settingRow('Record mouse movement', 'Off records only clicks and keys.', MM.toggle('macros.recordMouseMoves'))}
        <div class="small muted">Record ${kbd(h.macroRecord)} · Play/stop ${kbd(h.macroPlay)} · Emergency stop ${kbd(h.emergencyStop)}</div>
        <div class="hint" style="margin-top:6px">Records keys, clicks and cursor moves. Scroll-wheel input isn't captured.</div>`;
      MM.bindSettings(MM.$('#mc-ctl', root));
    };

    const renderList = () => {
      MM.$('#mc-list', root).innerHTML = list.length ? list.map(m => `<div class="item ${m.id === selectedId ? 'selected' : ''}" data-id="${MM.esc(m.id)}" style="${m.id === selectedId ? 'border-color:var(--border-hi)' : ''}">
        ${MM.icon('bot')}<div class="grow" data-act="select" style="cursor:pointer"><div class="title">${MM.esc(m.name)}</div><div class="meta">${MM.fmt.dur(m.durationMs)} · ${m.eventCount} events · created ${MM.fmt.ago(m.createdAt)} · used ${MM.fmt.ago(m.lastUsedAt)}</div></div>
        <button class="btn sm primary" data-act="play">${MM.icon('play', 14)}Play</button>
        <button class="btn sm icon" data-act="rename" title="Rename">${MM.icon('pencil', 14)}</button>
        <button class="btn sm icon" data-act="export" title="Export">${MM.icon('file-down', 14)}</button>
        <button class="btn sm icon danger" data-act="del" title="Delete">${MM.icon('trash-2', 14)}</button></div>`).join('')
        : MM.empty('bot', 'No macros yet', 'Press Start recording, do your actions, then Stop & save.');
    };

    const renderDetail = async () => {
      const el = MM.$('#mc-detail', root);
      if (!selectedId) { el.innerHTML = `<h3>${MM.icon('timer')}Timeline</h3>${MM.empty('timer', 'Select a macro', 'Its events appear here on a timeline.')}`; return; }
      const m = await MM.call('macros:get', selectedId);
      if (!m) return;
      const d = Math.max(1, m.durationMs);
      const names = { kdown: 'Key down', kup: 'Key up', mdown: 'Mouse down', mup: 'Mouse up', move: 'Move' };
      const visibleEvents = m.events.filter(e => e.type !== 'move');
      el.innerHTML = `<h3>${MM.icon('timer')}${MM.esc(m.name)}<span class="right">${MM.fmt.dur(m.durationMs)} · ${m.totalEvents} events</span></h3>
        <div class="timeline">${m.events.filter((e, i) => e.type !== 'move' || i % 4 === 0).slice(0, 1500).map(e => `<i class="${e.type === 'move' ? 'v' : e.type[0] === 'k' ? 'k' : 'm'}" style="left:${(e.t / d) * 100}%"></i>`).join('')}</div>
        <div class="legend" style="margin:8px 0 12px"><span><i style="background:var(--accent)"></i>Keys</span><span><i style="background:var(--lavender)"></i>Clicks</span><span><i style="background:hsla(270,50%,60%,.5)"></i>Mouse moves</span></div>
        <div style="max-height:240px;overflow:auto"><table class="tbl"><thead><tr><th>Time</th><th>Event</th><th>Detail</th></tr></thead><tbody>${visibleEvents.slice(0, 300).map(e => `<tr><td class="mono">${(e.t / 1000).toFixed(2)}s</td><td>${names[e.type]}</td><td class="mono">${e.vk ? MM.esc(e.key || `VK ${e.vk}`) : `${e.button} @ ${e.x}, ${e.y}`}</td></tr>`).join('')}</tbody></table>${visibleEvents.length > 300 ? `<div class="hint">…and ${visibleEvents.length - 300} more</div>` : ''}</div>`;
    };

    const load = async () => { list = await MM.call('macros:list') || []; if (selectedId && !list.some(m => m.id === selectedId)) selectedId = null; renderList(); };
    const idOf = (el) => el.closest('[data-id]').dataset.id;

    MM.delegate(root, {
      record: async () => renderCtl(await MM.call('macros:record')),
      pause: async () => renderCtl(await MM.call('macros:pause')),
      stopRec: async () => {
        const name = await MM.prompt('Save macro', 'Name', `Macro ${list.length + 1}`);
        const r = await MM.call('macros:stopRecording', name || undefined);
        if (r) { renderCtl(r.status); if (r.saved) { selectedId = r.saved.id; MM.toast('success', 'Macro saved', r.saved.name); } else MM.toast('warn', 'Nothing recorded'); load(); renderDetail(); }
      },
      discard: async () => { const r = await MM.call('macros:discard'); if (r) renderCtl(r.status); },
      stopPlay: async () => renderCtl(await MM.call('macros:stop')),
      select: (el) => { selectedId = idOf(el); renderList(); renderDetail(); },
      play: async (el) => { const s = await MM.call('macros:play', idOf(el)); if (s) { renderCtl(s); MM.toast('info', 'Playing macro', `Press ${MM.getSetting('hotkeys.emergencyStop')} to stop at any time.`); } },
      rename: async (el) => { const m = list.find(x => x.id === idOf(el)); const n = await MM.prompt('Rename macro', 'Name', m.name); if (n && await MM.call('macros:rename', m.id, n)) { load(); if (selectedId === m.id) renderDetail(); } },
      export: async (el) => { const p = await MM.call('macros:export', idOf(el)); if (p) MM.toast('success', 'Exported', p); },
      del: async (el) => { const m = list.find(x => x.id === idOf(el)); if (await MM.confirm(`Delete “${m.name}”?`, 'This cannot be undone.', { danger: true, ok: 'Delete' })) { await MM.call('macros:remove', m.id); load(); renderDetail(); } },
      import: async () => { const r = await MM.call('macros:import'); if (r) { MM.toast('success', 'Macro imported', r.name); selectedId = r.id; load(); renderDetail(); } },
    });

    MM.call('macros:status').then(renderCtl);
    load(); renderDetail();
    const offs = [MM.on('macros:update', s => { const changedMode = !status || s.recording !== status.recording || s.playing !== status.playing || s.paused !== status.paused; if (changedMode) renderCtl(s); else { status = s; const v = MM.$('#mc-ctl .stat .value', root); if (v && s.recording) v.innerHTML = `${MM.fmt.dur(s.recordingMs)}<small>${s.recordedEvents} events</small>`; const pr = MM.$('#mc-ctl .progress i', root); if (pr) pr.style.width = `${Math.round(s.progress * 100)}%`; } }), MM.on('macros:changed', load)];
    return () => offs.forEach(f => f());
  }

  function afkTab(root) {
    root.innerHTML = `<div class="grid g3">
      <div class="card" id="afk-ctl"></div>
      <div class="card span2"><h3>${MM.icon('sliders-horizontal')}Anti-AFK settings</h3>
        <div class="form-grid">
          <div class="field"><label>Mode</label><select class="input" data-setting="antiAfk.mode"><option value="reminder">Reminder only — notify me</option><option value="nudge">Nudge — tap a key in each Roblox window</option></select></div>
          <div class="field"><label>Every (minutes)</label><input class="input" type="number" min="1" max="120" data-setting="antiAfk.intervalMin"><span class="hint">Nudge mode is capped at 19 min (Roblox disconnects idle players at 20).</span></div>
          <div class="field"><label>Keys to press (nudge mode)</label><div class="row nowrap"><input class="input" data-setting="antiAfk.key" placeholder="F13" style="flex:1"><button class="btn sm" data-act="recordKeys">${MM.icon('circle-dot', 14)}Record</button></div><span class="hint">One or more keys, pressed in order, e.g. <b>W, Space</b>. F13 moves nothing in-game but still counts as activity.</span></div>
          <div class="field"><label>Count me as away after (seconds)</label><input class="input" type="number" min="10" max="900" data-setting="antiAfk.awaySec"></div>
        </div>
        ${MM.settingRow('Only while I\'m away', 'Waits until you haven\'t touched the mouse or keyboard for a while, so it never steals focus while you\'re using the PC. Checks again every 30 seconds.', MM.toggle('antiAfk.onlyWhenAway'))}
        ${MM.settingRow('Only MultiMenu sessions', 'Nudge only Roblox clients launched from MultiMenu.', MM.toggle('antiAfk.onlyTracked'))}
        <div class="callout warn" style="margin-top:8px">${MM.icon('triangle-alert')}<div>Nudge mode briefly brings each Roblox window to the front, taps the key, then returns focus to what you were using. Some games don't allow AFK tools: check the game's rules before using nudge mode.</div></div>
      </div></div>`;
    MM.bindSettings(root);
    const render = (s) => {
      if (!s) return;
      MM.$('#afk-ctl', root).innerHTML = `<h3>${MM.icon('moon')}Anti-AFK</h3>
        <div class="row"><span class="dot ${s.running ? 'live' : ''}"></span><b style="font-size:16px">${s.running ? 'Active' : 'Off'}</b><span class="spacer"></span><span class="badge">${s.config.mode === 'nudge' ? 'Nudge' : 'Reminder'}</span></div>
        <div class="stack small muted" style="margin:14px 0"><div>Next: ${s.nextAt ? MM.fmt.clock(s.nextAt) : '—'}</div><div>Last: ${s.lastAt ? `${MM.fmt.ago(s.lastAt)} (${s.lastCount} window${s.lastCount === 1 ? '' : 's'})` : 'never'}</div><div>Actions so far: ${s.actions}</div>${s.lastSkipped ? `<div>${MM.esc(s.lastSkipped)}</div>` : ''}</div>
        ${s.lastError ? `<div class="callout err" style="margin-bottom:12px">${MM.icon('circle-alert')}<div>${MM.esc(s.lastError)}</div></div>` : ''}
        <button class="btn ${s.running ? 'danger' : 'primary'} big-toggle" data-act="${s.running ? 'stop' : 'start'}" ${s.available ? '' : 'disabled'}>${MM.icon(s.running ? 'square-stop' : 'play', 20)}${s.running ? 'Stop' : 'Start Anti-AFK'}</button>
        <button class="btn" style="width:100%;margin-top:10px" data-act="now" ${s.available ? '' : 'disabled'}>${MM.icon('zap')}Run once now</button>`;
    };
    MM.delegate(root, {
      start: async (b) => render(await MM.busy(b, () => MM.call('antiafk:start'))),
      stop: async () => render(await MM.call('antiafk:stop')),
      now: async (b) => render(await MM.busy(b, () => MM.call('antiafk:runNow'))),
      recordKeys: async () => {
        const keys = [];
        const name = (e) => {
          const c = e.code;
          if (/^Key[A-Z]$/.test(c)) return c.slice(3);
          if (/^Digit\d$/.test(c)) return c.slice(5);
          if (/^F\d{1,2}$/.test(c)) return c;
          if (/^Numpad\d$/.test(c)) return `Num${c.slice(6)}`;
          return { Space: 'Space', Enter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
            ShiftLeft: 'LShift', ShiftRight: 'RShift', ControlLeft: 'LCtrl', ControlRight: 'RCtrl', AltLeft: 'LAlt', AltRight: 'RAlt', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete' }[c] || null;
        };
        let onKey;
        const r = await MM.modal({
          title: 'Record keys', icon: 'keyboard', desc: 'Press the keys you want Anti-AFK to press, in order (up to 8). Then click Save.',
          body: `<div class="input" id="rk-out" style="min-height:40px;display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="dim">Waiting for keys…</span></div><button class="btn sm ghost" id="rk-clear" style="margin-top:8px">${MM.icon('undo-2', 14)}Clear</button>`,
          buttons: [{ label: 'Cancel', value: null, cls: 'ghost' }, { label: 'Save', value: 'save', cls: 'primary', icon: 'check' }],
          onMount: (m) => {
            const out = m.querySelector('#rk-out');
            const paint = () => { out.innerHTML = keys.length ? keys.map(k => `<kbd>${MM.esc(k)}</kbd>`).join(' ') : '<span class="dim">Waiting for keys…</span>'; };
            onKey = (e) => {
              if (e.key === 'Escape' && !keys.length) return;
              const n = name(e);
              if (!n) return;
              e.preventDefault(); e.stopPropagation();
              if (keys.length < 8) keys.push(n);
              paint();
            };
            document.addEventListener('keydown', onKey, true);
            m.querySelector('#rk-clear').onclick = () => { keys.length = 0; paint(); };
          },
        });
        document.removeEventListener('keydown', onKey, true);
        if (r !== 'save' || !keys.length) return;
        const v = keys.join(', ');
        await MM.setSetting('antiAfk.key', v);
        const inp = root.querySelector('[data-setting="antiAfk.key"]');
        if (inp) inp.value = v;
        MM.toast('success', 'Anti-AFK keys saved', v);
      },
    });
    MM.call('antiafk:status').then(render);
    return MM.on('antiafk:update', render);
  }

  MM.pages.automation = {
    render(root, params) {
      let tab = params.tab || 'clicker', sub = null;
      root.innerHTML = `<div class="page-head"><div><h1>Automation</h1><p>Auto clicker, macro recorder and Anti-AFK. Hotkeys work even when MultiMenu is in the background.</p></div>
        <div class="actions"><button class="btn danger" data-act="estop">${MM.icon('octagon-x')}Emergency stop</button></div></div>
        ${MM.winOnly()}
        <div class="tabs"><button class="tab" data-act="tab" data-tab="clicker">${MM.icon('mouse-pointer-click', 15)}Auto Clicker</button><button class="tab" data-act="tab" data-tab="macros">${MM.icon('bot', 15)}Macro Recorder</button><button class="tab" data-act="tab" data-tab="afk">${MM.icon('moon', 15)}Anti-AFK</button></div>
        <div id="auto-body"></div>`;
      const show = () => {
        if (sub) sub();
        MM.$$('.tabs .tab', root).forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
        const body = MM.$('#auto-body', root);
        const fresh = body.cloneNode(false); body.replaceWith(fresh); // drop old listeners
        sub = { clicker: clickerTab, macros: macrosTab, afk: afkTab }[tab](fresh);
      };
      root.querySelector('.tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; show(); } });
      root.querySelector('[data-act="estop"]').addEventListener('click', () => MM.call('automation:emergencyStop'));
      show();
      return () => { if (sub) sub(); };
    },
  };
})();
