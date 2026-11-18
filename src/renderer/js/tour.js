// Page tips: the first time you open a page, a few short tooltips point at the
// important parts. Turn them off (or bring them back) in Settings.
(function () {
  const MM = window.MM;
  const TOURS = {
    dashboard: [
      { sel: '.nav-item[data-page="accts"]', text: 'Start here: add your Roblox accounts. Each one logs in through Roblox\'s own sign-in page.' },
      { sel: '.nav-item[data-page="openmulti"]', text: 'Launch several accounts at once and tile their windows.' },
      { sel: '.nav-item[data-page="watch"]', text: 'The 24/7 Watcher rejoins alts that crash, freeze, disconnect or get stuck loading.' },
      { sel: '#tb-mini', text: 'The mini panel is a small always-on-top view of your sessions. Press Ctrl+K anywhere to search every feature.' },
      { sel: '[data-act="customise"]', text: 'Make this page yours: pick widgets, move them and change their size. Press ? for every keyboard shortcut.' },
    ],
    wall: [
      { sel: '#w-grid', text: 'Every running alt with a live picture. Click one to jump to its window.' },
      { sel: '[data-act="switcher"]', text: 'The switcher shows the same view on top of Roblox. Its hotkey works from anywhere.' },
    ],
    scaling: [
      { sel: '#rot-card', text: 'Rotation takes turns: a few alts play at a time and swap every so often.' },
      { sel: '#sc-card', text: 'Auto-scale starts more alts while your PC has room and closes some when it gets busy. Main accounts are never closed.' },
    ],
    perf: [
      { sel: '#pf-presets', text: 'Pick how hard your alts work your PC. You see every change before it\'s applied.' },
      { sel: '#pf-pc', text: 'Measure one alt to find out how many this PC can run.' },
    ],
    rules: [
      { sel: '#r-tpl', text: 'Start from an idea, or build your own: when something happens, MultiMenu does something for you.' },
      { sel: '[data-act="importCode"]', text: 'Got a share code from a friend? Paste it here. Shared automations start switched off.' },
    ],
    timeline: [{ sel: '#tl', text: 'Each row is an alt. Coloured bars show when it was online; marks show crashes and rejoins.' }],
    achievements: [{ sel: '#ach-grid', text: 'Badges unlock as you use MultiMenu. Your Wrapped shows them off.' }],
    doctor: [{ sel: '[data-act="run"]', text: 'Doctor checks for common problems and fixes most of them with one click.' }],
    alertapps: [{ sel: '[data-act="new"]', text: 'Get alerts on Telegram, ntfy, Pushover or email, or have MultiMenu say them out loud.' }],
    gallery: [{ sel: '#gal-online', text: 'Try a theme on. Keep it, or go back to how it was.' }],
    accounts: [
      { sel: '[data-act="login"]', text: 'Add an account by logging in normally. MultiMenu never asks for your password.' },
      { sel: '[data-act="bin"]', text: 'Removed accounts wait in the recycle bin for 30 days, in case you change your mind.' },
      { sel: '[data-act="ramImport"]', text: 'Coming from Roblox Account Manager? Import your list here — only names and groups are read.' },
      { sel: '[data-act="selectAll"]', text: 'Tick several accounts to launch them together or edit them all at once.' },
      { sel: '#acc-health', text: 'Health checks find expired logins and bans. Login warnings tell you the evening before.' },
    ],
    sessions: [
      { sel: '#om-accounts', text: 'Pick accounts, paste a game link and press Launch.' },
      { sel: '#tile-layouts', text: 'Choose how windows are arranged, then tile them. Your layout is remembered for each monitor setup.' },
      { sel: '#fx-box', text: 'Focus mode makes one window big and puts the rest in a strip. Picture-in-picture keeps an alt in view while you play.' },
    ],
    presets: [
      { sel: '[data-act="newPreset"]', text: 'A preset saves accounts, game, layout and watcher settings. Start it with one click.' },
      { sel: '[data-act="importCode"]', text: 'Share a preset as a code, or paste one a friend sent you.' },
      { sel: '[data-act="newTask"]', text: 'Schedules start, close or restart things by themselves at set times.' },
    ],
    servers: [
      { sel: '#fw-card', text: 'Follow my main: alts join whatever server your main account is in.' },
      { sel: '#sv-input', text: 'Paste a game to list its servers and send accounts to the emptiest one.' },
    ],
    watcher: [
      { sel: '#w-enabled', text: 'Turn the 24/7 Watcher on and leave your alts running. Problems are fixed and logged below.' },
      { sel: '#w-guards', text: 'Guards keep your PC awake, close crash pop-ups and wait out internet or Roblox outages.' },
    ],
    performance: [
      { sel: '#p-recs', text: 'Suggestions based on what your PC is doing right now.' },
      { sel: '[data-act="limToggle"]', text: 'The background limiter gives alts less CPU so your main stays smooth.' },
    ],
    trimmer: [{ sel: '#t-ctl', text: 'The RAM Trimmer asks Windows to page out memory clients aren\'t using. It runs on a timer.' }],
    capacity: [{ sel: '[data-act="run"]', text: 'Find out how many clients your PC can really run, step by step.' }],
    automation: [{ sel: '#ck-ctl', text: 'Auto clicker, macros and anti-AFK. F8 stops all automation at once.' }],
    discord: [
      { sel: '#wh-url', text: 'Paste a Discord webhook to get alerts on your phone. Logins and passwords are never sent.' },
      { sel: '#rc-card', text: 'Or control MultiMenu from Discord with your own bot.' },
    ],
    settings: [
      { sel: '#set-q', text: 'Search every setting. Ctrl+F works too.' },
      { sel: '#ph-card', text: 'The phone dashboard lets you check on alts from your phone on the same Wi-Fi.' },
    ],
  };

  let active = null;
  const seen = () => new Set(MM.getSetting('tour.seen') || []);
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };

  function end(markSeen) {
    if (!active) return;
    const { page, layer, onKey, onResize } = active;
    layer.remove();
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onResize);
    document.querySelectorAll('.tour-target').forEach(el => el.classList.remove('tour-target'));
    active = null;
    if (markSeen) { const s = seen(); s.add(page); MM.setSetting('tour.seen', [...s]); }
  }

  function place(tip, el) {
    const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight, m = 12;
    const below = r.bottom + th + m < innerHeight, right = r.left + tw < innerWidth - m;
    const side = el.closest('.sidebar') && r.right + tw + m < innerWidth;
    let x, y, arrow;
    if (side) { x = r.right + m; y = Math.min(innerHeight - th - m, Math.max(m, r.top + r.height / 2 - th / 2)); arrow = 'left'; }
    else { x = Math.max(m, Math.min(right ? r.left : r.right - tw, innerWidth - tw - m)); y = below ? r.bottom + m : Math.max(m, r.top - th - m); arrow = below ? 'up' : 'down'; }
    tip.style.left = `${x}px`; tip.style.top = `${y}px`; tip.dataset.arrow = arrow;
    if (arrow !== 'left') tip.style.setProperty('--ax', `${Math.max(16, Math.min(tw - 16, r.left + r.width / 2 - x))}px`);
  }

  function show(page, steps) {
    end(false);
    const layer = document.createElement('div');
    layer.className = 'tour-layer';
    layer.innerHTML = '<div class="tour-tip" role="dialog" aria-live="polite"></div>';
    document.body.appendChild(layer);
    const tip = layer.firstChild;
    let i = 0;
    const step = () => {
      document.querySelectorAll('.tour-target').forEach(el => el.classList.remove('tour-target'));
      const s = steps[i], el = document.querySelector(s.sel);
      el.classList.add('tour-target');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      tip.innerHTML = `<div class="tour-head">${MM.icon('lightbulb', 15)}<span>${MM.esc(MM.t('Tip'))} ${i + 1}/${steps.length}</span><button class="tour-x" data-t="skip" title="${MM.esc(MM.t('Hide tips for this page'))}">${MM.icon('x', 14)}</button></div>
        <p>${MM.esc(MM.t(s.text))}</p>
        <div class="tour-foot"><button class="btn sm ghost" data-t="off">${MM.esc(MM.t('Turn tips off'))}</button><span class="spacer"></span>
        ${i > 0 ? `<button class="btn sm" data-t="back">${MM.esc(MM.t('Back'))}</button>` : ''}<button class="btn sm primary" data-t="next">${MM.esc(MM.t(i === steps.length - 1 ? 'Got it' : 'Next'))}</button></div>`;
      requestAnimationFrame(() => place(tip, el));
      setTimeout(() => place(tip, el), 320);
    };
    tip.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      const a = b.dataset.t;
      if (a === 'next') { if (++i >= steps.length) end(true); else step(); }
      else if (a === 'back') { i = Math.max(0, i - 1); step(); }
      else if (a === 'skip') end(true);
      else if (a === 'off') { end(true); MM.setSetting('tour.enabled', false); MM.toast('info', 'Page tips are off', 'Turn them back on in Settings → Appearance.'); }
    });
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); end(true); } };
    const onResize = () => { const el = document.querySelector(steps[i].sel); if (el) place(tip, el); };
    document.addEventListener('keydown', onKey, true);
    addEventListener('resize', onResize);
    active = { page, layer, onKey, onResize };
    step();
  }

  MM.tour = {
    TOURS,
    end: () => end(false),
    /** Shows a page's tips if they haven't been seen yet (or always, with force). */
    maybe(page, force = false) {
      if (!force && (!MM.getSetting('tour.enabled') || seen().has(page))) return;
      if (document.querySelector('.modal-back')) return; // not on top of a dialog (e.g. the wizard)
      const steps = (TOURS[page] || []).filter(s => visible(document.querySelector(s.sel)));
      if (steps.length) show(page, steps);
    },
  };
})();
