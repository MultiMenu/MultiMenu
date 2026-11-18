(function () {
  const MM = window.MM;
  const EV = {
    crash: ['err', 'circle-alert', 'Crash'], disconnect: ['warn', 'triangle-alert', 'Disconnect'], freeze: ['warn', 'timer', 'Freeze'],
    rejoin: ['ok', 'refresh-cw', 'Rejoin'], memory: ['warn', 'memory-stick', 'Memory'], scheduled: ['', 'clock', 'Scheduled'], gaveup: ['err', 'ban', 'Stopped'], skipped: ['', 'moon', 'Skipped'], failed: ['err', 'circle-alert', 'Launch failed'], waiting: ['warn', 'wifi-off', 'On hold'],
  };
  const hours = (ms) => (ms / 3600000);
  MM.pingCell = (ms) => (ms == null ? '<span class="dim">—</span>' : `<span class="ping ${ms < 120 ? 'good' : ms < 250 ? 'mid' : 'bad'}">${ms} ms</span>`);

  MM.pages.watcher = {
    render(root) {
      let sessions = [];
      root.innerHTML = `
        <div class="page-head"><div><h1>24/7 Watcher</h1><p>Keeps your accounts in game around the clock: detects crashes, disconnects and frozen clients, then rejoins — back into the same server when it can.</p></div>
          <div class="actions"><button class="btn" data-act="codes">${MM.icon('circle-help')}Error code guide</button><label class="toggle"><input type="checkbox" id="w-enabled"><span class="sw"></span><b>Watcher on</b></label></div></div>
        ${MM.winOnly()}
        <div class="row" id="w-pills" style="margin-bottom:16px"></div>
        <div class="grid g3">
          <div class="card span2"><h3>${MM.icon('radar')}Watched sessions<span class="right">${MM.icon('info', 13)}Toggle watching per session</span></h3><div id="w-sessions"></div></div>
          <div class="card"><h3>${MM.icon('clock')}Upcoming rejoins</h3><div class="list" id="w-pending"></div></div>
          <div class="card spanall" id="w-guards"><h3>${MM.icon('shield-check')}Reliability guards<span class="right" id="w-g-status"></span></h3>
            <div class="row" id="w-g-pills" style="margin-bottom:12px"></div>
            <div class="grid g3" style="gap:0 22px">
              <div>${MM.settingRow('Keep the PC awake', 'Stops Windows sleeping while Roblox clients are running. Your screen can still turn off.', MM.toggle('guards.keepAwake'))}
                ${MM.settingRow('Close crash pop-ups', 'Clicks away Roblox error boxes and the crash reporter so the watcher can restart the client.', MM.toggle('guards.closePopups'))}</div>
              <div>${MM.settingRow('Detect game updates', 'Notices when a game you\'re in publishes an update (old servers usually shut down soon after).', MM.toggle('guards.gameUpdates'))}
                ${MM.settingRow('Move clients to fresh servers', 'After an update, restarts clients that were on old servers, one at a time. Roblox also marks a game updated when its page is edited, so this can restart clients for nothing.', MM.toggle('guards.restartOnUpdate'))}</div>
              <div>${MM.settingRow('Ping monitor', 'Pings each client\'s game server every 30 seconds.', MM.toggle('guards.ping'))}
                <div class="field" style="margin-top:8px"><label>Warn when ping stays above (ms)</label><input class="input" type="number" min="80" max="2000" data-setting="guards.highPingMs"></div></div>
            </div>
            <p class="hint">Rejoins pause by themselves while your internet is down or Roblox reports a major outage (status.roblox.com), and carry on when things are back.</p>
          </div>
          <div class="card"><h3>${MM.icon('sliders-horizontal')}Detection</h3>
            ${MM.settingRow('Watch new sessions automatically', 'Every account you launch is watched unless you turn it off for that session.', MM.toggle('watcher.watchNewSessions'))}
            ${MM.settingRow('Rejoin the same server', 'Uses the server ID from Roblox\'s log. Falls back to the game if that server is gone.', MM.toggle('watcher.rejoinSameServer'))}
            ${MM.settingRow('Detect disconnects', 'Kicks, error 277 and server shutdowns, read from Roblox\'s log file.', MM.toggle('watcher.detectDisconnects'))}
            ${MM.settingRow('Detect frozen clients', 'When Windows reports the window as not responding.', MM.toggle('watcher.detectFreezes'))}
            ${MM.settingRow('Screenshot problems', 'Captures the error / frozen window before restarting it and attaches it to the Discord alert.', MM.toggle('watcher.screenshots'))}
            ${MM.settingRow('Detect stuck loading', 'Rejoins an alt that sits on the loading screen or a menu and never gets into a server.', MM.toggle('watcher.detectStuck'))}
            <div class="grid g2" style="margin-top:10px;gap:10px">
              <div class="field"><label>Treat as frozen after (seconds)</label><input class="input" type="number" min="30" max="1800" data-setting="watcher.freezeSec"></div>
              <div class="field"><label>Treat as stuck after (minutes)</label><input class="input" type="number" min="1" max="60" data-setting="watcher.stuckMin"></div>
            </div>
          </div>
          <div class="card"><h3>${MM.icon('route')}Retries</h3>
            <div class="form-grid" style="grid-template-columns:1fr 1fr">
              <div class="field"><label>Max rejoins per hour</label><input class="input" type="number" min="1" max="60" data-setting="watcher.maxPerHour"></div>
              <div class="field"><label>First retry after (s)</label><input class="input" type="number" min="3" max="600" data-setting="watcher.baseDelaySec"></div>
              <div class="field"><label>Longest wait (s)</label><input class="input" type="number" min="10" max="3600" data-setting="watcher.maxDelaySec"></div>
            </div>
            <p class="hint">Each failed attempt doubles the wait (10s → 20s → 40s …) up to the longest wait. After 10 stable minutes the count resets. If an account's login expires, the watcher stops for it and tells you.</p>
          </div>
          <div class="card"><h3>${MM.icon('moon')}Quiet hours</h3>
            ${MM.settingRow('Enable quiet hours', 'No rejoins during this window (e.g. overnight).', MM.toggle('schedule.quietHours.enabled'))}
            <div class="form-grid" style="grid-template-columns:1fr 1fr;margin-top:8px">
              <div class="field"><label>From</label><input class="input" type="time" data-setting="schedule.quietHours.start"></div>
              <div class="field"><label>To</label><input class="input" type="time" data-setting="schedule.quietHours.end"></div>
            </div>
          </div>
          <div class="card spanall" id="w-mem">
            <h3>${MM.icon('memory-stick')}Memory guard<span class="right">${MM.toggle('memGuard.enabled')}<b style="margin-left:6px">On</b></span></h3>
            <p class="sub">Roblox slowly uses more RAM over long sessions. The memory guard watches each client's trend and restarts one that's leaking or too big — back into the same server — one at a time, never the window you're using.</p>
            <div class="tile-wrap" style="grid-template-columns:minmax(0,1fr) minmax(0,1.6fr)">
              <div>
                <div class="form-grid" style="grid-template-columns:1fr 1fr">
                  <div class="field"><label>Restart above (MB)</label><input class="input" type="number" min="800" max="16000" data-setting="memGuard.maxMB"></div>
                  <div class="field"><label>…or growing faster than (MB/hour)</label><input class="input" type="number" min="50" max="5000" data-setting="memGuard.leakMBPerHour"></div>
                  <div class="field"><label>Don't restart in the first (minutes)</label><input class="input" type="number" min="5" max="600" data-setting="memGuard.minUptimeMin"></div>
                </div>
                ${MM.settingRow('Never restart the window I\'m using', 'Waits until you switch away.', MM.toggle('memGuard.avoidFocused'))}
                ${MM.settingRow('Only watched sessions', 'Ignore sessions with the 24/7 Watcher turned off.', MM.toggle('memGuard.watchedOnly'))}
              </div>
              <div><div id="w-mem-list"></div><div id="w-mem-recent" style="margin-top:10px"></div></div>
            </div>
          </div>
          <div class="card span2"><h3>${MM.icon('chart-column')}Last 7 days<span class="right legend"><span><i style="background:${MM.accent()}"></i>Uptime (h)</span><span><i style="background:#fbbf24"></i>Problems</span><span><i style="background:#34d399"></i>Rejoins</span></span></h3><canvas class="chart" id="w-chart"></canvas></div>
          <div class="card"><h3>${MM.icon('history')}Event log<span class="right"><button class="btn sm ghost" data-act="clear">Clear history</button></span></h3><div class="list ev-list" id="w-events"></div></div>
          <div class="card spanall"><h3>${MM.icon('users')}Per account (7 days)</h3><div id="w-accounts"></div></div>
        </div>`;
      MM.bindSettings(root);
      const en = MM.$('#w-enabled', root);

      const renderStatus = (s) => {
        if (!s) return;
        en.checked = s.enabled;
        MM.$('#w-pills', root).innerHTML = `
          <div class="statpill"><b style="color:${s.enabled ? 'var(--ok)' : 'var(--dim)'}">${s.enabled ? 'ON' : 'OFF'}</b><span>Watcher</span></div>
          <div class="statpill"><b>${s.watched}</b><span>sessions watched</span></div>
          <div class="statpill"><b>${s.pending.length}</b><span>rejoins queued</span></div>
          <div class="statpill"><b style="color:${s.quiet ? 'var(--warn)' : 'var(--dim)'}">${s.quiet ? 'Quiet' : 'Active'}</b><span>${s.quiet ? 'quiet hours now' : 'rejoins allowed'}</span></div>`;
        MM.$('#w-pending', root).innerHTML = s.pending.length ? s.pending.map(p => `<div class="item" data-pid="${MM.esc(p.id)}">${MM.icon('refresh-cw')}<div class="grow"><div class="title">${MM.esc(p.label)}</div><div class="meta">${MM.esc(p.reason)} · ${p.sameServer ? 'same server' : 'same game'} · in ${MM.fmt.dur(p.at - Date.now())}</div></div><button class="btn sm ghost" data-act="cancel">Cancel</button></div>`).join('')
          : MM.empty('clock', 'Nothing queued', s.enabled ? 'Problems trigger a rejoin here.' : 'Turn the watcher on to auto-rejoin.');
      };

      const renderSessions = (list) => {
        sessions = list || sessions;
        const rows = sessions.filter(s => !s.external && ['running', 'launching'].includes(s.status));
        MM.$('#w-sessions', root).innerHTML = rows.length ? `<table class="tbl"><thead><tr><th>Watch</th><th>Session</th><th>State</th><th>Server</th><th>Ping</th><th>Uptime</th><th></th></tr></thead><tbody>${rows.map(s => `<tr data-id="${MM.esc(s.id)}">
            <td><label class="toggle"><input type="checkbox" data-watch ${s.watch ? 'checked' : ''}><span class="sw"></span></label></td>
            <td><div class="row nowrap">${MM.avatar(s.avatarUrl, s.label, 'sm')}<b>${MM.esc(s.label)}</b></div></td>
            <td>${s.status === 'launching' ? '<span class="badge warn">Launching</span>' : !s.watch ? '<span class="badge dim">Not watched</span>' : s.watchState === 'not responding' ? '<span class="badge err">Not responding</span>' : s.watchState === 'in game' ? '<span class="badge ok">In game</span>' : '<span class="badge">Loading</span>'}</td>
            <td class="mono small">${s.jobId ? MM.esc(s.jobId.slice(0, 8)) + '…' : '—'}</td>
            <td>${MM.pingCell(s.ping)}</td>
            <td>${s.status === 'running' ? MM.fmt.dur(Date.now() - s.startedAt) : '—'}</td>
            <td><button class="btn sm" data-act="log" ${s.hasLog ? '' : 'disabled title="Log appears a few seconds after start"'}>${MM.icon('scroll-text', 14)}Log</button></td></tr>`).join('')}</tbody></table>`
          : MM.empty('radar', 'No sessions running', 'Launch accounts from OpenMulti or a preset — they show up here.');
      };

      const renderHistory = async () => {
        const s = await MM.call('watcher:stats', 7);
        if (!s) return;
        const labels = s.days.map(d => new Date(d.day + 'T12:00').toLocaleDateString(MM.loc(), { weekday: 'short' }));
        MM.bars(MM.$('#w-chart', root), labels, [
          { data: s.days.map(d => +hours(d.uptimeMs).toFixed(1)), color: MM.accent(), fade: MM.accent(0.25) },
          { data: s.days.map(d => d.crashes + d.disconnects + d.freezes), color: '#fbbf24', fade: 'rgba(251,191,36,.2)' },
          { data: s.days.map(d => d.rejoins), color: '#34d399', fade: 'rgba(52,211,153,.2)' },
        ]);
        const accs = Object.values(s.accounts).sort((a, b) => b.uptimeMs - a.uptimeMs);
        MM.$('#w-accounts', root).innerHTML = accs.length ? `<table class="tbl"><thead><tr><th>Account</th><th>Uptime</th><th>Launches</th><th>Crashes</th><th>Disconnects</th><th>Freezes</th><th>Rejoins</th><th>Stability</th></tr></thead><tbody>${accs.map(a => {
          const problems = a.crashes + a.disconnects + a.freezes, perDay = problems / Math.max(1, hours(a.uptimeMs) / 24);
          return `<tr><td><b>${MM.esc(a.label)}</b></td><td>${hours(a.uptimeMs).toFixed(1)} h</td><td>${a.launches}</td><td>${a.crashes}</td><td>${a.disconnects}</td><td>${a.freezes}</td><td>${a.rejoins}</td>
          <td><span class="badge ${problems === 0 ? 'ok' : perDay < 3 ? 'warn' : 'err'}">${problems === 0 ? 'Rock solid' : `${perDay.toFixed(1)} issues/day`}</span></td></tr>`;
        }).join('')}</tbody></table>` : MM.empty('chart-column', 'No history yet', 'Uptime and problems are recorded while accounts run.');
      };

      const renderEvents = async () => {
        const ev = await MM.call('watcher:events') || [];
        MM.$('#w-events', root).innerHTML = ev.length ? ev.slice(0, 60).map(e => { const [c, ic, t] = EV[e.type] || ['', 'info', e.type]; return `<div class="item"><span class="badge ${c}">${MM.icon(ic, 12)}${t}</span><div class="grow"><div class="title">${MM.esc(e.account || '')}</div><div class="meta">${MM.esc(e.detail || '')}</div>${e.action ? `<div class="meta" style="color:var(--lavender)">→ ${MM.esc(e.action)}</div>` : ''}${e.hint ? `<div class="meta" style="color:var(--warn)">${MM.esc(e.hint)}</div>` : ''}</div>${e.shot ? `<button class="btn sm icon" data-act="shot" data-shot="${MM.esc(e.shot)}" title="View screenshot">${MM.icon('eye', 13)}</button>` : ''}<span class="small dim">${MM.fmt.clock(e.at)}</span></div>`; }).join('')
          : MM.empty('history', 'No events yet', 'Crashes, disconnects and rejoins are logged here.');
      };

      const renderMem = (m) => {
        if (!m) return;
        MM.$('#w-mem-list', root).innerHTML = m.clients.length ? `<table class="tbl"><thead><tr><th>Client</th><th>RAM</th><th>Trend (last hour)</th><th>Growth</th><th>Status</th><th></th></tr></thead><tbody>${m.clients.map(c => `<tr data-id="${MM.esc(c.id)}">
            <td><b>${MM.esc(c.label)}</b></td><td>${MM.fmt.mb(c.mb)}</td>
            <td><canvas class="spark" data-spark="${MM.esc(JSON.stringify(c.spark))}" style="height:28px;width:140px"></canvas></td>
            <td>${c.samples >= 20 ? `${c.slope > 0 ? '+' : ''}${c.slope} MB/h` : `<span class="dim">collecting (${c.samples}/20)</span>`}</td>
            <td>${c.flagged ? `<span class="badge warn" title="${MM.esc(c.flagged)}">Restart due</span>` : c.mb >= m.config.maxMB * 0.8 ? '<span class="badge warn">High</span>' : '<span class="badge ok">OK</span>'}</td>
            <td><button class="btn sm" data-act="memRestart">${MM.icon('refresh-cw', 13)}Restart</button></td></tr>`).join('')}</tbody></table>`
          : MM.empty('memory-stick', 'No clients running', 'RAM trends appear here a minute after clients start.');
        MM.$$('[data-spark]', root).forEach(cv => { const d = JSON.parse(cv.dataset.spark); MM.chart(cv, [{ data: d, color: MM.accent(), fill: MM.accent(0.25) }], { max: Math.max(1000, ...d) * 1.1, grid: false }); });
        MM.$('#w-mem-recent', root).innerHTML = m.recent.length ? `<div class="lbl" style="margin-bottom:6px">Recent restarts</div>${m.recent.slice(0, 5).map(r => `<div class="small muted">${MM.fmt.clock(r.at)} · <b>${MM.esc(r.label)}</b> — ${MM.esc(r.reason)}</div>`).join('')}` : '';
      };
      const renderGuards = (g) => {
        if (!g) return;
        const rb = g.roblox || {};
        const rbTxt = { none: ['ok', 'All systems operational'], minor: ['warn', 'Minor issues'], major: ['err', 'Major outage'], critical: ['err', 'Critical outage'], unknown: ['dim', 'Unknown'] }[rb.indicator] || ['dim', rb.indicator];
        MM.$('#w-g-pills', root).innerHTML = `
          <div class="statpill"><b style="color:${g.online ? 'var(--ok)' : 'var(--err)'}">${g.online ? 'Online' : 'Offline'}</b><span>${g.online ? 'internet' : `since ${MM.fmt.clock(g.offlineSince)}`}</span></div>
          <div class="statpill" title="${MM.esc(rb.description || '')}"><b style="color:var(--${rbTxt[0] === 'dim' ? 'dim' : rbTxt[0]})">${MM.esc(rbTxt[1])}</b><span>Roblox status</span></div>
          <div class="statpill"><b style="color:${g.keepingAwake ? 'var(--ok)' : 'var(--dim)'}">${g.keepingAwake ? 'Awake' : 'Normal'}</b><span>PC sleep</span></div>
          <div class="statpill"><b>${g.popupsClosed}</b><span>pop-ups closed${g.lastPopupAt ? ` · last ${MM.fmt.ago(g.lastPopupAt)}` : ''}</span></div>
          <div class="statpill"><b>${g.games.length}</b><span>games watched for updates</span></div>`;
        MM.$('#w-g-status', root).innerHTML = g.blocked ? `<span class="badge warn">${MM.icon('wifi-off', 12)}Rejoins paused: ${MM.esc(g.blocked)}</span>` : '';
      };
      MM.call('guards:status').then(renderGuards);
      MM.call('memguard:status').then(renderMem);
      const tm = setInterval(() => MM.call('memguard:status').then(renderMem), 30000);

      en.addEventListener('change', async () => {
        const r = await MM.call('watcher:enable', en.checked);
        if (r) { renderStatus(r); MM.state.settings.watcher.enabled = r.enabled; MM.toast(r.enabled ? 'success' : 'info', r.enabled ? '24/7 Watcher is on' : '24/7 Watcher is off'); }
      });
      root.addEventListener('change', (e) => {
        if (!e.target.matches('[data-watch]')) return;
        MM.call('sessions:setWatch', e.target.closest('[data-id]').dataset.id, e.target.checked);
      });
      MM.delegate(root, {
        cancel: async (b) => { await MM.call('watcher:cancel', b.closest('[data-pid]').dataset.pid); renderStatus(await MM.call('watcher:status')); },
        log: (b) => { const id = b.closest('[data-id]').dataset.id; MM.showSessionLog(id, sessions.find(s => s.id === id)?.label || ''); },
        shot: async (b) => {
          const url = await MM.call('watcher:shot', b.dataset.shot);
          if (url) MM.modal({ title: 'Screenshot at the moment of the problem', icon: 'eye', wide: true, body: `<img src="${MM.esc(url)}" alt="" style="width:100%;border-radius:10px;border:1px solid var(--border)">`, buttons: [{ label: 'Open folder', value: 'f', cls: 'ghost', handler: () => { MM.call('watcher:openShots'); } }, { label: 'Close', value: null }] });
        },
        memRestart: async (b) => { const id = b.closest('[data-id]').dataset.id; if (await MM.confirm('Restart this client now?', 'It closes and rejoins the same server.', { ok: 'Restart' })) { await MM.call('memguard:restart', id); MM.toast('info', 'Restarting client'); } },
        codes: async () => {
          const list = await MM.call('errors:all') || [];
          const cls = { rejoin: 'ok', newServer: '', slow: 'warn', stop: 'err' };
          MM.modal({ title: 'Roblox error codes', icon: 'circle-help', wide: true, desc: 'What each disconnect means and what the 24/7 Watcher does about it.',
            body: `<div style="max-height:60vh;overflow:auto"><table class="tbl"><thead><tr><th>Code</th><th>Meaning</th><th>Watcher</th></tr></thead><tbody>${list.map(e => `<tr><td><b>${e.code}</b></td><td><b>${MM.esc(e.title)}</b><div class="small muted">${MM.esc(e.meaning)}</div>${e.hint ? `<div class="small" style="color:var(--warn)">${MM.esc(e.hint)}</div>` : ''}</td><td><span class="badge ${cls[e.action]}">${MM.esc(e.actionText)}</span></td></tr>`).join('')}</tbody></table></div>` });
        },
        clear: async () => { if (await MM.confirm('Clear watcher history?', 'Uptime stats and the event log are deleted.', { danger: true, ok: 'Clear' })) { await MM.call('watcher:clearStats'); renderHistory(); renderEvents(); } },
      });

      MM.call('watcher:status').then(renderStatus);
      MM.call('sessions:list').then(renderSessions);
      renderHistory(); renderEvents();
      const t1 = setInterval(() => { MM.call('watcher:status').then(renderStatus); }, 3000);
      const t2 = setInterval(() => { renderHistory(); renderEvents(); }, 30000);
      const offs = [MM.on('watcher:update', (s) => { renderStatus(s); renderEvents(); }), MM.on('sessions:changed', renderSessions), MM.on('sessions:stats', renderSessions), MM.on('guards:update', renderGuards)];
      return () => { clearInterval(t1); clearInterval(t2); clearInterval(tm); offs.forEach(f => f()); };
    },
  };
})();
