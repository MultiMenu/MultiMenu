// Language picker (first launch, and Settings → Language) and the
// "Switching from Roblox Account Manager" import, shared by the wizard and the Accounts page.
(function () {
  const MM = window.MM;

  const HELLO = { en: 'Choose your language', es: 'Elige tu idioma', de: 'Wähle deine Sprache', fr: 'Choisis ta langue', pt: 'Escolha seu idioma', nb: 'Velg språk', it: 'Scegli la lingua', pl: 'Wybierz język', tr: 'Dilini seç', ru: 'Выбери язык', id: 'Pilih bahasamu', vi: 'Chọn ngôn ngữ', fil: 'Piliin ang wika mo' };

  /** Shows the picker; picking a language reloads the window in that language. */
  MM.pickLanguage = async ({ first = false } = {}) => {
    const info = await MM.call('app:languages');
    if (!info) return;
    const current = info.current || info.suggested || 'en';
    const greet = [...new Set([current, 'en'])].map(id => HELLO[id]).filter(Boolean).join(' · ');
    const v = await MM.modal({
      cls: 'lang-modal', dismissable: !first, buttons: first ? [] : [{ label: 'Cancel', value: null, cls: 'ghost' }],
      body: `<div class="lang-pick" data-nt>
        <div class="logo-mark">M</div>
        <h2>${MM.esc(greet)}</h2>
        <p class="muted">${first ? 'You can change this any time in Settings.' : ''}</p>
        <div class="lang-grid">${info.list.map(l => `<button class="lang-btn ${l.id === current ? 'on' : ''}" data-lang="${l.id}"><b>${MM.esc(l.name)}</b>${l.name !== l.english ? `<span>${MM.esc(l.english)}</span>` : ''}</button>`).join('')}</div>
      </div>`,
      onMount: (m, close) => m.querySelectorAll('[data-lang]').forEach(b => { b.onclick = () => close(b.dataset.lang); }),
    });
    if (!v || (!first && v === info.current)) return;
    await MM.call('app:setLanguage', v); // the window reloads in the new language
  };

  // ---------- import from Roblox Account Manager ----------
  MM.openRamImport = async () => {
    const report = (r) => {
      if (!r) return;
      const bits = [`${r.added} added to “Sign in”`];
      if (r.skipped) bits.push(`${r.skipped} already in MultiMenu`);
      if (r.bad) bits.push(`${r.bad} lines skipped`);
      MM.toast('success', 'Accounts imported', bits.join(' · '), 6000);
      if (r.ignoredSecrets) MM.toast('info', 'Passwords were ignored', 'MultiMenu only kept the usernames. You sign in to each account yourself on the Roblox page.', 8000);
      document.dispatchEvent(new CustomEvent('mm:pending'));
    };
    return MM.modal({
      title: 'Switching from Roblox Account Manager', icon: 'arrow-right-left', wide: true,
      body: `<p class="desc">MultiMenu brings over your list of accounts (names, aliases, groups and descriptions). Then you sign in to each one once on the official Roblox page. Saved logins and passwords from the other app are never copied.</p>
        <div class="grid g2" style="margin-top:12px">
          <div class="card"><h3>${MM.icon('file-up')}From its file</h3><p class="small muted">Pick <b>AccountData.json</b> from the Roblox Account Manager folder. If that file is encrypted, paste your usernames instead.</p><button class="btn primary" data-a="file">${MM.icon('folder-open')}Choose AccountData.json</button></div>
          <div class="card"><h3>${MM.icon('list')}Paste usernames</h3><p class="small muted">One per line. Optional: <code>username, alias, group</code></p><textarea class="input" id="ri-list" rows="5" placeholder="NeonFalcon2291, Main&#10;VioletRaven_77, Farm 1, Alts"></textarea><button class="btn" data-a="list" style="margin-top:8px">${MM.icon('download')}Import list</button></div>
        </div>`,
      buttons: [{ label: 'Done', value: null }],
      onMount: (m, close) => {
        m.querySelector('[data-a="file"]').onclick = async (e) => {
          try { const r = await MM.busy(e.currentTarget, () => MM.api('accounts:ramFile')); if (r) { report(r); close(r); } }
          catch (err) { MM.toast(err.code === 'ENCRYPTED' ? 'warn' : 'error', 'Could not import', err.message, 8000); if (err.code === 'ENCRYPTED') m.querySelector('#ri-list').focus(); }
        };
        m.querySelector('[data-a="list"]').onclick = async (e) => {
          const text = m.querySelector('#ri-list').value;
          if (!text.trim()) return m.querySelector('#ri-list').focus();
          const r = await MM.busy(e.currentTarget, () => MM.call('accounts:ramList', text));
          if (r) { report(r); close(r); }
        };
      },
    });
  };

  /** "Waiting to sign in" panel for imported accounts. */
  MM.renderPending = async (el) => {
    if (!el) return;
    const list = await MM.call('accounts:pending') || [];
    if (!list.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = `<div class="row" style="margin-bottom:10px"><b style="font-family:var(--display);font-size:15px">${MM.icon('log-in', 18)} Waiting to sign in</b><span class="badge warn">${list.length}</span><span class="spacer"></span>
        <span class="small muted" id="pend-note">Sign in once on the Roblox page and the account moves to your list.</span>
        ${list.length > 1 ? `<button class="btn sm primary" data-pa-all>${MM.icon('log-in', 14)}Sign in all (${list.length})</button>` : ''}</div>
      <div class="list" style="max-height:240px;overflow:auto">${list.map(p => `<div class="item" data-pid="${MM.esc(p.id)}">
        <div class="grow"><div class="title" data-nt>${MM.esc(p.alias || p.displayName || p.username)}</div><div class="meta" data-nt>@${MM.esc(p.username)}${p.group ? ` · ${MM.esc(p.group)}` : ''}${p.hasPassword ? ` · <span style="display:inline-flex;align-items:center;gap:3px;vertical-align:middle">${MM.icon('key-round', 11)}${MM.esc(MM.t('password saved'))}</span>` : ''}</div></div>
        ${p.hasPassword ? `<button class="btn sm icon ghost" data-pa="copy" title="Copy the saved password">${MM.icon('copy', 14)}</button>` : ''}
        <button class="btn sm primary" data-pa="login">${MM.icon('log-in', 14)}Sign in</button>
        <button class="btn sm icon ghost" data-pa="remove" title="Remove from this list">${MM.icon('x', 14)}</button></div>`).join('')}</div>`;
    el.querySelectorAll('[data-pa]').forEach(b => {
      b.onclick = async () => {
        const id = b.closest('[data-pid]').dataset.pid;
        if (b.dataset.pa === 'remove') { await MM.call('accounts:pendingRemove', id); return MM.renderPending(el); }
        if (b.dataset.pa === 'copy') { if (await MM.call('accounts:pendingCopyPassword', id)) MM.toast('success', 'Password copied', 'Paste it on the Roblox page. The clipboard clears in 30 seconds.'); return; }
        const hasPw = b.closest('[data-pid]').querySelector('[data-pa="copy"]');
        if (hasPw) await MM.call('accounts:pendingCopyPassword', id).catch(() => {});
        MM.toast('info', 'Roblox sign-in opened', hasPw ? 'Your username is filled in and the password is on your clipboard. Paste it and finish on the Roblox page.' : 'Your username is filled in. Enter the password on the Roblox page.');
        await MM.busy(b, () => MM.call('accounts:pendingLogin', id));
        MM.renderPending(el);
      };
    });
    const all = el.querySelector('[data-pa-all]');
    if (all) all.onclick = () => signInAll(el, list);
  };

  // Signs the waiting accounts in one after another: when one finishes on the Roblox
  // page, the next sign-in opens by itself. Closing the Roblox window stops the queue.
  // The password goes to the clipboard (cleared after 30 s); the user pastes it and
  // handles any CAPTCHA on Roblox's own page, exactly as with a single sign-in.
  let queueRunning = false;
  async function signInAll(el, list) {
    if (queueRunning) return;
    queueRunning = true;
    let done = 0;
    let stopped = false;
    try {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const note = el.querySelector('#pend-note');
        if (note) note.textContent = MM.t('Signing in {0} of {1}: {2}. Close the Roblox window to stop.').replace('{0}', i + 1).replace('{1}', list.length).replace('{2}', p.username);
        el.querySelectorAll('[data-pa], [data-pa-all]').forEach(x => { x.disabled = true; });
        el.querySelectorAll('[data-pid]').forEach(x => x.classList.toggle('on', x.dataset.pid === p.id));
        if (p.hasPassword) await MM.api('accounts:pendingCopyPassword', p.id).catch(() => {});
        try {
          await MM.api('accounts:pendingLogin', p.id);
          done++;
          if (i < list.length - 1) await MM.renderPending(el); // the signed-in account leaves the list
        } catch (e) {
          if (e.code !== 'CANCELLED') MM.toast('error', 'Sign-in failed', `${p.username}: ${e.message}`);
          stopped = true;
          break;
        }
      }
    } finally {
      queueRunning = false;
      await MM.renderPending(el);
    }
    const left = list.length - done;
    if (stopped) MM.toast('info', 'Sign-in stopped', MM.t('{0} signed in, {1} still waiting.').replace('{0}', done).replace('{1}', left));
    else MM.toast('success', 'All signed in', MM.t('{0} accounts added to your list.').replace('{0}', done));
  }
}());
