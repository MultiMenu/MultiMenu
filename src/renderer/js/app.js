// App shell: loading screen, sidebar + router, background, notifications, update popup.
(function () {
  const MM = window.MM;
  // Sidebar sections. Sections with more than one page show tabs at the top.
  // Every page keeps its own id, so MM.go('trimmer') still works anywhere.
  const NAV = [
    { id: 'home', label: 'Dashboard', icon: 'layout-dashboard', tabs: [['dashboard', 'Dashboard', 'layout-dashboard']] },
    { id: 'altwall', label: 'Alt Wall', icon: 'layout-grid', tabs: [['wall', 'Alt Wall', 'layout-grid']] },
    { id: 'accts', label: 'Accounts', icon: 'users', tabs: [['accounts', 'Accounts', 'users'], ['items', 'Items & security', 'shield-check'], ['creator', 'Creator', 'user-plus']] },
    { id: 'openmulti', label: 'OpenMulti', icon: 'monitor-play', tabs: [['sessions', 'Sessions & Tiling', 'monitor-play'], ['presets', 'Presets & Schedule', 'calendar-clock'], ['scaling', 'Rotation & Scaling', 'repeat'], ['servers', 'Servers & Games', 'server']] },
    { id: 'watch', label: '24/7 Watcher', icon: 'radar', tabs: [['watcher', 'Watcher', 'radar'], ['stats', 'Stats', 'chart-column'], ['timeline', 'Timeline', 'history'], ['achievements', 'Achievements', 'trophy'], ['card', 'Profile card', 'id-card'], ['logs', 'Logs', 'scroll-text']] },
    { id: 'perfsec', label: 'Performance', icon: 'gauge', tabs: [['perf', 'Alt performance', 'sliders-horizontal'], ['performance', 'PC monitor', 'activity'], ['trimmer', 'RAM Trimmer', 'memory-stick'], ['capacity', 'Capacity test', 'flask-conical']] },
    { id: 'auto', label: 'Automation', icon: 'zap', tabs: [['rules', 'Automations', 'zap'], ['automation', 'Clicker & macros', 'mouse-pointer-click']] },
    { id: 'disc', label: 'Alerts', icon: 'bell-ring', tabs: [['discord', 'Discord', 'webhook'], ['hatch', 'Hatch alerts', 'egg'], ['alertapps', 'Phone, email & voice', 'smartphone']] },
    '-',
    { id: 'conf', label: 'Settings', icon: 'settings', tabs: [['settings', 'Settings', 'settings'], ['theme', 'Theme studio', 'palette'], ['gallery', 'Theme gallery', 'sparkles'], ['doctor', 'Doctor', 'heart-pulse'], ['updates', 'Updates', 'refresh-cw']] },
  ];
  MM.NAV = NAV;
  // Read NAV each time: admin mode adds its section after this file loads.
  const sectionOf = (page) => NAV.find(s => s !== '-' && (s.id === page || s.tabs.some(t => t[0] === page)));
  const lastTab = {}; // section id -> last page shown
  let current = null, cleanup = null, unread = 0, notifications = [];

  // ---------- appearance ----------
  const lightQuery = window.matchMedia('(prefers-color-scheme: light)');
  MM.applyAppearance = () => {
    const a = MM.state.settings.appearance, p = MM.state.settings.performance;
    const de = document.documentElement;
    de.style.setProperty('--hue', a.accentHue);
    // Dark, light, or whatever Windows uses; compact spacing; high contrast.
    de.dataset.mode = a.mode === 'light' || (a.mode === 'system' && lightQuery.matches) ? 'light' : 'dark';
    de.dataset.density = a.density === 'compact' ? 'compact' : 'comfortable';
    de.dataset.contrast = a.contrast === 'high' ? 'high' : 'normal';
    const diet = !!MM.state.mode?.diet;
    const lite = p.lowResourceMode || diet;
    const reduce = a.reducedMotion || lite || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.body.classList.toggle('reduce-motion', reduce || !a.animations);
    document.body.classList.toggle('no-blur', lite);
    document.body.classList.toggle('diet', diet);
    document.body.classList.toggle('collapsed', !!a.sidebarCollapsed);
    Particles.configure(a.particles && !reduce && !lite, a.particleCount);
  };

  // ---------- particles ----------
  const Particles = (() => {
    const cv = document.getElementById('particles');
    const ctx = cv.getContext('2d');
    let parts = [], on = false, raf = 0, w = 0, h = 0, last = 0, away = false;
    // 30 frames a second is plenty for drifting dots, and half the work on a 60 Hz screen
    // (a quarter on 120 Hz). They stop while MultiMenu isn't the window in front, unless
    // Settings → Appearance → Pause effects when MultiMenu isn't in front is off.
    const pauseAway = () => MM.state.settings?.appearance?.pauseUnfocused !== false;
    const resize = () => { const d = window.devicePixelRatio || 1; w = innerWidth; h = innerHeight; cv.width = w * d; cv.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
    const seed = (n) => { parts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.8 + 0.4, vx: (Math.random() - 0.5) * 0.15, vy: -(Math.random() * 0.25 + 0.05), a: Math.random() * 0.6 + 0.2, tw: Math.random() * Math.PI * 2 })); };
    const frame = (ts) => {
      raf = requestAnimationFrame(frame);
      if (ts - last < 32) return;
      last = ts;
      ctx.clearRect(0, 0, w, h);
      const hue = MM.state.settings ? MM.state.settings.appearance.accentHue : 270;
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.tw += 0.02;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
        const alpha = p.a * (0.6 + 0.4 * Math.sin(p.tw));
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 100%, 80%, ${alpha})`;
        ctx.shadowColor = `hsla(${hue}, 100%, 65%, 1)`; ctx.shadowBlur = 8;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    };
    addEventListener('resize', () => { resize(); if (on) seed(parts.length); });
    const run = () => { cancelAnimationFrame(raf); if (on && !document.hidden && !(away && pauseAway())) raf = requestAnimationFrame(frame); };
    document.addEventListener('visibilitychange', run);
    addEventListener('blur', () => { away = true; run(); });
    addEventListener('focus', () => { away = false; run(); });
    resize();
    return {
      configure(enable, count) {
        cancelAnimationFrame(raf);
        on = enable;
        if (!enable) { ctx.clearRect(0, 0, w, h); cv.style.display = 'none'; return; }
        cv.style.display = '';
        seed(Math.max(5, Math.min(120, count || 40)));
        run();
      },
    };
  })();

  // ---------- sidebar & router ----------
  function renderSidebar() {
    const sb = document.getElementById('sidebar');
    sb.innerHTML = `
      <div class="logo"><div class="logo-mark">M</div><div class="logo-text">Multi<span>Menu</span></div></div>
      ${NAV.map(n => n === '-' ? '<div class="nav-sep"></div>' : `<button class="nav-item" data-page="${n.id}" title="${MM.esc(n.label)}">${MM.icon(n.icon)}<span>${MM.esc(n.label)}</span><em class="badge hidden" data-badge="${n.id}"></em></button>`).join('')}
      <div class="grow"></div>
      <button class="nav-item collapse-btn" id="collapse" title="Collapse sidebar">${MM.icon(MM.state.settings.appearance.sidebarCollapsed ? 'chevrons-right' : 'chevrons-left')}<span>Collapse</span></button>
      <div class="side-foot" data-admin-tap>v${MM.esc(MM.state.info.version)}${MM.state.info.portable ? ' · Portable' : ''}</div>`;
    sb.addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (b) MM.go(b.dataset.page);
      if (e.target.closest('#collapse')) {
        const v = !MM.state.settings.appearance.sidebarCollapsed;
        MM.setSetting('appearance.sidebarCollapsed', v).then(() => { MM.applyAppearance(); MM.$('#collapse').innerHTML = `${MM.icon(v ? 'chevrons-right' : 'chevrons-left')}<span>Collapse</span>`; });
      }
    });
  }

  MM.setBadge = (page, text, cls = '') => {
    const sec = sectionOf(page);
    const el = MM.$(`[data-badge="${sec ? sec.id : page}"]`);
    if (!el) return;
    el.textContent = text || '';
    el.className = `badge ${cls} ${text ? '' : 'hidden'}`;
  };

  MM.go = (target, params) => {
    const sec = sectionOf(target);
    if (!sec) return;
    // A section id opens its last-used tab; a page id opens that exact tab.
    const page = sec.tabs.some(t => t[0] === target) ? target : (lastTab[sec.id] || sec.tabs[0][0]);
    const p = MM.pages[page];
    if (!p) return;
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    current = page;
    lastTab[sec.id] = page;
    MM.$$('.nav-item[data-page]').forEach(b => { b.classList.toggle('active', b.dataset.page === sec.id); if (b.dataset.page === sec.id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const main = document.getElementById('main');
    main.scrollTop = 0;
    const tabs = sec.tabs.length > 1
      ? `<div class="hub-tabs">${sec.tabs.map(([id, label, icon]) => `<button class="hub-tab ${id === page ? 'on' : ''}" data-hub-tab="${id}" ${id === page ? 'aria-current="page"' : ''}>${MM.icon(icon, 15)}${MM.esc(label)}</button>`).join('')}</div>` : '';
    main.innerHTML = `${tabs}<div class="page"></div>`;
    main.querySelectorAll('[data-hub-tab]').forEach(b => b.addEventListener('click', () => MM.go(b.dataset.hubTab)));
    const host = main.querySelector('.page');
    try { cleanup = p.render(host, params || {}) || null; }
    catch (e) { console.error(e); host.innerHTML = `<div class="callout err">${MM.icon('circle-alert')}<div>This page failed to load: ${MM.esc(e.message)}</div></div>`; }
    // First visit: page tips (after the page has drawn its cards).
    if (MM.tour) { MM.tour.end(); clearTimeout(MM._tourT); MM._tourT = setTimeout(() => { if (current === page) MM.tour.maybe(page); }, 900); }
  };
  MM.currentPage = () => current;

  // ---------- notifications ----------
  function updateBell() {
    MM.$('#tb-bell').innerHTML = MM.icon('bell') + (unread ? '<i class="pip"></i>' : '');
  }
  function openDrawer() {
    const ex = MM.$('.drawer');
    if (ex) { ex.remove(); return; }
    const d = document.createElement('div');
    d.className = 'drawer';
    const lvlIcon = { success: 'circle-check', error: 'circle-alert', warn: 'triangle-alert', info: 'info' };
    d.innerHTML = `<div class="row" style="margin-bottom:8px"><b style="font-family:var(--display);font-size:15px">Notifications</b><span class="spacer"></span><button class="btn sm ghost" data-act="clear">Clear</button></div>
      ${notifications.length ? notifications.map(n => `<div class="n ${n.read ? '' : 'unread'}">${MM.icon(lvlIcon[n.level] || 'info')}<div><b>${MM.esc(n.title)}</b><div class="small muted">${MM.esc(n.message)}</div><div class="small dim">${MM.fmt.ago(n.at)}</div></div></div>`).join('') : MM.empty('bell', 'All caught up', 'Session events, alerts and updates show up here.')}`;
    document.body.appendChild(d);
    MM.delegate(d, { clear: async () => { notifications = await MM.call('notifications:clear') || []; d.remove(); } });
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!d.contains(e.target) && !e.target.closest('#tb-bell')) { d.remove(); document.removeEventListener('mousedown', off); } }), 0);
    MM.call('notifications:read');
    notifications.forEach(n => { n.read = true; });
    unread = 0; updateBell();
  }

  // ---------- update popup ----------
  let updateShown = false;
  MM.showUpdatePopup = async (st) => {
    if (updateShown || !st.latest) return;
    updateShown = true;
    const l = st.latest;
    const res = await MM.modal({
      cls: 'update-modal',
      body: `<div class="orb">${MM.icon('sparkles', 40)}</div>
        <div class="kicker">MULTIMENU UPDATE AVAILABLE</div>
        <h2>MultiMenu v${MM.esc(l.version)} is ready!</h2>
        <p class="muted">You have v${MM.esc(st.current)}${l.prerelease ? ' · Beta channel' : ''}. Your accounts and settings are kept.</p>
        <div class="progress hidden" id="up-prog"><i></i></div><div class="small muted hidden" id="up-msg"></div>`,
      buttons: [
        { label: 'Remind Me Later', value: 'later', cls: 'ghost', icon: 'clock' },
        { label: 'View Changelog', value: 'log', icon: 'list' },
        { label: 'Download & Install', cls: 'primary', icon: 'download', handler: async (m) => {
          m.querySelectorAll('.foot .btn').forEach(b => { b.disabled = true; });
          m.querySelector('#up-prog').classList.remove('hidden');
          const msg = m.querySelector('#up-msg'); msg.classList.remove('hidden'); msg.textContent = 'Downloading…';
          const off = MM.on('updater:update', s => { m.querySelector('#up-prog i').style.width = `${Math.round((s.progress || 0) * 100)}%`; msg.textContent = s.message; });
          try {
            await MM.api('updates:download');
            msg.textContent = 'Verified. Installing — MultiMenu will restart.';
            await MM.api('updates:install');
          } catch (e) { msg.textContent = e.message; m.querySelectorAll('.foot .btn').forEach(b => { b.disabled = false; }); off(); return false; }
          off();
          return false;
        } },
      ],
    });
    updateShown = false;
    if (res === 'later') { await MM.call('updates:remind'); MM.toast('info', 'Update postponed', 'We\'ll remind you again in 24 hours.'); }
    if (res === 'log') { await MM.showChangelog(l); MM.showUpdatePopup(st); }
  };
  MM.showChangelog = (l) => MM.modal({ title: `What's new in v${l.version}`, icon: 'list', wide: true, body: `<div class="changelog">${MM.esc(l.notes || 'No release notes were published for this version.')}</div>` });

  // ---------- resume after restart ----------
  MM.offerResume = async () => {
    const st = await MM.call('resume:status');
    const p = st?.pending;
    if (!p) return;
    const auto = st.config.auto && !p.robloxRunning;
    const res = await MM.modal({
      title: 'Pick up where you left off?', icon: 'refresh-cw',
      desc: `${p.sessions.length} account${p.sessions.length === 1 ? ' was' : 's were'} running ${MM.fmt.ago(p.savedAt)}. MultiMenu can put them back in the same games${p.sessions.some(s => s.target?.jobId) ? ' and servers' : ''}.`,
      body: `<div class="list">${p.sessions.map(s => `<div class="item">${MM.icon('monitor-play')}<div class="grow"><div class="title">${MM.esc(s.label)}</div><div class="meta">${MM.esc(s.placeName || s.target?.placeId || 'default game')}${s.target?.jobId ? ' · same server' : ''}${s.watch ? ' · 24/7' : ''}</div></div></div>`).join('')}</div>
        ${p.robloxRunning ? `<div class="callout warn" style="margin-top:12px">${MM.icon('triangle-alert')}<div>Roblox is still running from before. Close it first, or resuming will open extra clients.</div></div>` : ''}
        ${auto ? `<div class="callout" style="margin-top:12px">${MM.icon('clock')}<div>Resuming automatically in a few seconds (Settings → Startup).</div></div>` : ''}
        <label class="toggle" style="margin-top:14px"><input type="checkbox" id="rs-auto" ${st.config.auto ? 'checked' : ''}><span class="sw"></span>Always resume automatically after a restart</label>`,
      buttons: [{ label: 'Not now', value: 'no', cls: 'ghost' }, { label: 'Resume', value: 'yes', cls: 'primary', icon: 'play' }],
      onMount: (m) => { m.querySelector('#rs-auto').onchange = (e) => MM.setSetting('resume.auto', e.target.checked); },
    });
    if (res === 'yes') { const r = await MM.call('resume:go'); if (r) MM.go('sessions'); }
    else if (res === 'no') await MM.call('resume:dismiss');
  };

  // ---------- boot ----------
  async function boot() {
    const loaderText = MM.$('#loader-text');
    try {
      await window.MMI18NReady;
      if (MM.adminBoot) await MM.adminBoot();
      loaderText.textContent = 'Loading settings';
      [MM.state.info, MM.state.settings, MM.state.mode] = await Promise.all([MM.api('app:info'), MM.api('settings:get'), MM.api('app:mode').catch(() => ({}))]);
      if (MM.state.mode?.safeMode) {
        const b = MM.$('#tb-safe');
        b.innerHTML = `${MM.icon('life-buoy', 14)}<span>${MM.esc(MM.t('Safe mode'))}</span>`;
        b.classList.remove('hidden');
        b.onclick = async () => { if (await MM.confirm('Leave safe mode?', 'MultiMenu restarts with all your background features back on.', { ok: 'Restart normally' })) MM.call('app:restartNormal'); };
        document.body.classList.add('safe-mode');
      }
      MM.initExtras();
      MM.initLaunchQueue?.();
      if (!MM.state.settings.startup.showLoadingScreen) MM.$('#loader').classList.add('done');
      renderSidebar();
      // window controls
      MM.$('#win-min').innerHTML = MM.icon('minus', 16); MM.$('#win-max').innerHTML = MM.icon('square', 13); MM.$('#win-close').innerHTML = MM.icon('x', 16);
      MM.$('#win-min').onclick = () => MM.api('app:minimize');
      MM.$('#win-max').onclick = () => MM.api('app:maximize');
      MM.$('#win-close').onclick = () => MM.api('app:close');
      MM.$('#tb-estop').innerHTML = MM.icon('octagon-x');
      MM.$('#tb-mini').innerHTML = MM.icon('picture-in-picture-2');
      MM.$('#tb-mini').onclick = () => MM.api('app:toggleMini');
      MM.$('#tb-estop').onclick = () => MM.api('automation:emergencyStop');
      updateBell();
      MM.$('#tb-bell').onclick = openDrawer;
      loaderText.textContent = 'Loading accounts';
      notifications = await MM.api('notifications:list');
      unread = notifications.filter(n => !n.read).length; updateBell();
      MM.on('notifications:new', (n) => {
        notifications.unshift(n); unread++; updateBell();
        MM.toast(n.level === 'success' ? 'success' : n.level, n.title, n.message);
      });
      MM.on('updater:available', st => MM.showUpdatePopup(st));
      MM.on('sessions:changed', (list) => { const n = list.filter(s => s.status === 'running').length; MM.setBadge('sessions', n ? String(n) : ''); });
      MM.on('clicker:update', s => MM.setBadge('automation', s.running ? 'ON' : '', s.running ? 'ok' : ''));
      MM.on('trimmer:update', s => MM.setBadge('trimmer', s.running ? 'ON' : '', s.running ? 'ok' : ''));
      MM.on('watcher:update', s => MM.setBadge('watcher', s.enabled ? (s.pending.length ? `${s.pending.length}↻` : 'ON') : '', s.enabled ? 'ok' : ''));
      MM.api('watcher:status').then(s => MM.setBadge('watcher', s.enabled ? 'ON' : '', 'ok')).catch(() => {});
      document.addEventListener('mm:setting', (e) => { if (/^(appearance|performance)\./.test(e.detail.key)) MM.applyAppearance(); });
      lightQuery.addEventListener('change', () => { if (MM.state.settings.appearance.mode === 'system') MM.applyAppearance(); });
      loaderText.textContent = 'Ready';
      MM.go('dashboard');
      if (MM.state.info.updatedFrom) MM.toast('success', `Updated to v${MM.state.info.version}`, `from v${MM.state.info.updatedFrom.from}. Your data was kept.`, 7000);
      const st = await MM.api('updates:status');
      if (st.status === 'available' && !st.snoozed) MM.showUpdatePopup(st);
    } catch (e) {
      console.error(e);
      loaderText.textContent = `Failed to start: ${e.message}`;
      return;
    }
    setTimeout(() => MM.$('#loader').classList.add('done'), 700);
    // First thing on a new install (and once after updating to 1.7): pick a language.
    if (!MM.state.settings.language) { setTimeout(() => MM.pickLanguage({ first: true }), 900); return; }
    if (!MM.state.settings.firstRunDone) setTimeout(() => MM.runWizard(), 1100);
    else setTimeout(() => MM.offerResume(), 1200);
  }
  boot();
})();
