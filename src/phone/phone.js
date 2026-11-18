// MultiMenu phone dashboard. Talks only to the MultiMenu on this network.
(function () {
  const app = document.getElementById('app');
  let token = null, data = null, shots = {}, t = (s) => s;
  let loop = null, thumbLoop = null, fails = 0, busy = false; // the refresh loop
  let touching = false, pending = false, touchTimer = null;   // no redraw under a finger
  const inFlight = new Set();                                 // actions waiting for the PC
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // An id per action, so a retry after a dropped connection never runs it twice.
  // (crypto.randomUUID needs https; getRandomValues works on the home network.)
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  try { token = localStorage.getItem('mm-token'); } catch { /* private mode */ }
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = (s) => esc(t(s));

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = t(msg); el.classList.add('on');
    clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), 2600);
  }

  /** One request to the PC. A dropped connection (Wi-Fi blip, phone waking up) is tried
   *  again a couple of times before it counts as "can't reach your PC". */
  async function api(path, body, tries = 3) {
    for (let i = 0; ; i++) {
      const ctl = new AbortController();
      const limit = setTimeout(() => ctl.abort(), 12000);
      let r;
      try {
        r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: ctl.signal });
      } catch {
        clearTimeout(limit);
        if (i + 1 < tries) { await sleep(i ? 1200 : 350); continue; }
        throw Object.assign(new Error("Can't reach your PC."), { network: true });
      }
      clearTimeout(limit);
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 && path !== '/api/login') { signOut(false, j.error || 'Sign in again.'); throw Object.assign(new Error(j.error || 'Sign in again.'), { quiet: true }); }
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      return j;
    }
  }

  /** The banner while the PC can't be reached; the page keeps trying by itself. */
  function setOffline(on) {
    const el = document.getElementById('net');
    if (!el) return;
    if (!on) { el.classList.add('hidden'); return; }
    el.innerHTML = `<b>${T("Can't reach your PC")}</b><span>${T('Check that your phone is on the same Wi-Fi as the PC, the PC is awake and MultiMenu is open. Still trying…')}</span><button type="button" class="ghost" id="net-retry">${T('Try again')}</button>`;
    el.classList.remove('hidden');
    document.getElementById('net-retry').onclick = () => { fails = 0; schedule(0); };
  }

  function dur(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  function signOut(callServer = true, why) {
    if (callServer && token) api('/api/logout', {}, 1).catch(() => {});
    token = null; try { localStorage.removeItem('mm-token'); } catch { /* ignore */ }
    clearTimeout(loop); clearTimeout(thumbLoop); setOffline(false); login(why);
  }

  function login(error) {
    document.getElementById('logout').classList.add('hidden');
    app.innerHTML = `<form class="login" id="f" autocomplete="off">
      <h1>${T('Sign in to MultiMenu')}</h1>
      <p>${T('Enter the 6-digit PIN you set in MultiMenu on your PC.')}</p>
      <input class="pin" id="pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" aria-label="${T('PIN')}">
      <label class="remember"><input type="checkbox" id="remember" checked> ${T('Remember this phone for 30 days')}</label>
      <button class="primary" type="submit">${T('Sign in')}</button>
      <div class="login-err" id="err">${esc(error ? t(error) : '')}</div>
    </form>`;
    const pin = document.getElementById('pin');
    pin.focus();
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/login', { pin: pin.value.trim(), remember: document.getElementById('remember').checked }, 2);
        token = r.token; try { localStorage.setItem('mm-token', token); } catch { /* ignore */ }
        dashboard();
      } catch (err) { document.getElementById('err').textContent = t(err.message); pin.value = ''; pin.focus(); }
    };
  }

  function stateOf(s) {
    if (s.state === 'not responding') return ['err', 'Not responding'];
    if (s.state === 'in game' || s.state === 'running') return ['ok', 'In game'];
    return ['', 'Loading'];
  }

  /** Redraws, unless a finger is on the screen: a tap that lands on a button
   *  being replaced is lost, so the redraw waits until the tap is done. */
  function paint() {
    if (touching) { pending = true; return; }
    render();
  }
  function render() {
    if (!data) return;
    const live = data.sessions.length;
    const c = data.control;
    app.innerHTML = `
      <div class="card"><div class="stats">
        <div class="stat"><b>${live}</b><span>${T('running')}</span></div>
        <div class="stat"><b>${data.pc ? `${data.pc.cpu}%` : '—'}</b><span>CPU</span></div>
        <div class="stat"><b>${data.pc ? `${data.pc.ram}%` : '—'}</b><span>RAM</span></div>
      </div></div>
      <div class="card"><div class="row"><div class="grow"><b>${T('24/7 Watcher')}</b><div class="muted">${data.watcher.queued ? T(data.watcher.queued === 1 ? '1 rejoin queued' : `${data.watcher.queued} rejoins queued`) : T('Rejoins alts that crash or disconnect')}</div></div>
        <button class="toggle ${data.watcher.enabled ? 'on' : ''}" data-act="watcher" ${c ? '' : 'disabled'} aria-label="${T('24/7 Watcher')}"></button></div></div>
      <div class="card"><h2>${T('Accounts')}<span class="grow"></span>${c && live ? `<button class="ghost" data-act="tile">${T('Tile')}</button>` : ''}</h2>
        <div class="sess">${live ? data.sessions.map(s => { const [cls, label] = stateOf(s); return `<div class="s">
          ${data.thumbs ? `<div class="shot" data-shot="${esc(s.id)}">${shots[s.id] ? `<img src="${shots[s.id]}" alt="">` : `<span>${T(s.status === 'running' ? 'Minimised' : 'Starting…')}</span>`}</div>` : ''}
          <div class="head"><span class="dot ${cls}"></span><div class="grow" style="min-width:0"><div class="name">${esc(s.label)}</div>
          <div class="meta">${T(label)}${s.game ? ` · ${esc(s.game)}` : ''}${s.since ? ` · ${T(dur(data.at - s.since))}` : ''}${s.memMB ? ` · ${s.memMB} MB` : ''}</div></div></div>
          ${c ? `<div class="btns"><button data-act="rejoin" data-id="${esc(s.id)}">${T('Rejoin')}</button><button class="danger" data-act="close" data-id="${esc(s.id)}">${T('Close')}</button></div>` : ''}
        </div>`; }).join('') : `<div class="empty">${T('Nothing running.')}</div>`}</div>
        ${c && live > 1 ? `<button class="danger" style="width:100%;margin-top:10px" data-act="closeAll">${T('Close all')}</button>` : ''}
      </div>
      ${c && data.offline?.length ? `<div class="card"><h2>${T('Not running')}</h2><div class="presets">${data.offline.map(a => `<div class="p"><div class="grow"><b>${esc(a.label)}</b>${a.tier === 'main' ? `<span class="muted">${T('Main')}</span>` : ''}</div><button data-act="launch" data-id="${esc(a.id)}">${T('Launch')}</button></div>`).join('')}</div></div>` : ''}
      <div class="card"><h2>${T('Presets')}</h2><div class="presets">${data.presets.length ? data.presets.map(p => `<div class="p"><div class="grow"><b>${esc(p.name)}</b><span class="muted">${T(`${p.count} accounts`)}</span></div>
        ${c ? `<button class="primary" data-act="preset" data-id="${esc(p.id)}">${T('Start')}</button>` : ''}</div>`).join('') : `<div class="empty">${T('No presets yet.')}</div>`}</div></div>
      ${c ? '' : `<p class="foot">${T('Control from the phone is turned off in MultiMenu.')}</p>`}
      ${standalone() || hintHidden() ? '' : `<div class="card hint"><b>${T('Add MultiMenu to your home screen')}</b><p class="muted">${T('iPhone: Share, then Add to Home Screen. Android: the ⋮ menu, then Add to Home screen.')}</p><button class="ghost" data-act="hideHint">${T('Got it')}</button></div>`}
      <p class="foot">${T('Updated')} ${new Date(data.at).toLocaleTimeString(data.lang === 'en' ? [] : data.lang)}</p>`;
    for (const b of app.querySelectorAll('[data-act]')) if (inFlight.has(`${b.dataset.act}:${b.dataset.id || ''}`)) b.disabled = true;
  }

  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const hintHidden = () => { try { return localStorage.getItem('mm-hint') === '1'; } catch { return true; } };

  // One refresh at a time, every 5 s; slower while the PC can't be reached.
  function schedule(ms) { clearTimeout(loop); loop = setTimeout(tick, ms); }
  async function tick() {
    if (!token) return;
    if (document.hidden) { schedule(5000); return; }
    if (busy) { schedule(800); return; }
    busy = true;
    try {
      data = await api('/api/status');
      fails = 0; setOffline(false); paint();
    } catch (e) {
      if (e.quiet) { busy = false; return; }
      fails++;
      if (fails >= 2 || !data) setOffline(true);
    }
    busy = false;
    schedule(fails ? Math.min(15000, 3000 * fails) : 5000);
  }
  function scheduleShots(ms) { clearTimeout(thumbLoop); thumbLoop = setTimeout(shotsTick, ms); }
  async function shotsTick() {
    if (!token) return;
    if (data?.thumbs && !document.hidden && !fails && data.sessions.some(s => s.status === 'running')) {
      try {
        shots = await api('/api/thumbs', undefined, 2);
        for (const el of app.querySelectorAll('[data-shot]')) { const src = shots[el.dataset.shot]; if (src) el.innerHTML = `<img src="${src}" alt="">`; }
      } catch { /* the status refresh shows the problem */ }
    }
    scheduleShots(10000);
  }

  async function act(btn) {
    const a = btn.dataset.act;
    if (a === 'hideHint') { try { localStorage.setItem('mm-hint', '1'); } catch { /* ignore */ } render(); return; }
    if (a === 'close' && !confirm(t('Close this account?'))) return;
    if (a === 'closeAll' && !confirm(t('Close every Roblox session?'))) return;
    const key = `${a}:${btn.dataset.id || ''}`;
    if (inFlight.has(key)) return;
    inFlight.add(key); btn.disabled = true;
    try {
      const body = { ...(a === 'watcher' ? { on: !data.watcher.enabled } : { id: btn.dataset.id }), rid: rid() };
      const r = await api(`/api/action/${a}`, body);
      toast(r.message || 'Done');
      setTimeout(() => schedule(0), a === 'watcher' ? 100 : 1500);
    } catch (e) { if (!e.quiet) toast(e.message); }
    finally { inFlight.delete(key); paint(); }
  }

  function dashboard() {
    document.getElementById('logout').classList.remove('hidden');
    app.innerHTML = `<div class="empty">${T('Loading…')}</div>`;
    fails = 0; data = null; schedule(0); scheduleShots(1500);
  }

  app.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) act(b); });
  // A finger on the screen holds the redraw until the tap is done (plus a moment for the click).
  const up = () => { if (!touching) return; touching = false; clearTimeout(touchTimer); if (pending) { pending = false; setTimeout(paint, 400); } };
  app.addEventListener('pointerdown', () => { touching = true; clearTimeout(touchTimer); touchTimer = setTimeout(up, 4000); }, { passive: true });
  for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, up, { passive: true });
  document.getElementById('logout').onclick = () => signOut(true);
  // Back from the lock screen, another app or a lost connection: check straight away.
  const now = () => { if (token && !document.hidden) { fails = 0; schedule(0); } };
  document.addEventListener('visibilitychange', now);
  window.addEventListener('online', now);
  window.addEventListener('pageshow', now);

  (async () => {
    try {
      const r = await fetch('/api/i18n', { cache: 'no-store' }).then(x => x.json());
      if (r.lang && r.lang !== 'en' && window.MMTranslate) { t = window.MMTranslate.create(r.dict); document.documentElement.lang = r.lang; }
    } catch { /* English */ }
    document.getElementById('logout').textContent = t('Sign out');
    if (token) dashboard(); else login();
  })();
})();
