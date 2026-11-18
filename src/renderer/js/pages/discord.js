(function () {
  const MM = window.MM;

  MM.pages.discord = {
    render(root) {
      root.innerHTML = `
        <div class="page-head"><div><h1>Discord notifications</h1><p>Get purple embeds in your Discord server when sessions launch, close or crash, and when something needs attention.</p></div>
          <div class="actions"><label class="toggle"><input type="checkbox" data-setting="discord.enabled"><span class="sw"></span><span>Notifications on</span></label></div></div>
        <div class="grid g3">
          <div class="card span2"><h3>${MM.icon('webhook')}Webhooks</h3>
            <div class="row nowrap" style="margin-bottom:12px">
              <input class="input" id="wh-name" placeholder="Name (e.g. Alerts)" style="max-width:180px" maxlength="40">
              <input class="input" id="wh-url" placeholder="https://discord.com/api/webhooks/…" spellcheck="false">
              <button class="btn primary" data-act="add">${MM.icon('plus')}Add</button>
            </div>
            <div class="secret-note" style="margin-bottom:12px">${MM.icon('shield-check', 14)}Webhook URLs are encrypted on this PC and only shown masked.</div>
            <div class="list" id="wh-list"></div>
          </div>
          <div class="card"><h3>${MM.icon('sliders-horizontal')}Delivery</h3>
            <div class="field"><label>Cooldown for repeated events (seconds)</label><input class="input" type="number" min="0" max="3600" data-setting="discord.cooldownSec"><span class="hint">The same event for the same account isn't sent twice within this time.</span></div>
            <div class="field" style="margin-top:12px"><label>Mention (optional)</label><input class="input" data-setting="discord.mention" placeholder="<@123…> or <@&roleId>"><span class="hint">Pings only that user or role. @everyone is never sent.</span></div>
            <div class="callout" style="margin-top:14px">${MM.icon('shield-check')}<div>Embeds contain only the account label, event, status, time and error text. Passwords, cookies and tokens are never sent.</div></div>
          </div>
          <div class="card"><h3>${MM.icon('bell')}Events to send</h3><div id="wh-events"></div></div>
          <div class="card span2" id="rc-card"></div>
          <div class="card" id="dr-card">
            <h3>${MM.icon('chart-column')}Daily report</h3>
            <p class="sub">Once a day, a summary to your webhooks: uptime, problems and rejoins per account, plus Robux and how much it changed.</p>
            ${MM.settingRow('Send a daily report', '', MM.toggle('report.enabled'))}
            <div class="field" style="margin:8px 0 12px"><label>Send at</label><input class="input" type="time" data-setting="report.time"></div>
            <button class="btn" data-act="reportNow">${MM.icon('send')}Send one now</button>
            <div class="small dim" id="dr-last" style="margin-top:8px"></div>
          </div>
          <div class="card" id="rp-card">
            <h3>${MM.icon('gamepad-2')}Discord status<span class="right"><span id="rp-state" style="margin-right:8px"></span>${MM.toggle('richPresence.enabled')}</span></h3>
            <p class="sub">While alts are running, your Discord profile shows "Playing MultiMenu" with how many are running and the game. Account names are never shown. It needs the Discord app open on this PC; nothing goes over the internet from MultiMenu.</p>
            <div class="rp-preview" id="rp-preview"></div>
            ${MM.settingRow('Show how many alts', 'Off: "Running Roblox alts" instead of the number.', MM.toggle('richPresence.showCount'))}
            ${MM.settingRow('Show the game', 'Off: the game\'s name never shows.', MM.toggle('richPresence.showGame'))}
            <div class="form-grid"><div class="field"><label>Your own first line</label><input class="input" maxlength="100" placeholder="Running {count} alts" data-setting="richPresence.details"></div><div class="field"><label>Your own second line</label><input class="input" maxlength="100" placeholder="In {game}" data-setting="richPresence.state"></div></div>
            <p class="hint">Leave a line empty for the usual text. ${'{count}'} becomes the number of alts and ${'{game}'} the game, unless you hid them above.</p>
            <p class="hint">To hide all your activity on Discord, use Discord's own setting: User Settings → Activity Privacy.</p>
          </div>
          <div class="card span2"><h3>${MM.icon('history')}History<span class="right"><button class="btn sm ghost" data-act="clearHist">Clear</button></span></h3><div id="wh-hist"></div></div>
        </div>`;
      MM.bindSettings(root);

      const renderHooks = (list) => {
        MM.$('#wh-list', root).innerHTML = (list || []).length ? list.map(h => `<div class="item" data-id="${MM.esc(h.id)}">${MM.icon('webhook')}<div class="grow"><div class="title">${MM.esc(h.name)}</div><div class="meta mono">${MM.esc(h.masked)}</div></div>
          <label class="toggle"><input type="checkbox" data-hook-toggle ${h.enabled ? 'checked' : ''}><span class="sw"></span></label>
          <button class="btn sm" data-act="test">${MM.icon('send', 14)}Test</button>
          <button class="btn sm icon danger" data-act="remove" title="Remove">${MM.icon('trash-2', 14)}</button></div>`).join('')
          : MM.empty('webhook', 'No webhooks yet', 'In Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy URL.');
      };

      const renderEvents = async () => {
        const ev = await MM.call('discord:events') || {};
        MM.$('#wh-events', root).innerHTML = Object.entries(ev).map(([k, t]) => MM.settingRow(t, '', MM.toggle(`discord.events.${k}`))).join('');
        MM.bindSettings(MM.$('#wh-events', root));
      };

      const renderHist = async () => {
        const h = await MM.call('discord:history') || [];
        MM.$('#wh-hist', root).innerHTML = h.length ? `<table class="tbl"><thead><tr><th>Time</th><th>Event</th><th>Account</th><th>Result</th></tr></thead><tbody>${h.slice(0, 60).map(x => `<tr><td>${MM.esc(MM.fmt.date(x.at))}</td><td>${MM.esc(x.title)}</td><td>${MM.esc(x.account || '—')}</td><td>${x.ok ? '<span class="badge ok">Delivered</span>' : `<span class="badge err" title="${MM.esc(x.results.filter(r => !r.ok).map(r => `${r.hook}: ${r.error}`).join('; '))}">Failed</span>`}</td></tr>`).join('')}</tbody></table>`
          : MM.empty('history', 'Nothing sent yet', 'Delivered and failed notifications are listed here.');
      };

      root.addEventListener('change', async (e) => {
        if (!e.target.matches('[data-hook-toggle]')) return;
        const id = e.target.closest('[data-id]').dataset.id;
        renderHooks(await MM.call('discord:update', id, { enabled: e.target.checked }));
      });

      MM.delegate(root, {
        add: async (b) => {
          const url = MM.$('#wh-url', root), name = MM.$('#wh-name', root);
          const r = await MM.busy(b, () => MM.call('discord:add', name.value || 'Webhook', url.value));
          if (r) { url.value = ''; name.value = ''; renderHooks(r); MM.toast('success', 'Webhook added', 'Press Test to check it.'); if (!MM.getSetting('discord.enabled')) { await MM.setSetting('discord.enabled', true); MM.bindSettings(root.querySelector('.page-head')); } }
        },
        test: async (b) => {
          const r = await MM.busy(b, () => MM.call('discord:test', b.closest('[data-id]').dataset.id));
          if (r?.results?.[0]) MM.toast(r.results[0].ok ? 'success' : 'error', r.results[0].ok ? 'Test sent' : 'Test failed', r.results[0].ok ? 'Check your Discord channel.' : r.results[0].error);
          renderHist();
        },
        remove: async (b) => { if (await MM.confirm('Remove this webhook?', 'MultiMenu stops sending to it.', { danger: true, ok: 'Remove' })) renderHooks(await MM.call('discord:remove', b.closest('[data-id]').dataset.id)); },
        clearHist: async () => { await MM.call('discord:clearHistory'); renderHist(); },
      });

      // ---------- remote control bot ----------
      const STC = { online: 'ok', connecting: 'warn', error: 'err', off: 'dim', waiting: 'warn' };
      const renderRemote = (r) => {
        if (!r) return;
        const ids = (r.config.allowedUserIds || []).join(', ');
        MM.$('#rc-card', root).innerHTML = `<h3>${MM.icon('bot')}Remote control from Discord<span class="right"><span class="badge ${STC[r.status] || 'dim'}">${MM.esc(r.status)}</span></span></h3>
          <p class="sub">Your own Discord bot that answers /mm commands from your phone: a control panel with buttons, a live status message, screenshots of every alt, presets, rejoin, close, tile and the watcher.</p>
          <div class="grid g2">
            <div class="stack">
              <div class="field"><label>1 · Bot token ${r.hasToken ? '<span class="badge ok" style="margin-left:6px">saved</span>' : ''}</label><div class="row nowrap"><input class="input" type="password" id="rc-token" placeholder="${r.hasToken ? '•••••••• (saved, encrypted)' : 'Paste the token from Developer Portal → Bot'}" autocomplete="off"><button class="btn" data-act="rcSave">${MM.icon('save', 14)}Save</button></div></div>
              <div class="field"><label>2 · Discord user IDs allowed to use it (comma separated)</label><input class="input" id="rc-ids" value="${MM.esc(ids)}" placeholder="e.g. 123456789012345678"><span class="hint">Discord → Settings → Advanced → Developer Mode on, then right-click your name → Copy User ID.</span></div>
              <div class="field"><label>Server ID (optional — makes commands appear instantly)</label><input class="input" data-setting="remote.guildId" placeholder="Right-click your server → Copy Server ID"></div>
              ${MM.settingRow('Private replies', 'Only you see the bot\'s answers.', MM.toggle('remote.private'))}
              ${MM.settingRow('Connect when MultiMenu starts', '', MM.toggle('remote.autoConnect'))}
              ${MM.settingRow('DM me when an alt closes unexpectedly', 'The bot sends you a message with a Rejoin button, so you can get it back from your phone anywhere. Needs the bot connected.', MM.toggle('remote.alertClosed'))}
            </div>
            <div class="stack">
              <div class="callout ${r.status === 'error' ? 'err' : r.status === 'online' ? 'ok' : ''}">${MM.icon(r.status === 'online' ? 'circle-check' : 'info')}<div>${MM.esc(r.message)}</div></div>
              <div class="row">${r.status === 'online' || r.status === 'connecting' ? `<button class="btn danger" data-act="rcOff">${MM.icon('power')}Disconnect</button>` : `<button class="btn primary" data-act="rcOn" ${r.hasToken ? '' : 'disabled'}>${MM.icon('power')}Connect bot</button>`}
                <button class="btn" data-act="rcInvite" ${r.inviteUrl ? '' : 'disabled'}>${MM.icon('external-link')}3 · Add bot to my server</button></div>
              ${r.lastCommand ? `<div class="small muted">Last command: /mm ${MM.esc(r.lastCommand.command)} by ${MM.esc(r.lastCommand.user)} · ${MM.fmt.ago(r.lastCommand.at)}</div>` : ''}
              <details class="small muted"><summary style="cursor:pointer">How to create the bot (2 minutes)</summary><ol style="padding-left:18px;margin:8px 0 0">
                <li>Open the <a href="#" data-act="devPortal">Discord Developer Portal</a> → New Application → name it “MultiMenu”.</li>
                <li>Bot tab → Reset Token → copy it into step 1 above. (No privileged intents are needed.)</li>
                <li>Paste your user ID in step 2, press Connect, then “Add bot to my server”.</li>
                <li>In your server type <b>/mm status</b>.</li></ol></details>
              <div class="small dim">Commands: /mm panel · live · status · launch · start · stop · rejoin · close · screenshot · screenshots · tile · watcher</div>
              ${r.live ? `<div class="small"><span class="badge ok">${MM.icon('signal', 12)}Live status is on</span></div>` : ''}
              <div class="small muted">Added the bot before 2.0? Invite it again so it may post the live status and screenshots.</div>
            </div>
          </div>`;
        MM.bindSettings(MM.$('#rc-card', root));
        MM.$('#rc-ids', root).onchange = async (e) => {
          try { await MM.setSetting('remote.allowedUserIds', e.target.value.split(',').map(x => x.trim()).filter(Boolean)); MM.toast('success', 'Allowed users saved'); }
          catch { /* toast shown */ }
        };
      };


      const renderReport = async () => { const r = await MM.call('report:status'); if (r) MM.$('#dr-last', root).textContent = r.lastSentDay ? `Last sent: ${r.lastSentDay}` : 'Not sent yet.'; };

      MM.delegate(root, {
        rcSave: async () => { const v = MM.$('#rc-token', root).value; if (!v) return; const r = await MM.call('remote:setToken', v); MM.$('#rc-token', root).value = ''; if (r) { renderRemote(r); MM.toast('success', 'Bot token saved', 'Encrypted on this PC. Press Connect.'); } },
        rcOn: async (b) => renderRemote(await MM.busy(b, () => MM.call('remote:connect'))),
        rcOff: async () => renderRemote(await MM.call('remote:disconnect')),
        rcInvite: () => MM.call('remote:invite'),
        devPortal: () => MM.call('app:openDevPortal'),
        reportNow: async (b) => { const r = await MM.busy(b, () => MM.call('report:send')); if (r) { MM.toast('success', 'Daily report sent', r.summary); renderReport(); } },
      });
      const renderPresence = (st) => {
        if (!st) return;
        const el = MM.$('#rp-state', root);
        el.innerHTML = !st.enabled ? `<span class="badge dim">${MM.esc(MM.t('Off'))}</span>` : st.connected ? `<span class="badge ok">${MM.esc(st.user ? MM.t('Showing for {0}').replace('{0}', st.user) : MM.t('Showing'))}</span>` : `<span class="badge dim">${MM.esc(MM.t('Discord not open'))}</span>`;
        el.querySelector('.badge')?.setAttribute('data-nt', '');
        const a = st.preview;
        MM.$('#rp-preview', root).innerHTML = `<div class="rp-label">${MM.esc(MM.t('Playing a game'))}</div><div class="rp-row"><div class="rp-logo">M</div><div class="rp-text" data-nt>
          <b>MultiMenu</b><span>${MM.esc(a.details)}</span>${a.state ? `<span>${MM.esc(a.state)}</span>` : ''}<span class="rp-time">${MM.esc(MM.t("{0} elapsed").replace("{0}", MM.fmt.dur(Date.now() - a.timestamps.start * 1000)))}</span></div></div>
          ${a.buttons ? `<div class="rp-btn" data-nt>${MM.esc(a.buttons[0].label)}</div>` : ''}`;
      };
      MM.call('presence:status').then(renderPresence);
      const offRp = MM.on('presence:update', renderPresence);
      MM.call('remote:status').then(renderRemote);
      renderReport();
      const offRc = MM.on('remote:update', renderRemote);

      MM.call('discord:list').then(renderHooks);
      renderEvents(); renderHist();
      const t = setInterval(renderHist, 10000);
      return () => { clearInterval(t); offRc(); offRp(); };
    },
  };
})();
