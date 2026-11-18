(function () {
  const MM = window.MM;
  const STATE = { ingame: ['ok', 'In game'], online: ['', 'Online'], studio: ['', 'In Studio'], offline: ['dim', 'Offline'], invisible: ['dim', 'Offline'] };

  MM.pages.servers = {
    render(root) {
      let accounts = [], games = [], picker = null, browse = null, friends = [], profiles = [];
      root.innerHTML = `
        <div class="page-head"><div><h1>Servers & Games</h1><p>Saved games and their profiles, a live server browser, joining friends, and putting several accounts in one server.</p></div>
          <div class="actions"><button class="btn" data-act="importCode">${MM.icon('clipboard-paste')}Paste a code</button></div></div>
        <div class="card" style="margin-bottom:16px" id="fw-card">
          <h3>${MM.icon('route')}Follow my main<span class="right">${MM.toggle('follow.enabled')}<b style="margin-left:6px">On</b></span></h3>
          <p class="sub">Your alts automatically join whatever server your main account is in — whether you play the main here, on your phone or another PC.</p>
          <div class="tile-wrap" style="grid-template-columns:minmax(0,1fr) minmax(0,1.4fr)">
            <div class="stack">
              <div class="field"><label>Main account</label><select class="input" id="fw-main"></select></div>
              <div class="field"><label>Alts that follow</label><div class="chips" id="fw-alts"></div></div>
              ${MM.settingRow('Start alts that aren\'t running', 'Otherwise only running alts are moved.', MM.toggle('follow.launchIfOffline'))}
            </div>
            <div><div class="callout" id="fw-msg">${MM.icon('info')}<div>Off</div></div><div class="list" id="fw-list" style="margin-top:10px"></div></div>
          </div>
        </div>
        <div class="card" style="margin-bottom:16px"><h3>${MM.icon('users')}Accounts to send<span class="right" id="sv-count"></span></h3><div class="chips" id="sv-picker"></div></div>
        <div class="card" style="margin-bottom:16px" id="gs-card"><h3>${MM.icon('search')}Find a game</h3>
          <form class="row nowrap" id="gs-form" style="margin-bottom:12px"><input class="input" id="gs-q" placeholder="${MM.esc(MM.t('Search Roblox games by name'))}" maxlength="80" autocomplete="off"><button class="btn primary" type="submit">${MM.icon('search')}Search</button></form>
          <div class="gs-grid" id="gs-list"></div>
          <div id="gs-more"></div>
        </div>
        <div class="grid g3">
          <div class="card span2"><h3>${MM.icon('globe')}Server browser<span class="right" id="sv-place"></span></h3>
            <div class="row nowrap" style="margin-bottom:12px">
              <input class="input" id="sv-input" placeholder="Place ID or game link" list="sv-games">
              <datalist id="sv-games"></datalist>
              <button class="btn" data-act="load">${MM.icon('search')}Load servers</button>
              <button class="btn primary" data-act="emptiest">${MM.icon('zap')}Join emptiest</button>
            </div>
            <div id="sv-list"></div>
          </div>
          <div class="card"><h3>${MM.icon('star')}Saved games & private servers</h3>
            <div class="stack" style="margin-bottom:12px">
              <input class="input" id="g-link" placeholder="Game link, place ID or private server link">
              <div class="row nowrap"><input class="input" id="g-name" placeholder="Name (optional)" maxlength="60"><button class="btn primary" data-act="addGame">${MM.icon('plus')}Save</button></div>
            </div>
            <div class="list" id="g-list" style="max-height:420px;overflow:auto"></div>
          </div>
          <div class="card span2"><h3>${MM.icon('heart-pulse')}Join a friend</h3>
            <div class="row nowrap" style="margin-bottom:12px"><select class="input" id="f-acc" style="max-width:280px"></select><button class="btn" data-act="friends">${MM.icon('refresh-cw')}Load friends</button><input class="input" id="f-filter" placeholder="Search friends…" style="max-width:220px"></div>
            <div id="f-list"></div>
          </div>
          <div class="card"><h3>${MM.icon('swords')}Squad join</h3>
            <p class="sub">The first selected account joins the game; every other selected account follows it into the same server.</p>
            <input class="input" id="sq-input" placeholder="Game, place ID or private server link" list="sv-games">
            <button class="btn primary big" style="width:100%;margin-top:12px" data-act="squad">${MM.icon('users')}Launch squad</button>
            <p class="hint" style="margin-top:10px">Following needs the leader's joins to be open to your other accounts (friends, or "Everyone" in Roblox privacy settings). Private server links put everyone in that private server directly.</p>
          </div>
        </div>`;

      const sel = () => picker?.get() || [];
      const need = (min = 1) => { const s = sel(); if (s.length < min) { MM.toast('warn', min > 1 ? `Pick at least ${min} accounts` : 'Pick an account first', 'Use “Accounts to send” at the top.'); return null; } return s; };
      const updateCount = (ids) => { MM.$('#sv-count', root).textContent = ids.length ? `${ids.length} selected` : 'none selected'; };

      const renderGames = () => {
        MM.$('#sv-games', root).innerHTML = games.map(g => `<option value="${MM.esc(g.link)}">${MM.esc(g.name)}</option>`).join('');
        MM.$('#g-list', root).innerHTML = games.length ? games.map(g => `<div class="item" data-id="${MM.esc(g.id)}">${MM.icon(g.private ? 'lock' : 'gamepad-2')}<div class="grow"><div class="title" data-nt>${MM.esc(g.name)}</div><div class="meta">${g.private ? 'Private server' : `Place ${MM.esc(g.placeId)}`}${profiles.some(p => p.placeId === g.placeId) ? ` · <span class="badge dim">${MM.icon('sliders-horizontal', 11)}Profile</span>` : ''}${g.accountIds?.length ? ` · <span class="badge ok" title="${MM.esc(MM.t('Launch uses these when no accounts are picked'))}">${MM.icon('users', 11)}${MM.esc(MM.t('{0} accounts').replace('{0}', g.accountIds.length))}</span>` : ''}</div></div>
            <button class="btn sm primary" data-act="launchGame" title="${g.accountIds?.length ? 'Launch the picked accounts, or its remembered accounts when none are picked' : 'Launch selected accounts'}">${MM.icon('play', 14)}</button>
            <button class="btn sm icon" data-act="rememberGame" title="Remember the picked accounts for this game: then Launch needs no picking">${MM.icon('users', 14)}</button>
            ${g.placeId ? `<button class="btn sm icon" data-act="profile" title="Game profile: graphics, layout and watcher rules for this game">${MM.icon('sliders-horizontal', 14)}</button>` : ''}
            ${g.private ? '' : `<button class="btn sm icon" data-act="browseGame" title="Browse servers">${MM.icon('globe', 14)}</button>`}
            <button class="btn sm icon" data-act="renameGame" title="Rename">${MM.icon('pencil', 14)}</button>
            <button class="btn sm icon danger" data-act="removeGame" title="Remove">${MM.icon('trash-2', 14)}</button></div>`).join('')
          : MM.empty('star', 'Nothing saved', 'Save games and private server links to reach them quickly here and in presets.');
      };

      const renderServers = () => {
        if (!browse) { MM.$('#sv-list', root).innerHTML = MM.empty('server', 'No game loaded', 'Enter a game and press Load servers. Servers are sorted by fewest players.'); return; }
        MM.$('#sv-place', root).textContent = browse.placeName ? `${browse.placeName} · ${browse.servers.length} servers` : `${browse.servers.length} servers`;
        MM.$('#sv-list', root).innerHTML = browse.servers.length ? `<div style="max-height:440px;overflow:auto"><table class="tbl"><thead><tr><th>Players</th><th></th><th>Ping</th><th>FPS</th><th>Server</th><th></th></tr></thead><tbody>${browse.servers.map(s => `<tr data-job="${MM.esc(s.id)}">
            <td><b>${s.playing}</b> / ${s.maxPlayers}</td><td><span class="pbar"><i style="width:${s.maxPlayers ? Math.round((s.playing / s.maxPlayers) * 100) : 0}%"></i></span></td>
            <td>${s.ping != null ? `${s.ping} ms` : '—'}</td><td>${s.fps ?? '—'}</td><td class="mono small">${MM.esc(s.id.slice(0, 8))}…</td>
            <td><button class="btn sm primary" data-act="joinServer" ${s.maxPlayers - s.playing < 1 ? 'disabled' : ''}>${MM.icon('play', 14)}Join</button></td></tr>`).join('')}</tbody></table></div>
            ${browse.nextCursor ? `<button class="btn" style="margin-top:10px" data-act="more">Load more</button>` : ''}`
          : MM.empty('server', 'No open servers', 'Every public server is full right now, or the game has none.');
      };

      const renderFriends = () => {
        const q = MM.$('#f-filter', root).value.toLowerCase();
        const list = friends.filter(f => !q || f.name.toLowerCase().includes(q) || (f.displayName || '').toLowerCase().includes(q));
        MM.$('#f-list', root).innerHTML = friends.length ? `<div class="list" style="max-height:420px;overflow:auto">${list.slice(0, 300).map(f => { const [c, l] = STATE[f.state] || STATE.offline; return `<div class="item" data-uid="${f.id}">${MM.avatar(f.avatarUrl, f.name, 'sm')}<div class="grow"><div class="title">${MM.esc(f.displayName || f.name)} <span class="small muted">@${MM.esc(f.name)}</span></div><div class="meta">${MM.esc(f.location || l)}</div></div><span class="badge ${c}">${l}</span>${f.state === 'ingame' ? `<button class="btn sm primary" data-act="joinFriend">${MM.icon('play', 14)}Join</button>` : ''}</div>`; }).join('')}</div>`
          : MM.empty('heart-pulse', 'No friends loaded', 'Pick which account\'s friends list to load, then press Load friends.');
      };

      let fwPicker = null, fwBound = false;
      const WHY = { none: ['ok', 'With main'], move: ['warn', 'Moving'], launch: ['warn', 'Starting'], wait: ['dim', 'Waiting'] };
      const renderFollow = (f) => {
        if (!f) return;
        const main = MM.$('#fw-main', root);
        if (!main.options.length) {
          main.innerHTML = '<option value="">Choose…</option>' + accounts.map(x => `<option value="${MM.esc(x.id)}">${MM.esc(x.alias || x.displayName || x.username)} (@${MM.esc(x.username)})</option>`).join('');
          main.value = f.config.mainAccountId || '';
          main.onchange = async () => { await MM.setSetting('follow.mainAccountId', main.value); fwPicker.update(accounts.filter(x => x.id !== main.value)); };
        }
        if (!fwPicker) fwPicker = MM.accountPicker(MM.$('#fw-alts', root), accounts.filter(x => x.id !== f.config.mainAccountId), { selected: f.config.followerIds, onChange: (ids) => MM.setSetting('follow.followerIds', ids) });
        MM.$('#fw-msg', root).innerHTML = `${MM.icon(f.loc ? 'circle-check' : 'info')}<div>${MM.esc(f.message)}${f.lastMove ? `<div class="small muted">Last move: ${MM.esc(f.lastMove.account)} → ${MM.esc(f.lastMove.to || '')} · ${MM.fmt.ago(f.lastMove.at)}</div>` : ''}</div>`;
        MM.$('#fw-list', root).innerHTML = Object.entries(f.followers || {}).map(([id, d]) => { const a = accounts.find(x => x.id === id); const [c, l] = WHY[d.action] || ['dim', d.action]; return a ? `<div class="item">${MM.avatar(a.avatarUrl, a.username, 'sm')}<div class="grow"><div class="title">${MM.esc(a.alias || a.displayName || a.username)}</div><div class="meta">${MM.esc(d.why)}</div></div><span class="badge ${c}">${l}</span></div>` : ''; }).join('');
      };

      const load = async () => {
        const [a, g, gp] = await Promise.all([MM.call('accounts:list'), MM.call('servers:games'), MM.call('gameprofiles:list')]);
        profiles = gp || [];
        accounts = a?.accounts || []; games = g || [];
        if (!picker) picker = MM.accountPicker(MM.$('#sv-picker', root), accounts, { onChange: updateCount });
        else picker.update(accounts);
        updateCount(sel());
        MM.$('#f-acc', root).innerHTML = accounts.filter(x => x.status !== 'expired').map(x => `<option value="${MM.esc(x.id)}">${MM.esc(x.alias || x.displayName || x.username)} (@${MM.esc(x.username)})</option>`).join('');
        renderGames(); renderServers(); renderFriends();
        if (!fwBound) { MM.bindSettings(MM.$('#fw-card', root)); fwBound = true; }
        renderFollow(await MM.call('follow:status'));
      };

      const loadServers = async (input, btn) => {
        const r = await MM.busy(btn, () => MM.call('servers:browse', input));
        if (r) { browse = { ...r, input }; renderServers(); }
      };

      // ---------- find a game ----------
      let found = { q: '', games: [], next: null };
      const num = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
      const renderFound = () => {
        MM.$('#gs-list', root).innerHTML = found.games.map(g => `<div class="gs-tile" data-place="${MM.esc(g.placeId)}">
            ${g.icon ? `<img src="${MM.esc(g.icon)}" alt="" loading="lazy">` : `<div class="gs-noimg">${MM.icon('gamepad-2', 28)}</div>`}
            <div class="gs-body"><b data-nt title="${MM.esc(g.name)}">${MM.esc(g.name)}</b>
              <span class="small muted" data-nt>${MM.esc(g.creator)}${g.verified ? ' ✔' : ''}</span>
              <span class="small gs-stats">${MM.icon('users', 12)} ${MM.esc(num(g.playing))}${g.likes != null ? ` · ${MM.icon('thumbs-up', 12)} ${g.likes}%` : ''}</span>
              <div class="row nowrap gs-actions"><button class="btn sm primary" data-act="gsLaunch">${MM.icon('play', 13)}${MM.esc(MM.t('Launch'))}</button>
                <button class="btn sm" data-act="gsServers" title="${MM.esc(MM.t('Servers'))}">${MM.icon('globe', 13)}</button>
                <button class="btn sm" data-act="gsSave" title="${MM.esc(MM.t('Save'))}">${MM.icon('star', 13)}</button></div></div></div>`).join('')
          || (found.q ? MM.empty('search', 'No games found', 'Try another name.') : '');
        MM.$('#gs-more', root).innerHTML = found.next ? `<button class="btn" data-act="gsMore" style="margin-top:12px">${MM.esc(MM.t('More results'))}</button>` : '';
      };
      MM.$('#gs-form', root).addEventListener('submit', async (e) => {
        e.preventDefault();
        const q = MM.$('#gs-q', root).value.trim();
        const r = await MM.busy(e.submitter || MM.$('#gs-form button', root), () => MM.call('games:search', q));
        if (r) { found = { q, games: r.games, next: r.next }; renderFound(); }
      });
      const gOf = (b) => found.games.find(g => g.placeId === b.closest('[data-place]').dataset.place);

      MM.$('#f-filter', root).addEventListener('input', renderFriends);
      const gid = (b) => b.closest('[data-id]').dataset.id;
      MM.delegate(root, {
        importCode: () => MM.importCode(),
        gsMore: async (b) => { const r = await MM.busy(b, () => MM.call('games:search', found.q, found.next)); if (r) { const have = new Set(found.games.map(g => g.placeId)); found.games = found.games.concat(r.games.filter(g => !have.has(g.placeId))); found.next = r.next; renderFound(); } },
        gsLaunch: async (b) => { const ids = need(); if (!ids) return; const g = gOf(b); const r = await MM.call('sessions:launchMany', ids, g.placeId); if (r) MM.toast('success', MM.t('Launching {0}').replace('{0}', g.name), MM.t('{0} accounts are in the launch queue.').replace('{0}', ids.length)); },
        gsServers: (b) => { const g = gOf(b); MM.$('#sv-input', root).value = g.placeId; loadServers(g.placeId, b); MM.$('#sv-list', root).scrollIntoView({ behavior: 'smooth', block: 'start' }); },
        gsSave: async (b) => { const g = gOf(b); const r = await MM.busy(b, () => MM.call('servers:addGame', { link: g.placeId, name: g.name.slice(0, 60) })); if (r) { games = r; renderGames(); MM.toast('success', 'Saved', g.name); } },
        load: (b) => loadServers(MM.$('#sv-input', root).value, b),
        more: async (b) => { const r = await MM.busy(b, () => MM.call('servers:browse', browse.input, browse.nextCursor)); if (r) { browse.servers = browse.servers.concat(r.servers); browse.nextCursor = r.nextCursor; renderServers(); } },
        emptiest: async (b) => { const ids = need(); if (!ids) return; const r = await MM.busy(b, () => MM.call('servers:emptiest', ids, MM.$('#sv-input', root).value)); if (r) MM.toast('success', 'Joining emptiest server', `${r.server.playing}/${r.server.maxPlayers} players · ${ids.length} account${ids.length > 1 ? 's' : ''}`); },
        joinServer: async (b) => { const ids = need(); if (!ids) return; const r = await MM.call('servers:join', ids, browse.placeId, b.closest('[data-job]').dataset.job); if (r) MM.toast('success', 'Joining server', `${r.queued} account${r.queued > 1 ? 's' : ''} queued.`); },
        addGame: async (b) => { const r = await MM.busy(b, () => MM.call('servers:addGame', { link: MM.$('#g-link', root).value, name: MM.$('#g-name', root).value })); if (r) { games = r; MM.$('#g-link', root).value = ''; MM.$('#g-name', root).value = ''; renderGames(); } },
        profile: async (b) => {
          const g = games.find(x => x.id === gid(b));
          const p = profiles.find(x => x.placeId === g.placeId) || { placeId: g.placeId, name: g.name, graphics: { enabled: false, quality: 1, fpsCap: 60 }, layout: '', watcher: { stuckMin: 0, freezeSec: 0, maxPerHour: 0 } };
          const LAY = { '': 'Keep my layout', auto: 'Smart grid', columns: 'Side by side', rows: 'Stacked', grid2: '2 × 2', grid3: '3 × 3', grid4: '4 × 4', main: 'Main + side', cascade: 'Cascade', fixed: 'Fixed size' };
          for (const l of (await MM.call('customlayouts:list')) || []) LAY[`custom:${l.id}`] = l.name; // layouts you drew
          const CAPS = [30, 60, 75, 120, 144, 165, 240, -1];
          let out = null;
          const res = await MM.modal({
            title: `Game profile — ${g.name}`, icon: 'sliders-horizontal', wide: true,
            desc: 'Used whenever an account launches into this game. An account\'s own launch graphics still win.',
            body: `<div class="stack">
              ${MM.settingRow('Set graphics for this game', 'Quality and FPS cap are written just before each client starts.', `<label class="toggle"><input type="checkbox" id="gp-gfx" ${p.graphics.enabled ? 'checked' : ''}><span class="sw"></span></label>`)}
              <div class="grid g2"><div class="field"><label>Graphics quality</label><select class="input" id="gp-q">${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}" ${p.graphics.quality === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>
                <div class="field"><label>FPS cap</label><select class="input" id="gp-fps">${CAPS.map(c => `<option value="${c}" ${p.graphics.fpsCap === c ? 'selected' : ''}>${c === -1 ? 'Unlimited' : c}</option>`).join('')}</select></div></div>
              <div class="field"><label>Window layout when every window is in this game</label><select class="input" id="gp-layout">${Object.entries(LAY).map(([k, l]) => `<option value="${k}" ${p.layout === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
              <div class="lbl">24/7 Watcher for this game (blank = your normal settings)</div>
              <div class="grid g3"><div class="field"><label>Stuck loading after (min)</label><input class="input" type="number" min="1" max="60" id="gp-stuck" value="${p.watcher.stuckMin || ''}"></div>
                <div class="field"><label>Frozen after (seconds)</label><input class="input" type="number" min="30" max="1800" id="gp-freeze" value="${p.watcher.freezeSec || ''}"></div>
                <div class="field"><label>Rejoins per hour at most</label><input class="input" type="number" min="1" max="30" id="gp-max" value="${p.watcher.maxPerHour || ''}"></div></div>
            </div>`,
            buttons: [...(profiles.some(x => x.placeId === g.placeId) ? [{ label: 'Delete profile', value: 'del', cls: 'ghost danger', icon: 'trash-2' }, { label: 'Share', value: 'share', cls: 'ghost', icon: 'share-2' }] : []), { label: 'Cancel', value: null, cls: 'ghost' }, { label: 'Save profile', value: 'save', cls: 'primary', icon: 'save', handler: (m) => {
              const v = (id) => m.querySelector(id).value;
              out = { placeId: g.placeId, name: g.name, layout: v('#gp-layout'), graphics: { enabled: m.querySelector('#gp-gfx').checked, quality: Number(v('#gp-q')), fpsCap: Number(v('#gp-fps')) }, watcher: { stuckMin: Number(v('#gp-stuck')) || 0, freezeSec: Number(v('#gp-freeze')) || 0, maxPerHour: Number(v('#gp-max')) || 0 } };
            } }],
          });
          if (res === 'save' && out) { const r = await MM.call('gameprofiles:save', out); if (r) { profiles = r; renderGames(); MM.toast('success', 'Game profile saved', g.name); } }
          if (res === 'del') { const r = await MM.call('gameprofiles:remove', g.placeId); if (r) { profiles = r; renderGames(); } }
          if (res === 'share') MM.shareCode('game', g.placeId);
        },
        removeGame: async (b) => { games = await MM.call('servers:removeGame', gid(b)) || games; renderGames(); },
        renameGame: async (b) => { const g = games.find(x => x.id === gid(b)); const n = await MM.prompt('Rename', 'Name', g.name); if (n) { games = await MM.call('servers:renameGame', g.id, n) || games; renderGames(); } },
        browseGame: (b) => { const g = games.find(x => x.id === gid(b)); MM.$('#sv-input', root).value = g.link; loadServers(g.link, null); },
        launchGame: async (b) => {
          const g = games.find(x => x.id === gid(b));
          const ids = sel().length || !g.accountIds?.length ? need() : g.accountIds;
          if (!ids) return;
          await MM.call('sessions:launchMany', ids, g.link); MM.toast('info', `Launching ${ids.length} into ${g.name}`);
        },
        rememberGame: async (b) => {
          const g = games.find(x => x.id === gid(b));
          const ids = sel();
          if (!ids.length && !g.accountIds?.length) { MM.toast('warn', 'Pick an account first', 'Pick the accounts this game should remember in “Accounts to send”.'); return; }
          if (!ids.length && !(await MM.confirm('Forget the remembered accounts?', 'Launch will use the accounts you pick again.', { ok: 'Forget' }))) return;
          games = await MM.call('servers:gameAccounts', g.id, ids) || games; renderGames();
          MM.toast('success', ids.length ? MM.t('Accounts remembered: {0}').replace('{0}', ids.length) : 'Remembered accounts forgotten', ids.length ? 'Press ▶ with nothing picked to launch them.' : '');
        },
        friends: async (b) => { const id = MM.$('#f-acc', root).value; if (!id) return; const r = await MM.busy(b, () => MM.call('servers:friends', id)); if (r) { friends = r; renderFriends(); } },
        joinFriend: async (b) => { const ids = need(); if (!ids) return; const r = await MM.call('servers:joinUser', ids, b.closest('[data-uid]').dataset.uid); if (r) MM.toast('success', 'Joining friend', `${r.queued} account${r.queued > 1 ? 's' : ''} queued.`); },
        squad: async (b) => { const ids = need(2); if (!ids) return; const r = await MM.busy(b, () => MM.call('servers:squad', ids, MM.$('#sq-input', root).value)); if (r) MM.toast('success', 'Squad launching', `${r.leader} leads, ${r.queued - 1} follow.`); },
      });
      load();
      const offF = MM.on('follow:update', renderFollow);
      const offA = MM.on('accounts:changed', load);
      return () => { offF(); offA(); };
    },
  };
})();
