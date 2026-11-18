(function () {
  const MM = window.MM;

  MM.pages.performance = {
    render(root) {
      let hist = [], sessions = [], caps = [], gfx = null, totalMB = 0;
      root.innerHTML = `
        <div class="page-head"><div><h1>Performance Centre</h1><p>Live CPU, RAM, GPU and FPS, Roblox graphics shortcuts and performance profiles.</p></div>
          <div class="actions"><label class="toggle">${'<input type="checkbox" data-setting="performance.lowResourceMode"><span class="sw"></span>'}<span>Low-resource mode</span></label></div></div>
        ${MM.winOnly()}
        <div class="grid g4">
          <div class="card stat"><div class="label">${MM.icon('cpu', 15)}CPU</div><div class="value" id="p-cpu">—</div><canvas class="spark" id="sp-cpu"></canvas></div>
          <div class="card stat"><div class="label">${MM.icon('memory-stick', 15)}RAM</div><div class="value" id="p-ram">—</div><canvas class="spark" id="sp-ram"></canvas></div>
          <div class="card stat"><div class="label">${MM.icon('monitor', 15)}GPU</div><div class="value" id="p-gpu">—</div><canvas class="spark" id="sp-gpu"></canvas></div>
          <div class="card stat"><div class="label">${MM.icon('gamepad-2', 15)}Roblox RAM</div><div class="value" id="p-rbx">—</div><canvas class="spark" id="sp-rbx"></canvas></div>
        </div>
        <div class="grid g3" style="margin-top:16px">
          <div class="card span2"><h3>${MM.icon('activity')}Memory usage<span class="right legend"><span><i style="background:${MM.accent()}"></i>System RAM %</span><span><i style="background:#f0abfc"></i>Roblox share of RAM %</span></span></h3><canvas class="chart" id="p-chart"></canvas></div>
          <div class="card"><h3>${MM.icon('sparkles')}Recommendations</h3><div class="list" id="p-recs"></div></div>
          <div class="card span2" id="p-fps"></div>
          <div class="card"><h3>${MM.icon('sliders-horizontal')}Profiles</h3><p class="sub">One click sets Roblox graphics, FPS cap, RAM Trimmer and low-resource mode together.</p><div class="list" id="p-profiles"></div></div>
          <div class="card span3" id="p-lim-card">
            <h3>${MM.icon('cpu')}Background limiter<span class="right" id="p-lim-state"></span></h3>
            <p class="sub">Gives the Roblox window you're using full speed and slows the ones in the background, so many clients run smoothly together.</p>
            <div class="tile-wrap" style="grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)">
              <div class="stack">
                <div class="form-grid" style="grid-template-columns:1fr 1fr">
                  <div class="field"><label>Window you're using</label><select class="input" data-setting="limiter.focusedPriority"><option value="normal">Normal priority</option><option value="above">Above normal</option><option value="high">High</option></select></div>
                  <div class="field"><label>Background windows</label><select class="input" data-setting="limiter.backgroundPriority"><option value="below">Below normal</option><option value="idle">Low (idle)</option><option value="normal">Normal (no change)</option></select></div>
                </div>
                ${MM.settingRow('Limit background CPU cores', 'Background clients only use the last few cores.', MM.toggle('limiter.limitCores'))}
                <div class="field"><label>Cores for background clients</label><input class="input" type="number" min="1" max="64" data-setting="limiter.backgroundCores"></div>
                ${MM.settingRow('Mute background clients', 'Only the window you\'re using plays sound.', MM.toggle('limiter.muteBackground'))}
                <button class="btn big" id="p-lim-btn" data-act="limToggle"></button>
              </div>
              <div><div class="lbl" style="margin-bottom:8px">Roblox clients</div><div id="p-lim-list"></div></div>
            </div>
          </div>
          <div class="card span3" id="p-gfx"></div>
          <div class="card span3"><h3>${MM.icon('list')}Processes<span class="right">Top 30 by memory · refreshes every 3s</span></h3><div id="p-procs"></div></div>
        </div>`;
      MM.bindSettings(root);

      const sparks = () => {
        const opt = { max: 100, grid: false };
        MM.chart(MM.$('#sp-cpu', root), [{ data: hist.map(h => h.cpu), color: MM.accent(), fill: MM.accent(0.3), capacity: 150 }], opt);
        MM.chart(MM.$('#sp-ram', root), [{ data: hist.map(h => h.ram), color: '#e9d5ff', fill: 'rgba(233,213,255,.25)', capacity: 150 }], opt);
        MM.chart(MM.$('#sp-gpu', root), [{ data: hist.map(h => h.gpu), color: '#f0abfc', fill: 'rgba(240,171,252,.25)', capacity: 150 }], opt);
        const maxR = Math.max(1024, ...hist.map(h => h.roblox || 0));
        MM.chart(MM.$('#sp-rbx', root), [{ data: hist.map(h => h.roblox), color: '#c4b5fd', fill: 'rgba(196,181,253,.25)', capacity: 150 }], { max: maxR * 1.1, grid: false });
        MM.chart(MM.$('#p-chart', root), [
          { data: hist.map(h => h.ram), color: MM.accent(), fill: MM.accent(0.22), capacity: 150 },
          { data: hist.map(h => (totalMB ? Math.min(100, ((h.roblox || 0) / totalMB) * 100) : null)), color: '#f0abfc', capacity: 150 },
        ], { labels: true });
      };

      const onSample = (s) => {
        if (!s) return;
        totalMB = s.ramTotal / 1048576;
        MM.$('#p-cpu', root).innerHTML = `${Math.round(s.cpu)}<small>%</small>`;
        MM.$('#p-ram', root).innerHTML = `${Math.round(s.ramPercent)}<small>% · ${MM.esc(MM.fmt.bytes(s.ramUsed))}</small>`;
        MM.$('#p-gpu', root).innerHTML = s.gpu == null ? `<span class="small muted">${s.gpuStatus === 'off' ? 'Off in settings' : s.gpuStatus === 'starting' ? 'Starting…' : 'Unavailable'}</span>` : `${Math.round(s.gpu)}<small>%</small>`;
        MM.$('#p-rbx', root).innerHTML = `${MM.esc(MM.fmt.mb(s.roblox.memMB))}<small>${s.roblox.count} client${s.roblox.count === 1 ? '' : 's'}</small>`;
        hist.push({ cpu: s.cpu, ram: s.ramPercent, gpu: s.gpu, roblox: s.roblox.memMB });
        if (hist.length > 150) hist.shift();
        sparks();
      };

      const renderFps = (st) => {
        if (!st) return;
        const rows = Object.entries(st.fps || {});
        const labelFor = (pid) => sessions.find(s => s.pid === Number(pid))?.label || `Roblox (PID ${pid})`;
        MM.$('#p-fps', root).innerHTML = `<h3>${MM.icon('gauge')}FPS monitor<span class="right"><span class="dot ${st.status === 'ok' ? 'live' : st.status === 'error' ? 'err' : ''}"></span>${MM.esc({ ok: 'Measuring', starting: 'Starting', error: 'Error', off: 'Stopped' }[st.status] || st.status)}</span></h3>
          <p class="sub">Roblox doesn't share its frame rate with other apps, so MultiMenu measures it with <b>PresentMon</b>, Intel's free frame-timing tool.</p>
          ${st.status === 'ok' || rows.length ? (rows.length ? `<table class="tbl"><thead><tr><th>Client</th><th>FPS</th><th>1% low</th><th>Frame time</th></tr></thead><tbody>${rows.map(([pid, f]) => `<tr><td>${MM.esc(labelFor(pid))}</td><td><b style="font-size:16px">${f.fps}</b></td><td>${f.low1}</td><td>${f.frameMs} ms</td></tr>`).join('')}</tbody></table>` : MM.empty('gauge', 'Waiting for frames', 'Open a Roblox client to see its FPS.'))
            : `<div class="callout ${st.status === 'error' ? 'err' : ''}">${MM.icon(st.status === 'error' ? 'circle-alert' : 'info')}<div>${MM.esc(st.message)}</div></div>`}
          <div class="row" style="margin-top:12px">
            <button class="btn" data-act="pickPM">${MM.icon('folder-open')}${st.path ? 'Change PresentMon…' : 'Choose PresentMon.exe…'}</button>
            ${st.status === 'ok' || st.status === 'starting' ? `<button class="btn danger" data-act="fpsStop">${MM.icon('square-stop')}Stop</button>` : `<button class="btn primary" data-act="fpsStart" ${st.path ? '' : 'disabled'}>${MM.icon('play')}Start monitoring</button>`}
            <button class="btn ghost" data-act="pmLink">${MM.icon('external-link')}Get PresentMon</button>
            <span class="small dim">${st.path ? MM.esc(st.path) : ''}</span>
          </div>`;
      };

      const renderGfx = async () => {
        gfx = await MM.call('fps:graphics');
        const el = MM.$('#p-gfx', root);
        if (!gfx) return;
        if (!gfx.available) { el.innerHTML = `<h3>${MM.icon('monitor')}Roblox graphics & FPS cap</h3><div class="callout warn">${MM.icon('triangle-alert')}<div>${MM.esc(gfx.message)}</div></div>`; return; }
        el.innerHTML = `<h3>${MM.icon('monitor')}Roblox graphics & FPS cap<span class="right">Edits Roblox's own settings file · backed up first</span></h3>
          ${gfx.robloxRunning ? `<div class="callout warn" style="margin-bottom:12px">${MM.icon('triangle-alert')}<div>Roblox is open. Changes apply to clients started after this, and a client closing later may overwrite them.</div></div>` : ''}
          <div class="grid g2">
            <div class="field"><label>Maximum frame rate</label><div class="seg" id="g-cap">${caps.map(c => `<button data-cap="${c}" class="${gfx.fpsCap === c ? 'on' : ''}">${c === -1 ? 'Unlimited' : c}</button>`).join('')}</div>
              <div class="hint">Current: ${gfx.fpsCap == null ? 'not set yet (uses Roblox default)' : gfx.fpsCap === -1 ? 'Unlimited' : `${gfx.fpsCap} FPS`}</div></div>
            <div class="field"><label>Graphics quality</label>
              <div class="row"><div class="seg"><button data-q="0" class="${gfx.quality === 0 ? 'on' : ''}">Auto</button><button data-q="1" class="${gfx.quality === 1 ? 'on' : ''}">Low</button><button data-q="5" class="${gfx.quality === 5 ? 'on' : ''}">Medium</button><button data-q="10" class="${gfx.quality === 10 ? 'on' : ''}">High</button></div>
              <input type="range" min="0" max="10" step="1" id="g-q" value="${gfx.quality ?? 0}"><b id="g-qv">${gfx.quality == null ? '—' : gfx.quality || 'Auto'}</b></div>
              <div class="hint">${gfx.quality == null ? 'Change graphics once inside Roblox so this setting exists.' : '1 = lowest, 10 = highest.'}</div></div>
          </div>`;
        el.querySelectorAll('[data-cap]').forEach(b => b.onclick = () => setGfx({ fpsCap: Number(b.dataset.cap) }));
        el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => setGfx({ quality: Number(b.dataset.q) }));
        const r = el.querySelector('#g-q');
        if (r) { r.oninput = () => { el.querySelector('#g-qv').textContent = r.value === '0' ? 'Auto' : r.value; }; r.onchange = () => setGfx({ quality: Number(r.value) }); }
      };
      const setGfx = async (patch) => { const r = await MM.call('fps:setGraphics', patch); if (r) { MM.toast('success', 'Roblox settings saved', r.note || ''); renderGfx(); } };

      const renderProfiles = async () => {
        const p = await MM.call('fps:profiles') || {};
        MM.$('#p-profiles', root).innerHTML = Object.entries(p).map(([id, v]) => `<div class="item"><div class="grow"><div class="title">${MM.esc(v.label)}</div><div class="meta">Graphics ${v.quality || 'Auto'} · ${v.fpsCap === -1 ? 'Unlimited' : v.fpsCap + ' FPS'} · Trimmer ${v.trimmer ? 'on' : 'off'}${v.lowResource ? ' · Low-resource' : ''}</div></div><button class="btn sm" data-act="profile" data-id="${id}">Apply</button></div>`).join('');
      };

      const renderRecs = async () => {
        const r = await MM.call('system:recommendations') || [];
        const lvl = { warn: 'warn', ok: 'ok', info: '' };
        const act = { enableTrimmer: 'Turn on trimmer', graphicsLow: 'Set graphics Low', fpsCap60: 'Cap at 60 FPS', lowResource: 'Enable' };
        MM.$('#p-recs', root).innerHTML = r.map(x => `<div class="callout ${lvl[x.level] || ''}">${MM.icon(x.level === 'ok' ? 'circle-check' : x.level === 'warn' ? 'triangle-alert' : 'info')}<div>${MM.esc(x.text)}${x.action ? `<div style="margin-top:8px"><button class="btn sm" data-act="rec" data-rec="${x.action}">${act[x.action]}</button></div>` : ''}</div></div>`).join('');
      };

      const renderProcs = async () => {
        const list = await MM.call('system:processes') || [];
        MM.$('#p-procs', root).innerHTML = list.length ? `<table class="tbl"><thead><tr><th>Process</th><th>PID</th><th>Memory</th><th>CPU</th></tr></thead><tbody>${list.map(p => `<tr><td>${/roblox/i.test(p.name) ? `<b style="color:var(--lavender)">${MM.esc(p.name)}</b>` : MM.esc(p.name)}</td><td class="mono">${p.pid}</td><td>${MM.fmt.mb(p.memMB)}</td><td>${p.cpu}%</td></tr>`).join('')}</tbody></table>`
          : MM.empty('list', 'Process list unavailable', MM.state.info.native ? 'Waiting for data…' : 'Needs Windows.');
      };

      const PRI = { idle: 'Low', below: 'Below normal', normal: 'Normal', above: 'Above normal', high: 'High' };
      const renderLimiter = (s) => {
        if (!s) return;
        MM.$('#p-lim-state', root).innerHTML = `<span class="dot ${s.running ? 'live' : ''}"></span>${s.running ? 'Running' : 'Off'}`;
        const b = MM.$('#p-lim-btn', root);
        b.className = `btn big ${s.running ? 'danger' : 'primary'}`; b.disabled = !s.available; b.dataset.on = s.running ? '1' : '0';
        b.innerHTML = `${MM.icon(s.running ? 'square-stop' : 'play')}${s.running ? 'Stop limiter (restores normal priority)' : 'Start limiter'}`;
        MM.$('#p-lim-list', root).innerHTML = s.running && s.clients.length ? `<table class="tbl"><thead><tr><th>Client</th><th>Role</th><th>Priority</th><th>Cores</th><th>Sound</th></tr></thead><tbody>${s.clients.map(c => `<tr><td>${MM.esc(sessions.find(x => x.pid === c.pid)?.label || `PID ${c.pid}`)}</td><td>${c.pid === s.focusedPid ? '<span class="badge ok">In use</span>' : '<span class="badge dim">Background</span>'}</td><td>${PRI[c.priority] || c.priority}</td><td>${(c.mask.toString(2).match(/1/g) || []).length >= s.cores ? 'All' : (c.mask.toString(2).match(/1/g) || []).length}</td><td>${c.muted ? MM.icon('volume-x', 14) : '—'}</td></tr>`).join('')}</tbody></table>`
          + (s.lastError ? `<div class="callout warn" style="margin-top:10px">${MM.icon('triangle-alert')}<div>${MM.esc(s.lastError)}</div></div>` : '')
          + (s.config.muteBackground && s.audio.state === 'error' ? `<div class="callout err" style="margin-top:10px">${MM.icon('circle-alert')}<div>Muting unavailable: ${MM.esc(s.audio.lastError || '')}</div></div>` : '')
          : MM.empty('cpu', s.running ? 'No Roblox clients' : 'Limiter is off', s.running ? 'Clients appear here when they start.' : `${s.cores} logical cores detected. Start it to manage your clients.`);
      };

      MM.delegate(root, {
        limToggle: async (b) => { const s = await MM.busy(b, () => MM.call(MM.$('#p-lim-btn', root).dataset.on === '1' ? 'limiter:stop' : 'limiter:start')); renderLimiter(s); },
        pickPM: async () => { if (await MM.call('fps:pickPresentMon')) renderFps(await MM.call('fps:status')); },
        fpsStart: async () => renderFps(await MM.call('fps:start')),
        fpsStop: async () => renderFps(await MM.call('fps:stop')),
        pmLink: () => MM.call('app:openExternal', 'https://github.com/GameTechDev/PresentMon/releases'),
        profile: async (b) => { const r = await MM.busy(b, () => MM.call('fps:applyProfile', b.dataset.id)); if (r) { MM.toast('success', `${r.profile} applied`, r.steps.join(' · '), 7000); renderGfx(); renderRecs(); MM.bindSettings(root); } },
        rec: async (b) => {
          const a = b.dataset.rec;
          if (a === 'enableTrimmer') { if (await MM.call('trimmer:start')) MM.toast('success', 'RAM Trimmer started'); }
          if (a === 'graphicsLow') await setGfx({ quality: 1 });
          if (a === 'fpsCap60') await setGfx({ fpsCap: 60 });
          if (a === 'lowResource') { await MM.setSetting('performance.lowResourceMode', true); MM.$('[data-setting="performance.lowResourceMode"]', root).checked = true; }
          renderRecs();
        },
      });

      (async () => {
        caps = await MM.call('fps:caps') || [];
        renderGfx();
        hist = (await MM.call('system:history') || []).slice();
        onSample(await MM.call('system:latest'));
        sessions = await MM.call('sessions:list') || [];
        renderFps(await MM.call('fps:status'));
      })();
      renderProfiles(); renderRecs(); renderProcs();
      MM.call('limiter:status').then(renderLimiter);
      const t1 = setInterval(renderProcs, 3000), t2 = setInterval(renderRecs, 15000);
      const onResize = () => sparks();
      addEventListener('resize', onResize);
      const offs = [MM.on('limiter:update', renderLimiter), MM.on('system:sample', onSample), MM.on('fps:update', renderFps), MM.on('sessions:changed', l => { sessions = l; })];
      return () => { clearInterval(t1); clearInterval(t2); removeEventListener('resize', onResize); offs.forEach(f => f()); };
    },
  };
})();
