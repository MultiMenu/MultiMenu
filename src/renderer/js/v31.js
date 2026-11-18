// 3.1: Items & security page, Logs page, and new cards on existing pages
// (getting started, private servers, smart join, volume mixer, update guard,
// network monitor, fresh restarts).
(function () {
  const MM = window.MM;
  const fmtNum = (n) => (n == null || !Number.isFinite(n) ? '—' : Number(n).toLocaleString(MM.loc ? MM.loc() : undefined));
  const robux = (n) => (n == null || !Number.isFinite(n) ? '—' : `R$ ${fmtNum(n)}`);
  const gb = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${Math.round(b / 1024 ** 2)} MB`);
  const rateText = (bps) => (bps >= 1024 ** 2 ? `${(bps / 1024 ** 2).toFixed(1)} MB/s` : `${Math.round(bps / 1024)} KB/s`);
  const yes = (v, okText = 'Yes', noText = 'No') => (v == null ? `<span class="badge dim">${MM.esc(MM.t('Unknown'))}</span>` : v ? `<span class="badge ok">${MM.icon('check', 11)}${MM.esc(MM.t(okText))}</span>` : `<span class="badge err">${MM.icon('x', 11)}${MM.esc(MM.t(noText))}</span>`);
  const after = (el, html) => { if (!el) return null; el.insertAdjacentHTML('afterend', html); return el.nextElementSibling; };
  /** Wraps a page's render so extra cards can be added after it draws. */
  const extend = (page, add) => {
    const p = MM.pages[page];
    if (!p) return;
    const orig = p.render;
    p.render = function (root, ...rest) {
      const undo = orig.call(this, root, ...rest);
      let undo2 = null;
      try { undo2 = add(root); } catch (e) { console.error(`3.1 ${page}:`, e); }
      return () => { if (typeof undo === 'function') undo(); if (typeof undo2 === 'function') undo2(); };
    };
  };

  // ======================================================================
  // Items & security
  // ======================================================================
  const SEC = { verified: ['ok', 'Verified'], unverified: ['warn', 'Not verified'], none: ['err', 'None'] };
  const secBadge = (v) => { if (v == null) return `<span class="badge dim">${MM.esc(MM.t('Unknown'))}</span>`; const [c, l] = SEC[v] || ['dim', v]; return `<span class="badge ${c}">${MM.esc(MM.t(l))}</span>`; };
  const GRADE = { good: ['ok', 'Good'], fair: ['warn', 'Fair'], weak: ['err', 'Weak'], unknown: ['dim', 'Unknown'] };

  MM.pages.items = {
    render(root) {
      let data = null, picker = null, accounts = [];
      root.innerHTML = `
        <div class="page-head"><div><h1>Items & security</h1><p>Security, Robux and limited items for every account, and who owns a game's passes and badges. Read-only: nothing here changes an account.</p></div></div>
        <div class="grid g4" id="it-stats">
          <div class="card stat"><div class="label">${MM.icon('coins', 15)}Robux</div><div class="value" id="it-robux">—</div><div class="small muted" id="it-robux-sub">&nbsp;</div></div>
          <div class="card stat"><div class="label">${MM.icon('hourglass', 15)}Pending Robux</div><div class="value" id="it-pending">—</div><div class="small muted">This month</div></div>
          <div class="card stat"><div class="label">${MM.icon('gem', 15)}Limiteds value</div><div class="value" id="it-value">—</div><div class="small muted" id="it-value-sub">&nbsp;</div></div>
          <div class="card stat"><div class="label">${MM.icon('shield-check', 15)}Weak security</div><div class="value" id="it-weak">—</div><div class="small muted" id="it-weak-sub">&nbsp;</div></div>
        </div>
        <div class="card" style="margin-top:16px"><h3>${MM.icon('users')}Accounts to check<span class="right small muted" id="it-count"></span></h3>
          <p class="sub">Pick some, or leave them all unpicked to check every account. Expired logins are skipped.</p><div class="chips" id="it-picker"></div></div>
        <div class="grid g2" style="margin-top:16px">
          <div class="card spanall" id="it-sec-card"><h3>${MM.icon('shield-check')}Security check<span class="right"><button class="btn sm primary" data-act="sec">${MM.icon('scan-search', 14)}Check security</button></span></h3>
            <p class="sub">Accounts without 2-step verification or a verified email are the easiest to lose. Email addresses and phone numbers are never shown or kept, only whether they're set up.</p>
            <div id="it-sec"></div></div>
          <div class="card"><h3>${MM.icon('coins')}Robux<span class="right"><button class="btn sm primary" data-act="wallet">${MM.icon('refresh-cw', 14)}Check Robux</button></span></h3><div id="it-wallet"></div></div>
          <div class="card" id="it-lim-card"><h3>${MM.icon('gem')}Limited items<span class="right"><button class="btn sm primary" data-act="limiteds">${MM.icon('refresh-cw', 14)}Check items</button></span></h3>
            ${MM.settingRow('Use Rolimons values', 'Shows each item\'s trading value from rolimons.com; otherwise its recent average price (RAP).', MM.toggle('wallet.rolimons'))}
            <div id="it-lim"></div></div>
          <div class="card spanall"><h3>${MM.icon('medal')}Game passes & badges</h3>
            <form class="row nowrap" id="it-game-form" style="margin-bottom:12px"><input class="input" id="it-game" placeholder="${MM.esc(MM.t('Place ID or game link'))}" list="it-games"><datalist id="it-games"></datalist><button class="btn primary" type="submit">${MM.icon('search', 14)}Check</button></form>
            <div id="it-game-out">${MM.empty('medal', 'No game checked', 'Enter a game to see which of the picked accounts own its passes and badges.')}</div></div>
        </div>`;
      MM.bindSettings(MM.$('#it-lim-card', root));

      const sel = () => picker?.get() || [];
      const who = (r) => `<div class="row nowrap" style="gap:8px">${MM.avatar(r.avatarUrl, r.username, 'xs')}<span data-nt>${MM.esc(r.label)}</span>${r.expired ? `<span class="badge dim">${MM.esc(MM.t('Expired'))}</span>` : ''}</div>`;
      const checked = (x) => (x?.at ? `<span class="small muted">${MM.esc(MM.fmt.ago(x.at))}</span>` : '');

      const render = () => {
        if (!data) return;
        const t = data.totals;
        MM.$('#it-robux', root).textContent = t.wallet.counted ? robux(t.wallet.robux) : '—';
        MM.$('#it-robux-sub', root).textContent = t.wallet.counted ? MM.t('{0} accounts, {1} with Premium').replace('{0}', t.wallet.counted).replace('{1}', t.wallet.premium) : MM.t('Not checked yet');
        MM.$('#it-pending', root).textContent = t.wallet.counted ? robux(t.wallet.pending) : '—';
        MM.$('#it-value', root).textContent = t.items.count ? robux(t.items.value) : '—';
        MM.$('#it-value-sub', root).textContent = t.items.count ? MM.t('{0} items · RAP {1}').replace('{0}', fmtNum(t.items.count)).replace('{1}', robux(t.items.rap)) : MM.t('Not checked yet');
        MM.$('#it-weak', root).textContent = t.security.checked ? String(t.security.weak) : '—';
        MM.$('#it-weak-sub', root).textContent = t.security.checked ? MM.t('of {0} checked').replace('{0}', t.security.checked) : MM.t('Not checked yet');

        const secRows = data.rows.filter(r => r.security);
        MM.$('#it-sec', root).innerHTML = secRows.length ? `<div style="overflow:auto"><table class="tbl"><thead><tr><th>Account</th><th>2-step</th><th>Email</th><th>Phone</th><th>PIN</th><th>Rating</th><th>To fix</th></tr></thead><tbody>${secRows.map(r => {
          const s = r.security; const [gc, gl] = GRADE[s.grade] || GRADE.unknown;
          return `<tr><td>${who(r)}</td><td>${s.error ? '' : yes(s.twoStep, 'On', 'Off')}</td><td>${s.error ? '' : secBadge(s.email)}</td><td>${s.error ? '' : secBadge(s.phone)}</td><td>${s.error ? '' : yes(s.pin, 'On', 'Off')}</td>
            <td>${s.error ? `<span class="badge err">${MM.esc(MM.t('Failed'))}</span>` : `<span class="badge ${gc}">${MM.esc(MM.t(gl))}${s.score != null ? ` · ${s.score}` : ''}</span>`}</td>
            <td class="small">${s.error ? MM.esc(s.error) : (s.issues || []).map(i => MM.esc(MM.t(i.text))).join(' · ') || MM.esc(MM.t('Nothing'))} ${checked(s)}</td></tr>`; }).join('')}</tbody></table></div>
            <p class="hint" style="margin-top:8px">${MM.icon('info', 13)}Turn these on at roblox.com → Settings → Security while signed in as that account (Accounts → Open roblox.com as this account).</p>`
          : MM.empty('shield-check', 'Not checked yet', 'Press Check security.');

        const walRows = data.rows.filter(r => r.wallet);
        MM.$('#it-wallet', root).innerHTML = walRows.length ? `<div style="max-height:420px;overflow:auto"><table class="tbl"><thead><tr><th>Account</th><th>Robux</th><th>Pending</th><th>Premium</th></tr></thead><tbody>${walRows.sort((a, b) => (b.wallet.robux || 0) - (a.wallet.robux || 0)).map(r => `<tr><td>${who(r)}</td>
            <td>${r.wallet.error ? `<span class="small err-text">${MM.esc(r.wallet.error)}</span>` : `<b>${robux(r.wallet.robux)}</b>`}</td><td>${r.wallet.error ? '' : robux(r.wallet.pending)}</td><td>${r.wallet.error ? '' : yes(r.wallet.premium)}</td></tr>`).join('')}</tbody></table></div>`
          : MM.empty('coins', 'Not checked yet', 'Press Check Robux to see every account\'s Robux and pending Robux.');

        const limRows = data.rows.filter(r => r.items);
        MM.$('#it-lim', root).innerHTML = limRows.length ? `<div style="max-height:420px;overflow:auto"><table class="tbl"><thead><tr><th>Account</th><th>Items</th><th>Value</th><th>Best items</th></tr></thead><tbody>${limRows.sort((a, b) => (b.items.value || 0) - (a.items.value || 0)).map(r => {
          const x = r.items;
          const cell = x.error ? `<span class="small err-text">${MM.esc(x.error)}</span>` : x.hidden ? `<span class="small muted">${MM.esc(MM.t('Inventory is private'))}</span>` : `<b>${robux(x.value)}</b><div class="small muted">RAP ${robux(x.rap)}</div>`;
          const pics = (x.top || []).slice(0, 4).map(i => (i.icon ? `<img class="it-pic" src="${MM.esc(i.icon)}" alt="" title="${MM.esc(`${i.name} · ${robux(i.value)}`)}">` : `<span class="badge dim" data-nt title="${MM.esc(robux(i.value))}">${MM.esc(i.name.slice(0, 18))}</span>`)).join('');
          return `<tr><td>${who(r)}</td><td>${x.error || x.hidden ? '' : fmtNum(x.count)}</td><td>${cell}</td><td><div class="row" style="gap:4px">${pics}</div></td></tr>`; }).join('')}</tbody></table></div>`
          : MM.empty('gem', 'Not checked yet', 'Press Check items to count each account\'s limited items and what they\'re worth.');
      };

      const renderGame = (g) => {
        const out = MM.$('#it-game-out', root);
        if (!g) return;
        if (!g.passes.length && !g.badges.length) { out.innerHTML = MM.empty('medal', 'Nothing to check', 'This game has no game passes or badges.'); return; }
        const col = (items, key) => items.map(p => `<th class="it-rot" title="${MM.esc(p.name)}"><span data-nt>${MM.esc(p.name)}</span></th>`).join('');
        const owners = (key, id) => g.rows.filter(r => r[key][id]).length;
        out.innerHTML = `<div class="row" style="margin-bottom:8px"><b data-nt>${MM.esc(g.name)}</b><span class="small muted">${MM.esc(MM.t('{0} game passes · {1} badges').replace('{0}', g.passes.length).replace('{1}', g.badges.length))} · ${MM.esc(MM.fmt.ago(g.at))}</span></div>
          <div style="overflow:auto;max-height:520px"><table class="tbl it-grid"><thead><tr><th>Account</th>${g.passes.length ? col(g.passes) : ''}${g.badges.length ? col(g.badges) : ''}</tr>
            <tr class="small muted"><th>${MM.esc(MM.t('Owned by'))}</th>${g.passes.map(p => `<th>${owners('passes', p.id)}/${g.rows.length}</th>`).join('')}${g.badges.map(b => `<th>${owners('badges', b.id)}/${g.rows.length}</th>`).join('')}</tr></thead>
          <tbody>${g.rows.map(r => `<tr><td data-nt>${MM.esc(r.label)}${r.error ? ` <span class="badge err" title="${MM.esc(r.error)}">!</span>` : ''}</td>${g.passes.map(p => `<td class="it-cell">${r.passes[p.id] ? MM.icon('check', 15) : r.passes[p.id] === false ? '<span class="dim">·</span>' : '?'}</td>`).join('')}${g.badges.map(b => `<td class="it-cell">${r.badges[b.id] ? MM.icon('check', 15) : '<span class="dim">·</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
          ${g.morePasses || g.moreBadges ? `<p class="hint">${MM.esc(MM.t('Only the first 40 game passes and 100 badges are checked.'))}</p>` : ''}
          <p class="hint">${MM.icon('info', 13)}${MM.esc(MM.t('Game passes in a private inventory show as not owned.'))}</p>`;
      };

      const load = async () => {
        const [a, d, g] = await Promise.all([MM.call('accounts:list'), MM.call('items:status'), MM.call('servers:games')]);
        accounts = a?.accounts || [];
        if (!picker) picker = MM.accountPicker(MM.$('#it-picker', root), accounts, { onChange: (ids) => { MM.$('#it-count', root).textContent = ids.length ? MM.t('{0} picked').replace('{0}', ids.length) : MM.t('All accounts'); } });
        else picker.update(accounts);
        MM.$('#it-count', root).textContent = sel().length ? MM.t('{0} picked').replace('{0}', sel().length) : MM.t('All accounts');
        MM.$('#it-games', root).innerHTML = (g || []).filter(x => x.placeId).map(x => `<option value="${MM.esc(x.placeId)}">${MM.esc(x.name)}</option>`).join('');
        if (d) { data = d; render(); if (d.passes && !MM.$('#it-game', root).value) renderGame(d.passes); }
      };
      const run = async (b, ch, title) => {
        const r = await MM.busy(b, () => MM.call(ch, sel()));
        if (r) { data = r; render(); MM.toast('success', title); }
      };
      MM.delegate(root, {
        sec: (b) => run(b, 'items:security', 'Security checked'),
        wallet: (b) => run(b, 'items:wallets', 'Robux checked'),
        limiteds: (b) => run(b, 'items:limiteds', 'Limited items checked'),
      });
      MM.$('#it-game-form', root).addEventListener('submit', async (e) => {
        e.preventDefault();
        const r = await MM.busy(e.submitter || MM.$('#it-game-form button', root), () => MM.call('items:game', MM.$('#it-game', root).value, sel()));
        if (r) renderGame(r);
      });
      load();
      const off = MM.on('accounts:changed', load);
      return () => off();
    },
  };

  // ======================================================================
  // Logs
  // ======================================================================
  const KIND = { disconnect: ['err', 'Disconnect'], error: ['warn', 'Error'], join: ['ok', 'Join'], teleport: ['', 'Teleport'], info: ['dim', 'Info'] };
  const kindBadge = (k) => { const [c, l] = KIND[k] || KIND.info; return `<span class="badge ${c}">${MM.esc(MM.t(l))}</span>`; };
  const whyText = (w) => (w ? `<div class="small" style="margin-top:2px">${MM.icon('info', 12)}<b>${MM.esc(MM.t('Error {0}').replace('{0}', w.code))} — ${MM.esc(MM.t(w.title))}</b>: ${MM.esc(MM.t(w.meaning))}</div>` : '');

  const openLog = async (name) => {
    let kind = '', q = '';
    const draw = async (m) => {
      const r = await MM.call('logs:read', name, { kind, q });
      const box = m.querySelector('#lg-view');
      if (!r) { box.textContent = MM.t('Could not read the log.'); return; }
      m.querySelector('#lg-meta').textContent = `${r.account ? `${r.account} · ` : ''}${MM.t('{0} lines').replace('{0}', r.total)}`;
      box.innerHTML = r.lines.map(l => `<div class="${l.kind === 'disconnect' ? 'err' : l.kind === 'error' ? 'warn' : l.kind === 'join' || l.kind === 'teleport' ? 'hi' : ''}">${MM.esc(l.text)}${l.why ? `<div class="lg-why">→ ${MM.esc(MM.t('Error {0}').replace('{0}', l.why.code))}: ${MM.esc(MM.t(l.why.title))}</div>` : ''}</div>`).join('') || `<div class="muted">${MM.esc(MM.t('No matching lines.'))}</div>`;
      box.scrollTop = box.scrollHeight;
    };
    await MM.modal({
      title: MM.t('Roblox log'), icon: 'scroll-text', wide: true,
      body: `<div class="row nowrap" style="margin-bottom:10px"><select class="input sm" id="lg-kind" style="max-width:170px"><option value="">${MM.esc(MM.t('Every line'))}</option><option value="disconnect">${MM.esc(MM.t('Disconnects'))}</option><option value="error">${MM.esc(MM.t('Errors'))}</option><option value="join">${MM.esc(MM.t('Joins'))}</option><option value="teleport">${MM.esc(MM.t('Teleports'))}</option></select>
        <input class="input sm" id="lg-q" placeholder="${MM.esc(MM.t('Filter text'))}"></div>
        <div class="small dim mono" data-nt style="margin-bottom:4px">${MM.esc(name)}</div><div class="small muted" id="lg-meta" style="margin-bottom:6px"></div><div class="logview" id="lg-view">${MM.esc(MM.t('Loading…'))}</div>`,
      onMount: (m) => {
        draw(m);
        m.querySelector('#lg-kind').onchange = (e) => { kind = e.target.value; draw(m); };
        let t; m.querySelector('#lg-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; draw(m); }, 300); };
      },
    });
  };

  MM.pages.logs = {
    render(root) {
      root.innerHTML = `
        <div class="page-head"><div><h1>Logs</h1><p>Every Roblox log on this PC, which alt it belongs to, and why alts disconnected. Logins and keys in logs are hidden.</p></div>
          <div class="actions"><button class="btn" data-act="folder">${MM.icon('folder-open')}Open logs folder</button><button class="btn" data-act="reload">${MM.icon('refresh-cw')}Refresh</button></div></div>
        <div class="card"><h3>${MM.icon('search')}Search every log</h3>
          <form class="row nowrap" id="lg-form" style="margin-bottom:12px"><input class="input" id="lg-q" placeholder="${MM.esc(MM.t('Text to find, e.g. kicked, 277, teleport'))}" maxlength="100">
            <select class="input" id="lg-kind" style="max-width:190px"><option value="">${MM.esc(MM.t('Any kind'))}</option><option value="disconnect">${MM.esc(MM.t('Disconnects'))}</option><option value="error">${MM.esc(MM.t('Errors'))}</option><option value="join">${MM.esc(MM.t('Joins'))}</option><option value="teleport">${MM.esc(MM.t('Teleports'))}</option></select>
            <button class="btn primary" type="submit">${MM.icon('search', 14)}Search</button></form>
          <div id="lg-hits"></div></div>
        <div class="grid g3" style="margin-top:16px">
          <div class="card"><h3>${MM.icon('radar')}Why alts disconnected</h3><p class="sub">The most common reasons in the recent logs.</p><div class="list" id="lg-sum"></div></div>
          <div class="card span2"><h3>${MM.icon('scroll-text')}Log files<span class="right small muted" id="lg-n"></span></h3><div id="lg-files"></div></div>
        </div>`;

      const loadFiles = async () => {
        const r = await MM.call('logs:files');
        const list = r?.files || [];
        MM.$('#lg-n', root).textContent = list.length ? MM.t('Newest {0}').replace('{0}', list.length) : '';
        MM.$('#lg-files', root).innerHTML = list.length ? `<div style="max-height:460px;overflow:auto"><table class="tbl"><thead><tr><th>Account</th><th>Last written</th><th>Size</th><th></th></tr></thead><tbody>${list.map(f => `<tr data-file="${MM.esc(f.name)}">
            <td>${f.account ? `<span data-nt>${MM.esc(f.account)}</span>` : `<span class="muted">${MM.esc(MM.t('Not signed in yet'))}</span>`}${f.claimed ? ` <span class="badge ok">${MM.esc(MM.t('Running'))}</span>` : ''}</td>
            <td>${MM.esc(MM.fmt.date(f.modified))}</td><td>${MM.esc(MM.fmt.bytes(f.size))}</td><td><button class="btn sm" data-act="open">${MM.icon('eye', 14)}Open</button></td></tr>`).join('')}</tbody></table></div>`
          : MM.empty('scroll-text', 'No Roblox logs', r?.dir ? 'Roblox hasn\'t written any logs on this PC yet.' : 'The Roblox logs folder wasn\'t found.');
      };
      const loadSummary = async () => {
        const s = await MM.call('logs:summary') || [];
        MM.$('#lg-sum', root).innerHTML = s.length ? s.map(r => `<div class="item"><div class="grow"><div class="title">${r.code ? `${MM.esc(MM.t('Error {0}').replace('{0}', r.code))} — ` : ''}${MM.esc(MM.t(r.title))}</div><div class="meta" data-nt>${MM.esc(r.accounts.join(', '))}</div></div><span class="badge">${r.count}×</span>${r.code ? `<button class="btn sm ghost" data-act="findCode" data-code="${r.code}">${MM.icon('search', 13)}</button>` : ''}</div>`).join('')
          : MM.empty('circle-check', 'No disconnects', 'None in the recent logs.');
      };
      const search = async (btn) => {
        const q = MM.$('#lg-q', root).value.trim(), kind = MM.$('#lg-kind', root).value;
        const r = await MM.busy(btn, () => MM.call('logs:search', { q, kind }));
        if (!r) return;
        MM.$('#lg-hits', root).innerHTML = r.hits.length ? `<div class="small muted" style="margin-bottom:6px">${MM.esc(MM.t('{0} matches in {1} logs').replace('{0}', r.hits.length + (r.more ? '+' : '')).replace('{1}', r.files))}</div>
          <div class="list" style="max-height:440px;overflow:auto">${r.hits.map(h => `<div class="item" data-file="${MM.esc(h.file)}">${kindBadge(h.kind)}<div class="grow"><div class="mono small lg-line">${MM.esc(h.text)}</div>${whyText(h.why)}<div class="meta" data-nt>${MM.esc(h.account || h.file)}</div></div><button class="btn sm ghost" data-act="open" title="${MM.esc(MM.t('Open'))}">${MM.icon('eye', 14)}</button></div>`).join('')}</div>`
          : MM.empty('search', 'Nothing found', 'Try other words or another kind.');
      };
      MM.$('#lg-form', root).addEventListener('submit', (e) => { e.preventDefault(); search(e.submitter); });
      MM.delegate(root, {
        folder: () => MM.call('logs:openFolder'),
        reload: () => { loadFiles(); loadSummary(); },
        open: (b) => openLog(b.closest('[data-file]').dataset.file),
        findCode: (b) => { MM.$('#lg-q', root).value = b.dataset.code; MM.$('#lg-kind', root).value = 'disconnect'; search(null); },
      });
      loadFiles(); loadSummary();
      return null;
    },
  };

  // ======================================================================
  // Dashboard: getting started
  // ======================================================================
  extend('dashboard', (root) => {
    const hero = MM.$('.card.hero', root);
    if (!hero) return null;
    const card = after(hero, '<div class="card gs-card hidden" id="gs-check"></div>');
    const draw = (c) => {
      if (!c || c.hidden || c.complete) { card.classList.add('hidden'); return; }
      card.classList.remove('hidden');
      card.innerHTML = `<h3>${MM.icon('list-checks')}Getting started<span class="right"><span class="small muted" style="margin-right:8px">${MM.esc(MM.t('{0} of {1} done').replace('{0}', c.done).replace('{1}', c.total))}</span><button class="btn sm ghost" data-gs="hide" title="${MM.esc(MM.t('Hide'))}">${MM.icon('x', 14)}</button></span></h3>
        <div class="meter" style="margin-bottom:12px"><i style="width:${Math.round((c.done / c.total) * 100)}%"></i></div>
        <div class="gs-steps">${c.steps.map(s => `<button class="gs-step ${s.done ? 'done' : ''}" data-gs="go" data-page="${MM.esc(s.page)}">${MM.icon(s.done ? 'circle-check' : 'circle-dot', 16)}<span>${MM.esc(MM.t(s.title))}</span></button>`).join('')}</div>`;
    };
    card.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-gs]');
      if (!b) return;
      if (b.dataset.gs === 'hide') { draw(await MM.call('checklist:hide', true)); MM.toast('info', 'Checklist hidden', 'Bring it back in Settings → Getting started.'); }
      else MM.go(b.dataset.page);
    });
    MM.call('checklist:status').then(draw);
    return MM.on('checklist:update', draw);
  });

  // ======================================================================
  // Servers: smart join and private servers
  // ======================================================================
  extend('servers', (root) => {
    const anchor = MM.$('#gs-card', root);
    if (!anchor) return null;
    const picked = () => MM.$$('#sv-picker .chip.on', root).map(b => b.dataset.chip);
    const need = () => { const s = picked(); if (!s.length) { MM.toast('warn', 'Pick an account first', 'Use “Accounts to send” at the top.'); return null; } return s; };
    const card = after(anchor, `<div class="grid g3" style="margin-bottom:16px" id="v31-servers">
      <div class="card"><h3>${MM.icon('zap')}Smart join</h3>
        <p class="sub">Picks the server for you. Spread out puts a few alts in each server instead of all in one.</p>
        <div class="stack">
          <input class="input" id="sj-input" placeholder="${MM.esc(MM.t('Place ID or game link'))}" list="sv-games">
          <div class="grid g2" style="gap:10px"><div class="field"><label>Pick</label><select class="input" id="sj-mode"><option value="ping">${MM.esc(MM.t('Lowest ping'))}</option><option value="fewest">${MM.esc(MM.t('Fewest players'))}</option><option value="spread">${MM.esc(MM.t('Spread out'))}</option></select></div>
            <div class="field hidden" id="sj-per-f"><label>Alts per server</label><input class="input" type="number" min="1" max="50" value="2" id="sj-per"></div></div>
          <button class="btn primary" data-act="sjGo">${MM.icon('play', 14)}Join</button>
          <p class="hint">${MM.esc(MM.t('Ping is how quickly the server answers Roblox, which is usually close to what you get.'))}</p>
        </div></div>
      <div class="card span2"><h3>${MM.icon('lock')}Your private servers<span class="right"><span class="small muted" id="ps-when" style="margin-right:8px"></span><button class="btn sm" data-act="psRefresh">${MM.icon('refresh-cw', 14)}Refresh</button></span></h3>
        <div class="row" style="margin-bottom:8px">${MM.settingRow('Warn before one runs out', 'When a private server that won\'t renew ends within the days below.', MM.toggle('privateServers.warn'))}<div class="field" style="max-width:120px"><label>Days</label><input class="input" type="number" min="1" max="30" data-setting="privateServers.warnDays"></div></div>
        <div id="ps-list"></div></div></div>`);
    MM.bindSettings(card);
    MM.$('#sj-mode', card).onchange = (e) => MM.$('#sj-per-f', card).classList.toggle('hidden', e.target.value !== 'spread');

    const draw = (r) => {
      if (!r) return;
      MM.$('#ps-when', card).textContent = r.checkedAt ? MM.t('Checked {0}').replace('{0}', MM.fmt.ago(r.checkedAt)) : '';
      MM.$('#ps-list', card).innerHTML = r.servers.length ? `<div style="max-height:360px;overflow:auto"><table class="tbl"><thead><tr><th>Server</th><th>Owner</th><th>Ends</th><th></th></tr></thead><tbody>${r.servers.map(s => {
        const soon = r.expiring.includes(s.id);
        const ends = !s.active ? `<span class="badge dim">${MM.esc(MM.t('Inactive'))}</span>` : s.expiresAt ? `${MM.esc(new Date(s.expiresAt).toLocaleDateString(MM.loc()))} ${s.willRenew ? `<span class="badge ok">${MM.esc(MM.t('Renews'))}</span>` : `<span class="badge ${soon ? 'err' : 'warn'}">${MM.esc(MM.t('Won\'t renew'))}</span>`}` : `<span class="badge ok">${MM.esc(MM.t('Free'))}</span>`;
        return `<tr data-ps="${MM.esc(s.id)}"><td><b data-nt>${MM.esc(s.name)}</b><div class="small muted" data-nt>${MM.esc(s.game || '')}</div></td><td data-nt>${MM.esc(s.ownerLabel)}</td><td>${ends}</td>
          <td><div class="row nowrap" style="gap:4px"><button class="btn sm primary" data-act="psLaunch" ${s.active ? '' : 'disabled'}>${MM.icon('play', 14)}Launch</button><button class="btn sm icon" data-act="psSave" title="${MM.esc(MM.t('Save to games'))}">${MM.icon('star', 14)}</button></div></td></tr>`; }).join('')}</tbody></table></div>`
        : MM.empty('lock', r.checkedAt ? 'No private servers' : 'Not checked yet', r.checkedAt ? 'None of your accounts own a private server.' : 'Press Refresh to list the private servers your accounts own.');
    };
    MM.delegate(card, {
      sjGo: async (b) => {
        const ids = need(); if (!ids) return;
        const mode = MM.$('#sj-mode', card).value;
        const r = await MM.busy(b, () => MM.call('smartjoin:join', ids, MM.$('#sj-input', card).value, { mode, perServer: Number(MM.$('#sj-per', card).value) || 1 }));
        if (r) MM.toast('success', MM.t('Joining {0} servers').replace('{0}', r.servers), `${MM.t('{0} accounts queued').replace('{0}', r.queued)}${r.skipped ? ` · ${MM.t('{0} left out: not enough servers with room').replace('{0}', r.skipped)}` : ''}`);
      },
      psRefresh: async (b) => { const r = await MM.busy(b, () => MM.call('privservers:refresh')); if (r) { draw(r); if (r.errors?.length) MM.toast('warn', 'Some accounts weren\'t checked', r.errors.map(e => `${e.account}: ${e.error}`).join(' · ')); } },
      psLaunch: async (b) => { const ids = need(); if (!ids) return; const r = await MM.busy(b, () => MM.call('privservers:launch', b.closest('[data-ps]').dataset.ps, ids)); if (r) MM.toast('success', MM.t('Launching into {0}').replace('{0}', r.name), MM.t('{0} accounts queued').replace('{0}', r.queued)); },
      psSave: async (b) => { const r = await MM.busy(b, () => MM.call('privservers:save', b.closest('[data-ps]').dataset.ps)); if (r) MM.toast('success', 'Saved', 'It\'s in Saved games & private servers.'); },
    });
    MM.call('privservers:status').then(draw);
    return null;
  });

  // ======================================================================
  // Sessions: volume mixer and update guard
  // ======================================================================
  MM.openVolumeMixer = async () => {
    let v = await MM.call('volume:view');
    if (!v) return;
    const rows = (x) => (x.rows.length ? x.rows.map(r => `<div class="item vm-row" data-acc="${MM.esc(r.accountId)}">${MM.avatar(r.avatarUrl, r.label, 'sm')}<div class="grow"><div class="title" data-nt>${MM.esc(r.label)}</div>
        <div class="row nowrap" style="gap:10px"><input type="range" min="0" max="100" step="5" value="${r.level}" class="vm-range" data-vm="one"><b class="vm-val">${r.level}%</b>${r.own ? `<button class="btn sm ghost" data-vm="reset" title="${MM.esc(MM.t('Use the all-alts level'))}">${MM.icon('rotate-ccw', 13)}</button>` : ''}</div></div></div>`).join('')
      : MM.empty('volume-2', 'No alts running', 'Levels you set are remembered per account and used every time it starts.'));
    await MM.modal({
      title: MM.t('Volume mixer'), icon: 'volume-2', wide: false,
      desc: MM.t('A volume for each alt, like Windows\' Volume Mixer. Remembered per account.'),
      body: `<div class="setting-row"><div class="txt"><b>${MM.esc(MM.t('All alts'))}</b><span>${MM.esc(MM.t('Alts without their own level'))}</span></div><div class="ctl row nowrap"><input type="range" min="0" max="100" step="5" value="${v.all}" id="vm-all"><b id="vm-all-v">${v.all}%</b></div></div>
        <div class="list" id="vm-list" style="margin-top:10px;max-height:380px;overflow:auto">${rows(v)}</div>
        ${v.available ? '' : `<div class="callout warn" style="margin-top:10px">${MM.icon('triangle-alert')}<div>${MM.esc(MM.t('Volume control needs Windows.'))}</div></div>`}`,
      onMount: (m) => {
        const redraw = (x) => { v = x; m.querySelector('#vm-list').innerHTML = rows(x); };
        const all = m.querySelector('#vm-all');
        all.oninput = () => { m.querySelector('#vm-all-v').textContent = `${all.value}%`; };
        all.onchange = async () => { const r = await MM.call('volume:setAll', Number(all.value)); if (r) redraw(r); };
        m.querySelector('#vm-list').addEventListener('input', (e) => { const r = e.target.closest('.vm-range'); if (r) r.parentElement.querySelector('.vm-val').textContent = `${r.value}%`; });
        m.querySelector('#vm-list').addEventListener('change', async (e) => { const r = e.target.closest('.vm-range'); if (!r) return; const x = await MM.call('volume:set', r.closest('[data-acc]').dataset.acc, Number(r.value)); if (x) redraw(x); });
        m.querySelector('#vm-list').addEventListener('click', async (e) => { const b = e.target.closest('[data-vm="reset"]'); if (!b) return; const x = await MM.call('volume:reset', b.closest('[data-acc]').dataset.acc); if (x) redraw(x); });
      },
    });
  };

  extend('sessions', (root) => {
    const actions = MM.$('.page-head .actions', root);
    if (actions) actions.insertAdjacentHTML('afterbegin', `<button class="btn" id="vm-open">${MM.icon('volume-2')}Volume</button>`);
    MM.$('#vm-open', root)?.addEventListener('click', () => MM.openVolumeMixer());
    const tile = MM.$('#tile-card', root);
    const card = after(tile, `<div class="card" style="margin-top:16px" id="ug-card"><h3>${MM.icon('download')}Roblox updates</h3>
      <div class="setting-row"><div class="txt"><b>Hold Roblox updates</b><span>Roblox's installer closes every open client when it updates. While updates are held, MultiMenu starts the Roblox you already have and stops the installer if anything else starts it, so your alts stay in game. Roblox may refuse to join servers once your version is too old: then press Update Roblox now.</span></div>
        <div class="ctl"><select class="input" data-setting="updateGuard.hold"><option value="off">Off</option><option value="whileOpen">While a client is open</option><option value="always">Always, until I update</option></select></div></div>
      <div class="setting-row"><div class="txt"><b>Update guard</b><span>When Roblox has an update, the first alt you launch installs it and the rest of the queue waits until it's done, instead of every alt downloading it at once.</span></div><div class="ctl">${MM.toggle('updateGuard.enabled')}</div></div>
      <div class="row"><span class="small" id="ug-state">…</span><span class="spacer"></span><div class="field" style="max-width:190px"><label>Wait at most (seconds)</label><input class="input" type="number" min="30" max="900" data-setting="updateGuard.maxWaitSec"></div><button class="btn sm" data-ug="check">${MM.icon('refresh-cw', 14)}Check now</button><button class="btn sm primary" data-ug="update">${MM.icon('download', 14)}Update Roblox now</button></div></div>`);
    if (!card) return null;
    MM.bindSettings(card);
    const draw = (r) => {
      if (!r) return;
      const el = MM.$('#ug-state', card);
      if (r.updatingNow) el.innerHTML = `<span class="badge warn">${MM.esc(MM.t('Updating'))}</span> ${MM.esc(MM.t('Roblox may update for the next 15 minutes'))}`;
      else if (r.holding && r.upToDate === false) el.innerHTML = `<span class="badge warn">${MM.esc(MM.t('Update held'))}</span> <span class="mono small muted" data-nt>${MM.esc(r.latest)}</span>`;
      else if (r.state?.phase === 'updating') el.innerHTML = `<span class="badge warn">${MM.esc(MM.t('Updating'))}</span> ${MM.esc(MM.t('Waiting for Roblox {0} to install').replace('{0}', r.state.version || ''))}`;
      else if (r.upToDate === true) el.innerHTML = `<span class="badge ok">${MM.esc(MM.t('Up to date'))}</span> <span class="mono small muted" data-nt>${MM.esc(r.latest)}</span>`;
      else if (r.upToDate === false) el.innerHTML = `<span class="badge warn">${MM.esc(MM.t('Update available'))}</span> <span class="mono small muted" data-nt>${MM.esc(r.latest)}</span>`;
      else el.innerHTML = `<span class="badge dim">${MM.esc(MM.t('Unknown'))}</span> ${MM.esc(MM.t('Roblox wasn\'t found, or its version couldn\'t be checked.'))}`;
    };
    card.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ug]');
      if (!b) return;
      if (b.dataset.ug === 'update') {
        const open = ((await MM.call('sessions:list')) || []).filter(x => x.status === 'running').length;
        if (open && !(await MM.confirm('Update Roblox now?', MM.t('Roblox closes the {0} clients that are open while it updates. Updates are let through for 15 minutes.').replace('{0}', open), { ok: 'Update' }))) return;
        draw(await MM.busy(b, () => MM.call('updateguard:updateNow')));
        return;
      }
      draw(await MM.busy(b, () => MM.call('updateguard:check')));
    });
    MM.call('updateguard:check').then(draw);
    return MM.on('updateguard:update', () => MM.call('updateguard:check').then(draw));
  });

  // ======================================================================
  // PC monitor: network
  // ======================================================================
  extend('performance', (root) => {
    const fps = MM.$('#p-fps', root);
    if (!fps) return null;
    fps.parentElement.insertAdjacentHTML('beforeend', `<div class="card span3" id="nm-card"><h3>${MM.icon('wifi')}Network<span class="right">${MM.toggle('netmon.enabled')}<b style="margin-left:6px">On</b></span></h3>
      <div class="tile-wrap" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)">
        <div><div class="grid g4" style="gap:10px;margin-bottom:10px">
            <div><div class="small muted">${MM.icon('arrow-down', 12)}Download</div><b id="nm-down">—</b></div>
            <div><div class="small muted">${MM.icon('arrow-up', 12)}Upload</div><b id="nm-up">—</b></div>
            <div><div class="small muted">Today</div><b id="nm-today">—</b></div>
            <div><div class="small muted">This month</div><b id="nm-month">—</b></div></div>
          <canvas class="chart" id="nm-chart" style="height:140px"></canvas>
          <div class="small muted" id="nm-per" style="margin-top:6px"></div></div>
        <div class="stack">
          <div class="lbl">Data cap</div>
          <div class="grid g2" style="gap:10px"><div class="field"><label>Cap (GB, 0 = off)</label><input class="input" type="number" min="0" max="100000" data-setting="netmon.capGB"></div>
            <div class="field"><label>Per</label><select class="input" data-setting="netmon.period"><option value="month">${MM.esc(MM.t('Month'))}</option><option value="day">${MM.esc(MM.t('Day'))}</option></select></div></div>
          <div id="nm-cap"></div>
          ${MM.settingRow('Close Filler alts at the cap', 'Main and Important alts keep running.', MM.toggle('netmon.closeFiller'))}
          <p class="hint">${MM.icon('info', 12)}${MM.esc(MM.t('Windows only reports the whole PC\'s traffic, so the per-alt figure is the total shared between running alts.'))}</p>
        </div></div></div>`);
    const card = MM.$('#nm-card', root);
    MM.bindSettings(card);
    const draw = (v) => {
      if (!v) return;
      MM.$('#nm-down', card).textContent = v.rate.at ? rateText(v.rate.down) : '—';
      MM.$('#nm-up', card).textContent = v.rate.at ? rateText(v.rate.up) : '—';
      MM.$('#nm-today', card).textContent = gb(v.today.down + v.today.up);
      MM.$('#nm-month', card).textContent = gb(v.month.down + v.month.up);
      MM.$('#nm-per', card).textContent = !v.available ? MM.t('Network monitoring needs Windows.') : v.error ? v.error : v.perAltHour != null ? MM.t('About {0} per alt per hour right now ({1} running)').replace('{0}', gb(v.perAltHour)).replace('{1}', v.alts) : MM.t('No alts running');
      MM.$('#nm-cap', card).innerHTML = v.cap ? `<div class="meter ${v.cap.pct >= 100 ? 'err' : v.cap.pct >= 80 ? 'warn' : ''}"><i style="width:${v.cap.pct}%"></i></div><div class="small muted" style="margin-top:4px">${MM.esc(MM.t('{0} of {1} GB used').replace('{0}', gb(v.cap.used)).replace('{1}', v.cap.gb))}</div>` : '';
      const max = Math.max(1, ...v.history.map(h => Math.max(h.down, h.up)));
      MM.chart(MM.$('#nm-chart', card), [{ data: v.history.map(h => (h.down / max) * 100), color: MM.accent(), fill: MM.accent(0.25), capacity: 90 }, { data: v.history.map(h => (h.up / max) * 100), color: '#f0abfc', capacity: 90 }], { max: 100 });
    };
    MM.call('netmon:view').then(draw);
    return MM.on('netmon:update', draw);
  });

  // ======================================================================
  // Watcher: fresh restarts
  // ======================================================================
  extend('watcher', (root) => {
    const mem = MM.$('#w-mem', root);
    const card = after(mem, `<div class="card spanall" id="fr-card"><h3>${MM.icon('rotate-ccw')}Fresh restarts<span class="right">${MM.toggle('freshRestart.enabled')}<b style="margin-left:6px">On</b></span></h3>
      <p class="sub">Long sessions get slower. Every few hours each alt is restarted back into the same server, one at a time with a gap between them, so they never all drop together.</p>
      <div class="tile-wrap" style="grid-template-columns:minmax(0,1fr) minmax(0,1.6fr)">
        <div><div class="form-grid" style="grid-template-columns:1fr 1fr">
            <div class="field"><label>Restart each alt every (hours)</label><input class="input" type="number" min="1" max="72" data-setting="freshRestart.everyHours"></div>
            <div class="field"><label>At least this long between two (minutes)</label><input class="input" type="number" min="1" max="240" data-setting="freshRestart.gapMin"></div></div>
          ${MM.settingRow('Never restart Main accounts', 'Main-tier alts are left alone.', MM.toggle('freshRestart.skipMain'))}
          ${MM.settingRow('Never restart the window I\'m using', 'Waits until you switch away.', MM.toggle('freshRestart.avoidFocused'))}</div>
        <div><div class="lbl">Next up</div><div class="list" id="fr-next"></div><div id="fr-recent" style="margin-top:10px"></div></div></div></div>`);
    if (!card) return null;
    MM.bindSettings(card);
    const draw = (r) => {
      if (!r) return;
      MM.$('#fr-next', card).innerHTML = r.next.length ? r.next.map(n => `<div class="item"><div class="grow"><div class="title" data-nt>${MM.esc(n.label)}</div><div class="meta">${n.dueAt <= Date.now() ? MM.esc(MM.t('Due now')) : MM.esc(MM.t('Due in {0}').replace('{0}', MM.fmt.dur(n.dueAt - Date.now())))}</div></div><button class="btn sm ghost" data-fr="${MM.esc(n.id)}">${MM.icon('rotate-ccw', 13)}Restart now</button></div>`).join('')
        : `<div class="small muted">${MM.esc(MM.t('No alts running'))}</div>`;
      MM.$('#fr-recent', card).innerHTML = r.recent.length ? `<div class="lbl">${MM.esc(MM.t('Recent'))}</div>${r.recent.slice(0, 5).map(x => `<div class="small"><span data-nt>${MM.esc(x.label)}</span> · ${MM.esc(MM.fmt.ago(x.at))}${x.auto ? '' : ` · ${MM.esc(MM.t('by you'))}`}</div>`).join('')}` : '';
    };
    card.addEventListener('click', async (e) => { const b = e.target.closest('[data-fr]'); if (b) draw(await MM.busy(b, () => MM.call('freshrestart:now', b.dataset.fr))); });
    MM.call('freshrestart:status').then(draw);
    const t = setInterval(() => MM.call('freshrestart:status').then(draw), 60_000);
    return () => clearInterval(t);
  });

  // ======================================================================
  // Settings: bring the checklist back
  // ======================================================================
  extend('settings', (root) => {
    const last = MM.$$('.card', root).at(-1);
    after(last, `<div class="card" style="margin-top:16px" id="gs-set"><h3>${MM.icon('list-checks')}Getting started</h3>${MM.settingRow('Hide the getting started checklist', 'It also goes away by itself once every step is done.', MM.toggle('checklist.hidden'))}</div>`);
    const c = MM.$('#gs-set', root);
    if (c) MM.bindSettings(c);
    return null;
  });
})();
