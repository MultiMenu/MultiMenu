(function () {
  const MM = window.MM;
  const COLORS = { violet: '#a78bfa', pink: '#f472b6', blue: '#60a5fa', cyan: '#22d3ee', green: '#34d399', yellow: '#fbbf24', orange: '#fb923c', red: '#f87171' };
  MM.ACCOUNT_COLORS = COLORS;
  const STATUS = { valid: ['ok', 'Valid'], expired: ['err', 'Login expired'], error: ['warn', 'Check failed'], unknown: ['dim', 'Unchecked'] };

  MM.pages.accounts = {
    render(root) {
      let data = { accounts: [], groups: [] }, scores = {};
      let tab = 'all', query = '', selected = new Set();

      root.innerHTML = `
        <div class="page-head">
          <div><h1>Accounts</h1><p>Sign in through the official Roblox page. Logins are encrypted with Windows DPAPI and never shown or logged.</p></div>
          <div class="actions">
            <button class="btn" data-act="bin" id="acc-bin">${MM.icon('trash-2')}Recycle bin</button>
            <button class="btn" data-act="more" aria-haspopup="menu">${MM.icon('list')}More</button>
            <button class="btn" data-act="bulk">${MM.icon('clipboard-paste')}Bulk add</button>
            <button class="btn" data-act="cookie">${MM.icon('cookie')}Import cookie</button>
            <button class="btn primary" data-act="login">${MM.icon('log-in')}Log in with Roblox</button>
          </div>
        </div>
        <div id="acc-secure"></div>
        <div class="card" id="acc-pending" style="margin-bottom:12px;display:none"></div>
        <div class="card" id="acc-health" style="margin-bottom:12px"></div>
        <div class="card" id="acc-inbox" style="margin-bottom:16px"><div class="row" style="gap:12px"><div style="display:flex;gap:10px;align-items:center">${MM.icon('mail', 20)}<b style="font-family:var(--display);font-size:15px">Inbox watcher</b></div>
          ${MM.toggle('inbox.enabled')}<span class="small muted">Tell me about new</span>
          <label class="check-lbl small"><input type="checkbox" data-setting="inbox.trades"> trades</label><label class="check-lbl small"><input type="checkbox" data-setting="inbox.messages"> messages</label><label class="check-lbl small"><input type="checkbox" data-setting="inbox.friends"> friend requests</label>
          <span class="small muted">every</span><input class="input sm" type="number" min="2" max="120" style="width:64px" data-setting="inbox.intervalMin"><span class="small muted">min</span>
          <span class="spacer"></span><span class="small dim" id="ib-last"></span><button class="btn sm" data-act="inboxNow">${MM.icon('refresh-cw', 14)}Check now</button></div></div>
        <div class="row" style="margin-bottom:6px">
          <div class="tabs" id="acc-tabs" style="flex:1;margin-bottom:0"></div>
        </div>
        <div class="row acc-filter" style="margin:14px 0 8px">
          <input class="input" id="acc-search" placeholder="Search accounts…" style="max-width:240px" aria-label="Search accounts">
          <select class="input sm" id="acc-tier" aria-label="Priority"><option value="">Any priority</option><option value="main">Main</option><option value="important">Important</option><option value="filler">Filler</option></select>
          <select class="input sm" id="acc-tag" aria-label="Tag" data-nt></select>
          <select class="input sm" id="acc-status" aria-label="Status"><option value="">Any status</option><option value="valid">Valid</option><option value="expired">Login expired</option><option value="error">Check failed</option><option value="unknown">Unchecked</option></select>
          <button class="btn sm ghost" data-act="saveFilter" title="Save this filter">${MM.icon('bookmark', 14)}Save filter</button>
        </div>
        <div class="row" id="acc-saved" style="margin-bottom:10px"></div>
        <div class="row" style="margin:0 0 14px">
          <span class="spacer"></span>
          <span class="small muted" id="acc-selinfo"></span>
          <button class="btn sm" data-act="selectAll">Select all</button>
          <button class="btn sm" data-act="bulkEdit" disabled>${MM.icon('pencil', 14)}Edit selected</button>
          <button class="btn sm primary" data-act="launchSelected" disabled>${MM.icon('rocket', 14)}Launch selected</button>
        </div>
        <div class="acc-grid" id="acc-grid"></div>`;

      const grid = MM.$('#acc-grid', root);

      const fq = { tier: '', tag: '', status: '' };
      // ---------- export the list (never passwords or logins) ----------
      const exportList = async () => {
        const cols = await MM.call('accounts:exportColumns');
        if (!cols) return;
        const shown = visible();
        const def = ['username', 'displayName', 'alias', 'group', 'tags', 'notes'];
        let opts = null;
        const which = [['all', MM.t('All accounts ({0})').replace('{0}', data.accounts.length)],
          ...(shown.length !== data.accounts.length ? [['shown', MM.t('Only the ones shown now ({0})').replace('{0}', shown.length)]] : []),
          ...(selected.size ? [['selected', MM.t('Only the selected ({0})').replace('{0}', selected.size)]] : [])];
        const go = await MM.modal({
          title: 'Export account list', icon: 'file-text', wide: true,
          desc: 'A list for a spreadsheet or to keep. Passwords and logins are never included; use Backup to move accounts to another PC.',
          body: `<div class="stack">
            <div class="field"><label>Which accounts</label><div class="row" style="gap:14px">${which.map(([v, l], i) => `<label class="check-lbl"><input type="radio" name="ex-which" value="${v}" ${i === 0 ? 'checked' : ''}> ${MM.esc(l)}</label>`).join('')}</div></div>
            <div class="field"><label>Columns</label><div class="ex-cols">${Object.entries(cols).map(([k, l]) => `<label class="check-lbl"><input type="checkbox" data-col="${k}" ${def.includes(k) ? 'checked' : ''}> ${MM.esc(MM.t(l))}</label>`).join('')}</div></div>
            <div class="field"><label>Format</label><div class="row" style="gap:14px"><label class="check-lbl"><input type="radio" name="ex-fmt" value="csv" checked> ${MM.esc(MM.t('Spreadsheet (CSV)'))}</label><label class="check-lbl"><input type="radio" name="ex-fmt" value="txt"> ${MM.esc(MM.t('Text list'))}</label></div></div></div>`,
          buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Copy', value: 'copy', icon: 'copy' }, { label: 'Save file', value: 'save', cls: 'primary', icon: 'download' }],
          onMount: (m) => {
            const read = () => {
              const w = m.querySelector('input[name="ex-which"]:checked').value;
              opts = {
                ids: w === 'shown' ? shown.map(a => a.id) : w === 'selected' ? [...selected] : null,
                columns: [...m.querySelectorAll('[data-col]:checked')].map(x => x.dataset.col),
                format: m.querySelector('input[name="ex-fmt"]:checked').value,
              };
            };
            m.addEventListener('change', read); read();
          },
        });
        if (!go || !opts) return;
        if (!opts.columns.length) { MM.toast('warn', 'Pick at least one column'); return; }
        if (go === 'copy') { const r = await MM.call('accounts:copyList', opts); if (r) MM.toast('success', 'Copied', MM.t('{0} accounts copied as a text list.').replace('{0}', r.count)); return; }
        const r = await MM.call('accounts:saveList', opts);
        if (r) MM.toast('success', 'Account list saved', MM.t('{0} accounts, no passwords.').replace('{0}', r.count));
      };

      const visible = () => data.accounts.filter(a => {
        if (tab === 'fav' && !a.favourite) return false;
        if (tab !== 'all' && tab !== 'fav' && a.group !== tab) return false;
        if (fq.tier && a.tier !== fq.tier) return false;
        if (fq.tag && !(a.tags || []).includes(fq.tag)) return false;
        if (fq.status && (a.status || 'unknown') !== fq.status) return false;
        if (query) {
          const q = query.toLowerCase();
          return q.split(/\s+/).every(w => [a.username, a.displayName, a.alias, a.notes, a.group, ...(a.tags || [])].some(v => String(v || '').toLowerCase().includes(w)));
        }
        return true;
      });
      const renderFilters = () => {
        const tagSel = MM.$('#acc-tag', root);
        tagSel.innerHTML = `<option value="">${MM.esc(MM.t('Any tag'))}</option>${(data.tags || []).map(t => `<option value="${MM.esc(t.tag)}" ${fq.tag === t.tag ? 'selected' : ''}>#${MM.esc(t.tag)} (${t.count})</option>`).join('')}`;
        MM.$('#acc-tier', root).value = fq.tier; MM.$('#acc-status', root).value = fq.status;
        const saved = data.filters || [];
        MM.$('#acc-saved', root).innerHTML = saved.length ? `<span class="small muted">${MM.icon('bookmark', 13)}</span>${saved.map(f => `<span class="chip saved-filter" data-fid="${MM.esc(f.id)}"><button class="lnk" data-act="useFilter" data-nt>${MM.esc(f.name)}</button><button class="x" data-act="delFilter" title="Remove filter" aria-label="Remove filter">${MM.icon('x', 12)}</button></span>`).join('')}` : '';
        const bin = MM.$('#acc-bin', root);
        bin.innerHTML = `${MM.icon('trash-2')}Recycle bin${data.binCount ? ` <span class="count">${data.binCount}</span>` : ''}`;
      };

      const renderTabs = () => {
        const count = (g) => data.accounts.filter(a => a.group === g).length;
        const t = [['all', 'All', data.accounts.length], ['fav', 'Favourites', data.accounts.filter(a => a.favourite).length], ...data.groups.map(g => [g, g, count(g)])];
        MM.$('#acc-tabs', root).innerHTML = t.map(([id, label, n]) => `<button class="tab ${tab === id ? 'on' : ''}" data-act="tab" data-tab="${MM.esc(id)}">${id === 'fav' ? MM.icon('star', 14) : ''}${MM.esc(label)}<span class="count">${n}</span></button>`).join('')
          + `<button class="tab" data-act="newGroup" title="New group">${MM.icon('plus', 14)}Group</button>`
          + (!['all', 'fav'].includes(tab) ? `<span class="spacer"></span><button class="btn sm ghost" data-act="renameGroup">${MM.icon('pencil', 14)}Rename</button><button class="btn sm ghost" data-act="deleteGroup">${MM.icon('trash-2', 14)}Delete group</button>` : '');
      };

      const card = (a) => {
        const [cls, label] = STATUS[a.status] || STATUS.unknown;
        const name = a.alias || a.displayName || a.username;
        const ib = a.inbox || {};
        const pills = [[ib.trades, 'swords', 'trade'], [ib.messages, 'mail', 'unread message'], [ib.friends, 'user-plus', 'friend request']].filter(([n]) => n > 0)
          .map(([n, ic, t]) => `<span title="${n} ${t}${n === 1 ? '' : 's'}">${MM.icon(ic, 11)}${n}</span>`).join('');
        const drag = !query && !fq.tier && !fq.tag && !fq.status ? 'draggable="true"' : '';
        return `<div class="card acc hover ${selected.has(a.id) ? 'selected' : ''}" data-id="${MM.esc(a.id)}" ${drag} ${a.color ? `data-color="${a.color}" style="--acc-c:${COLORS[a.color]}"` : ''}>
          <div class="top">
            <input type="checkbox" class="check" data-act="select" ${selected.has(a.id) ? 'checked' : ''} title="Select">
            ${MM.avatar(a.avatarUrl, a.username)}
            <div style="min-width:0"><div class="name" data-nt>${MM.esc(name)}${pills ? ` <span class="inbox-pills">${pills}</span>` : ''}</div><div class="user" data-nt>@${MM.esc(a.username)}${a.alias ? ` · ${MM.esc(a.displayName)}` : ''}</div></div>
            ${MM.healthRing(scores[a.id], 32)}
            <button class="btn sm icon ghost fav ${a.favourite ? 'on' : ''}" data-act="fav" title="Favourite">${MM.icon('star', 16)}</button>
          </div>
          <div class="row">${MM.tierBadge(a.tier)}<span class="badge ${cls}">${MM.esc(label)}</span>${a.slot ? `<span class="badge dim" title="Hotkey slot">${MM.icon('keyboard', 12)}${a.slot}</span>` : ''}${a.health && ['banned', 'moderated'].includes(a.health.state) ? `<span class="badge err" title="${MM.esc(a.health.detail)}">${MM.icon('ban', 12)}${a.health.state === 'banned' ? 'Banned' : 'Moderated'}</span>` : ''}<span class="badge dim">${MM.icon('tag', 12)}${MM.esc(a.group)}</span>${a.hasPassword ? `<span class="badge dim">${MM.icon('key-round', 12)}Password saved</span>` : ''}</div>
          ${a.statusMessage && a.status !== 'valid' ? `<div class="small" style="color:var(--err)">${MM.esc(a.statusMessage)}</div>` : ''}
          ${a.detailsAt ? `<div class="row small"><span class="badge dim">${MM.icon('coins', 12)}${a.robux == null ? '—' : Number(a.robux).toLocaleString()} R$</span>${a.premium ? `<span class="badge">${MM.icon('crown', 12)}Premium</span>` : ''}${a.friendCount != null ? `<span class="badge dim">${MM.icon('users', 12)}${a.friendCount} friends</span>` : ''}</div>` : ''}
          ${a.tags?.length ? `<div class="row tag-row">${MM.tagChips(a.tags)}</div>` : ''}
          ${a.notes ? `<div class="small muted">${MM.esc(a.notes)}</div>` : ''}
          <div class="small dim">Last used ${MM.fmt.ago(a.lastUsedAt)}${a.defaultPlace ? ` · Default game ${MM.esc(a.defaultPlace.slice(0, 40))}` : ''}</div>
          <div class="acts">
            ${a.status === 'expired' ? `<button class="btn sm primary" data-act="relogin">${MM.icon('log-in', 14)}Log in again</button>` : `<button class="btn sm primary" data-act="launch">${MM.icon('play', 14)}Launch</button>`}
            <button class="btn sm" data-act="edit">${MM.icon('pencil', 14)}Edit</button>
            ${a.status !== 'expired' ? `<button class="btn sm icon" data-act="outfits" title="Outfits">${MM.icon('sparkles', 14)}</button>` : ''}
            ${a.status !== 'expired' ? `<button class="btn sm icon" data-act="browse" title="Open roblox.com signed in as this account">${MM.icon('globe', 14)}</button>` : ''}
            <button class="btn sm icon" data-act="refresh" title="Check login">${MM.icon('refresh-cw', 14)}</button>
            ${a.hasPassword ? `<button class="btn sm icon" data-act="copyPw" title="Copy password (clipboard clears after 30s)">${MM.icon('copy', 14)}</button>` : ''}
            <span class="spacer"></span>
            <button class="btn sm icon danger" data-act="remove" title="Remove">${MM.icon('trash-2', 14)}</button>
          </div>
        </div>`;
      };

      const render = () => {
        renderTabs(); renderFilters();
        const v = visible();
        grid.innerHTML = v.length ? v.map(card).join('') : `<div class="card spanall" style="grid-column:1/-1">${data.accounts.length ? MM.empty('search', 'No matches', 'Try another search or tab.') : MM.empty('users', 'No accounts yet', 'Click “Log in with Roblox” to add your first account.')}</div>`;
        MM.$('#acc-selinfo', root).textContent = selected.size ? `${selected.size} selected` : '';
        MM.$('[data-act="launchSelected"]', root).disabled = !selected.size;
        MM.$('[data-act="bulkEdit"]', root).disabled = !selected.size;
        MM.$('#acc-secure', root).innerHTML = data.secureStorage === false ? `<div class="callout err" style="margin-bottom:14px">${MM.icon('circle-alert')}<div>Secure storage is unavailable, so accounts can't be saved. This normally only happens outside Windows.</div></div>` : '';
      };

      const renderHealth = (h) => {
        if (!h) return;
        const el = MM.$('#acc-health', root);
        const bad = h.expired + h.banned + h.moderated;
        el.innerHTML = `<div class="row" style="gap:12px"><div style="display:flex;gap:10px;align-items:center">${MM.icon('heart-pulse', 20)}<b style="font-family:var(--display);font-size:15px">Account health</b></div>
          <span class="badge ${bad ? 'err' : 'ok'}">${bad ? `${bad} need attention` : 'All good'}</span>
          <span class="small muted">${h.ok} OK · ${h.expired} expired · ${h.banned} banned · ${h.moderated} moderated${h.unchecked ? ` · ${h.unchecked} not checked` : ''}${h.lastRun ? ` · checked ${MM.fmt.ago(h.lastRun)}` : ''}</span>
          <span class="spacer"></span>${MM.toggle('health.autoCheck')}<span class="small muted">Auto-check every</span><input class="input sm" type="number" min="1" max="72" style="width:64px" data-setting="health.intervalHours"><span class="small muted">h</span>
          <button class="btn sm" data-act="healthNow" ${h.running ? 'disabled' : ''}>${MM.icon('refresh-cw', 14)}${h.running ? 'Checking…' : 'Check now'}</button></div>
          <div class="row login-warn" style="gap:12px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">${MM.icon('key-round', 16)}<b>Login warnings</b>
            ${MM.toggle('loginCheck.enabled')}<span class="small muted">Evening check at</span><input class="input sm" type="time" style="width:110px" data-setting="loginCheck.time">
            <span class="spacer"></span>${MM.toggle('loginCheck.beforeStart')}<span class="small muted">Check logins before a preset starts</span></div>`;
        MM.bindSettings(el);
      };
      MM.call('health:summary').then(renderHealth);
      MM.bindSettings(MM.$('#acc-inbox', root));
      const ibLast = (st) => { if (st) MM.$('#ib-last', root).textContent = st.running ? 'Checking…' : st.lastRun ? `checked ${MM.fmt.ago(st.lastRun)}` : ''; };
      MM.call('inbox:status').then(ibLast);

      const load = async () => { const [r, hs] = await Promise.all([MM.call('accounts:list'), MM.call('health:scores')]); scores = hs || {}; if (r) { data = r; selected = new Set([...selected].filter(id => data.accounts.some(a => a.id === id))); render(); } };

      const idOf = (el) => el.closest('[data-id]').dataset.id;
      const acc = (el) => data.accounts.find(a => a.id === idOf(el));

      const login = async (btn, opts) => {
        MM.toast('info', 'Roblox sign-in opened', 'Log in normally in the new window. It closes by itself when you\'re done.');
        const r = await MM.busy(btn, () => MM.call('accounts:login', opts || { group: !['all', 'fav'].includes(tab) ? tab : undefined }));
        if (r) load();
      };

      const editModal = async (a) => {
        const caps = await MM.call('fps:caps') || [];
        const g = a.launchGraphics || {};
        let color = a.color || null;
        const groups = data.groups.map(g => `<option value="${MM.esc(g)}" ${g === a.group ? 'selected' : ''}>${MM.esc(g)}</option>`).join('');
        let patch = null;
        const ok = await MM.modal({
          title: `Edit ${a.username}`, icon: 'pencil',
          body: `<div class="stack">
            <div class="field"><label>Nickname (shown instead of the display name)</label><input class="input" id="e-alias" maxlength="40" value="${MM.esc(a.alias || '')}" placeholder="${MM.esc(a.displayName)}"></div>
            <div class="grid cols-2">
              <div class="field"><label>Group</label><select class="input" id="e-group" data-nt>${groups}</select></div>
              <div class="field"><label>Priority</label><select class="input" id="e-tier">${Object.entries(MM.TIERS).map(([k, [, l]]) => `<option value="${k}" ${a.tier === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            </div>
            <p class="hint" style="margin-top:-4px">Main is never closed or slowed down automatically. Filler alts go first when your PC runs low.</p>
            <div class="grid cols-2">
              <div class="field"><label>Tags (comma-separated)</label><input class="input" id="e-tags" list="e-taglist" maxlength="200" value="${MM.esc((a.tags || []).join(', '))}" placeholder="e.g. farm, trade"><datalist id="e-taglist">${(data.tags || []).map(t => `<option value="${MM.esc(t.tag)}">`).join('')}</datalist></div>
              <div class="field"><label>Hotkey slot</label><select class="input" id="e-slot"><option value="">None</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<option value="${n}" ${a.slot === n ? 'selected' : ''}>${MM.esc(MM.getSetting('altKeys.modifier') || 'Ctrl+Alt')}+${n}</option>`).join('')}</select></div>
            </div>
            <div class="field"><label>Default game (place ID or roblox.com link)</label><input class="input" id="e-place" value="${MM.esc(a.defaultPlace || '')}" placeholder="e.g. 920587237"></div>
            <div class="field"><label>Colour (card border, OpenMulti list and window tiles)</label><div class="color-dots" id="e-color"><button class="none ${!color ? 'on' : ''}" data-c="" title="None"></button>${Object.entries(COLORS).map(([k, v]) => `<button class="${color === k ? 'on' : ''}" data-c="${k}" style="--c:${v}" title="${k}"></button>`).join('')}</div></div>
            <div class="grid cols-2">
              <div class="field"><label>Graphics quality at launch</label><select class="input" id="e-q"><option value="">Don't change</option>${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}" ${g.quality === i + 1 ? 'selected' : ''}>${i + 1}${i === 0 ? ' (lowest)' : i === 9 ? ' (highest)' : ''}</option>`).join('')}</select></div>
              <div class="field"><label>FPS cap at launch</label><select class="input" id="e-fps"><option value="">Don't change</option>${caps.map(c => `<option value="${c}" ${g.fpsCap === c ? 'selected' : ''}>${c === -1 ? 'Unlimited' : `${c} FPS`}</option>`).join('')}</select></div>
            </div>
            <p class="hint" style="margin-top:-4px">Handy for keeping AFK alts on low graphics while your main stays on high. Applied just before this account starts.</p>
            <div class="field"><label>Notes</label><textarea class="input" id="e-notes" maxlength="1000">${MM.esc(a.notes || '')}</textarea></div>
            <div><button class="btn sm" id="e-shortcut">${MM.icon('monitor', 14)}Create desktop shortcut</button> <span class="small muted">Double-click it to launch this account straight away.</span></div>
          </div>`,
          onMount: (m) => {
            m.querySelector('#e-color').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; color = b.dataset.c || null; m.querySelectorAll('#e-color button').forEach(x => x.classList.toggle('on', x === b)); });
            m.querySelector('#e-shortcut').onclick = async () => { const f = await MM.call('shortcuts:create', 'account', a.id); if (f) MM.toast('success', 'Shortcut created', 'It\'s on your desktop.'); };
          },
          buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Save', value: true, cls: 'primary', handler: (m) => {
            const q = m.querySelector('#e-q').value, f = m.querySelector('#e-fps').value;
            patch = { alias: m.querySelector('#e-alias').value, group: m.querySelector('#e-group').value, tier: m.querySelector('#e-tier').value,
              tags: m.querySelector('#e-tags').value.split(','), slot: m.querySelector('#e-slot').value ? Number(m.querySelector('#e-slot').value) : null, defaultPlace: m.querySelector('#e-place').value, notes: m.querySelector('#e-notes').value,
              color, launchGraphics: q || f ? { quality: q ? Number(q) : null, fpsCap: f ? Number(f) : null } : null };
          } }],
        });
        if (ok && patch && await MM.call('accounts:update', a.id, patch)) { MM.toast('success', 'Saved', a.username); load(); }
      };

      // Bulk edit: tick a field to change it on every selected account; unticked fields stay as they are.
      const bulkModal = async (ids) => {
        const caps = await MM.call('fps:caps') || [];
        let color = null, patch = null;
        const row = (key, label, control) => `<div class="bulk-row" data-k="${key}"><label class="bulk-tick"><input type="checkbox" class="check" data-tick="${key}"><span>${label}</span></label><div class="bulk-ctl">${control}</div></div>`;
        const ok = await MM.modal({
          title: `Edit ${ids.length} accounts`, icon: 'pencil', wide: true,
          desc: 'Tick what you want to change. Everything else stays as it is on each account.',
          body: `<div class="stack bulk">
            ${row('group', 'Group', `<select class="input" id="b-group" data-nt>${data.groups.map(g => `<option value="${MM.esc(g)}">${MM.esc(g)}</option>`).join('')}</select>`)}
            ${row('tier', 'Priority', `<select class="input" id="b-tier">${Object.entries(MM.TIERS).map(([k, [, l]]) => `<option value="${k}">${l}</option>`).join('')}</select>`)}
            ${row('tags', 'Tags', `<div class="row" style="gap:8px"><select class="input" id="b-tmode" style="max-width:150px"><option value="add">Add tags</option><option value="remove">Remove tags</option></select><input class="input" id="b-tags" list="b-taglist" maxlength="200" placeholder="farm, trade"><datalist id="b-taglist">${(data.tags || []).map(t => `<option value="${MM.esc(t.tag)}">`).join('')}</datalist></div>`)}
            ${row('defaultPlace', 'Default game', `<input class="input" id="b-place" placeholder="Place ID or roblox.com link — blank clears it">`)}
            ${row('launchGraphics', 'Graphics at launch', `<div class="row" style="gap:8px"><select class="input" id="b-q"><option value="">Quality: don't change</option>${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">Quality ${i + 1}</option>`).join('')}</select><select class="input" id="b-fps"><option value="">FPS: don't change</option>${caps.map(c => `<option value="${c}">${c === -1 ? 'Unlimited' : `${c} FPS`}</option>`).join('')}</select></div>`)}
            ${row('favourite', 'Favourite', `<select class="input" id="b-fav"><option value="1">Add to favourites</option><option value="0">Remove from favourites</option></select>`)}
            ${row('color', 'Colour', `<div class="color-dots" id="b-color"><button class="none on" data-c="" title="None"></button>${Object.entries(COLORS).map(([k, v]) => `<button data-c="${k}" style="--c:${v}" title="${k}"></button>`).join('')}</div>`)}
            ${row('notes', 'Notes', `<div class="row" style="gap:8px"><select class="input" id="b-nmode" style="max-width:150px"><option value="add">Add a line</option><option value="clear">Clear notes</option></select><input class="input" id="b-notes" maxlength="300" placeholder="e.g. Farming alt — Pet Sim"></div>`)}
          </div>`,
          onMount: (m) => {
            const tick = (k) => { const t = m.querySelector(`[data-tick="${k}"]`); if (t && !t.checked) { t.checked = true; t.dispatchEvent(new Event('change')); } };
            m.querySelectorAll('.bulk-row').forEach(r => {
              const t = r.querySelector('[data-tick]');
              const sync = () => r.classList.toggle('on', t.checked);
              t.addEventListener('change', sync); sync();
              r.querySelector('.bulk-ctl').addEventListener('input', () => tick(r.dataset.k));
              r.querySelector('.bulk-ctl').addEventListener('click', (e) => { if (e.target.closest('button,select,input')) tick(r.dataset.k); });
            });
            m.querySelector('#b-color').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; color = b.dataset.c || null; m.querySelectorAll('#b-color button').forEach(x => x.classList.toggle('on', x === b)); });
          },
          buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Apply to all', value: true, cls: 'primary', handler: (m) => {
            const on = (k) => m.querySelector(`[data-tick="${k}"]`).checked;
            patch = {};
            if (on('group')) patch.group = m.querySelector('#b-group').value;
            if (on('tier')) patch.tier = m.querySelector('#b-tier').value;
            if (on('tags')) { const tags = m.querySelector('#b-tags').value.split(','); if (m.querySelector('#b-tmode').value === 'remove') patch.tagsRemove = tags; else patch.tagsAdd = tags; }
            if (on('defaultPlace')) patch.defaultPlace = m.querySelector('#b-place').value;
            if (on('launchGraphics')) { const q = m.querySelector('#b-q').value, f = m.querySelector('#b-fps').value; patch.launchGraphics = q || f ? { quality: q ? Number(q) : null, fpsCap: f ? Number(f) : null } : null; }
            if (on('favourite')) patch.favourite = m.querySelector('#b-fav').value === '1';
            if (on('color')) patch.color = color;
            if (on('notes')) { if (m.querySelector('#b-nmode').value === 'clear') patch.clearNotes = true; else patch.notesAppend = m.querySelector('#b-notes').value; }
            if (!Object.keys(patch).length) { MM.toast('warn', 'Nothing ticked', 'Tick at least one thing to change.'); return false; }
          } }],
        });
        if (!ok || !patch) return;
        const r = await MM.call('accounts:bulkUpdate', ids, patch);
        if (r) { MM.toast('success', `Updated ${r.changed} accounts`); load(); }
      };

      const launchModal = async (ids) => {
        const first = data.accounts.find(a => a.id === ids[0]);
        let target = null;
        const ok = await MM.modal({
          title: ids.length > 1 ? `Launch ${ids.length} accounts` : `Launch ${first.alias || first.username}`, icon: 'rocket',
          body: `<div class="field"><label>Game — place ID, game link or private server link</label><input class="input" id="l-target" value="${MM.esc((ids.length === 1 && first.defaultPlace) || MM.getSetting('accounts.defaultPlaceId') || '')}" placeholder="e.g. 920587237 or https://www.roblox.com/games/…"></div>
            <p class="hint" style="margin-top:8px">Leave blank to use each account's default game. ${ids.length > 1 ? `Accounts launch one after another, ${MM.getSetting('accounts.launchDelaySec')}s apart.` : ''}</p>`,
          buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Launch', value: true, cls: 'primary', icon: 'play', handler: (m) => { target = m.querySelector('#l-target').value.trim(); } }],
        });
        if (!ok) return;
        if (ids.length === 1) await MM.call('sessions:launch', ids[0], target || null);
        else await MM.call('sessions:launchMany', ids, target || null);
        MM.toast('info', 'Launching', 'Follow progress on the OpenMulti page.');
      };

      const binModal = async () => {
        let list = await MM.call('accounts:bin') || [];
        const draw = (m) => {
          m.querySelector('#bin-list').innerHTML = list.length ? list.map(a => `<div class="item" data-bid="${MM.esc(a.id)}">${MM.avatar(a.avatarUrl, a.username, 'sm')}<div class="grow"><div class="title" data-nt>${MM.esc(a.alias || a.displayName || a.username)}</div><div class="meta">@<span data-nt>${MM.esc(a.username)}</span> · ${MM.esc(MM.t('removed {0}').replace('{0}', MM.fmt.ago(a.deletedAt)))} · ${MM.esc(MM.t('deleted for good in {0} days').replace('{0}', Math.max(0, Math.ceil((a.purgeAt - Date.now()) / 86400000))))}</div></div>
            <button class="btn sm" data-bin="restore">${MM.icon('undo-2', 14)}Restore</button><button class="btn sm icon danger" data-bin="purge" title="Delete forever">${MM.icon('trash-2', 14)}</button></div>`).join('')
            : MM.empty('trash-2', 'The recycle bin is empty', 'Removed accounts wait here so you can bring them back.');
          m.querySelector('[data-bin-empty]')?.toggleAttribute('disabled', !list.length);
        };
        await MM.modal({
          title: 'Recycle bin', icon: 'trash-2', wide: true,
          desc: `Removed accounts stay here for ${MM.getSetting('accounts.binDays') ?? 30} days with their login still encrypted, then they are deleted for good.`,
          body: `<div class="list" id="bin-list" style="max-height:52vh;overflow:auto"></div>
            <div class="row" style="margin-top:12px"><span class="small muted">Keep removed accounts for</span><input class="input sm" type="number" min="0" max="365" style="width:70px" data-setting="accounts.binDays"><span class="small muted">days (0 = delete straight away)</span><span class="spacer"></span><button class="btn sm danger" data-bin-empty>${MM.icon('trash-2', 14)}Empty bin</button></div>`,
          onMount: (m) => {
            draw(m); MM.bindSettings(m);
            m.addEventListener('click', async (e) => {
              const b = e.target.closest('[data-bin]'); const emp = e.target.closest('[data-bin-empty]');
              if (emp) { if (await MM.confirm('Empty the recycle bin?', 'Every account in it is deleted for good. This can\'t be undone.', { danger: true, ok: 'Delete forever' })) { await MM.call('accounts:emptyBin'); list = []; draw(m); load(); } return; }
              if (!b) return;
              const id = b.closest('[data-bid]').dataset.bid;
              if (b.dataset.bin === 'restore') { const r = await MM.call('accounts:restore', id); if (r) { MM.toast('success', 'Account restored', r.username); list = list.filter(x => x.id !== id); draw(m); load(); } }
              else if (await MM.confirm('Delete forever?', 'Its saved login is erased from this PC. This can\'t be undone.', { danger: true, ok: 'Delete forever' })) { await MM.call('accounts:purge', id); list = list.filter(x => x.id !== id); draw(m); load(); }
            });
          },
        });
      };

      const handlers = {
        login: (b) => login(b),
        relogin: (b) => login(b, { group: acc(b).group }),
        cookie: async () => {
          let val = null, grp = null;
          const ok = await MM.modal({
            title: 'Import a Roblox cookie', icon: 'cookie',
            desc: 'Paste the .ROBLOSECURITY value for an account you own. It is checked with Roblox, encrypted, and never shown again.',
            body: `<div class="stack"><div class="field"><label>Cookie</label><textarea class="input mono" id="ck" placeholder="_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you…" spellcheck="false"></textarea></div>
              <div class="field"><label>Group</label><select class="input" id="ck-g" data-nt>${data.groups.map(g => `<option value="${MM.esc(g)}">${MM.esc(g)}</option>`).join('')}</select></div>
              <div class="callout warn">${MM.icon('shield-check')}<div>Never paste a cookie someone else sent you, and never share yours: anyone with it can sign in as you.</div></div></div>`,
            buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Import', value: true, cls: 'primary', handler: (m) => { val = m.querySelector('#ck').value; grp = m.querySelector('#ck-g').value; m.querySelector('#ck').value = ''; } }],
          });
          if (ok && val) { const r = await MM.call('accounts:importCookie', val, { group: grp }); val = null; if (r) load(); }
        },
        bulk: async () => {
          const USER = /^[A-Za-z0-9_]{3,20}$/;
          // Live preview only; the main process re-parses and is authoritative.
          const scan = (text) => {
            const seen = new Set(); let ok = 0, withPw = 0, dup = 0, bad = 0;
            for (const raw of String(text).split(/\r?\n/)) {
              const line = raw.trim();
              if (!line || line.startsWith('#') || line.startsWith('//')) continue;
              const m = /^(\S+?)\s*([:,\t ])\s*(.*)$/.exec(line);
              const u = (m ? m[1] : line).trim();
              if (!USER.test(u)) { bad++; continue; }
              const k = u.toLowerCase();
              if (seen.has(k)) { dup++; continue; }
              seen.add(k);
              ok++; if (m && m[3].trim()) withPw++;
              if (ok >= 200) break;
            }
            return { ok, withPw, dup, bad };
          };
          let text = null, grp = null;
          const ok = await MM.modal({
            title: 'Bulk add accounts', icon: 'clipboard-paste',
            desc: 'One account per line, as username:password (the password is optional). They go to "Waiting to sign in" — you finish each sign-in on the real Roblox page, where you also handle any CAPTCHA. Passwords are encrypted with Windows DPAPI and never shared, shown or logged.',
            body: `<div class="stack"><div class="field"><label>Accounts</label><textarea class="input mono" id="bulk-t" rows="9" spellcheck="false" placeholder="SkyRunner482:Tq8rLm2vXc&#10;PixelMoth19:nW4pZk7Lqe&#10;FrostByte77:Hy3bQe9Tsd"></textarea></div>
              <div class="row" style="gap:10px;align-items:center"><div class="small muted" id="bulk-count" data-nt>Paste your list above.</div><span class="spacer"></span><div class="field" style="margin:0"><label class="small">Group</label><select class="input sm" id="bulk-g" data-nt>${data.groups.map(g => `<option value="${MM.esc(g)}">${MM.esc(g)}</option>`).join('')}</select></div></div>
              <div class="callout">${MM.icon('info')}<div>You can also paste just usernames, or username,password,alias,group. Lines starting with # are skipped.</div></div></div>`,
            onMount: (m) => {
              const ta = m.querySelector('#bulk-t'); const out = m.querySelector('#bulk-count');
              const upd = () => {
                const s = scan(ta.value);
                const t = (k, n) => MM.esc(MM.t(k).replace('{0}', n));
                out.innerHTML = s.ok
                  ? `<b style="color:var(--ok)">${t('Accounts found: {0}', s.ok)}</b>${s.withPw ? ` · ${t('With a password: {0}', s.withPw)}` : ''}${s.dup ? ` · <span style="color:var(--warn)">${t('Duplicates: {0}', s.dup)}</span>` : ''}${s.bad ? ` · <span style="color:var(--warn)">${t('Lines not understood: {0}', s.bad)}</span>` : ''}`
                  : MM.esc(MM.t(ta.value.trim() ? 'No valid usernames yet.' : 'Paste your list above.'));
              };
              ta.addEventListener('input', upd); upd();
            },
            buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Add accounts', value: true, cls: 'primary', handler: (m) => { text = m.querySelector('#bulk-t').value; grp = m.querySelector('#bulk-g').value; m.querySelector('#bulk-t').value = ''; } }],
          });
          if (!ok || !text || !text.trim()) { text = null; return; }
          const r = await MM.call('accounts:addPendingBulk', text, { group: grp });
          text = null;
          if (!r) return;
          const t = (k, n) => MM.t(k).replace('{0}', n);
          const extra = [r.skipped ? t('Already added: {0}', r.skipped) : '', r.duplicates ? t('Duplicates: {0}', r.duplicates) : '', r.invalid ? t('Lines not understood: {0}', r.invalid) : ''].filter(Boolean).join(' · ');
          MM.toast(r.added ? 'success' : 'warn', r.added ? t('Waiting to sign in: {0}', r.added) : 'Nothing added', r.added ? `${extra}${extra ? ' · ' : ''}${MM.t('Press "Sign in all" to go through them one by one.')}` : extra);
          document.dispatchEvent(new CustomEvent('mm:pending'));
          load();
        },
        ramImport: async () => { await MM.openRamImport(); },
        importFile: async (b) => {
          const r = await MM.busy(b, () => MM.call('accounts:importFile'));
          if (r) { MM.toast(r.failed ? 'warn' : 'success', 'Import finished', `${r.added} added, ${r.failed} failed${r.errors[0] ? ` — ${r.errors[0]}` : ''}`); load(); }
        },
        outfits: async (el) => {
          const a = acc(el);
          let picker = null;
          await MM.modal({
            title: `Outfits — ${a.alias || a.displayName || a.username}`, icon: 'sparkles', wide: true,
            body: `<div class="grid g4" id="of-grid" style="max-height:52vh;overflow:auto"><div class="small muted">Loading outfits…</div></div>
              <div class="card" style="margin-top:14px;padding:14px"><div class="lbl" style="margin-bottom:8px">Also put the selected outfit on</div><div class="chips" id="of-to"></div>
              <p class="hint" style="margin-top:8px">Each account must own the items. Items it doesn't own are skipped and listed.</p></div>`,
            onMount: async (m) => {
              picker = MM.accountPicker(m.querySelector('#of-to'), data.accounts.filter(x => x.id !== a.id && x.status !== 'expired'));
              const list = await MM.call('outfits:list', a.id);
              const grid = m.querySelector('#of-grid');
              if (!list) { grid.innerHTML = MM.empty('sparkles', 'Could not load outfits', ''); return; }
              grid.innerHTML = list.length ? list.map(o => `<div class="card hover" style="padding:10px;text-align:center"><div style="aspect-ratio:1;border-radius:10px;background:hsla(270,50%,8%,.6);overflow:hidden;margin-bottom:8px">${o.imageUrl ? `<img src="${MM.esc(o.imageUrl)}" alt="" style="width:100%;height:100%;object-fit:cover">` : ''}</div><div class="small" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${MM.esc(o.name)}</div><button class="btn sm primary" style="margin-top:8px;width:100%" data-outfit="${o.id}">${MM.icon('check', 13)}Wear</button></div>`).join('')
                : MM.empty('sparkles', 'No saved outfits', 'Create outfits in the Roblox avatar editor first.');
              grid.addEventListener('click', async (e) => {
                const btn = e.target.closest('[data-outfit]');
                if (!btn) return;
                const targets = [a.id, ...picker.get()];
                const r = await MM.busy(btn, () => MM.call('outfits:copy', a.id, Number(btn.dataset.outfit), targets));
                if (!r) return;
                const bad = r.results.filter(x => !x.ok), partial = r.results.filter(x => x.ok && x.skipped.length);
                MM.toast(bad.length ? 'warn' : 'success', `“${r.outfit}” applied`, `${r.results.length - bad.length}/${r.results.length} accounts${partial.length ? ` · ${partial.map(p => `${p.account} skipped ${p.skipped.length} item${p.skipped.length > 1 ? 's' : ''}`).join(', ')}` : ''}${bad.length ? ` · failed: ${bad.map(x => x.account).join(', ')}` : ''}`, 9000);
                load();
              });
            },
          });
        },
        friendAlts: async () => {
          let picker = null, off = null;
          await MM.modal({
            title: 'Friend my alts', icon: 'heart-pulse', wide: true,
            desc: 'Makes every selected account friends with every other one, so “join friend” and squad joins always work. One account sends, the other accepts.',
            body: `<div class="chips" id="fa-pick"></div>
              <div class="callout" style="margin-top:12px">${MM.icon('info')}<div>Roblox sometimes asks for a CAPTCHA on friend requests. MultiMenu never solves those — it lists any pairs you need to finish on roblox.com, and pauses if Roblox keeps asking.</div></div>
              <div class="progress hidden" id="fa-prog" style="margin-top:14px"><i></i></div><div class="list" id="fa-res" style="margin-top:10px;max-height:34vh;overflow:auto"></div>`,
            onMount: (m) => {
              picker = MM.accountPicker(m.querySelector('#fa-pick'), data.accounts, { selected: data.accounts.filter(x => x.status !== 'expired').map(x => x.id) });
              const ST = { done: ['ok', 'Now friends'], already: ['dim', 'Already'], captcha: ['warn', 'CAPTCHA'], failed: ['err', 'Failed'], skipped: ['warn', 'Paused'] };
              off = MM.on('alts:progress', (p) => {
                m.querySelector('#fa-prog').classList.remove('hidden');
                m.querySelector('#fa-prog i').style.width = `${Math.round((p.done / p.total) * 100)}%`;
                m.querySelector('#fa-res').innerHTML = p.results.map(r => `<div class="item"><span class="badge ${ST[r.state][0]}">${ST[r.state][1]}</span><div class="grow"><div class="title">${MM.esc(r.pair)}</div><div class="meta">${MM.esc(r.detail)}</div></div></div>`).join('');
              });
            },
            buttons: [{ label: 'Close', value: null, cls: 'ghost' }, { label: 'Make them friends', cls: 'primary', icon: 'heart-pulse', handler: async () => {
              const ids = picker.get();
              const n = ids.length * (ids.length - 1) / 2;
              MM.toast('info', `Working through ${n} pair${n === 1 ? '' : 's'}`, 'About 3 seconds each.');
              const r = await MM.call('alts:friend', ids);
              if (r) { const d = r.results.filter(x => x.state === 'done').length; MM.toast('success', 'Friend alts finished', `${d} new friendship${d === 1 ? '' : 's'} · ${r.results.filter(x => x.state === 'captcha').length} need a CAPTCHA`); }
              return false;
            } }],
          });
          off?.();
        },
        more: (b) => MM.menu(b, [
          { label: 'Refresh all', icon: 'refresh-cw', run: () => handlers.refreshAll(b) },
          { label: 'Robux & details', icon: 'coins', run: () => handlers.detailsAll(b) },
          { label: 'Friend my alts', icon: 'heart-pulse', run: () => handlers.friendAlts() },
          { label: 'Give hotkey slots 1–9', icon: 'keyboard', run: async () => { if (await MM.confirm('Give hotkey slots 1–9?', 'Main accounts get the first numbers, then Important, then the rest in your order. Turn the hotkeys on in Settings.', { ok: 'Assign' })) { const r = await MM.call('accounts:autoSlots'); if (r) { data = r; render(); MM.toast('success', 'Hotkey slots assigned'); } } } },
          '-',
          { label: 'Bulk add (username:password)', icon: 'clipboard-paste', run: () => handlers.bulk() },
          { label: 'From Roblox Account Manager', icon: 'arrow-right-left', run: () => handlers.ramImport() },
          { label: 'Import file', icon: 'file-up', run: () => handlers.importFile(b) },
          '-',
          { label: 'Export list (no passwords)', icon: 'file-text', run: () => exportList() },
          { label: 'Backup', icon: 'archive', run: () => handlers.backup() },
          { label: 'Restore', icon: 'undo-2', run: () => handlers.restore() },
        ]),
        bin: () => binModal(),
        saveFilter: async () => {
          if (!query && !fq.tier && !fq.tag && !fq.status && ['all', 'fav'].includes(tab)) return MM.toast('warn', 'Nothing to save', 'Pick a tag, priority, status or search first.');
          const n = await MM.prompt('Save filter', 'Name', fq.tag ? `#${fq.tag}` : '', { ok: 'Save' });
          if (!n) return;
          const r = await MM.call('accounts:saveFilter', n, { text: query, group: ['all', 'fav'].includes(tab) ? '' : tab, tag: fq.tag, tier: fq.tier, status: fq.status });
          if (r) { data.filters = r; render(); }
        },
        useFilter: (b) => {
          const f = (data.filters || []).find(x => x.id === b.closest('[data-fid]').dataset.fid);
          if (!f) return;
          Object.assign(fq, { tier: f.q.tier, tag: f.q.tag, status: f.q.status });
          tab = f.q.group && data.groups.includes(f.q.group) ? f.q.group : 'all';
          query = f.q.text || ''; MM.$('#acc-search', root).value = query;
          render();
        },
        delFilter: async (b) => { const r = await MM.call('accounts:removeFilter', b.closest('[data-fid]').dataset.fid); if (r) { data.filters = r; render(); } },
        healthNow: async (b) => { MM.toast('info', 'Checking every account', 'Logins, bans and moderation notices.'); const r = await MM.busy(b, () => MM.call('health:checkAll')); if (r) { renderHealth(r); load(); MM.toast(r.expired + r.banned + r.moderated ? 'warn' : 'success', 'Health check done', `${r.ok} OK · ${r.expired} expired · ${r.banned} banned · ${r.moderated} moderated`); } },
        detailsAll: async (b) => { MM.toast('info', 'Fetching account details', 'Robux, Premium and friends for each account.'); const r = await MM.busy(b, () => MM.call('accounts:detailsAll')); if (r) { data = r; render(); MM.toast('success', 'Details updated'); } },
        backup: async () => {
          let pw = null;
          const ok = await MM.modal({
            title: 'Encrypted backup', icon: 'archive', desc: 'Saves every account (logins and saved passwords), groups, presets, saved games and webhooks into one file locked with a password. Use it to move to a new PC.',
            body: `<div class="stack"><div class="field"><label>Backup password (8+ characters)</label><input class="input" type="password" id="bk1" autocomplete="new-password"></div><div class="field"><label>Repeat password</label><input class="input" type="password" id="bk2" autocomplete="new-password"></div>
              <div class="callout warn">${MM.icon('triangle-alert')}<div>Anyone with this file AND the password can sign in to every account in it. Keep both safe. The password can't be recovered.</div></div></div>`,
            buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Save backup', value: true, cls: 'primary', icon: 'save', handler: (m) => {
              const a1 = m.querySelector('#bk1').value, a2 = m.querySelector('#bk2').value;
              if (a1.length < 8) { MM.toast('warn', 'Password too short', 'Use at least 8 characters.'); return false; }
              if (a1 !== a2) { MM.toast('warn', 'Passwords don\'t match'); return false; }
              pw = a1;
            } }],
          });
          if (!ok) return;
          const r = await MM.call('backup:export', pw); pw = null;
          if (r) MM.toast('success', 'Backup saved', `${r.count} accounts → ${r.path}`, 7000);
        },
        restore: async () => {
          let pw = null;
          const ok = await MM.modal({
            title: 'Restore from backup', icon: 'undo-2', desc: 'Pick a .mmvault file and enter its password. Accounts are checked with Roblox; ones you already have are updated, not duplicated.',
            body: `<div class="field"><label>Backup password</label><input class="input" type="password" id="rs1"></div>`,
            buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Choose file…', value: true, cls: 'primary', icon: 'folder-open', handler: (m) => { pw = m.querySelector('#rs1').value; } }],
          });
          if (!ok) return;
          MM.toast('info', 'Restoring…', 'This can take a moment per account.');
          const r = await MM.call('backup:import', pw); pw = null;
          if (r) { MM.toast(r.failed ? 'warn' : 'success', 'Restore finished', `${r.accounts} accounts, ${r.presets} presets, ${r.games} games, ${r.webhooks} webhooks${r.failed ? ` · ${r.failed} accounts failed${r.errors[0] ? ` (${r.errors[0]})` : ''}` : ''}`, 9000); load(); }
        },
        refreshAll: async (b) => { const r = await MM.busy(b, () => MM.call('accounts:refreshAll')); if (r) { data = r; render(); MM.toast('success', 'Accounts checked'); } },
        tab: (b) => { tab = b.dataset.tab; render(); },
        newGroup: async () => { const n = await MM.prompt('New group', 'Group name', '', { ok: 'Create' }); if (n && await MM.call('accounts:addGroup', n)) { tab = n.trim(); load(); } },
        renameGroup: async () => { const n = await MM.prompt('Rename group', 'New name', tab); if (n && await MM.call('accounts:renameGroup', tab, n)) { tab = n.trim(); load(); } },
        deleteGroup: async () => { if (await MM.confirm(`Delete group “${tab}”?`, 'Accounts in it move to your first group. No accounts are deleted.', { danger: true, ok: 'Delete group' })) { await MM.call('accounts:deleteGroup', tab); tab = 'all'; load(); } },
        select: (el) => { const id = idOf(el); if (selected.has(id)) selected.delete(id); else selected.add(id); render(); },
        selectAll: () => { const v = visible(); if (v.every(a => selected.has(a.id))) v.forEach(a => selected.delete(a.id)); else v.forEach(a => selected.add(a.id)); render(); },
        launchSelected: () => launchModal([...selected]),
        bulkEdit: () => bulkModal([...selected]),
        launch: (el) => launchModal([idOf(el)]),
        inboxNow: async (b) => { MM.toast('info', 'Checking inboxes', 'Trades, messages and friend requests for each account.'); const st = await MM.busy(b, () => MM.call('inbox:check')); ibLast(st); load(); },
        browse: async (el) => { const a = acc(el); await MM.call('browse:open', a.id); },
        fav: async (el) => { const a = acc(el); if (await MM.call('accounts:update', a.id, { favourite: !a.favourite })) load(); },
        edit: (el) => editModal(acc(el)),
        refresh: async (el) => { const r = await MM.busy(el, () => MM.call('accounts:refresh', idOf(el))); if (r) { load(); MM.toast(r.status === 'valid' ? 'success' : 'warn', r.status === 'valid' ? 'Login is valid' : 'Login needs attention', r.statusMessage || r.username); } },
        copyPw: async (el) => { if (await MM.call('accounts:copyPassword', idOf(el))) MM.toast('success', 'Password copied', 'The clipboard is cleared again in 30 seconds.'); },
        remove: async (el) => {
          const a = acc(el);
          const days = MM.getSetting('accounts.binDays') ?? 30;
          if (MM.getSetting('accounts.confirmBeforeRemove') && !(await MM.confirm(`Remove ${a.username}?`, days > 0 ? `It goes to the recycle bin. You can restore it for ${days} days.` : 'Its saved login is deleted from this PC. The Roblox account itself is not affected.', { danger: true, ok: 'Remove' }))) return;
          if (await MM.call('accounts:remove', a.id)) { selected.delete(a.id); load(); }
        },
      };
      MM.delegate(root, handlers);
      MM.$('#acc-search', root).addEventListener('input', (e) => { query = e.target.value; render(); });
      for (const [id, k] of [['#acc-tier', 'tier'], ['#acc-tag', 'tag'], ['#acc-status', 'status']]) MM.$(id, root).addEventListener('change', (e) => { fq[k] = e.target.value; render(); });

      // drag to reorder
      let dragId = null;
      grid.addEventListener('dragstart', (e) => { const c = e.target.closest('[data-id]'); if (!c) return; dragId = c.dataset.id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      grid.addEventListener('dragend', () => { dragId = null; MM.$$('.dragging, .drag-over', grid).forEach(x => x.classList.remove('dragging', 'drag-over')); });
      grid.addEventListener('dragover', (e) => { const c = e.target.closest('[data-id]'); if (!dragId || !c) return; e.preventDefault(); MM.$$('.drag-over', grid).forEach(x => x !== c && x.classList.remove('drag-over')); if (c.dataset.id !== dragId) c.classList.add('drag-over'); });
      grid.addEventListener('drop', async (e) => {
        const c = e.target.closest('[data-id]');
        if (!dragId || !c || c.dataset.id === dragId) return;
        e.preventDefault();
        const ids = data.accounts.map(a => a.id).filter(id => id !== dragId);
        ids.splice(ids.indexOf(c.dataset.id), 0, dragId);
        data.accounts.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id));
        render();
        await MM.call('accounts:reorder', ids);
      });

      const pend = () => MM.renderPending(MM.$('#acc-pending', root));
      load(); pend();
      const offA = MM.on('accounts:changed', () => { load(); pend(); });
      document.addEventListener('mm:pending', pend);
      return () => { offA(); document.removeEventListener('mm:pending', pend); };
    },
  };
})();
