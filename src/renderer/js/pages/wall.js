(function () {
  const MM = window.MM;
  const SIZES = { s: 210, m: 290, l: 400 };

  MM.pages.wall = {
    render(root) {
      let data = { tiles: [], offline: [] }, shots = {}, thumbTimer = null;
      const size = () => MM.getSetting('wall.size') || 'm';
      root.innerHTML = `
        <div class="page-head"><div><h1>Alt Wall</h1><p>Every alt at a glance, with a live picture of its window. Click one to jump to it.</p></div>
          <div class="actions">
            <div class="seg" id="w-size" role="group" aria-label="Tile size"><button data-s="s">S</button><button data-s="m">M</button><button data-s="l">L</button></div>
            <button class="btn" data-act="switcher" title="${MM.esc(MM.getSetting('hotkeys.altWall') || '')}">${MM.icon('layout-grid')}Switcher</button>
            <button class="btn" data-act="tile">${MM.icon('layout-dashboard')}Tile windows</button>
          </div></div>
        <div class="card wall-bar"><div class="row" style="gap:14px">
          <span id="w-sum" class="small muted"></span><span class="spacer"></span>
          <label class="check-lbl small"><input type="checkbox" data-setting="wall.showOffline"> Show accounts that aren't running</label>
          <label class="check-lbl small"><input type="checkbox" id="w-labels"> Name labels on Roblox windows</label>
          <span class="small muted">Pictures every</span><select class="input sm" style="width:auto" data-setting="wall.thumbSec" data-type="number"><option value="2">2 s</option><option value="5">5 s</option><option value="10">10 s</option><option value="30">30 s</option></select>
        </div></div>
        <div class="wall-grid" id="w-grid"></div>
        <h3 class="wall-sub hidden" id="w-off-h">${MM.icon('moon')}Not running</h3>
        <div class="wall-grid off" id="w-off"></div>`;
      const grid = MM.$('#w-grid', root), off = MM.$('#w-off', root);
      MM.bindSettings(root);

      const applySize = () => {
        root.style.setProperty('--wall-min', `${SIZES[size()]}px`);
        MM.$$('#w-size button', root).forEach(b => b.classList.toggle('on', b.dataset.s === size()));
      };
      const stateCls = (t) => t.state === 'not responding' ? 'err' : t.status !== 'running' ? 'warn' : /load|stuck|join/i.test(t.state || '') ? 'warn' : 'live';
      const scoreCls = (h) => (h == null ? '' : h.score >= 85 ? 'ok' : h.score >= 60 ? 'warn' : 'err');
      const stats = (t) => [
        t.startedAt && t.status === 'running' ? `${MM.icon('clock', 12)}${MM.fmt.dur(Date.now() - t.startedAt)}` : '',
        t.fps != null ? `${MM.icon('gauge', 12)}${t.fps} FPS` : '',
        t.ping != null ? `${MM.icon('signal', 12)}${t.ping} ms` : '',
        t.memMB ? `${MM.icon('memory-stick', 12)}${MM.fmt.mb(t.memMB)}` : '',
        t.health ? `<span class="hs ${scoreCls(t.health)}" title="${MM.esc(MM.t('Health score'))}">${MM.icon('heart-pulse', 12)}${t.health.score}</span>` : '',
      ].filter(Boolean).map(x => `<span>${x}</span>`).join('');

      const tileHtml = (t) => `<div class="wall-tile ${t.tier ? `tier-${t.tier}` : ''} ${t.external ? 'ext' : ''}" data-id="${MM.esc(t.id)}" ${t.color ? `style="--acc-c:${MM.ACCOUNT_COLORS?.[t.color] || ''}"` : ''}>
          <button class="wt-shot" data-act="focus" title="Switch to this window"><img alt="" class="${shots[t.id] ? '' : 'hidden'}" ${shots[t.id] ? `src="${shots[t.id]}"` : ''}><div class="wt-none ${shots[t.id] ? 'hidden' : ''}">${MM.avatar(t.avatarUrl, t.label)}<span class="small dim wt-why"></span></div>
            ${t.slot ? `<span class="sw-key">${t.slot}</span>` : ''}<span class="dot wt-dot"></span></button>
          <div class="wt-body">
            <div class="row nowrap"><b class="wt-name" data-nt>${MM.esc(t.label)}</b>${MM.tierBadge(t.tier, true)}<span class="spacer"></span>
              <button class="btn sm icon ghost wt-pin ${t.pinned ? 'on' : ''}" data-act="pin" title="${MM.esc(MM.t('Always on top'))}">${MM.icon('pin', 14)}</button>
              <button class="btn sm icon ghost" data-act="pip" title="Picture-in-picture">${MM.icon('picture-in-picture-2', 14)}</button>
              ${t.accountId ? `<button class="btn sm icon ghost" data-act="rejoin" title="Rejoin">${MM.icon('repeat', 14)}</button>` : ''}
              <button class="btn sm icon ghost danger" data-act="close" title="Close">${MM.icon('x', 14)}</button></div>
            <div class="small muted wt-game" data-nt></div>
            <div class="wt-stats small"></div>
          </div></div>`;

      const update = (el, t) => {
        el.querySelector('.wt-pin')?.classList.toggle('on', !!t.pinned);
        el.querySelector('.wt-dot').className = `dot wt-dot ${stateCls(t)}`;
        el.querySelector('.wt-game').textContent = t.game || (t.external ? MM.t('Opened outside MultiMenu') : '');
        el.querySelector('.wt-stats').innerHTML = stats(t);
        el.querySelector('.wt-why').textContent = MM.t(t.status !== 'running' ? 'Starting…' : 'Minimised');
        const img = el.querySelector('img'), none = el.querySelector('.wt-none');
        const src = shots[t.id];
        if (src && img.getAttribute('src') !== src) img.setAttribute('src', src);
        img.classList.toggle('hidden', !src); none.classList.toggle('hidden', !!src);
      };

      const render = () => {
        applySize();
        const tiles = data.tiles;
        const keep = new Set(tiles.map(t => t.id));
        MM.$$('.wall-tile', grid).forEach(el => { if (!keep.has(el.dataset.id)) el.remove(); });
        if (!tiles.length) grid.innerHTML = `<div class="card" style="grid-column:1/-1">${MM.empty('layout-grid', 'No alts running', 'Launch accounts and they appear here with a live picture of their window.')}</div>`;
        else {
          grid.querySelector('.card')?.remove();
          tiles.forEach((t, i) => {
            let el = grid.querySelector(`.wall-tile[data-id="${CSS.escape(t.id)}"]`);
            if (!el) { const tmp = document.createElement('div'); tmp.innerHTML = tileHtml(t); el = tmp.firstElementChild; }
            if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
            update(el, t);
          });
        }
        const showOff = MM.getSetting('wall.showOffline') !== false;
        MM.$('#w-off-h', root).classList.toggle('hidden', !showOff || !data.offline.length);
        off.innerHTML = showOff ? data.offline.map(a => `<div class="wall-tile off ${a.tier ? `tier-${a.tier}` : ''}" data-acc="${MM.esc(a.accountId)}">
            <div class="row nowrap">${MM.avatar(a.avatarUrl, a.label, 'sm')}<div style="min-width:0;flex:1"><b class="wt-name" data-nt>${MM.esc(a.label)}</b><div class="small dim" data-nt>@${MM.esc(a.username)}</div></div>${MM.tierBadge(a.tier, true)}${a.slot ? `<span class="badge dim">${MM.icon('keyboard', 12)}${a.slot}</span>` : ''}</div>
            <div class="row">${a.status === 'expired' ? `<span class="badge err">Login expired</span><span class="spacer"></span><button class="btn sm" data-act="relogin">${MM.icon('log-in', 14)}Log in again</button>` : `${a.health ? `<span class="hs ${scoreCls(a.health)} small">${MM.icon('heart-pulse', 12)}${a.health.score}</span>` : ''}<span class="spacer"></span><button class="btn sm primary" data-act="launch">${MM.icon('play', 14)}Launch</button>`}</div></div>`).join('') : '';
        const run = tiles.filter(t => t.status === 'running');
        const mem = run.reduce((n, t) => n + (t.memMB || 0), 0);
        const bad = tiles.filter(t => stateCls(t) === 'err').length;
        MM.$('#w-sum', root).innerHTML = `<b>${run.length}</b> ${MM.esc(MM.t(run.length === 1 ? 'alt running' : 'alts running'))} · ${MM.fmt.mb(mem)} RAM${bad ? ` · <span style="color:var(--err)">${bad} ${MM.esc(MM.t(bad === 1 ? 'needs attention' : 'need attention'))}</span>` : ''}`;
      };

      const load = async () => { const d = await MM.call('wall:data'); if (d) { data = d; render(); } };
      const loadShots = async () => {
        if (document.hidden || !data.tiles.some(t => t.status === 'running')) return;
        const w = Math.min(480, SIZES[size()] + 40);
        const s = await MM.call('wall:thumbs', w);
        if (s) { shots = s; render(); }
      };
      const schedule = () => { clearInterval(thumbTimer); thumbTimer = setInterval(loadShots, Math.max(2, Number(MM.getSetting('wall.thumbSec')) || 5) * 1000); };

      MM.call('overlay:status').then(st => { if (st) MM.$('#w-labels', root).checked = !!st.enabled; });
      MM.$('#w-labels', root).addEventListener('change', async (e) => { const r = await MM.call('overlay:enable', e.target.checked); if (!r) e.target.checked = !e.target.checked; else { MM.state.settings.overlay.enabled = r.enabled; if (r.enabled) MM.toast('success', 'Name labels on', 'They show on each Roblox window while Roblox or MultiMenu is in front.'); } });
      MM.$('#w-size', root).addEventListener('click', async (e) => { const b = e.target.closest('[data-s]'); if (!b) return; await MM.setSetting('wall.size', b.dataset.s); render(); loadShots(); });
      const sid = (b) => b.closest('[data-id]')?.dataset.id;
      const aid = (b) => b.closest('[data-acc]')?.dataset.acc;
      MM.delegate(root, {
        pin: async (b) => { const r = await MM.call('tiler:topmost', sid(b)); if (r) { b.classList.toggle('on', r.topmost); MM.toast('info', r.topmost ? 'Pinned on top' : 'Unpinned', r.label); } },
        focus: (b) => { const t = data.tiles.find(x => x.id === sid(b)); if (t?.status === 'running') MM.call('tiler:focus', t.id); },
        pip: (b) => MM.call('pip:open', sid(b)),
        rejoin: async (b) => { const t = data.tiles.find(x => x.id === sid(b)); if (t && await MM.confirm(`Rejoin ${t.label}?`, 'The client closes and starts again in the same game.', { ok: 'Rejoin' })) { const r = await MM.call('cmd:run', 'rejoin', { who: t.accountId ? `id:${t.accountId}` : t.label }); if (r) MM.toast('info', r.message); } },
        close: async (b) => { const t = data.tiles.find(x => x.id === sid(b)); if (t && await MM.confirm(`Close ${t.label}?`, 'The 24/7 Watcher won\'t rejoin it.', { danger: true, ok: 'Close' })) { await MM.call('sessions:setWatch', t.id, false); await MM.call('sessions:close', t.id); } },
        launch: (b) => MM.call('sessions:launch', aid(b), null).then(r => r && MM.toast('info', 'Launching')),
        relogin: () => MM.go('accounts'),
        switcher: () => MM.call('switcher:open'),
        tile: async () => { const r = await MM.call('tiler:tile'); if (r) MM.toast('success', 'Windows tiled', `${r.placed} of ${r.total} arranged.`); },
      });
      const onSet = (e) => { if (e.detail.key === 'wall.thumbSec') schedule(); if (e.detail.key === 'wall.showOffline') render(); };
      document.addEventListener('mm:setting', onSet);
      load().then(loadShots);
      schedule();
      const offs = [MM.on('sessions:changed', load), MM.on('sessions:stats', load), MM.on('accounts:changed', load), MM.on('overlay:update', st => { MM.$('#w-labels', root).checked = !!st.enabled; })];
      return () => { clearInterval(thumbTimer); offs.forEach(f => f()); document.removeEventListener('mm:setting', onSet); };
    },
  };
})();
