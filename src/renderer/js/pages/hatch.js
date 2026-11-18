(function () {
  const MM = window.MM;
  const SRC = { output: ['scroll-text', 'Game messages'], badge: ['award', 'Badges'], screen: ['scan-text', 'Screen'], test: ['send', 'Test'] };

  /** Picks one running client (or null). */
  async function pickSession(list, title) {
    if (!list.length) { MM.toast('info', 'No clients running', 'Launch an account into the game first.'); return null; }
    if (list.length === 1) return list[0];
    let id = null;
    const ok = await MM.modal({
      title, icon: 'gamepad-2',
      body: `<div class="list">${list.map(s => `<button class="item hp-pick" data-id="${MM.esc(s.id)}" style="width:100%;text-align:left">${MM.icon('user')}<div class="grow"><div class="title" data-nt>${MM.esc(s.label)}</div><div class="meta" data-nt>${MM.esc(s.placeName || (s.placeId ? `Place ${s.placeId}` : ''))}</div></div>${s.inGame ? '' : `<span class="badge dim">${MM.esc(MM.t('Not a watched game'))}</span>`}</button>`).join('')}</div>`,
      buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }],
      onMount: (m, close) => m.addEventListener('click', (e) => { const b = e.target.closest('.hp-pick'); if (b) { id = b.dataset.id; close(true); } }),
    });
    return ok ? list.find(s => s.id === id) : null;
  }

  MM.pickSession = pickSession;

  MM.pages.hatch = {
    render(root) {
      let st = null;
      root.innerHTML = `
        <div class="page-head"><div><h1>Hatch alerts</h1><p>Get pinged on Discord the moment one of your accounts hatches a rare pet, and count hatches per account. Works with any game: add it under Games and pets.</p></div>
          <div class="actions"><button class="btn" data-act="test">${MM.icon('send')}Send a test alert</button>
            <label class="toggle"><input type="checkbox" data-setting="hatch.enabled"><span class="sw"></span><b>Alerts on</b></label></div></div>
        ${MM.winOnly()}
        <div class="row" id="hp-pills" style="margin-bottom:16px"></div>
        <div class="card" id="hp-warn" style="display:none;margin-bottom:16px"></div>
        <div class="grid g2">
          <div class="card"><h3>${MM.icon('bell-ring')}Where to ping you</h3>
            <div class="field"><label>Your Discord user ID</label><input class="input mono" data-setting="hatch.ping" placeholder="123456789012345678" maxlength="30">
              <p class="hint">Discord → Settings → Advanced → turn on Developer Mode. Then right-click your name and press Copy User ID. Alerts go to your Discord webhooks and mention you.</p></div>
            ${MM.settingRow('DM me from the MultiMenu bot', 'Also sends a direct message to the people allowed to use the bot (Discord → Remote control).', MM.toggle('hatch.dm'))}
            ${MM.settingRow('Attach a screenshot', 'A picture of the account\'s Roblox window when it hatched.', MM.toggle('hatch.screenshot'))}
            ${MM.settingRow('Say it out loud', 'Windows reads the alert out (needs Spoken alerts on).', MM.toggle('speech.events.secretHatched'))}
            <div class="field" style="margin-top:8px"><label>Wait between alerts for one account (seconds)</label><input class="input" type="number" min="0" max="3600" data-setting="hatch.cooldownSec"></div></div>
          <div class="card"><h3>${MM.icon('gamepad-2')}Games and pets<span class="right"><button class="btn sm" data-act="reset">${MM.icon('rotate-ccw', 14)}Reset</button></span></h3>
            <div class="field"><label>Games to watch (place IDs, comma separated)</label><input class="input mono" data-setting="hatch.places" placeholder="123456789">
              <p class="hint">The number in the game's address: roblox.com/games/123456789/… Leave empty to watch every game.</p></div>
            <div class="field"><label>Words that mean a rare hatch</label><input class="input" data-setting="hatch.words" placeholder="secret"></div>
            <div class="field"><label>Pet names (comma separated)</label><textarea class="input" rows="4" data-setting="hatch.pets"></textarea>
              <p class="hint">Type the rare pets' names exactly as the game shows them. Add new ones when the game updates.</p></div></div>
          <div class="card spanall"><h3>${MM.icon('radar')}How MultiMenu sees a hatch</h3>
            <p class="sub">Roblox has no hatch API, so MultiMenu watches three things it is allowed to see. It never changes the game or reads its memory. Try the tools once to see which one catches your game's hatches.</p>
            <div class="grid g3" style="gap:0 22px">
              <div>${MM.settingRow('Game messages', 'What the game writes to each client\'s Roblox log. Instant and free, if the game writes hatches there.', MM.toggle('hatch.sources.output'))}
                <button class="btn sm" data-act="output" style="margin-top:8px">${MM.icon('scroll-text', 14)}Show game messages</button>
                <div class="small muted" id="hp-out" style="margin-top:8px"></div></div>
              <div>${MM.settingRow('Badges', 'Roblox\'s public badge list, for games that give a badge for a secret. Works even with tiny windows.', MM.toggle('hatch.sources.badges'))}
                <button class="btn sm" data-act="badges" style="margin-top:8px">${MM.icon('award', 14)}Find hatch badges</button>
                <div class="field" style="margin-top:8px"><label>Check every (seconds)</label><input class="input" type="number" min="30" max="3600" data-setting="hatch.badgeEverySec"></div>
                <div class="small muted" id="hp-badge"></div></div>
              <div>${MM.settingRow('Screen', 'Reads each Roblox window with Windows\' own text recognition and spots the hatch pop-up. Needs windows big enough to read.', MM.toggle('hatch.sources.screen'))}
                <button class="btn sm" data-act="screen" style="margin-top:8px">${MM.icon('scan-text', 14)}Test on a window</button>
                <div class="grid g2" style="margin-top:8px"><div class="field"><label>Each window every (s)</label><input class="input" type="number" min="1" max="120" data-setting="screen.everySec"></div>
                  <div class="field"><label>Smallest window (px)</label><input class="input" type="number" min="160" max="4000" data-setting="screen.minWidth"></div></div>
                <div class="small muted" id="hp-screen"></div></div>
            </div></div>
          <div class="card"><h3>${MM.icon('sparkles')}Recent secret hatches<span class="right"><button class="btn sm ghost" data-act="clear">${MM.icon('trash-2', 14)}Clear</button></span></h3><div class="list" id="hp-log"></div></div>
          <div class="card"><h3>${MM.icon('trophy')}Secrets per account</h3><div class="list" id="hp-counts"></div></div>
        </div>`;
      MM.bindSettings(root);

      const pills = () => {
        const on = MM.getSetting('hatch.enabled');
        MM.$('#hp-pills', root).innerHTML = `
          <div class="statpill"><b style="color:${on ? 'var(--ok)' : 'var(--dim)'}">${on ? 'ON' : 'OFF'}</b><span>${MM.esc(MM.t('Hatch alerts'))}</span></div>
          <div class="statpill"><b>${st.watching}/${st.running}</b><span>${MM.esc(MM.t('clients in a watched game'))}</span></div>
          <div class="statpill"><b>${st.counts.reduce((n, c) => n + c.n, 0)}</b><span>${MM.esc(MM.t('Secrets seen'))}</span></div>
          <div class="statpill"><b style="color:${st.discord.enabled && st.discord.hooks ? 'var(--ok)' : 'var(--warn)'}">${st.discord.enabled && st.discord.hooks ? MM.icon('circle-check', 16) : '!'}</b><span>${MM.esc(MM.t('Discord webhook'))}</span></div>
          <div class="statpill"><b style="color:${st.bot.ready ? 'var(--ok)' : 'var(--dim)'}">${st.bot.ready ? MM.icon('circle-check', 16) : '—'}</b><span>${MM.esc(MM.t('Bot DM'))}</span></div>`;
        const warn = [];
        if (!st.discord.enabled || !st.discord.hooks) warn.push(`${MM.esc(MM.t('Add a Discord webhook and turn Discord alerts on, or the ping has nowhere to go.'))} <button class="btn sm" data-act="go-discord">${MM.icon('webhook', 14)}${MM.esc(MM.t('Open Discord alerts'))}</button>`);
        else if (!st.discord.event) warn.push(`${MM.esc(MM.t('"Secret hatched!" is turned off in your Discord alert events.'))} <button class="btn sm" data-act="go-discord">${MM.esc(MM.t('Open Discord alerts'))}</button>`);
        if (!MM.getSetting('hatch.ping')) warn.push(MM.esc(MM.t('Add your Discord user ID so the alert pings you.')));
        if (MM.getSetting('hatch.dm') && !st.bot.ready) warn.push(MM.esc(MM.t('Bot DMs need the MultiMenu bot set up, with your user ID in its allowed list.')));
        const w = MM.$('#hp-warn', root);
        w.style.display = warn.length ? '' : 'none';
        w.innerHTML = warn.map(x => `<div class="row" style="gap:8px;align-items:center">${MM.icon('info', 16)}<span>${x}</span></div>`).join('');
      };

      const render = () => {
        if (!st) return;
        pills();
        MM.$('#hp-out', root).textContent = MM.t('{0} game messages read, {1} matched.').replace('{0}', st.outputLines).replace('{1}', st.outputMatches);
        const ids = MM.getSetting('hatch.badgeIds') || [];
        MM.$('#hp-badge', root).textContent = st.badgeError || (ids.length ? `${MM.t('{0} badges watched.').replace('{0}', ids.length)}${st.badgeCheckedAt ? ` ${MM.t('Last check {0}.').replace('{0}', MM.fmt.ago(st.badgeCheckedAt))}` : ''}` : MM.t('No badges picked yet.'));
        MM.$('#hp-screen', root).textContent = !st.ocr.available ? MM.t('Needs Windows 10 or 11.') : st.ocr.error || st.screenError || MM.t('{0} windows read, {1} too small or minimised.').replace('{0}', st.screenChecked).replace('{1}', st.screenSkipped);
        MM.$('#hp-log', root).innerHTML = st.log.length ? st.log.slice(0, 30).map(e => `<div class="item">${MM.icon(e.test ? 'send' : 'egg')}<div class="grow"><div class="title" data-nt>${MM.esc(e.label)} · ${MM.esc(e.pet || e.rarity || MM.t('Secret'))}${e.rarity && e.pet ? ` <span class="badge">${MM.esc(e.rarity)}</span>` : ''}</div>
            <div class="meta">${MM.esc(MM.fmt.ago(e.at))} · ${MM.esc(MM.t((SRC[e.source] || ['', e.source])[1]))}${e.text ? ` · <span data-nt>${MM.esc(e.text.slice(0, 90))}</span>` : ''}</div></div>
            ${e.shot ? `<button class="btn sm icon" data-act="shot" data-shot="${MM.esc(e.shot)}" title="${MM.esc(MM.t('Screenshot'))}">${MM.icon('image', 14)}</button>` : ''}</div>`).join('')
          : MM.empty('egg', 'No secrets yet', 'When an account hatches one, it shows up here.');
        MM.$('#hp-counts', root).innerHTML = st.counts.length ? st.counts.slice(0, 40).map(c => `<div class="item">${MM.icon('user')}<div class="grow"><div class="title" data-nt>${MM.esc(c.label)}</div><div class="meta">${MM.esc(MM.t('Last {0}').replace('{0}', MM.fmt.ago(c.last)))}</div></div><b>${c.n}</b></div>`).join('')
          : MM.empty('trophy', 'Nothing counted yet', 'Totals per account appear after the first secret.');
      };
      const load = async () => { const s = await MM.call('hatch:status'); if (s) { st = s; render(); } };

      MM.delegate(root, {
        'go-discord': () => MM.go('discord'),
        test: async (el) => { const r = await MM.busy(el, () => MM.call('hatch:test')); if (r) { MM.toast('success', 'Test alert sent', 'Check Discord (and your phone, if you set it up).'); load(); } },
        reset: async () => { if (await MM.call('hatch:reset')) { await MM.reloadSettings?.(); MM.bindSettings(root); MM.toast('success', 'Reset', 'Games, words and pet names are back to the defaults.'); } },
        clear: async () => { if (await MM.confirm('Clear the hatch list?', 'Removes the recent hatches and the totals per account.', { danger: true, ok: 'Clear' })) { const s = await MM.call('hatch:clear'); if (s) { st = s; render(); } } },
        shot: async (el) => { const url = await MM.call('hatch:shot', el.dataset.shot); if (url) MM.modal({ title: 'Screenshot', icon: 'image', wide: true, body: `<img src="${MM.esc(url)}" style="max-width:100%;border-radius:8px">`, buttons: [{ label: 'Close', value: true, cls: 'primary' }] }); },
        output: async () => {
          const s = await pickSession(st.sessions, 'Whose game messages?');
          if (!s) return;
          const lines = await MM.call('hatch:output', s.id);
          if (!lines) return;
          MM.modal({
            title: MM.t('Game messages: {0}').replace('{0}', s.label), icon: 'scroll-text', wide: true,
            desc: 'The last things the game wrote to this client\'s Roblox log. Hatch something: if it appears here, game messages will catch it. Highlighted lines would send an alert.',
            body: lines.length ? `<div class="mono small" style="max-height:420px;overflow:auto;white-space:pre-wrap" data-nt>${lines.map(l => `<div style="padding:2px 4px;border-radius:4px;${l.match && !l.other ? 'background:rgba(245,197,24,.18)' : l.other ? 'opacity:.6;text-decoration:line-through' : l.kind === 'Warning' ? 'color:var(--warn)' : ''}">${MM.esc(l.text)}</div>`).join('')}</div>`
              : MM.empty('scroll-text', 'This game has not written anything', 'Then game messages won\'t see hatches; try badges or the screen.'),
            buttons: [{ label: 'Close', value: true, cls: 'primary' }],
          });
        },
        badges: async (el) => {
          const r = await MM.busy(el, () => MM.call('hatch:badges'));
          if (!r) return;
          const chosen = new Set(r.chosen);
          const list = r.badges.slice().sort((a, b) => (b.looksLikeHatch - a.looksLikeHatch));
          let pick = null;
          const ok = await MM.modal({
            title: 'Hatch badges', icon: 'award', wide: true,
            desc: list.some(b => b.looksLikeHatch) ? 'Badges that look like hatch badges are ticked at the top. MultiMenu alerts when a running account gets one.' : 'None of this game\'s badges look like hatch badges, so badges probably won\'t catch secrets here. Use game messages or the screen.',
            body: list.length ? `<div class="list" style="max-height:420px;overflow:auto">${list.map(b => `<label class="item" style="cursor:pointer"><input type="checkbox" data-id="${MM.esc(b.id)}" ${chosen.has(b.id) || (!r.chosen.length && b.looksLikeHatch) ? 'checked' : ''}><div class="grow"><div class="title" data-nt>${MM.esc(b.name)}${b.looksLikeHatch ? ` <span class="badge ok">${MM.esc(MM.t('Hatch?'))}</span>` : ''}</div><div class="meta" data-nt>${MM.esc(b.description)}</div></div></label>`).join('')}</div>`
              : MM.empty('award', 'This game has no badges', ''),
            buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Save', value: true, cls: 'primary', handler: (m) => { pick = [...m.querySelectorAll('input[data-id]:checked')].map(x => x.dataset.id); } }],
          });
          if (ok && pick) { await MM.setSetting('hatch.badgeIds', pick.slice(0, 100)); load(); }
        },
        screen: async (el) => {
          const s = await pickSession(st.sessions, 'Which window?');
          if (!s) return;
          const r = await MM.busy(el, () => MM.call('hatch:testScreen', s.id));
          if (!r) return;
          MM.modal({
            title: MM.t('Screen text: {0}').replace('{0}', s.label), icon: 'scan-text', wide: true,
            desc: r.message || (r.match ? MM.t('This would send an alert: {0}').replace('{0}', r.match.pet || r.match.rarity) : 'This is what Windows read. Hatch something and test again while the pop-up is showing.'),
            body: r.text != null ? `<div class="mono small" style="max-height:380px;overflow:auto;white-space:pre-wrap" data-nt>${MM.esc(r.text || MM.t('(no text found)'))}</div>` : '',
            buttons: [{ label: 'Close', value: true, cls: 'primary' }],
          });
        },
      });

      const onSet = (e) => { if (String(e.detail?.key || '').match(/^(hatch|discord|remote)/)) load(); };
      document.addEventListener('mm:setting', onSet);
      const offs = [MM.on('hatch:new', load), MM.on('sessions:changed', load)];
      const t = setInterval(load, 5000);
      load();
      return () => { clearInterval(t); offs.forEach(f => f()); document.removeEventListener('mm:setting', onSet); };
    },
  };
})();
