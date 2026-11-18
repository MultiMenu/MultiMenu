(function () {
  const MM = window.MM;

  MM.pages.creator = {
    render(root) {
      root.innerHTML = `
        <div class="page-head"><div><h1>Account Creator</h1><p>Generate a username and a strong password, then finish signing up on the official Roblox page yourself.</p></div></div>
        <div class="grid g3">
          <div class="card span2">
            <h3>${MM.icon('wand-sparkles')}New account details</h3>
            <div class="stack">
              <div class="field"><label>Username</label>
                <div class="row nowrap"><input class="input" id="c-user" maxlength="20" spellcheck="false">
                  <button class="btn icon" data-act="genUser" title="Generate another">${MM.icon('dices')}</button>
                  <button class="btn icon" data-act="copyUser" title="Copy">${MM.icon('copy')}</button>
                  <button class="btn" data-act="check">${MM.icon('search')}Check</button></div>
                <div class="hint" id="c-ucheck">3–20 letters or numbers, at most one underscore.</div></div>
              <div class="field"><label>Password</label>
                <div class="row nowrap"><input class="input mono" id="c-pass" type="password" spellcheck="false">
                  <button class="btn icon" data-act="show" title="Show / hide">${MM.icon('eye')}</button>
                  <button class="btn icon" data-act="genPass" title="Generate another">${MM.icon('dices')}</button>
                  <button class="btn icon" data-act="copyPass" title="Copy">${MM.icon('copy')}</button></div>
                <div class="hint" id="c-pstr"></div></div>
              <div class="field"><label>Nickname in MultiMenu (optional)</label><input class="input" id="c-alias" maxlength="40" placeholder="e.g. Farming alt"></div>
              <div class="row" style="margin-top:6px"><button class="btn primary big" data-act="open">${MM.icon('external-link')}Open Roblox sign-up</button></div>
            </div>
          </div>
          <div class="card">
            <h3>${MM.icon('list')}How it works</h3>
            <ol class="muted" style="padding-left:18px;margin:0;display:flex;flex-direction:column;gap:8px">
              <li>MultiMenu opens <b>roblox.com/CreateAccount</b> in a private window and fills in the username and password.</li>
              <li>You choose your birthday, complete the CAPTCHA and press <b>Sign Up</b> yourself.</li>
              <li>When Roblox signs you in, the window closes and the account is saved here, encrypted, with its password.</li>
            </ol>
            <div class="callout" style="margin-top:14px">${MM.icon('shield-check')}<div>One sign-up window at a time. MultiMenu never solves CAPTCHAs or submits the form for you, and doesn't support bulk creation.</div></div>
          </div>
        </div>`;

      const u = MM.$('#c-user', root), p = MM.$('#c-pass', root);
      const strength = () => {
        const v = p.value; let s = 0;
        if (v.length >= 12) s++; if (v.length >= 16) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++;
        const label = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'][s];
        MM.$('#c-pstr', root).innerHTML = `Strength: <b style="color:${s >= 4 ? 'var(--ok)' : s >= 3 ? 'var(--warn)' : 'var(--err)'}">${label}</b> · ${v.length} characters`;
      };
      const genUser = async () => { u.value = await MM.call('creator:username') || u.value; MM.$('#c-ucheck', root).textContent = 'Not checked yet.'; };
      const genPass = async () => { p.value = await MM.call('creator:password') || p.value; strength(); };
      genUser(); genPass();
      p.addEventListener('input', strength);

      MM.delegate(root, {
        genUser, genPass,
        show: () => { p.type = p.type === 'password' ? 'text' : 'password'; },
        copyUser: async () => { await MM.call('creator:copy', u.value); MM.toast('success', 'Username copied'); },
        copyPass: async () => { await MM.call('creator:copy', p.value); MM.toast('success', 'Password copied'); },
        check: async (b) => {
          const r = await MM.busy(b, () => MM.call('creator:check', u.value.trim()));
          if (!r) return;
          const el = MM.$('#c-ucheck', root);
          el.innerHTML = !r.checked ? MM.esc(r.message) : r.valid ? `<span style="color:var(--ok)">✓ ${MM.esc(r.message || 'Available')}</span>` : `<span style="color:var(--err)">✗ ${MM.esc(r.message)}</span>`;
        },
        open: async (b) => {
          MM.toast('info', 'Sign-up window opened', 'Pick your birthday, complete the CAPTCHA and press Sign Up.', 7000);
          const r = await MM.busy(b, () => MM.call('creator:open', { username: u.value.trim(), password: p.value, alias: MM.$('#c-alias', root).value.trim() }));
          if (r) { MM.toast('success', 'Account saved', `${r.username} was added to your accounts.`); genUser(); genPass(); }
        },
      });
    },
  };
})();
