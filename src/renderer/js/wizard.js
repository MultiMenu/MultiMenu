// First-run setup wizard: Roblox & launcher → accounts → PC check → OpenMulti & windows → 24/7 Watcher → Discord → first preset.
(function () {
  const MM = window.MM;

  MM.runWizard = () => new Promise((resolve) => {
    const STEPS = ['welcome', 'roblox', 'accounts', 'pc', 'windows', 'watcher', 'discord', 'preset', 'done'];
    let i = 0, accounts = [], picker = null, launchers = null, pc = null;
    const created = { preset: null, webhook: false };
    const back = document.createElement('div');
    back.className = 'modal-back wizard-back';
    back.innerHTML = '<div class="modal wide wizard"><div class="wz-dots"></div><div class="wz-body"></div><div class="foot"><button class="btn ghost" data-w="skip">Skip setup</button><span class="spacer"></span><button class="btn" data-w="back">Back</button><button class="btn primary" data-w="next">Next</button></div></div>';
    document.getElementById('modal-root').appendChild(back);
    const body = back.querySelector('.wz-body');
    const set = (k, v) => MM.setSetting(k, v).catch(() => {});

    const finish = async () => {
      await MM.call('app:firstRunDone');
      MM.state.settings.firstRunDone = true;
      back.remove();
      MM.go('dashboard');
      resolve();
    };

    const loadAccounts = async () => { accounts = (await MM.call('accounts:list'))?.accounts || []; };

    const render = async () => {
      const step = STEPS[i];
      back.querySelector('.wz-dots').innerHTML = STEPS.map((s, j) => `<i class="${j < i ? 'done' : j === i ? 'on' : ''}"></i>`).join('');
      back.querySelector('[data-w="back"]').style.visibility = i > 0 && step !== 'done' ? 'visible' : 'hidden';
      back.querySelector('[data-w="skip"]').style.visibility = step === 'done' ? 'hidden' : 'visible';
      const next = back.querySelector('[data-w="next"]');
      next.innerHTML = step === 'welcome' ? `${MM.icon('rocket')}Let's go` : step === 'done' ? `${MM.icon('check')}Open MultiMenu` : step === 'preset' ? 'Save & finish' : 'Next';
      const s = MM.state.settings;
      switch (step) {
        case 'welcome':
          body.innerHTML = `<div class="wz-hero"><div class="logo-mark">M</div><h2>Welcome to Multi<span>Menu</span></h2><p class="muted">Let's get you running in about a minute: check Roblox, add your accounts, tune MultiMenu for your PC, keep accounts online 24/7 and connect Discord. You can change everything later.</p></div>`;
          break;
        case 'roblox': {
          launchers = launchers || await MM.call('launchers:detect') || { roblox: {}, bloxstrap: {}, fishstrap: {} };
          const L = launchers, method = s.openMulti.launchMethod;
          const opt = (v, title, sub, ok = true) => `<label class="wz-opt ${ok ? '' : 'off'}"><input type="radio" name="wz-launch" value="${v}" ${method === v ? 'checked' : ''} ${ok ? '' : 'disabled'}><div><b>${title}</b><span>${sub}</span></div></label>`;
          body.innerHTML = `<h2>${MM.icon('gamepad-2', 22)}Roblox on this PC</h2>
            <div class="callout ${L.roblox.installed ? 'ok' : 'warn'}" style="margin-bottom:14px">${MM.icon(L.roblox.installed ? 'circle-check' : 'triangle-alert')}<div>${L.roblox.installed ? 'Roblox is installed.' : 'Roblox wasn\'t found. Install it from roblox.com first (Bloxstrap or Fishstrap also work).'}</div>${L.roblox.installed ? '' : `<button class="btn sm" data-a="getRoblox">${MM.icon('external-link', 14)}Get Roblox</button>`}</div>
            <p class="desc">How should MultiMenu start Roblox?</p>
            <div class="stack">
              ${opt('protocol', 'Automatic (recommended)', `Uses whatever opens Roblox links on this PC${L.handler === 'bloxstrap' ? ' (Bloxstrap)' : L.handler === 'fishstrap' ? ' (Fishstrap)' : ''}.`)}
              ${opt('bloxstrap', 'Bloxstrap', L.bloxstrap.installed ? 'Your Bloxstrap mods and settings apply to every client.' : 'Not installed.', L.bloxstrap.installed)}
              ${opt('fishstrap', 'Fishstrap', L.fishstrap.installed ? 'Your Fishstrap mods and settings apply to every client.' : 'Not installed.', L.fishstrap.installed)}
              ${opt('direct', 'Roblox directly', 'Starts the Roblox player itself. Skips any bootstrapper.', L.roblox.installed)}
            </div>
            <p class="hint" style="margin-top:10px">If only one client opens through Bloxstrap or Fishstrap, turn on its multi-instance option.</p>`;
          break;
        }
        case 'pc': {
          pc = pc || await MM.call('capacity:quick') || { ramGB: 0, cores: 0, rough: 1 };
          const tight = pc.rough <= 5;
          body.innerHTML = `<h2>${MM.icon('gauge', 22)}Tune for your PC</h2>
            <div class="row nowrap" style="gap:10px;margin-bottom:14px">
              <div class="statpill" style="flex:1"><b>${pc.ramGB} GB</b><span>RAM</span></div>
              <div class="statpill" style="flex:1"><b>${pc.cores}</b><span>CPU threads</span></div>
              <div class="statpill" style="flex:1"><b>~${pc.live?.possible || pc.rough}</b><span>clients (rough guide)</span></div>
            </div>
            <p class="desc">${tight ? 'Your PC will feel it with many clients. These help a lot:' : 'Your PC has room. These keep it smooth with many clients:'}</p>
            ${MM.settingRow('Background limiter', 'Full speed for the window you use, lower priority and fewer cores for the rest.', `<label class="toggle"><input type="checkbox" id="wz-lim" checked><span class="sw"></span></label>`)}
            ${MM.settingRow('RAM trimmer', 'Frees memory from idle clients every minute. Starts with MultiMenu.', `<label class="toggle"><input type="checkbox" id="wz-trim" ${tight || s.ramTrimmer.startWithApp ? 'checked' : ''}><span class="sw"></span></label>`)}
            <p class="hint" style="margin-top:10px">For an exact number, run the capacity test on the Capacity page once your accounts are added.</p>`;
          break;
        }
        case 'accounts':
          await loadAccounts();
          body.innerHTML = `<h2>${MM.icon('users', 22)}Add your Roblox accounts</h2><p class="desc">Sign in on the official Roblox page — MultiMenu saves the login encrypted on this PC. Add as many as you like.</p>
            <div class="row"><button class="btn primary big" data-a="login">${MM.icon('log-in')}Log in with Roblox</button><button class="btn big" data-a="cookie">${MM.icon('cookie')}Paste a cookie instead</button><button class="btn big" data-a="restore">${MM.icon('undo-2')}Restore a backup</button><button class="btn big" data-a="ram">${MM.icon('arrow-right-left')}From Roblox Account Manager</button></div>
            <div id="wz-pending" style="margin-top:12px"></div>
            <div class="list" style="margin-top:16px;max-height:220px;overflow:auto">${accounts.length ? accounts.map(a => `<div class="item">${MM.avatar(a.avatarUrl, a.username, 'sm')}<div class="grow"><div class="title">${MM.esc(a.displayName || a.username)}</div><div class="meta">@${MM.esc(a.username)}</div></div><span class="badge ok">Saved</span></div>`).join('') : '<div class="small muted">No accounts yet.</div>'}</div>`;
          MM.renderPending(body.querySelector('#wz-pending'));
          break;
        case 'windows':
          body.innerHTML = `<h2>${MM.icon('layout-dashboard', 22)}Multiple clients & windows</h2><p class="desc">OpenMulti lets several Roblox clients run at once. Auto-tile arranges their windows as they start.</p>
            ${MM.settingRow('Enable OpenMulti', 'Turn it on while Roblox is closed.', `<label class="toggle"><input type="checkbox" id="wz-om" ${s.openMulti.enabled ? 'checked' : ''}><span class="sw"></span></label>`)}
            ${MM.settingRow('Auto-tile new clients', 'Re-arranges windows each time a client starts.', `<label class="toggle"><input type="checkbox" id="wz-tile" ${s.tiling.autoTile ? 'checked' : ''}><span class="sw"></span></label>`)}
            <div class="field" style="margin-top:10px"><label>Layout</label><select class="input" id="wz-layout">${Object.entries({ auto: 'Smart grid (recommended)', columns: 'Side by side', rows: 'Stacked', grid2: '2 × 2', grid3: '3 × 3', main: 'Main + side', cascade: 'Cascade' }).map(([k, l]) => `<option value="${k}" ${s.tiling.layout === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
          break;
        case 'watcher':
          body.innerHTML = `<h2>${MM.icon('radar', 22)}Keep accounts online 24/7</h2><p class="desc">The watcher rejoins accounts that crash, disconnect or freeze — back into the same server when it can.</p>
            ${MM.settingRow('Turn on the 24/7 Watcher', '', `<label class="toggle"><input type="checkbox" id="wz-w" ${s.watcher.enabled ? 'checked' : ''}><span class="sw"></span></label>`)}
            ${MM.settingRow('Quiet hours', 'No rejoins during this time (e.g. overnight).', `<label class="toggle"><input type="checkbox" id="wz-q" ${s.schedule.quietHours.enabled ? 'checked' : ''}><span class="sw"></span></label>`)}
            <div class="form-grid" style="grid-template-columns:1fr 1fr"><div class="field"><label>From</label><input class="input" type="time" id="wz-qs" value="${MM.esc(s.schedule.quietHours.start)}"></div><div class="field"><label>To</label><input class="input" type="time" id="wz-qe" value="${MM.esc(s.schedule.quietHours.end)}"></div></div>
            <p class="hint" style="margin-top:10px">Some games don't allow AFK farming — check the game's rules.</p>`;
          break;
        case 'discord':
          body.innerHTML = `<h2>${MM.icon('webhook', 22)}Discord alerts (optional)</h2><p class="desc">Paste a webhook URL to get purple alerts for crashes, rejoins and a daily report. In Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy URL.</p>
            <div class="row nowrap"><input class="input" id="wz-hook" placeholder="https://discord.com/api/webhooks/…"><button class="btn" data-a="hook">${MM.icon('send')}Add & test</button></div>
            <div class="small" id="wz-hook-msg" style="margin-top:8px">${created.webhook ? '<span style="color:var(--ok)">✓ Webhook added</span>' : ''}</div>
            ${MM.settingRow('Daily report', 'A summary every evening at 21:00.', `<label class="toggle"><input type="checkbox" id="wz-rep" ${s.report.enabled ? 'checked' : ''}><span class="sw"></span></label>`)}
            <p class="hint">Remote control (/mm commands) and showing activity on your Discord profile are set up on the Discord page.</p>`;
          break;
        case 'preset':
          await loadAccounts();
          body.innerHTML = `<h2>${MM.icon('save', 22)}Your first preset (optional)</h2><p class="desc">A preset launches a group of accounts into a game with your layout and watcher in one click — from here, the mini panel, a schedule, or Discord.</p>
            <div class="stack"><div class="field"><label>Name</label><input class="input" id="wz-pn" value="My setup" maxlength="50"></div>
            <div class="field"><label>Accounts</label><div class="chips" id="wz-pa"></div></div>
            <div class="field"><label>Game (place ID or link — blank for each account's default)</label><input class="input" id="wz-pg" placeholder="e.g. https://www.roblox.com/games/920587237"></div></div>`;
          picker = MM.accountPicker(body.querySelector('#wz-pa'), accounts, { selected: accounts.filter(a => a.status !== 'expired').map(a => a.id) });
          break;
        case 'done':
          body.innerHTML = `<div class="wz-hero"><div class="logo-mark">${MM.icon('check', 30)}</div><h2>You're all set</h2><p class="muted">${accounts.length} account${accounts.length === 1 ? '' : 's'} saved${created.preset ? ` · preset “${MM.esc(created.preset)}” ready` : ''}${MM.state.settings.watcher.enabled ? ' · 24/7 Watcher on' : ''}.</p>
            <div class="small muted" style="margin-top:14px">Handy keys: <span class="kbd">Ctrl+Alt+T</span> tile · <span class="kbd">Ctrl+Alt+M</span> mini panel · <span class="kbd">F8</span> emergency stop</div></div>`;
          break;
        default: break;
      }
    };

    const saveStep = async () => {
      const step = STEPS[i], q = (x) => body.querySelector(x), s0 = () => MM.state.settings;
      if (step === 'roblox') {
        const v = body.querySelector('input[name="wz-launch"]:checked')?.value;
        if (v) { await set('openMulti.launchMethod', v); s0().openMulti.launchMethod = v; }
      }
      if (step === 'pc') {
        if (q('#wz-lim').checked !== MM.state.settings.limiter.enabled) await MM.call(q('#wz-lim').checked ? 'limiter:start' : 'limiter:stop');
        await set('ramTrimmer.startWithApp', q('#wz-trim').checked);
        if (q('#wz-trim').checked) await MM.call('trimmer:start');
      }
      if (step === 'windows') {
        const om = q('#wz-om').checked;
        await set('openMulti.enabled', om);
        await MM.call(om ? 'sessions:enableOpenMulti' : 'sessions:disableOpenMulti');
        await set('tiling.autoTile', q('#wz-tile').checked);
        await set('tiling.layout', q('#wz-layout').value);
      }
      if (step === 'watcher') {
        await MM.call('watcher:enable', q('#wz-w').checked); MM.state.settings.watcher.enabled = q('#wz-w').checked;
        await set('schedule.quietHours.enabled', q('#wz-q').checked);
        await set('schedule.quietHours.start', q('#wz-qs').value || '02:00');
        await set('schedule.quietHours.end', q('#wz-qe').value || '07:00');
      }
      if (step === 'discord') await set('report.enabled', q('#wz-rep').checked);
      if (step === 'preset') {
        const ids = picker?.get() || [];
        if (ids.length) {
          const r = await MM.call('presets:save', { name: q('#wz-pn').value || 'My setup', accountIds: ids, game: q('#wz-pg').value.trim(), layout: MM.state.settings.tiling.layout, tile: true, watch: MM.state.settings.watcher.enabled });
          if (!r) return false;
          created.preset = r.name;
        }
      }
      return true;
    };

    back.addEventListener('click', async (e) => {
      const w = e.target.closest('[data-w]'), a = e.target.closest('[data-a]');
      if (w?.dataset.w === 'skip') return finish();
      if (w?.dataset.w === 'back') { i = Math.max(0, i - 1); return render(); }
      if (w?.dataset.w === 'next') {
        if (STEPS[i] === 'done') return finish();
        w.disabled = true;
        const ok = await saveStep().catch(() => false);
        w.disabled = false;
        if (ok) { i++; render(); }
        return;
      }
      if (!a) return;
      if (a.dataset.a === 'login') { MM.toast('info', 'Roblox sign-in opened', 'Log in in the new window; it closes when you\'re done.'); if (await MM.busy(a, () => MM.call('accounts:login', {}))) render(); }
      if (a.dataset.a === 'ram') { await MM.openRamImport(); render(); }
      if (a.dataset.a === 'getRoblox') MM.call('app:openExternal', 'https://www.roblox.com/download');
      if (a.dataset.a === 'cookie') { const v = await MM.prompt('Paste a .ROBLOSECURITY cookie', 'Cookie (for an account you own)', '', { ok: 'Import' }); if (v && await MM.call('accounts:importCookie', v, {})) render(); }
      if (a.dataset.a === 'restore') { back.style.display = 'none'; MM.go('accounts'); setTimeout(() => { document.querySelector('[data-act="restore"]')?.click(); }, 300); const off = setInterval(() => { if (!document.querySelector('#modal-root .modal-back:not(.wizard-back)')) { clearInterval(off); back.style.display = ''; render(); } }, 800); }
      if (a.dataset.a === 'hook') {
        const url = body.querySelector('#wz-hook').value.trim();
        const list = await MM.call('discord:add', 'Alerts', url);
        if (list) {
          await set('discord.enabled', true);
          const r = await MM.call('discord:test', list.at(-1).id);
          created.webhook = true;
          body.querySelector('#wz-hook-msg').innerHTML = r?.results?.[0]?.ok ? '<span style="color:var(--ok)">✓ Webhook added — check Discord for the test message</span>' : `<span style="color:var(--err)">Added, but the test failed: ${MM.esc(r?.results?.[0]?.error || '')}</span>`;
        }
      }
    });
    render();
  });
})();
