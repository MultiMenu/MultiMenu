(function () {
  const MM = window.MM;
  const KIND = {
    telegram: ['send', 'Telegram', 'A free bot in Telegram messages you.'],
    ntfy: ['bell-ring', 'ntfy', 'Free push notifications. No account needed.'],
    pushover: ['smartphone', 'Pushover', 'Reliable push notifications (one-time app purchase).'],
    email: ['mail', 'Email', 'Any email account that can send mail (SMTP).'],
  };
  const SPEAK = ['accountCrashed', 'watcherGaveUp', 'launchFailed', 'loginWarning', 'highUsage', 'robloxOutage', 'internetBack', 'gameUpdated', 'achievement', 'secretHatched'];

  MM.pages.alertapps = {
    render(root) {
      let data = { channels: [], history: [], defaults: {}, presets: {} }, titles = {};
      root.innerHTML = `
        <div class="page-head"><div><h1>Phone, email & voice</h1><p>Get alerts on your phone or by email, or have them read out loud. Only names and what happened are sent, never logins or passwords.</p></div>
          <div class="actions"><button class="btn primary" data-act="add" aria-haspopup="menu">${MM.icon('plus')}Add an app</button></div></div>
        <div class="stack" id="aa-list"></div>
        <div class="card" style="margin-top:16px" id="sp-card"><h3>${MM.icon('volume-2')}Spoken alerts<span class="right">${MM.toggle('speech.enabled')}<b style="margin-left:6px">On</b></span></h3>
          <p class="sub">Windows reads alerts out loud with its built-in voices, so you hear when an alt crashes while you're in another game.</p>
          <div id="sp-body"></div></div>
        <div class="card" style="margin-top:16px"><h3>${MM.icon('history')}Recently sent</h3><div class="list" id="aa-hist"></div></div>`;

      const summary = (c) => c.kind === 'telegram' ? (c.config.chatId ? `Chat ${c.config.chatId}` : MM.t('No chat chosen yet')) : c.kind === 'ntfy' ? `${c.config.server.replace(/^https?:\/\//, '')}/${c.config.topic}` : c.kind === 'email' ? c.config.to : MM.t('Your devices');
      const render = () => {
        MM.$('#aa-list', root).innerHTML = data.channels.length ? data.channels.map(c => `<div class="card aa-ch ${c.enabled ? '' : 'off'}" data-id="${MM.esc(c.id)}"><div class="row nowrap">
            <div class="aa-ic">${MM.icon(KIND[c.kind][0], 20)}</div><div class="grow" style="min-width:0"><b data-nt>${MM.esc(c.name)}</b><div class="small muted" data-nt>${MM.esc(KIND[c.kind][1])} · ${MM.esc(summary(c))}</div></div>
            <label class="toggle" title="On / off"><input type="checkbox" data-toggle ${c.enabled ? 'checked' : ''}><span class="sw"></span></label>
            <button class="btn sm" data-act="test">${MM.icon('send', 14)}Test</button><button class="btn sm icon" data-act="edit" title="Edit">${MM.icon('pencil', 14)}</button><button class="btn sm icon danger" data-act="del" title="Remove">${MM.icon('trash-2', 14)}</button></div>
            <div class="row aa-ev">${Object.entries(c.events).filter(([, on]) => on).map(([k]) => `<span class="badge dim">${MM.esc(titles[k] || k)}</span>`).join('') || `<span class="small dim">${MM.esc(MM.t('No events picked'))}</span>`}</div></div>`).join('')
          : `<div class="card"><div class="aa-pick">${Object.entries(KIND).map(([k, [ic, name, desc]]) => `<button class="tpl" data-act="new" data-kind="${k}">${MM.icon(ic, 20)}<span><b>${name}</b><span class="small muted" style="display:block">${MM.esc(desc)}</span></span></button>`).join('')}</div></div>`;
        MM.$('#aa-hist', root).innerHTML = data.history.length ? data.history.slice(0, 10).map(h => `<div class="item"><span class="dot ${h.results.every(r => r.ok) ? 'ok' : 'err'}"></span><div class="grow"><div class="title">${MM.esc(h.title)}${h.account ? ` · <span data-nt>${MM.esc(h.account)}</span>` : ''}</div><div class="meta" data-nt>${MM.esc(h.results.map(r => `${r.name}: ${r.ok ? '✓' : r.error}`).join(' · '))}</div></div><span class="small dim">${MM.fmt.ago(h.at)}</span></div>`).join('')
          : MM.empty('history', 'Nothing sent yet', 'Alerts you get show up here.');
      };
      const load = async () => {
        const [d, ev] = await Promise.all([MM.call('alertapps:list'), MM.call('discord:events')]);
        if (d) data = d;
        titles = ev || {};
        render();
      };

      const editor = async (kind, ch) => {
        const c = ch?.config || {};
        const has = ch?.has || {};
        const ev = { ...data.defaults, ...(ch?.events || {}) };
        const saved = (k) => (has[k] ? MM.t('Saved — leave blank to keep it') : '');
        let body = `<div class="field"><label>Name</label><input class="input" id="aa-name" maxlength="40" value="${MM.esc(ch?.name || KIND[kind][1])}"></div>`;
        if (kind === 'telegram') body += `
          <ol class="small muted aa-steps"><li>In Telegram, message @BotFather, send /newbot and copy the token it gives you.</li><li>Open your new bot and send it any message.</li><li>Press “Find my chat” below.</li></ol>
          <div class="field"><label>Bot token</label><input class="input mono" id="aa-token" type="password" placeholder="${MM.esc(saved('token') || '123456789:AA…')}" autocomplete="off"></div>
          <div class="field"><label>Chat ID</label><div class="row nowrap"><input class="input mono" id="aa-chat" value="${MM.esc(c.chatId || '')}" placeholder="123456789"><button class="btn sm" id="aa-find">${MM.icon('search', 14)}Find my chat</button></div><div id="aa-chats" class="chips" style="margin-top:8px"></div></div>`;
        if (kind === 'ntfy') body += `
          <p class="small muted">Install the ntfy app on your phone and subscribe to the topic below. Anyone who knows the topic can read it, so keep it random.</p>
          <div class="field"><label>Server</label><input class="input" id="aa-server" value="${MM.esc(c.server || 'https://ntfy.sh')}"></div>
          <div class="field"><label>Topic</label><div class="row nowrap"><input class="input mono" id="aa-topic" value="${MM.esc(c.topic || '')}" maxlength="64"><button class="btn sm" id="aa-rand">${MM.icon('dices', 14)}Random</button></div></div>
          <div class="field"><label>Access token (only for protected servers)</label><input class="input mono" id="aa-token" type="password" placeholder="${MM.esc(saved('token'))}" autocomplete="off"></div>`;
        if (kind === 'pushover') body += `
          <p class="small muted">Find both keys at pushover.net: your user key on the front page, and an application token after you create an application.</p>
          <div class="field"><label>Application token</label><input class="input mono" id="aa-app" type="password" placeholder="${MM.esc(saved('appToken'))}" autocomplete="off"></div>
          <div class="field"><label>User key</label><input class="input mono" id="aa-user" type="password" placeholder="${MM.esc(saved('userKey'))}" autocomplete="off"></div>`;
        if (kind === 'email') body += `
          <div class="field"><label>Email provider</label><select class="input" id="aa-preset"><option value="">Other</option>${Object.keys(data.presets).map(k => `<option value="${k}" ${c.host === data.presets[k].host ? 'selected' : ''}>${{ gmail: 'Gmail', outlook: 'Outlook / Hotmail', yahoo: 'Yahoo', icloud: 'iCloud' }[k]}</option>`).join('')}</select></div>
          <div class="grid g3"><div class="field" style="grid-column:span 2"><label>SMTP server</label><input class="input" id="aa-host" value="${MM.esc(c.host || '')}" placeholder="smtp.gmail.com"></div><div class="field"><label>Port</label><input class="input" type="number" id="aa-port" value="${MM.esc(c.port || 465)}"></div></div>
          <div class="grid g2"><div class="field"><label>Username</label><input class="input" id="aa-user" value="${MM.esc(c.user || '')}" placeholder="you@gmail.com" autocomplete="off"></div><div class="field"><label>App password</label><input class="input" id="aa-pass" type="password" placeholder="${MM.esc(saved('pass'))}" autocomplete="new-password"></div></div>
          <div class="grid g2"><div class="field"><label>From</label><input class="input" id="aa-from" value="${MM.esc(c.from || '')}" placeholder="Blank = the username"></div><div class="field"><label>Send to</label><input class="input" id="aa-to" value="${MM.esc(c.to || '')}" placeholder="you@example.com"></div></div>
          <p class="hint">Gmail and Outlook need an app password, not your normal one (Google or Microsoft account → Security → App passwords).</p>`;
        body += `<div class="field"><label>Send me</label><div class="aa-events">${Object.keys(data.defaults).map(k => `<label class="check-lbl small"><input type="checkbox" data-ev="${k}" ${ev[k] ? 'checked' : ''}> ${MM.esc(titles[k] || k)}</label>`).join('')}</div></div>`;
        let out = null;
        const ok = await MM.modal({
          title: ch ? `Edit ${ch.name}` : `Add ${KIND[kind][1]}`, icon: KIND[kind][0], wide: true, body: `<div class="stack">${body}</div>`,
          onMount: (m) => {
            m.querySelector('#aa-rand')?.addEventListener('click', async () => { const t = await MM.call('alertapps:topic'); if (t) m.querySelector('#aa-topic').value = t; });
            m.querySelector('#aa-preset')?.addEventListener('change', (e) => { const p = data.presets[e.target.value]; if (p) { m.querySelector('#aa-host').value = p.host; m.querySelector('#aa-port').value = p.port; } });
            m.querySelector('#aa-find')?.addEventListener('click', async (e) => {
              const chats = await MM.busy(e.currentTarget, () => MM.call('alertapps:telegramChats', m.querySelector('#aa-token').value, ch?.id || null));
              if (!chats) return;
              const box = m.querySelector('#aa-chats');
              box.innerHTML = chats.map(x => `<button class="chip plain" data-chat="${MM.esc(x.id)}" data-nt>${MM.esc(x.name)}</button>`).join('');
              box.onclick = (ev2) => { const b = ev2.target.closest('[data-chat]'); if (b) { m.querySelector('#aa-chat').value = b.dataset.chat; box.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); } };
              if (chats.length === 1) box.querySelector('.chip').click();
            });
            if (!ch && kind === 'ntfy') m.querySelector('#aa-rand').click();
          },
          buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Save', value: true, cls: 'primary', icon: 'save', handler: async (m) => {
            const v = (id) => m.querySelector(id)?.value ?? '';
            const config = kind === 'telegram' ? { token: v('#aa-token'), chatId: v('#aa-chat') } : kind === 'ntfy' ? { server: v('#aa-server'), topic: v('#aa-topic'), token: v('#aa-token') }
              : kind === 'pushover' ? { appToken: v('#aa-app'), userKey: v('#aa-user') } : { host: v('#aa-host'), port: Number(v('#aa-port')), user: v('#aa-user'), pass: v('#aa-pass'), from: v('#aa-from'), to: v('#aa-to') };
            out = { id: ch?.id, kind, name: v('#aa-name'), enabled: ch ? ch.enabled : true, config, events: Object.fromEntries([...m.querySelectorAll('[data-ev]')].map(x => [x.dataset.ev, x.checked])) };
            const r = await MM.call('alertapps:save', out);
            m.querySelectorAll('input[type=password]').forEach(x => { x.value = ''; });
            if (!r) return false;
            data.channels = r;
          } }],
        });
        if (ok) { render(); MM.toast('success', 'Saved', 'Press Test to check it works.'); }
      };

      // ---------- spoken alerts ----------
      const renderSpeech = async () => {
        const el = MM.$('#sp-body', root);
        const voices = await MM.call('speech:voices') || [];
        const cur = MM.getSetting('speech.voice') || '';
        el.innerHTML = `<div class="grid g3">
            <div class="field"><label>Voice</label><select class="input" data-setting="speech.voice" data-nt><option value="">${MM.esc(MM.t('Automatic (matches your language)'))}</option>${voices.map(v => `<option value="${MM.esc(v.name)}" ${v.name === cur ? 'selected' : ''}>${MM.esc(v.name)} (${MM.esc(v.culture)})</option>`).join('')}</select></div>
            <div class="field"><label>Volume</label><input type="range" min="0" max="100" data-setting="speech.volume"></div>
            <div class="field"><label>Speed</label><input type="range" min="-10" max="10" data-setting="speech.rate"></div></div>
          <div class="field"><label>Read out</label><div class="aa-events">${SPEAK.map(k => `<label class="check-lbl small"><input type="checkbox" data-setting="speech.events.${k}"> ${MM.esc(titles[k] || k)}</label>`).join('')}</div></div>
          <div class="row">${MM.toggle('speech.quiet')}<span class="small muted">Stay quiet during quiet hours</span><span class="spacer"></span><button class="btn sm" data-act="speakTest">${MM.icon('volume-2', 14)}Test</button></div>`;
        MM.bindSettings(el);
      };

      const cid = (b) => b.closest('[data-id]').dataset.id;
      MM.delegate(root, {
        add: (b) => MM.menu(b, Object.entries(KIND).map(([k, [ic, name]]) => ({ label: name, icon: ic, run: () => editor(k, null) }))),
        new: (b) => editor(b.dataset.kind, null),
        edit: (b) => { const c = data.channels.find(x => x.id === cid(b)); editor(c.kind, c); },
        del: async (b) => { const c = data.channels.find(x => x.id === cid(b)); if (await MM.confirm(`Remove ${c.name}?`, 'Its saved keys are deleted from this PC.', { danger: true, ok: 'Remove' })) { data.channels = await MM.call('alertapps:remove', c.id) || data.channels; render(); } },
        test: async (b) => { const r = await MM.busy(b, () => MM.call('alertapps:test', cid(b))); if (r) { const x = r.results[0]; MM.toast(x?.ok ? 'success' : 'error', x?.ok ? 'Test sent' : 'Test failed', x?.ok ? 'Check your phone or inbox.' : x?.error); load(); } },
        speakTest: async (b) => { const r = await MM.busy(b, () => MM.call('speech:test')); if (r && !r.spoken) MM.toast('warn', 'Couldn\'t speak', r.error || r.reason); },
      });
      root.addEventListener('change', async (e) => { if (e.target.matches('[data-toggle]')) { data.channels = await MM.call('alertapps:enable', cid(e.target), e.target.checked) || data.channels; render(); } });
      MM.bindSettings(MM.$('#sp-card', root));
      load().then(renderSpeech);
    },
  };
})();
