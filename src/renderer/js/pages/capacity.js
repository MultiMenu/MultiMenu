(function () {
  const MM = window.MM;

  MM.pages.capacity = {
    render(root) {
      let st = null, picker = null;
      root.innerHTML = `
        <div class="page-head"><div><h1>PC capacity test</h1><p>How many Roblox clients can this PC really run? Get a quick estimate from what's running now, or run a live test.</p></div></div>
        ${MM.winOnly()}
        <div class="grid g3">
          <div class="card"><h3>${MM.icon('gauge')}Quick estimate</h3><div id="cp-est"></div></div>
          <div class="card span2"><h3>${MM.icon('flask-conical')}Live test</h3>
            <p class="sub">Launches the accounts you pick one at a time, waits for each to load, measures, and stops as soon as RAM reaches 85%, CPU 90% or GPU 95%. Use a busy game for a realistic number. Clients opened for the test are closed afterwards.</p>
            <div class="lbl" style="margin-bottom:6px">Accounts to use</div><div class="chips" id="cp-acc"></div>
            <div class="grid cols-2" style="margin-top:12px">
              <div class="field"><label>Game (place ID or link)</label><input class="input" id="cp-game" placeholder="e.g. 920587237"></div>
              <div class="field"><label>Settle time per client (seconds)</label><input class="input" type="number" id="cp-settle" min="30" max="180" value="60"></div>
            </div>
            <label class="toggle" style="margin:6px 0 12px"><input type="checkbox" id="cp-close" checked><span class="sw"></span>Close the test clients when finished</label>
            <div class="row"><button class="btn primary" data-act="run">${MM.icon('play')}Start test</button><button class="btn" data-act="stop">${MM.icon('square-stop')}Stop</button><span class="small muted" id="cp-msg"></span></div>
          </div>
          <div class="card spanall"><h3>${MM.icon('activity')}Results</h3><div id="cp-res"></div><canvas class="chart" id="cp-chart" style="margin-top:12px"></canvas></div>
        </div>`;

      const renderEst = (e) => {
        const el = MM.$('#cp-est', root);
        if (!e || e.possible == null) { el.innerHTML = MM.empty('gauge', 'Nothing to measure yet', e?.reason || ''); return; }
        el.innerHTML = `<div class="cap-big">~${e.possible}</div><div class="muted">clients in total (you're running ${e.current})</div>
          <div class="lbl" style="margin:14px 0 6px">Limited by</div><span class="badge warn">${MM.esc(e.limitedBy)}</span>
          <div class="small muted" style="margin-top:12px">${e.perClient.gpu != null ? `Each client uses about ${MM.fmt.mb(e.perClient.memMB)} RAM, ${e.perClient.cpu}% CPU and ${e.perClient.gpu}% GPU.` : `Each client uses about ${MM.fmt.mb(e.perClient.memMB)} RAM and ${e.perClient.cpu}% CPU.`}<br>RAM allows ${e.byRam}, CPU ${e.byCpu}${e.byGpu != null ? `, GPU ${e.byGpu}` : ''}.</div>
          <p class="hint">Rough estimate: clients that are loading or in a busy area use more. Lower graphics (Performance → profiles) and the RAM Trimmer raise the limit.</p>`;
      };

      const renderTest = (t) => {
        MM.$('#cp-msg', root).textContent = t.running ? t.message : '';
        MM.$('[data-act="run"]', root).disabled = t.running;
        MM.$('[data-act="stop"]', root).disabled = !t.running;
        const res = t.result;
        MM.$('#cp-res', root).innerHTML = (res ? `<div class="callout ${res.limitedBy ? 'warn' : 'ok'}" style="margin-bottom:12px">${MM.icon(res.limitedBy ? 'triangle-alert' : 'circle-check')}<div><b>Your PC comfortably runs ${res.maxClients} client${res.maxClients === 1 ? '' : 's'}.</b> ${res.limitedBy ? `${MM.esc(res.limitedBy)} hit its limit at ${res.reachedAt} clients.` : MM.esc(res.note || '')}</div></div>` : '')
          + (t.steps.length ? `<table class="tbl"><thead><tr><th>Clients</th><th>RAM</th><th>CPU</th><th>GPU</th></tr></thead><tbody>${t.steps.map(s => `<tr><td><b>${s.clients}</b></td><td>${s.ram}%</td><td>${s.cpu}%</td><td>${s.gpu == null ? '—' : `${s.gpu}%`}</td></tr>`).join('')}</tbody></table>`
            : MM.empty('flask-conical', 'No test run yet', 'Results from your last test appear here.'));
        const cv = MM.$('#cp-chart', root);
        cv.style.display = t.steps.length > 1 ? '' : 'none';
        if (t.steps.length > 1) MM.chart(cv, [{ data: t.steps.map(s => s.ram), color: MM.accent(), fill: MM.accent(0.2) }, { data: t.steps.map(s => s.cpu), color: '#fbbf24' }, ...(t.steps.some(s => s.gpu != null) ? [{ data: t.steps.map(s => s.gpu), color: '#34d399' }] : [])], { max: 100 });
      };

      const apply = (s) => { if (!s) return; st = s; renderEst(s.estimate); renderTest(s.test); };

      MM.call('accounts:list').then(r => {
        const accs = (r?.accounts || []).filter(a => a.status !== 'expired');
        picker = MM.accountPicker(MM.$('#cp-acc', root), accs, { selected: accs.slice(0, 8).map(a => a.id) });
      });
      MM.$('#cp-game', root).value = MM.getSetting('accounts.defaultPlaceId') || '';
      MM.delegate(root, {
        run: async () => {
          const ids = picker ? picker.get() : [];
          const game = MM.$('#cp-game', root).value.trim();
          if (ids.length < 2) return MM.toast('warn', 'Pick at least two accounts');
          if (!game) return MM.toast('warn', 'Choose a game to test with');
          if (!(await MM.confirm('Start the capacity test?', `MultiMenu will open up to ${ids.length} Roblox clients one by one. Your PC may get slow near the end — that's the point. You can stop at any time.`, { ok: 'Start test' }))) return;
          await MM.call('capacity:run', ids, game, { closeAfter: MM.$('#cp-close', root).checked, settleSec: Number(MM.$('#cp-settle', root).value) });
        },
        stop: () => MM.call('capacity:cancel'),
      });
      MM.call('capacity:status').then(apply);
      const t = setInterval(() => { if (!st?.test.running) MM.call('capacity:status').then(apply); }, 5000);
      const off = MM.on('capacity:update', apply);
      return () => { clearInterval(t); off(); };
    },
  };
})();
