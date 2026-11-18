// 2.0 shared pieces: insights cards, health score rings, Wrapped 2.0 player, image capture.
(function () {
  const MM = window.MM;

  /** Page rect of an element in window pixels (the text-size zoom is applied). */
  MM.captureRect = (el) => {
    const r = el.getBoundingClientRect();
    const z = (Number(MM.getSetting?.('appearance.textSize')) || 100) / 100;
    return { x: r.left * z, y: r.top * z, width: r.width * z, height: r.height * z };
  };

  // ---------- health score ----------
  const GRADE = { great: 'ok', ok: 'ok2', poor: 'warn', bad: 'err' };
  MM.healthRing = (h, size = 30) => {
    if (!h) return '';
    const tip = `${MM.t('Health score')} ${h.score}${h.reasons.length ? `\n${h.reasons.map(r => `−${r.points} ${MM.t(r.text)}`).join('\n')}` : ''}`;
    return `<span class="hring ${GRADE[h.grade] || ''}" style="--p:${h.score};--sz:${size}px" title="${MM.esc(tip)}" role="img" aria-label="${MM.esc(`${MM.t('Health score')} ${h.score}`)}"><b>${h.score}</b></span>`;
  };

  // ---------- insights ----------
  MM.renderInsights = async (el, { limit = 4 } = {}) => {
    const list = await MM.call('insights:list');
    if (!el.isConnected) return;
    const items = (list || []).slice(0, limit);
    el.innerHTML = items.length ? items.map(i => `<div class="insight ${MM.esc(i.level)}" data-iid="${MM.esc(i.id)}">${MM.icon(i.icon, 18)}<div class="grow"><b data-nt>${MM.esc(i.title)}</b><div class="small muted">${MM.esc(i.text)}</div></div>
        ${i.action ? `<button class="btn sm" data-ins-go="${MM.esc(i.action.page)}">${MM.esc(i.action.label)}</button>` : ''}<button class="btn sm icon ghost" data-ins-x title="Hide for two weeks" aria-label="Hide">${MM.icon('x', 14)}</button></div>`).join('')
      : MM.empty('lightbulb', 'No tips right now', 'Tips appear here as MultiMenu learns how your alts run.');
    el.onclick = async (e) => {
      const go = e.target.closest('[data-ins-go]'); if (go) { MM.go(go.dataset.insGo); return; }
      const x = e.target.closest('[data-ins-x]'); if (!x) return;
      await MM.call('insights:dismiss', x.closest('[data-iid]').dataset.iid);
      MM.renderInsights(el, { limit });
    };
  };

  // ---------- Wrapped 2.0 ----------
  const fmtPeriod = (w) => (w.period === 'year' ? w.month : new Date(`${w.month}-15T12:00:00`).toLocaleDateString(MM.loc(), { month: 'long', year: 'numeric' }));
  MM.playWrapped = async (period = 'month') => {
    const w = await MM.call('stats:wrapped', period);
    if (!w) return;
    const reduce = document.body.classList.contains('reduce-motion');
    const n = (v) => Number(v || 0).toLocaleString(MM.loc().length ? MM.loc() : undefined);
    const slides = [];
    slides.push(`<div class="wr-kicker">MULTIMENU WRAPPED</div><h1 class="wr-huge">${MM.esc(fmtPeriod(w))}</h1><p>${MM.esc(MM.t('Here\'s how your alts did.'))}</p>`);
    slides.push(`<div class="wr-kicker">${MM.esc(MM.t('Alt time'))}</div><h1 class="wr-huge"><span data-count="${w.hours}">${n(w.hours)}</span></h1><p>${MM.esc(MM.t('hours across {0} accounts').replace('{0}', w.accountsUsed))}</p><p class="small muted">${MM.esc(MM.t('{0} launches').replace('{0}', n(w.launches)))}</p>`);
    if (w.topAccount) slides.push(`<div class="wr-kicker">${MM.esc(MM.t('Your MVP'))}</div><h1 class="wr-big" data-nt>${MM.esc(w.topAccount.label)}</h1><p>${MM.esc(MM.t('{0} hours').replace('{0}', w.topAccount.hours))}</p>${w.topAccounts.length > 1 ? `<ol class="wr-list">${w.topAccounts.map(a => `<li><span data-nt>${MM.esc(a.label)}</span><b>${a.hours} h</b></li>`).join('')}</ol>` : ''}`);
    if (w.topGame) slides.push(`<div class="wr-kicker">${MM.esc(MM.t('Most played'))}</div><h1 class="wr-big" data-nt>${MM.esc(w.topGame.name)}</h1><p>${MM.esc(MM.t('{0} hours').replace('{0}', w.topGame.hours))}</p>${w.topGames.length > 1 ? `<ol class="wr-list">${w.topGames.map(g => `<li><span data-nt>${MM.esc(g.name)}</span><b>${g.hours} h</b></li>`).join('')}</ol>` : ''}`);
    if (w.bestDay) slides.push(`<div class="wr-kicker">${MM.esc(MM.t('Biggest day'))}</div><h1 class="wr-big">${MM.esc(new Date(`${w.bestDay.day}T12:00:00`).toLocaleDateString(MM.loc(), { weekday: 'long', day: 'numeric', month: 'long' }))}</h1><p>${MM.esc(MM.t('{0} hours of alt time').replace('{0}', w.bestDay.hours))}</p><p class="small muted">${MM.esc(MM.t('On {0} days · longest streak {1} days').replace('{0}', w.activeDays).replace('{1}', w.streak?.longest || 0))}</p>`);
    slides.push(`<div class="wr-kicker">${MM.esc(MM.t('24/7 Watcher'))}</div><h1 class="wr-huge"><span data-count="${w.rejoins}">${n(w.rejoins)}</span></h1><p>${MM.esc(MM.t('rejoins, so you didn\'t have to'))}</p><p class="small muted">${MM.esc(MM.t('{0} problems handled').replace('{0}', n(w.problems)))}</p>`);
    if (w.achievements?.length) slides.push(`<div class="wr-kicker">${MM.esc(MM.t('Achievements'))}</div><h1 class="wr-big">${MM.esc(MM.t('{0} unlocked').replace('{0}', w.achievements.length))}</h1><div class="wr-badges">${w.achievements.slice(0, 8).map(a => `<span class="wr-badge">${MM.icon(a.icon, 20)}<small>${MM.esc(a.title)}</small></span>`).join('')}</div>`);
    slides.push(`<div class="wr-kicker">${MM.esc(MM.t('You are'))}</div><div class="wr-orb">${MM.icon(w.personality.icon, 46)}</div><h1 class="wr-big">${MM.esc(w.personality.title)}</h1><p>${MM.esc(w.personality.text)}</p>`);
    slides.push(`<div class="wr-card" id="wr-card"><div class="wr-card-head"><div class="logo-mark">M</div><div><b>MultiMenu Wrapped</b><div class="small">${MM.esc(fmtPeriod(w))}</div></div></div>
      <div class="wr-card-grid"><div><b>${n(w.hours)}</b><span>${MM.esc(MM.t('hours'))}</span></div><div><b>${w.accountsUsed}</b><span>${MM.esc(MM.t('accounts'))}</span></div><div><b>${n(w.rejoins)}</b><span>${MM.esc(MM.t('rejoins'))}</span></div><div><b>${w.activeDays}</b><span>${MM.esc(MM.t('days'))}</span></div></div>
      ${w.topAccount ? `<div class="wr-line">${MM.icon('crown', 14)}<span data-nt>${MM.esc(w.topAccount.label)}</span></div>` : ''}${w.topGame ? `<div class="wr-line">${MM.icon('gamepad-2', 14)}<span data-nt>${MM.esc(w.topGame.name)}</span></div>` : ''}
      <div class="wr-line">${MM.icon(w.personality.icon, 14)}<span>${MM.esc(w.personality.title)}</span></div></div>
      <div class="row" style="justify-content:center;margin-top:16px"><button class="btn" data-wr="copy">${MM.icon('copy', 14)}Copy image</button><button class="btn" data-wr="save">${MM.icon('download', 14)}Save image</button><button class="btn ghost" data-wr="again">${MM.icon('repeat', 14)}Watch again</button></div>`);

    const back = document.createElement('div');
    back.className = 'wr-back';
    back.setAttribute('role', 'dialog'); back.setAttribute('aria-label', 'MultiMenu Wrapped');
    back.innerHTML = `<div class="wr-bars">${slides.map(() => '<i><b></b></i>').join('')}</div><button class="wr-x" aria-label="Close">${MM.icon('x', 20)}</button>
      <button class="wr-nav prev" aria-label="Back">${MM.icon('chevrons-left', 22)}</button><div class="wr-stage"></div><button class="wr-nav next" aria-label="Next">${MM.icon('chevrons-right', 22)}</button>`;
    document.body.appendChild(back);
    const stage = back.querySelector('.wr-stage');
    let i = -1, timer = null, paused = false;
    const countUp = (el) => {
      const target = Number(el.dataset.count) || 0, t0 = performance.now(), dur = 1100;
      const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = n(Math.round(target * (1 - Math.pow(1 - k, 3)) * 10) / 10); if (k < 1 && el.isConnected) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    const show = (k) => {
      i = Math.max(0, Math.min(slides.length - 1, k));
      stage.innerHTML = `<div class="wr-slide s${i % 4}">${slides[i]}</div>`;
      back.querySelectorAll('.wr-bars i').forEach((b, j) => { b.className = j < i ? 'done' : j === i ? 'on' : ''; });
      if (!reduce) stage.querySelectorAll('[data-count]').forEach(countUp);
      clearTimeout(timer);
      if (i < slides.length - 1) timer = setTimeout(() => { if (!paused) show(i + 1); }, 4500);
    };
    const close = () => { clearTimeout(timer); back.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); show(i + 1); } else if (e.key === 'ArrowLeft') show(i - 1); };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mouseenter', () => { paused = true; back.classList.add('paused'); });
    back.addEventListener('mouseleave', () => { paused = false; back.classList.remove('paused'); if (i < slides.length - 1) { clearTimeout(timer); timer = setTimeout(() => show(i + 1), 2500); } });
    back.addEventListener('click', async (e) => {
      if (e.target.closest('.wr-x')) return close();
      if (e.target.closest('.wr-nav.prev')) return show(i - 1);
      if (e.target.closest('.wr-nav.next')) return show(i + 1);
      const b = e.target.closest('[data-wr]'); if (!b) return;
      const card = back.querySelector('#wr-card');
      if (b.dataset.wr === 'again') return show(0);
      if (b.dataset.wr === 'copy' && await MM.call('stats:copyImage', MM.captureRect(card))) MM.toast('success', 'Image copied', 'Paste it into Discord or anywhere else.');
      if (b.dataset.wr === 'save') { const p = await MM.call('stats:saveImage', MM.captureRect(card), 'wrapped'); if (p) MM.toast('success', 'Wrapped saved', p); }
    });
    show(0);
  };

  // ---------- share codes ----------
  const SHARE_KINDS = { preset: ['bookmark', 'Preset'], layout: ['layout-grid', 'Window layout'], theme: ['palette', 'Theme'], rule: ['zap', 'Automation'], game: ['gamepad-2', 'Game profile'] };
  MM.SHARE_KINDS = SHARE_KINDS;
  const n = (v, d) => (Number.isFinite(+v) ? +v : d);
  /** CSS background for a little theme preview. */
  MM.themeBg = (t = {}) => {
    const a = n(t.accentHue, 270), s = n(t.theme?.secondaryHue ?? t.secondaryHue, a);
    return (t.theme?.bgType ?? t.bgType) === 'solid' ? `hsl(${a},30%,6%)`
      : `radial-gradient(70% 90% at 20% 20%, hsla(${a},90%,50%,.7), transparent 70%), radial-gradient(60% 80% at 90% 30%, hsla(${s},90%,50%,.55), transparent 70%), #07040d`;
  };

  /** Makes a share code for one of your things and shows it with a Copy button. */
  MM.shareCode = async (kind, item, opts = {}) => {
    const id = item && typeof item === 'object' ? (kind === 'game' ? item.placeId : item.id) : item;
    const r = await MM.call('share:create', kind, id ?? '', opts);
    if (!r) return;
    const [icon, label] = SHARE_KINDS[kind];
    await MM.modal({
      title: 'Share code', icon: 'share-2',
      desc: 'Anyone with MultiMenu 2.0 can paste this in to get a copy. Codes never include your accounts, logins or private server links.',
      body: `<div class="stack"><div class="share-head">${MM.icon(icon, 18)}<b data-nt>${MM.esc(r.name || MM.t(label))}</b><span class="badge">${MM.esc(MM.t(label))}</span></div>
        <textarea class="input mono share-code" readonly rows="4" spellcheck="false" data-nt>${MM.esc(r.code)}</textarea>
        ${(r.notes || []).map(x => `<div class="callout">${MM.icon('info')}<div>${MM.esc(x)}</div></div>`).join('')}</div>`,
      onMount: (m) => { const ta = m.querySelector('.share-code'); ta.addEventListener('focus', () => ta.select()); },
      buttons: [{ label: 'Close', value: null, cls: 'ghost' }, { label: 'Copy code', value: 'copy', cls: 'primary', icon: 'copy', handler: async () => {
        try { await navigator.clipboard.writeText(r.code); MM.toast('success', 'Code copied', 'Paste it in Discord or send it to a friend.'); } catch { MM.toast('error', 'Couldn\'t copy', 'Select the code and press Ctrl+C.'); return false; }
      } }],
    });
  };

  const LAY = { auto: 'Smart grid', columns: 'Side by side', rows: 'Stacked', grid2: '2 × 2', grid3: '3 × 3', grid4: '4 × 4', main: 'Main + side', cascade: 'Cascade', fixed: 'Fixed size' };
  async function describeCode(p) {
    const d = p.data, L = [];
    const tr = (s, ...v) => v.reduce((x, y, i) => x.replace(`{${i}}`, y), MM.t(s));
    if (p.kind === 'preset') {
      L.push(d.game ? tr('Game: place {0}', d.game) : MM.t('Game: each account\'s own'));
      L.push(d.tag ? tr('Accounts: everyone tagged #{0} (you have {1})', d.tag, p.tagged || 0) : MM.t('Accounts: you pick them'));
      if (d.tile) L.push(tr('Tiles windows: {0}', MM.t(LAY[d.layout] || 'Keep current')));
      if (d.watch) L.push(MM.t('24/7 Watcher on'));
      if (d.graphics.enabled) L.push(tr('Graphics {0}, FPS cap {1}', d.graphics.quality, d.graphics.fpsCap === -1 ? MM.t('Unlimited') : d.graphics.fpsCap));
      if (d.closeAfterHours) L.push(tr('Closes after {0} h', d.closeAfterHours));
    } else if (p.kind === 'layout') {
      L.push(tr('{0} · gap {1} px · margin {2} px', MM.t(LAY[d.layout]), d.gap, d.padding));
      if (d.layout === 'main') L.push(tr('Main window {0}% wide', Math.round(d.mainRatio * 100)));
      if (d.layout === 'fixed') L.push(tr('Windows {0} × {1}', d.cellWidth, d.cellHeight));
      L.push(MM.t('Replaces your current tiling settings.'));
    } else if (p.kind === 'theme') {
      L.push(`<span class="share-swatch" style="background:${MM.themeBg(d)}"></span>${MM.esc(tr('Glow {0} · glass {1} · {2} background', d.theme.glow, d.theme.blur, MM.t(d.theme.bgType === 'solid' ? 'plain' : 'gradient')))}`);
      L.push(MM.t('Replaces your current theme. You can switch back in the theme studio.'));
    } else if (p.kind === 'rule') {
      const cat = await MM.call('automations:catalog') || { triggers: {}, conditions: {}, actions: {} };
      // A short hint of the settings, e.g. "RAM is above a level (90%)" or "The time is between (22:00–08:00)".
      const hint = (x) => {
        const v = x.kind && x.kind !== 'any' ? MM.t(x.kind) : x.start ? `${x.start}–${x.end}` : x.time ? x.time : x.percent ? `${x.op ? `${x.op} ` : ''}${x.percent}%` : x.ms ? `${x.ms} ms`
          : x.minutes ? `${x.minutes} min` : x.n != null && x.op ? `${x.op} ${x.n}` : x.who ? x.who : x.name ? x.name : x.state ? MM.t(x.state) : '';
        return v ? ` (${v})` : '';
      };
      const lab = (group, x) => `${MM.t(cat[group][x.type]?.label || x.type)}${hint(x)}`;
      L.push(tr('When: {0}', lab('triggers', d.trigger)));
      if (d.conditions.length) L.push(tr('Only if: {0}', d.conditions.map(c => lab('conditions', c)).join(', ')));
      L.push(tr('Then: {0}', d.actions.map(a => lab('actions', a)).join(' → ')));
      L.push(MM.t('It starts switched off, so nothing happens until you turn it on.'));
    } else if (p.kind === 'game') {
      L.push(tr('Place {0}', d.placeId));
      if (d.graphics.enabled) L.push(tr('Graphics {0}, FPS cap {1}', d.graphics.quality, d.graphics.fpsCap === -1 ? MM.t('Unlimited') : d.graphics.fpsCap));
      if (d.layout) L.push(tr('Layout: {0}', MM.t(LAY[d.layout] || d.layout)));
      const w = d.watcher;
      if (w.stuckMin || w.freezeSec || w.maxPerHour) L.push(MM.t('Its own 24/7 Watcher limits'));
      if (p.exists) L.push(MM.t('Replaces your profile for this game.'));
    }
    return L;
  }

  /** Paste a share code: shows what it holds, then brings it in. */
  MM.importCode = async (prefill = '') => {
    let current = null;
    const text = prefill || await MM.call('share:fromClipboard') || '';
    const res = await MM.modal({
      title: 'Paste a share code', icon: 'clipboard-paste',
      desc: 'Codes start with MM2-. You see what\'s inside before anything changes.',
      body: `<div class="stack"><textarea class="input mono share-code" id="sc-in" rows="3" spellcheck="false" placeholder="MM2-…" data-nt>${MM.esc(text)}</textarea><div id="sc-prev"></div></div>`,
      onMount: (m) => {
        const box = m.querySelector('#sc-prev'), go = m.querySelector('.foot .btn.primary');
        let seq = 0, t = null;
        const check = async () => {
          const v = m.querySelector('#sc-in').value.trim();
          const my = ++seq;
          current = null; go.disabled = true;
          if (!v) { box.innerHTML = ''; return; }
          let p = null, err = null;
          try { p = await MM.api('share:preview', v); } catch (e) { err = e.message; }
          if (my !== seq) return;
          if (err) { box.innerHTML = `<div class="callout err">${MM.icon('circle-alert')}<div>${MM.esc(err)}</div></div>`; return; }
          const [icon, label] = SHARE_KINDS[p.kind];
          const lines = await describeCode(p);
          if (my !== seq) return;
          box.innerHTML = `<div class="share-prev"><div class="share-head">${MM.icon(icon, 18)}<b data-nt>${MM.esc(p.name || MM.t(label))}</b><span class="badge">${MM.esc(MM.t(label))}</span></div>
            <ul>${lines.map(l => `<li>${l.startsWith('<span') ? l : MM.esc(l)}</li>`).join('')}</ul></div>`;
          current = p; go.disabled = false;
        };
        m.querySelector('#sc-in').addEventListener('input', () => { clearTimeout(t); t = setTimeout(check, 250); });
        check();
      },
      buttons: [{ label: 'Cancel', value: null, cls: 'ghost' }, { label: 'Import', value: 'go', cls: 'primary', icon: 'download', handler: () => (current ? undefined : false) }],
    });
    if (res !== 'go' || !current) return;
    const r = await MM.call('share:import', current.code);
    if (!r) return;
    if (r.kind === 'preset') { MM.go('presets', { importDraft: r.draft }); return; }
    if (r.kind === 'theme' || r.kind === 'layout') await MM.reloadSettings();
    const done = { theme: ['Theme applied', ''], layout: ['Layout applied', 'Tile your windows to use it.'], rule: ['Automation added', 'It\'s switched off. Turn it on when you\'re ready.'], game: ['Game profile saved', ''] }[r.kind];
    MM.toast('success', done[0], [r.name, done[1]].filter(Boolean).join(' · '));
    const page = { layout: 'sessions', rule: 'rules', game: 'servers', theme: MM.currentPage() === 'gallery' ? 'gallery' : 'theme' }[r.kind];
    if (page) MM.go(page);
  };
})();
