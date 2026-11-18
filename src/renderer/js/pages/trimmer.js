(function () {
  const MM = window.MM;

  MM.pages.trimmer = {
    render(root) {
      root.innerHTML = `
        <div class="page-head"><div><h1>RAM Trimmer</h1><p>Frees memory that Roblox and other apps are holding but not using, on a timer you choose. Nothing is ever closed.</p></div></div>
        ${MM.winOnly()}
        <div class="grid g3">
          <div class="card" id="t-ctl"></div>
          <div class="card span2">
            <h3>${MM.icon('sliders-horizontal')}Settings</h3>
            <div class="form-grid">
              <div class="field"><label>Run every (seconds)</label><input class="input" type="number" min="10" max="3600" data-setting="ramTrimmer.intervalSec"></div>
              <div class="field"><label>Only when system RAM is above (%)</label><input class="input" type="number" min="0" max="99" data-setting="ramTrimmer.onlyAboveSystemPercent"><span class="hint">0 = always run</span></div>
              <div class="field"><label>Skip processes using less than (MB)</label><input class="input" type="number" min="0" max="10000" data-setting="ramTrimmer.minWorkingSetMB"></div>
              <div class="field" style="grid-column:span 2"><label>What to trim</label><select class="input" data-setting="ramTrimmer.mode"><option value="targets">Only the processes listed below</option><option value="all">Every process I'm allowed to trim</option></select></div>
            </div>
            <div class="field" style="margin-top:14px"><label>Target processes (comma separated)</label><input class="input" data-setting="ramTrimmer.targets" placeholder="RobloxPlayerBeta.exe, chrome.exe"></div>
            <div class="setting-row"><div class="txt"><b>Trim a Roblox client as soon as it uses more than</b><span>Checks every 5 seconds while the trimmer runs, so a client that balloons doesn't wait for the next run. 350 MB is a good start. 0 = off.</span></div><div class="ctl"><input class="input sm" type="number" min="0" max="8000" step="50" style="width:84px" data-setting="ramTrimmer.watchMB"><span class="small muted">MB</span></div></div>
            ${MM.settingRow('Start the trimmer when MultiMenu opens', 'Begins trimming automatically at startup.', MM.toggle('ramTrimmer.startWithApp'))}
            <div class="callout" style="margin-top:6px">${MM.icon('shield-check')}<div>Windows and security processes (csrss, lsass, svchost, dwm, Defender and others) are always skipped. Trimming only asks Windows to move unused memory out; the app keeps running and reloads anything it needs.</div></div>
          </div>
          <div class="card span2"><h3>${MM.icon('history')}Last run<span class="right" id="t-lastinfo"></span></h3><div id="t-results"></div></div>
          <div class="card"><h3>${MM.icon('search')}Will be trimmed next<span class="right"><button class="btn sm ghost" data-act="preview">Refresh</button></span></h3><div class="list" id="t-preview"></div></div>
        </div>`;
      MM.bindSettings(root);

      const render = (s) => {
        if (!s) return;
        MM.$('#t-ctl', root).innerHTML = `<h3>${MM.icon('memory-stick')}Status</h3>
          <div class="row"><span class="dot ${s.running ? 'live' : ''}"></span><b style="font-size:16px">${s.running ? 'Running' : 'Stopped'}</b><span class="spacer"></span>${s.nextRun ? `<span class="small muted">next in ${MM.fmt.dur(s.nextRun - Date.now())}</span>` : ''}</div>
          <div class="grid g2" style="margin:16px 0"><div class="stat"><div class="label">Freed total</div><div class="value">${MM.fmt.mb(s.totalFreedMB)}</div></div><div class="stat"><div class="label">Runs</div><div class="value">${s.runs}${s.watchTrims ? `<small>+${s.watchTrims} over limit</small>` : ''}</div></div></div>
          ${s.lastError ? `<div class="callout err" style="margin-bottom:12px">${MM.icon('circle-alert')}<div>${MM.esc(s.lastError)}</div></div>` : ''}
          ${s.skipped ? `<div class="callout" style="margin-bottom:12px">${MM.icon('info')}<div>${MM.esc(s.skipped)}</div></div>` : ''}
          <button class="btn ${s.running ? 'danger' : 'primary'} big-toggle" data-act="${s.running ? 'stop' : 'start'}" ${s.available ? '' : 'disabled'}>${MM.icon(s.running ? 'square-stop' : 'play', 20)}${s.running ? 'Stop trimmer' : 'Start trimmer'}</button>
          <button class="btn" style="width:100%;margin-top:10px" data-act="now" ${s.available ? '' : 'disabled'}>${MM.icon('zap')}Trim once now</button>`;
        MM.$('#t-lastinfo', root).textContent = s.lastRun ? `${MM.fmt.ago(s.lastRun)} · freed ${MM.fmt.mb(s.lastFreedMB)}` : '';
        const r = s.lastResults || [];
        MM.$('#t-results', root).innerHTML = r.length ? `<table class="tbl"><thead><tr><th>Process</th><th>PID</th><th>Before</th><th>After</th><th>Freed</th><th></th></tr></thead><tbody>${r.map(x => `<tr><td>${MM.esc(x.name)}</td><td class="mono">${x.pid}</td><td>${MM.fmt.mb(x.beforeMB)}</td><td>${MM.fmt.mb(x.afterMB)}</td><td><b style="color:var(--ok)">${MM.fmt.mb(x.freedMB)}</b></td><td>${x.ok ? '<span class="badge ok">OK</span>' : `<span class="badge err" title="${MM.esc(x.error)}">Denied</span>`}</td></tr>`).join('')}</tbody></table>`
          : MM.empty('memory-stick', 'No runs yet', 'Start the trimmer or trim once to see results.');
      };

      const preview = async () => {
        const list = await MM.call('trimmer:preview') || [];
        MM.$('#t-preview', root).innerHTML = list.length ? list.slice(0, 20).map(p => `<div class="item"><div class="grow"><div class="title">${MM.esc(p.name)}</div><div class="meta">PID ${p.pid}</div></div><b>${MM.fmt.mb(p.memMB)}</b></div>`).join('')
          : MM.empty('search', 'Nothing matches', 'No running process matches your targets and size limit.');
      };

      MM.delegate(root, {
        start: async (b) => render(await MM.busy(b, () => MM.call('trimmer:start'))),
        stop: async (b) => render(await MM.busy(b, () => MM.call('trimmer:stop'))),
        now: async (b) => { const s = await MM.busy(b, () => MM.call('trimmer:trimNow')); if (s) { render(s); MM.toast('success', 'Trim complete', `Freed ${MM.fmt.mb(s.lastFreedMB)}`); } },
        preview,
      });
      const onSet = (e) => { if (e.detail.key.startsWith('ramTrimmer.')) preview(); };
      document.addEventListener('mm:setting', onSet);
      MM.call('trimmer:status').then(render);
      preview();
      const off = MM.on('trimmer:update', render);
      const tick = setInterval(() => MM.call('trimmer:status').then(render), 5000);
      return () => { off(); clearInterval(tick); document.removeEventListener('mm:setting', onSet); };
    },
  };
})();
