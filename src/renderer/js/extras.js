// Shell extras: theme studio rendering, Ctrl+K command palette, sleep timer,
// copied-link launcher and the connection indicator in the title bar.
(function () {
  const MM = window.MM;

  // ---------- theme ----------
  let bgKey = null, bgUrl = null;
  MM.applyTheme = async () => {
    const t = MM.state.settings.appearance.theme || {};
    const root = document.documentElement.style;
    root.setProperty('--hue2', t.secondaryHue ?? 295);
    root.setProperty('--glow-k', ((t.glow ?? 100) / 100).toFixed(2));
    root.setProperty('--blur', `${t.blur ?? 20}px`);
    root.setProperty('--bg-dim', ((t.bgDim ?? 55) / 100).toFixed(2));
    document.body.classList.toggle('bg-solid', t.bgType === 'solid');
    const lite = MM.state.settings.performance.lowResourceMode || MM.state.mode?.diet;
    // Safe mode skips your own background picture/video in case that is what's broken.
    const media = ['image', 'video'].includes(t.bgType) && t.bgFile && !(lite && t.bgType === 'video') && !MM.state.mode?.safeMode;
    document.body.classList.toggle('bg-media', !!media);
    const host = document.getElementById('bg-custom');
    if (!host) return;
    const key = media ? `${t.bgType}:${t.bgFile}:${t.bgStamp || ''}` : null;
    if (key === bgKey) return;
    bgKey = key;
    if (bgUrl) { URL.revokeObjectURL(bgUrl); bgUrl = null; }
    host.innerHTML = '';
    if (!media) return;
    try {
      const bg = await MM.api('theme:background');
      if (!bg || bgKey !== key) return;
      const bytes = Uint8Array.from(atob(bg.base64), c => c.charCodeAt(0));
      bgUrl = URL.createObjectURL(new Blob([bytes], { type: bg.mime }));
      const el = document.createElement(bg.kind === 'video' ? 'video' : 'img');
      el.src = bgUrl;
      if (bg.kind === 'video') { el.muted = true; el.loop = true; el.autoplay = true; el.playsInline = true; }
      host.appendChild(el);
      if (bg.kind === 'video' && !document.hasFocus() && MM.state.settings.appearance.pauseUnfocused !== false) el.pause();
    } catch (e) { console.warn('background', e); }
  };
  // The background video stops while MultiMenu isn't the window in front (Pause effects when
  // MultiMenu isn't in front), so it doesn't decode frames behind your game.
  const bgVideo = () => document.querySelector('#bg-custom video');
  addEventListener('blur', () => { const v = bgVideo(); if (v && MM.state.settings?.appearance?.pauseUnfocused !== false) v.pause(); });
  addEventListener('focus', () => { const v = bgVideo(); if (v && v.paused) v.play().catch(() => {}); });
  MM.reloadSettings = async () => { MM.state.settings = await MM.api('settings:get'); MM.applyAppearance(); };

  // ---------- command palette ----------
  const SETTINGS_INDEX = [
    ['watcher.enabled', '24/7 Watcher', 'auto rejoin crash disconnect', 'watcher'],
    ['guards.keepAwake', 'Keep PC awake while clients run', 'sleep power awake', 'watcher'],
    ['guards.closePopups', 'Close Roblox crash pop-ups', 'popup dialog crash', 'watcher'],
    ['guards.gameUpdates', 'Detect game updates', 'update restart server', 'watcher'],
    ['guards.restartOnUpdate', 'Move clients to fresh servers after a game update', 'update restart', 'watcher'],
    ['guards.ping', 'Ping monitor', 'ping latency lag network', 'watcher'],
    ['clipboard.enabled', 'Copied-link detection', 'clipboard link share', 'settings'],
    ['perf.minimize', 'Minimise alts once in game', 'minimise minimize launch taskbar', 'perf'],
    ['perf.lighter', 'Lighter rendering', 'fflags fast flags gpu graphics rendering', 'perf'],
    ['perf.lowGraphics', 'Lowest graphics for alts', 'graphics quality low', 'perf'],
    ['perf.mute', 'Mute alts once in game', 'mute sound audio', 'perf'],
    ['perf.tiny', 'Start alts tiny', 'tiny small window size', 'perf'],
    ['openMulti.restoreGraphics', 'Put my own graphics back after alts start', 'graphics restore', 'settings'],
    ['browse.lockPurchases', 'Lock purchases on roblox.com windows', 'robux buy purchase lock', 'settings'],
    ['robloxLogs.clean', 'Roblox log cleaner', 'logs delete clean disk', 'settings'],
    ['antiAfk.onlyWhenAway', 'Anti-AFK only while I\'m away', 'afk idle away', 'automation'],
    ['inbox.enabled', 'Inbox watcher (trades, messages, friend requests)', 'trade message friend inbox', 'accounts'],
    ['playtime.enabled', 'Playtime reminders', 'break playtime limit', 'settings'],
    ['openMulti.enabled', 'OpenMulti (multiple clients)', 'multi instance mutex', 'sessions'],
    ['openMulti.labelWindows', 'Label Roblox windows with account names', 'title label', 'sessions'],
    ['limiter.enabled', 'Background limiter', 'cpu priority limit', 'sessions'],
    ['performance.idleMode', 'Idle mode when hidden', 'idle low', 'settings'],
    ['performance.lowResourceMode', 'Low-resource mode', 'lite performance blur', 'settings'],
    ['appearance.particles', 'Background particles', 'particles theme', 'theme'],
    ['appearance.animations', 'Animations', 'motion', 'settings'],
    ['startup.launchOnLogin', 'Start with Windows', 'boot login startup', 'settings'],
    ['startup.closeToTray', 'Close to tray', 'tray background', 'settings'],
    ['notifications.toasts', 'Windows notifications', 'toast alert', 'settings'],
    ['follow.enabled', 'Follow my main', 'follow main alt', 'servers'],
    ['memGuard.enabled', 'Memory guard', 'memory leak restart', 'watcher'],
    ['autoBackup.enabled', 'Automatic backups', 'backup', 'settings'],
    ['resume.auto', 'Resume automatically after a restart', 'resume restart', 'settings'],
    ['watcher.detectStuck', 'Detect stuck loading', 'stuck loading menu rejoin', 'watcher'],
    ['tiling.autoTile', 'Auto-tile new clients', 'tile grid arrange', 'sessions'],
    ['tiling.perMonitorSetup', 'Layouts per monitor setup', 'monitor screen display layout', 'sessions'],
    ['loginCheck.enabled', 'Evening login check', 'login expired warning', 'accounts'],
    ['loginCheck.beforeStart', 'Check logins before a preset starts', 'login expired preset', 'accounts'],
    ['performance.dietMode', 'Diet mode (restart needed)', 'memory ram 8gb diet low', 'settings'],
    ['tour.enabled', 'Page tips', 'tips tour help', 'settings'],
    ['overlay.enabled', 'Name labels on Roblox windows', 'overlay label name tag fps ping', 'settings'],
    ['altKeys.enabled', 'Hotkeys per alt', 'hotkey slot switch alt number', 'settings'],
    ['launch.smart', 'Smart launches', 'cpu wait launch delay', 'settings'],
    ['launch.batchSize', 'Launch in batches', 'batch group cpu launch queue load', 'settings'],
    ['performance.checkSpeed', 'Background checks', 'cpu slow relaxed polling lighter', 'settings'],
    ['performance.pauseHidden', 'Pause page updates while hidden', 'cpu hidden tray minimised', 'settings'],
    ['performance.trimSelf', 'Free MultiMenu\'s memory when hidden', 'ram memory trim free', 'settings'],
    ['appearance.pauseUnfocused', 'Pause effects when MultiMenu isn\'t in front', 'particles video background cpu gpu', 'settings'],
    ['performance.endCrashHandlers', 'End Roblox\'s crash reporters', 'ram crash handler robloxcrashhandler memory', 'settings'],
    ['launch.hopIfJoinFails', 'Join another server if a server link fails', 'server hop full join link', 'settings'],
    ['updateGuard.hold', 'Hold Roblox updates', 'roblox update pause stop kick installer version', 'sessions'],
    ['tiling.hideTitleBars', 'Hide Roblox title bars', 'title bar border borderless window', 'sessions'],
    ['hotkeys.tileWindows', 'Tile hotkey', 'tile arrange key shortcut f5', 'sessions'],
    ['richPresence.enabled', 'Discord status', 'rich presence discord status activity idling hide', 'discord'],
    ['remote.alertClosed', 'DM me when an alt closes unexpectedly', 'crash rejoin phone dm discord bot', 'discord'],
    ['api.enabled', 'Local API', 'api stream deck script automation key', 'settings'],
    ['api.cli', 'Command line', 'cli terminal command mm', 'settings'],
    ['phone.thumbs', 'Live pictures of each alt on the phone', 'phone picture thumbnail screenshot', 'settings'],
  ];
  MM.SETTINGS_INDEX = SETTINGS_INDEX;
  const COMMANDS = [
    ['Tile Roblox windows', 'layout-grid', 'grid arrange', () => MM.call('tiler:tile')],
    ['Restore window positions', 'undo-2', 'untile', () => MM.call('tiler:restore')],
    ['Close all Roblox clients', 'square-stop', 'kill stop', async () => { if (await MM.confirm('Close all Roblox clients?', 'Every Roblox client opened by MultiMenu will close.', { danger: true, ok: 'Close all' })) MM.call('sessions:closeAll'); }],
    ['Close all Roblox now (panic)', 'octagon-x', 'kill terminate panic stop everything', async () => { if (await MM.confirm('Close every Roblox client now?', 'Ends every Roblox process at once (including ones opened outside MultiMenu) and stops queued launches and rejoins.', { danger: true, ok: 'Close everything' })) { const n = await MM.call('sessions:panic'); MM.toast('warn', 'Closed all Roblox', `${n ?? 0} client(s) ended.`); } }],
    ['Emergency stop automation', 'octagon-x', 'panic clicker macro', () => MM.call('automation:emergencyStop')],
    ['Mini panel', 'picture-in-picture-2', 'compact overlay', () => MM.call('app:toggleMini')],
    ['Sleep timer…', 'bed', 'shutdown timer bedtime', () => MM.openSleepTimer()],
    ['Trim RAM now', 'memory-stick', 'memory trimmer', () => MM.call('trimmer:trimNow')],
    ['Check for updates', 'refresh-cw', 'update version', () => MM.go('updates')],
    ['Run the PC capacity test', 'flask-conical', 'benchmark how many', () => MM.go('capacity')],
    ['Hatch alerts', 'egg', 'secret rare pet hatch counter discord ping', () => MM.go('hatch')],
    ['Send a test hatch alert', 'send', 'secret pet hatch test discord ping', () => MM.call('hatch:test').then(r => r && MM.toast('success', 'Test alert sent'))],
    ['Check inboxes now', 'mail', 'trades messages', () => MM.call('inbox:check').then(() => MM.toast('success', 'Inboxes checked'))],
    ['Profile card', 'id-card', 'share image stats', () => MM.go('card')],
    ['Theme studio', 'palette', 'colour background wallpaper', () => MM.go('theme')],
    ['Keyboard shortcuts', 'keyboard', 'keys hotkeys help shortcuts accessibility', () => MM.showShortcuts()],
    ['Paste a share code…', 'clipboard-paste', 'import share code mm2 paste preset layout theme automation game', () => MM.importCode()],
    ['Focus mode on / off', 'focus', 'big window strip', () => MM.call('tiler:focusToggle')],
    ['Picture-in-picture', 'picture-in-picture-2', 'pip live view watch alt', () => MM.call('pip:open')],
    ['Phone dashboard', 'smartphone', 'phone mobile wifi qr remote', () => { MM.go('settings'); setTimeout(() => document.getElementById('ph-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350); }],
    ['Open the alt switcher', 'layout-grid', 'switch alt wall window thumbnails', () => MM.call('switcher:open')],
    ['Restart in safe mode', 'life-buoy', 'safe mode troubleshoot crash broken', async () => { if (await MM.confirm('Restart in safe mode?', 'Background features stay off until you restart normally.', { ok: 'Restart in safe mode' })) MM.call('app:restartSafe'); }],
  ];

  function buildIndex(accounts, presets, themes) {
    const items = [];
    for (const sec of MM.NAV.filter(n => n !== '-')) for (const [id, label, icon] of sec.tabs) items.push({ kind: 'Page', label: sec.tabs.length > 1 ? `${sec.label} › ${label}` : label, icon, run: () => MM.go(id), keys: `${sec.label} ${label}` });
    for (const [label, icon, keys, run] of COMMANDS) items.push({ kind: 'Command', label, icon, keys, run });
    if (MM.adminCommands) items.push(...MM.adminCommands());
    for (const [key, label, keys, page] of SETTINGS_INDEX) {
      const on = MM.getSetting(key);
      if (typeof on !== 'boolean') continue;
      items.push({ kind: 'Setting', label: `${on ? 'Turn off' : 'Turn on'}: ${label}`, icon: on ? 'circle-check' : 'circle-dot', keys: `${keys} setting toggle`, run: async () => { await MM.setSetting(key, !on); MM.toast('success', label, !on ? 'On' : 'Off'); if (MM.currentPage() === page) MM.go(page); } });
    }
    for (const a of accounts) {
      const name = a.alias || a.displayName || a.username;
      items.push({ kind: 'Account', label: `Launch ${name}`, icon: 'play', keys: `${a.username} ${a.alias || ''} ${a.group || ''} launch play`, run: () => MM.call('sessions:launch', a.id, null).then(r => r && MM.toast('info', `Launching ${name}`)) });
      items.push({ kind: 'Account', label: `Open roblox.com as ${name}`, icon: 'globe', keys: `${a.username} ${a.alias || ''} browser website`, run: () => MM.call('browse:open', a.id) });
    }
    for (const p of presets) items.push({ kind: 'Preset', label: `Run preset “${p.name}”`, icon: 'bookmark', keys: `${p.name} preset start`, run: () => MM.call('presets:run', p.id).then(r => r && MM.toast('success', `Started ${p.name}`)) });
    for (const [id, t] of Object.entries(themes || {})) items.push({ kind: 'Theme', label: `Theme: ${t.label}`, icon: 'palette', keys: `${t.label} theme look`, run: async () => { await MM.call('theme:apply', id); await MM.reloadSettings(); } });
    return items;
  }

  function score(item, q) {
    if (!q) return 1;
    const hay = `${item.label} ${item.keys || ''} ${item.kind}`.toLowerCase();
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.every(w => hay.includes(w))) return 0;
    return (item.label.toLowerCase().startsWith(words[0]) ? 3 : 1) + (item.label.toLowerCase().includes(q.toLowerCase()) ? 2 : 0) + (item.kind === 'Page' ? 0.5 : 0);
  }

  MM.openPalette = async () => {
    if (document.querySelector('.palette-back')) return;
    const [accs, presets, themes] = await Promise.all([MM.call('accounts:list'), MM.call('presets:list'), MM.call('theme:presets')]);
    const index = buildIndex(accs?.accounts || [], presets || [], themes);
    const back = document.createElement('div');
    back.className = 'palette-back';
    back.innerHTML = `<div class="palette" role="dialog" aria-label="Search MultiMenu">
      <div class="p-in">${MM.icon('search')}<input id="pal-q" placeholder="Search pages, settings, accounts, presets and commands…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
      <div class="p-list" id="pal-list"></div>
      <div class="p-foot small dim"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> run · <kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere</div></div>`;
    document.body.appendChild(back);
    const input = back.querySelector('#pal-q'), list = back.querySelector('#pal-list');
    let shown = [], sel = 0;
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
    const render = () => {
      const q = input.value.trim();
      shown = /MM2-/.test(q) ? [{ kind: 'Command', label: MM.t('Import this share code'), icon: 'clipboard-paste', run: () => MM.importCode(q) }]
        : /^MMA-/.test(q) && MM.adminPaletteItem ? [MM.adminPaletteItem(q)]
        : index.map(i => ({ i, s: score(i, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 40).map(x => x.i);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = shown.length ? shown.map((it, n) => `<button class="p-item ${n === sel ? 'on' : ''}" data-n="${n}">${MM.icon(it.icon || 'circle-dot', 16)}<span class="grow">${MM.esc(it.label)}</span><em>${MM.esc(it.kind)}</em></button>`).join('')
        : `<div class="small muted" style="padding:16px">Nothing matches “${MM.esc(q)}”.</div>`;
      list.querySelector('.p-item.on')?.scrollIntoView({ block: 'nearest' });
    };
    const run = (n) => { const it = shown[n]; if (!it) return; close(); Promise.resolve(it.run()).catch(e => MM.toast('error', it.label, e.message)); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    };
    document.addEventListener('keydown', onKey, true);
    input.addEventListener('input', () => { sel = 0; render(); });
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-n]'); if (b) run(+b.dataset.n); });
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    render();
    setTimeout(() => input.focus(), 20);
  };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); MM.openPalette(); }
  });

  // ---------- sleep timer ----------
  let sleepState = null, sleepTick = null;
  function paintSleep() {
    const b = document.getElementById('tb-sleep');
    if (!b) return;
    clearInterval(sleepTick);
    const draw = () => {
      if (sleepState?.endsAt) {
        const mins = Math.max(0, Math.ceil((sleepState.endsAt - Date.now()) / 60000));
        b.innerHTML = `${MM.icon('bed', 16)}<span class="tb-chip">${mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : `${mins}m`}</span>`;
        b.classList.add('wide', 'on');
        b.title = `Sleep timer: ${sleepState.actionText} in ${mins} min`;
      } else { b.innerHTML = MM.icon('bed', 17); b.classList.remove('wide', 'on'); b.title = 'Sleep timer'; }
    };
    draw();
    if (sleepState?.endsAt) sleepTick = setInterval(draw, 15000);
  }
  MM.openSleepTimer = async () => {
    const st = await MM.call('sleeptimer:status');
    if (!st) return;
    if (st.endsAt) {
      const mins = Math.max(0, Math.ceil((st.endsAt - Date.now()) / 60000));
      const r = await MM.modal({ title: 'Sleep timer', icon: 'bed', desc: `${st.actionText} in ${mins} minute${mins === 1 ? '' : 's'}.`, buttons: [{ label: 'Keep it', value: null, cls: 'ghost' }, { label: 'Cancel timer', value: 'cancel', cls: 'danger', icon: 'x' }] });
      if (r === 'cancel') { await MM.call('sleeptimer:cancel'); MM.toast('info', 'Sleep timer cancelled'); }
      return;
    }
    let minutes = st.last.lastMinutes || 60, act = st.last.lastAction;
    const r = await MM.modal({
      title: 'Sleep timer', icon: 'bed', desc: 'Close every Roblox client after a while — handy for falling asleep with a game running.',
      body: `<div class="seg" id="sl-quick">${[15, 30, 60, 90, 120, 240].map(m => `<button class="${m === minutes ? 'on' : ''}" data-m="${m}">${m < 60 ? `${m} min` : `${m / 60} h`}</button>`).join('')}</div>
        <div class="grid cols-2" style="margin-top:12px">
          <div class="field"><label>Minutes</label><input class="input" type="number" id="sl-min" min="1" max="1440" value="${minutes}"></div>
          <div class="field"><label>Then</label><select class="input" id="sl-act">${Object.entries(st.actions).map(([k, v]) => `<option value="${k}" ${k === st.last.lastAction ? 'selected' : ''}>${MM.esc(v)}</option>`).join('')}</select></div>
        </div>
        <div class="small muted">Shutting down uses Windows' 60-second countdown, so you can still cancel it. The 24/7 Watcher is switched off for those clients so they stay closed.</div>`,
      buttons: [{ label: 'Cancel', value: null, cls: 'ghost' }, { label: 'Start timer', value: 'go', cls: 'primary', icon: 'timer', handler: (m) => { minutes = Number(m.querySelector('#sl-min').value); act = m.querySelector('#sl-act').value; } }],
      onMount: (m) => m.querySelector('#sl-quick').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; m.querySelectorAll('#sl-quick button').forEach(x => x.classList.toggle('on', x === b)); m.querySelector('#sl-min').value = b.dataset.m; }),
    });
    if (r !== 'go') return;
    const res = await MM.call('sleeptimer:start', minutes, act);
    if (res) MM.toast('success', 'Sleep timer set', `${res.actionText} in ${minutes} minutes.`);
  };
  // ---------- copied links ----------
  let linkOpen = false;
  async function onLink(l) {
    if (linkOpen || document.hidden || document.querySelector('.modal-back')) return;
    linkOpen = true;
    try {
      const accs = (await MM.call('accounts:list'))?.accounts || [];
      if (!accs.length) return;
      const t = l.target;
      const what = t.shareCode ? (t.shareType === 'Server' ? 'a private server share link' : 'a share link') : t.linkCode ? 'a private server link' : t.jobId ? 'a specific server' : `game ${t.placeId}`;
      let picker;
      const res = await MM.modal({
        title: 'Roblox link copied', icon: 'link',
        desc: `You copied ${what}. Launch accounts into it?`,
        body: `<div class="small dim" style="word-break:break-all;margin-bottom:10px">${MM.esc(l.url.slice(0, 160))}</div><div class="chips" id="cl-acc"></div>
          <label class="toggle" style="margin-top:14px"><input type="checkbox" id="cl-off"><span class="sw"></span>Stop asking when I copy Roblox links</label>`,
        buttons: [{ label: 'Ignore', value: null, cls: 'ghost' }, { label: 'Launch', value: 'go', cls: 'primary', icon: 'play' }],
        onMount: (m) => {
          picker = MM.accountPicker(m.querySelector('#cl-acc'), accs.filter(a => a.status !== 'expired'), { selected: accs.filter(a => a.favourite && a.status !== 'expired').map(a => a.id) });
          m.querySelector('#cl-off').onchange = (e) => MM.setSetting('clipboard.enabled', !e.target.checked);
        },
      });
      if (res === 'go') {
        const ids = picker.get();
        if (!ids.length) return MM.toast('warn', 'No accounts picked');
        await MM.call('sessions:launchMany', ids, l.url);
        MM.toast('success', `Launching ${ids.length} account${ids.length === 1 ? '' : 's'}`, 'They start one after another.');
      }
    } finally { linkOpen = false; }
  }

  // ---------- connection indicator ----------
  function paintNet(g) {
    const b = document.getElementById('tb-net');
    if (!b || !g) return;
    const off = g.online === false, outage = !off && !!g.blocked;
    b.classList.toggle('hidden', !off && !outage);
    b.innerHTML = MM.icon(off ? 'wifi-off' : 'triangle-alert', 16);
    b.title = off ? 'No internet — rejoins are paused until it comes back' : `Roblox is having an outage (${g.roblox?.description || 'status.roblox.com'}) — rejoins are paused`;
  }

  MM.initExtras = () => {
    const baseApply = MM.applyAppearance;
    MM.applyAppearance = () => { baseApply(); MM.applyTheme(); };
    MM.applyAppearance();
    const tb = document.querySelector('.tb-actions');
    tb.insertAdjacentHTML('afterbegin', `<button class="tb-btn danger hidden" id="tb-net"></button><button class="tb-btn" id="tb-search" title="Search (Ctrl+K)">${MM.icon('search', 16)}</button><button class="tb-btn" id="tb-sleep" title="Sleep timer"></button>`);
    document.getElementById('tb-search').onclick = () => MM.openPalette();
    document.getElementById('tb-sleep').onclick = () => MM.openSleepTimer();
    document.getElementById('tb-net').onclick = () => MM.go('watcher');
    MM.api('sleeptimer:status').then(s => { sleepState = s; paintSleep(); }).catch(() => {});
    MM.on('sleeptimer:update', s => { sleepState = s; paintSleep(); });
    MM.api('guards:status').then(paintNet).catch(() => {});
    MM.on('guards:update', paintNet);
    MM.on('clipboard:link', onLink);
    MM.on('theme:changed', () => MM.reloadSettings());
  };
})();
