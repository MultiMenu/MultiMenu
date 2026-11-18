// Shared UI helpers: API calls, escaping, toasts, modals, charts, settings binding.
(function () {
  const MM = (window.MM = window.MM || {});
  MM.pages = MM.pages || {};
  MM.state = { settings: null, info: null };

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  /** Translate a string into the chosen language (pages are written in English). */
  MM.t = (s) => (window.MMT ? window.MMT(s) : s);
  /** Locale for dates and times: the chosen language, or the system's when it's English. */
  MM.loc = () => { const l = window.MMLang; return !l || l === 'en' ? [] : (l === 'pt' ? 'pt-BR' : l); };
  MM.esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ESC[c]);

  // MM.demo (admin mode's demo mode) answers instead of MultiMenu, except for admin commands.
  const viaDemo = (name) => !!MM.demo && !String(name).startsWith('admin:');
  MM.api = (channel, ...args) => (viaDemo(channel) ? MM.demo.invoke(channel, ...args) : window.mm.invoke(channel, ...args));
  /** Like api() but shows errors as a toast and resolves undefined instead of throwing. */
  MM.call = async (channel, ...args) => {
    try { return await MM.api(channel, ...args); }
    catch (e) { if (e.code !== 'CANCELLED') MM.toast('error', 'Something went wrong', e.message); return undefined; }
  };
  MM.on = (event, cb) => (viaDemo(event) ? MM.demo.on(event, cb) : window.mm.on(event, cb));

  MM.$ = (sel, root) => (root || document).querySelector(sel);
  MM.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // ---------- formatting ----------
  MM.fmt = {
    mb: (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`),
    bytes: (b) => MM.fmt.mb(b / 1048576),
    pct: (n) => (n == null ? '—' : `${Math.round(n)}%`),
    ago(ts) {
      if (!ts) return 'never';
      const s = Math.round((Date.now() - ts) / 1000);
      if (s < 10) return 'just now';
      if (s < 60) return `${s}s ago`;
      if (s < 3600) return `${Math.floor(s / 60)}m ago`;
      if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
      return `${Math.floor(s / 86400)}d ago`;
    },
    dur(ms) {
      const s = Math.max(0, Math.round(ms / 1000));
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
      return h ? `${h}h ${m}m` : m ? `${m}m ${r}s` : `${r}s`;
    },
    clock: (ts) => new Date(ts).toLocaleTimeString(MM.loc(), { hour: '2-digit', minute: '2-digit' }),
    date: (ts) => new Date(ts).toLocaleString(MM.loc()),
    initials: (s) => String(s || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?',
  };

  MM.avatar = (url, name, cls = '') =>
    `<div class="avatar ${cls}">${url ? `<img src="${MM.esc(url)}" alt="" loading="lazy">` : MM.esc(MM.fmt.initials(name))}</div>`;

  MM.meterCls = (p) => (p >= 90 ? 'err' : p >= 75 ? 'warn' : '');

  // ---------- toasts ----------
  const TOAST_ICON = { success: 'circle-check', error: 'circle-alert', warn: 'triangle-alert', info: 'info' };
  MM.toast = (level, title, message, ms = 4500) => {
    const root = document.getElementById('toasts');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast ${level}`;
    el.innerHTML = `${MM.icon(TOAST_ICON[level] || 'info')}<div><b>${MM.esc(title)}</b>${message ? `<span>${MM.esc(message)}</span>` : ''}</div>`;
    root.appendChild(el);
    while (root.children.length > 4) root.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
  };

  // ---------- modals ----------
  /** buttons: [{ label, cls, value }]. Resolves with the clicked value, or null if dismissed. */
  MM.modal = ({ title, icon, desc, body = '', buttons = [{ label: 'Close', value: null }], wide = false, cls = '', onMount, dismissable = true }) =>
    new Promise((resolve) => {
      const root = document.getElementById('modal-root');
      const back = document.createElement('div');
      back.className = 'modal-back';
      const opener = document.activeElement;
      const hid = `mm-dlg-${Math.random().toString(36).slice(2, 8)}`;
      back.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${cls}" role="dialog" aria-modal="true" ${title ? `aria-labelledby="${hid}"` : ''}>
        ${title ? `<h2 id="${hid}">${icon ? MM.icon(icon, 22) : ''}${MM.esc(title)}</h2>` : ''}
        ${desc ? `<p class="desc">${MM.esc(desc)}</p>` : ''}
        <div class="m-body">${body}</div>
        <div class="foot">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${b.icon ? MM.icon(b.icon) : ''}${MM.esc(b.label)}</button>`).join('')}</div>
      </div>`;
      const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); if (opener?.isConnected) opener.focus?.(); resolve(v); };
      const onKey = (e) => {
        if (e.key === 'Escape' && dismissable) close(null);
        // Keep Tab inside the dialog.
        if (e.key === 'Tab' && back.isConnected && back === document.querySelector('.modal-back:last-of-type')) {
          const f = [...back.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
          if (!f.length) return;
          if (e.shiftKey && (document.activeElement === f[0] || !back.contains(document.activeElement))) { e.preventDefault(); f.at(-1).focus(); }
          else if (!e.shiftKey && (document.activeElement === f.at(-1) || !back.contains(document.activeElement))) { e.preventDefault(); f[0].focus(); }
        }
      };
      document.addEventListener('keydown', onKey);
      back.addEventListener('mousedown', (e) => { if (e.target === back && dismissable) close(null); });
      back.querySelectorAll('.foot .btn').forEach(btn => btn.addEventListener('click', async () => {
        const b = buttons[+btn.dataset.i];
        if (b.handler) {
          btn.disabled = true;
          const keep = await b.handler(back.querySelector('.modal'));
          btn.disabled = false;
          if (keep === false) return;
        }
        close(b.value === undefined ? b.label : b.value);
      }));
      root.appendChild(back);
      const first = back.querySelector('input, textarea, select');
      if (first) setTimeout(() => first.focus(), 50);
      if (onMount) onMount(back.querySelector('.modal'), close);
    });

  MM.confirm = (title, desc, { danger = false, ok = 'Confirm' } = {}) =>
    MM.modal({ title, desc, icon: danger ? 'triangle-alert' : 'circle-help', buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: ok, value: true, cls: danger ? 'danger' : 'primary' }] });

  MM.prompt = async (title, label, value = '', { placeholder = '', ok = 'Save' } = {}) => {
    let result = null;
    const v = await MM.modal({
      title, icon: 'pencil',
      body: `<div class="field"><label>${MM.esc(label)}</label><input class="input" id="mm-prompt" value="${MM.esc(value)}" placeholder="${MM.esc(placeholder)}" maxlength="100"></div>`,
      buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: ok, value: true, cls: 'primary', handler: (m) => { result = m.querySelector('#mm-prompt').value; } }],
      onMount: (m, close) => m.querySelector('#mm-prompt').addEventListener('keydown', e => { if (e.key === 'Enter') { result = e.target.value; close(true); } }),
    });
    return v ? result : null;
  };

  // ---------- settings binding ----------
  MM.getSetting = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), MM.state.settings);
  MM.setSetting = async (key, value) => {
    try {
      const r = await MM.api('settings:set', key, value);
      const parts = key.split('.');
      let o = MM.state.settings;
      parts.slice(0, -1).forEach(p => { o = o[p]; });
      o[parts.at(-1)] = r.value;
      document.dispatchEvent(new CustomEvent('mm:setting', { detail: { key, value: r.value, effect: r.effect } }));
      return r;
    } catch (e) { MM.toast('error', 'Setting not saved', e.message); throw e; }
  };

  /** Pure: the hotkey for a keydown ("Ctrl+Alt+T", "F5"), '' to clear it, or null for a key that
   *  can't be a hotkey on its own (a modifier, or a plain letter with no Ctrl/Alt). */
  MM.hotkeyFrom = (e) => {
    if (['Backspace', 'Delete', 'Escape'].includes(e.key) && !e.ctrlKey && !e.altKey && !e.shiftKey) return '';
    const code = e.code || '';
    let k = null;
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) k = e.key;
    else if (/^Key[A-Z]$/.test(code)) k = code.slice(3);
    else if (/^Digit[0-9]$/.test(code)) k = code.slice(5);
    else if (/^Numpad[0-9]$/.test(code)) k = code.slice(6);
    else if (['Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Delete'].includes(e.key)) k = e.key;
    if (!k) return null;
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
    // A letter or number alone would fire while you type anywhere, Roblox chat included.
    if (/^[A-Z0-9]$/.test(k) && !mods.some(m => m === 'Ctrl' || m === 'Alt')) return null;
    return [...mods, k].join('+');
  };
  /** A [data-hotkey] box: click it and press keys, instead of typing the name of the keys. */
  const hotkeyBox = (el) => {
    el.readOnly = true;
    el.placeholder = MM.t('Press keys');
    el.title = MM.t('Click, then press the keys. Backspace clears it.');
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') return;
      e.preventDefault();
      const v = MM.hotkeyFrom(e);
      if (v === null || v === el.value) return;
      el.value = v;
      el.dispatchEvent(new Event('change'));
    });
  };

  /** Wires every [data-setting] control inside root to the settings store. */
  MM.bindSettings = (root) => {
    MM.$$('[data-setting]', root).forEach(el => {
      const key = el.dataset.setting;
      const cur = MM.getSetting(key);
      if (el.hasAttribute('data-hotkey')) hotkeyBox(el);
      if (el.type === 'checkbox') el.checked = !!cur;
      else if (Array.isArray(cur)) el.value = cur.join(', ');
      else el.value = cur ?? '';
      el.addEventListener('change', async () => {
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'number' || el.type === 'range' || el.dataset.type === 'number') {
          v = Number(el.value);
          if (el.min !== '' && v < Number(el.min)) v = Number(el.min);
          if (el.max !== '' && v > Number(el.max)) v = Number(el.max);
          el.value = v;
        } else if (Array.isArray(cur)) v = el.value.split(',').map(s => s.trim()).filter(Boolean);
        else v = el.value;
        try { await MM.setSetting(key, v); } catch { el.value = MM.getSetting(key) ?? ''; if (el.type === 'checkbox') el.checked = !!MM.getSetting(key); }
      });
    });
  };

  MM.toggle = (key, extra = '') => `<label class="toggle" ${extra}><input type="checkbox" data-setting="${key}"><span class="sw"></span></label>`;
  MM.settingRow = (title, desc, control) => `<div class="setting-row"><div class="txt"><b>${MM.esc(title)}</b><span>${MM.esc(desc)}</span></div><div class="ctl">${control}</div></div>`;

  /** Delegated click handling: elements with data-act="name" call handlers[name](el, event). */
  MM.delegate = (root, handlers) => {
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || !root.contains(el)) return;
      const fn = handlers[el.dataset.act];
      if (fn) { e.preventDefault(); fn(el, e); }
    });
  };

  /** Disables a button while an async action runs. */
  MM.busy = async (btn, fn) => {
    if (btn) btn.disabled = true;
    try { return await fn(); } finally { if (btn) btn.disabled = false; }
  };

  // ---------- charts ----------
  /** series: [{ data:[numbers|null], color, fill }] drawn on a 0..max scale. */
  MM.chart = (canvas, series, { max = 100, grid = true, labels = false } = {}) => {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const pad = labels ? 28 : 2;
    if (grid) {
      c.strokeStyle = 'rgba(190,160,255,0.07)'; c.lineWidth = 1;
      c.fillStyle = 'rgba(190,170,230,0.45)'; c.font = '10px Inter, sans-serif';
      for (let i = 0; i <= 4; i++) {
        const y = Math.round(4 + (h - 8) * (i / 4)) + 0.5;
        c.beginPath(); c.moveTo(pad, y); c.lineTo(w, y); c.stroke();
        if (labels) c.fillText(String(Math.round(max * (1 - i / 4))), 0, y + 3);
      }
    }
    for (const s of series) {
      const d = s.data;
      if (!d.length) continue;
      const n = Math.max(d.length, s.capacity || d.length);
      const x = (i) => pad + ((w - pad) * (i + (n - d.length))) / Math.max(1, n - 1);
      const y = (v) => 4 + (h - 8) * (1 - Math.min(1, Math.max(0, v / max)));
      c.beginPath();
      let started = false, lastX = 0;
      d.forEach((v, i) => { if (v == null) return; if (!started) { c.moveTo(x(i), y(v)); started = true; } else c.lineTo(x(i), y(v)); lastX = x(i); });
      if (!started) continue;
      c.strokeStyle = s.color; c.lineWidth = 2; c.shadowColor = s.color; c.shadowBlur = 10; c.stroke(); c.shadowBlur = 0;
      if (s.fill) {
        const firstIdx = d.findIndex(v => v != null);
        c.lineTo(lastX, h); c.lineTo(x(firstIdx), h); c.closePath();
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, s.fill); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fill();
      }
    }
  };

  /** Grouped bar chart. series: [{ data:[n], color, label }], labels: x labels. */
  MM.bars = (canvas, labels, series, { max } = {}) => {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const top = Math.max(1, max ?? Math.max(1, ...series.flatMap(s => s.data)));
    const padL = 30, padB = 20, plotH = h - padB - 6, groupW = (w - padL) / labels.length;
    c.font = '10px Inter, sans-serif'; c.fillStyle = 'rgba(190,170,230,0.5)'; c.strokeStyle = 'rgba(190,160,255,0.07)';
    for (let i = 0; i <= 4; i++) {
      const y = 6 + plotH * (i / 4) + 0.5;
      c.beginPath(); c.moveTo(padL, y); c.lineTo(w, y); c.stroke();
      const v = top * (1 - i / 4);
      c.fillText(v >= 10 ? String(Math.round(v)) : v.toFixed(1), 0, y + 3);
    }
    const bw = Math.max(3, (groupW * 0.7) / series.length);
    labels.forEach((l, i) => {
      const gx = padL + i * groupW + (groupW - bw * series.length) / 2;
      series.forEach((s, j) => {
        const v = s.data[i] || 0, bh = (v / top) * plotH;
        const x = gx + j * bw, y = 6 + plotH - bh;
        const g = c.createLinearGradient(0, y, 0, y + bh);
        g.addColorStop(0, s.color); g.addColorStop(1, s.fade || s.color);
        c.fillStyle = g; c.shadowColor = s.color; c.shadowBlur = 8;
        c.beginPath(); c.roundRect ? c.roundRect(x + 1, y, bw - 2, Math.max(0, bh), 3) : c.rect(x + 1, y, bw - 2, bh); c.fill();
        c.shadowBlur = 0;
      });
      c.fillStyle = 'rgba(190,170,230,0.6)';
      c.fillText(l, padL + i * groupW + groupW / 2 - c.measureText(l).width / 2, h - 5);
    });
  };

  /** Account chip picker. Returns { el-html, get(), set(ids) } bound to a container. */
  MM.accountPicker = (container, accounts, { selected = [], onChange } = {}) => {
    const sel = new Set(selected);
    const render = () => {
      container.innerHTML = accounts.length ? accounts.map(a => `<button class="chip ${sel.has(a.id) ? 'on' : ''} ${a.status === 'expired' ? 'dis' : ''}" data-chip="${MM.esc(a.id)}" ${a.status === 'expired' ? 'disabled title="Login expired"' : ''}>${MM.avatar(a.avatarUrl, a.username, 'xs')}${MM.esc(a.alias || a.displayName || a.username)}</button>`).join('')
        : '<span class="small muted">No accounts yet. Add some on the Accounts page.</span>';
    };
    container.onclick = (e) => {
      const b = e.target.closest('[data-chip]');
      if (!b || b.disabled) return;
      const id = b.dataset.chip;
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      render(); onChange?.([...sel]);
    };
    render();
    return { get: () => [...sel], set: (ids) => { sel.clear(); ids.forEach(i => sel.add(i)); render(); onChange?.([...sel]); }, update: (accs) => { accounts = accs; render(); } };
  };

  /** Log viewer modal for a session. */
  MM.showSessionLog = async (sessionId, label) => {
    let filter = '';
    const load = async (m) => {
      const r = await MM.call('sessions:log', sessionId, filter);
      const pre = m.querySelector('#log-pre');
      if (!r) { pre.textContent = 'No log available.'; return; }
      m.querySelector('#log-file').textContent = r.file;
      pre.innerHTML = r.lines.map(l => {
        const cls = /disconnect|error|kick|crash/i.test(l) ? 'err' : /joining game|serverId|teleport/i.test(l) ? 'hi' : '';
        return `<div class="${cls}">${MM.esc(l)}</div>`;
      }).join('') || '<div class="muted">No matching lines.</div>';
      pre.scrollTop = pre.scrollHeight;
    };
    await MM.modal({
      title: `Roblox log — ${label}`, icon: 'scroll-text', wide: true,
      body: `<div class="row nowrap" style="margin-bottom:10px"><input class="input sm" id="log-filter" placeholder="Filter (e.g. disconnect, joining, error)"><button class="btn sm" id="log-refresh">${MM.icon('refresh-cw', 14)}Refresh</button><button class="btn sm ghost" id="log-folder">${MM.icon('folder-open', 14)}Logs folder</button></div>
        <div class="small dim mono" id="log-file" style="margin-bottom:6px"></div><div class="logview" id="log-pre">Loading…</div>`,
      onMount: (m) => {
        load(m);
        m.querySelector('#log-refresh').onclick = () => load(m);
        m.querySelector('#log-folder').onclick = () => MM.call('sessions:openLogFolder');
        let t; m.querySelector('#log-filter').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { filter = e.target.value; load(m); }, 300); };
      },
    });
  };

  MM.accent = (alpha = 1, light = 64) => {
    const hue = (MM.state.settings && MM.state.settings.appearance.accentHue) || 270;
    return `hsla(${hue}, 92%, ${light}%, ${alpha})`;
  };

  /** Small pop-up menu under a button. items: [{ label, icon, run, danger } | '-']. Arrow keys, Enter and Esc work. */
  MM.menu = (anchor, items) => {
    document.querySelector('.mm-menu')?.remove();
    const m = document.createElement('div');
    m.className = 'mm-menu';
    m.setAttribute('role', 'menu');
    m.innerHTML = items.map((it, i) => it === '-' ? '<div class="sep" role="separator"></div>'
      : `<button role="menuitem" class="${it.danger ? 'danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>${it.icon ? MM.icon(it.icon, 15) : ''}<span>${MM.esc(it.label)}</span></button>`).join('');
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
    m.style.top = `${r.bottom + h + 6 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
    const btns = [...m.querySelectorAll('button:not([disabled])')];
    const close = () => { m.remove(); document.removeEventListener('mousedown', out, true); document.removeEventListener('keydown', key, true); anchor.focus?.(); };
    const out = (e) => { if (!m.contains(e.target)) close(); };
    const key = (e) => {
      const i = btns.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
      else if (e.key === 'Tab') close();
    };
    m.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; close(); Promise.resolve(items[+b.dataset.i].run?.()).catch(err => MM.toast('error', 'Something went wrong', err.message)); });
    setTimeout(() => { document.addEventListener('mousedown', out, true); document.addEventListener('keydown', key, true); btns[0]?.focus(); }, 0);
    return close;
  };

  /** Priority tier badge. */
  MM.TIERS = { main: ['crown', 'Main'], important: ['gem', 'Important'], filler: ['circle-dot', 'Filler'] };
  MM.tierBadge = (tier, small) => (tier === 'main' || tier === 'important')
    ? `<span class="badge tier-${tier}" title="${MM.esc(MM.TIERS[tier][1])}">${MM.icon(MM.TIERS[tier][0], 12)}${small ? '' : MM.esc(MM.TIERS[tier][1])}</span>` : '';
  MM.tagChips = (tags) => (tags || []).map(t => `<span class="tag-chip" data-nt>#${MM.esc(t)}</span>`).join('');

  MM.empty = (icon, title, text) => `<div class="empty">${MM.icon(icon, 34)}<b>${MM.esc(title)}</b>${MM.esc(text || '')}</div>`;
  MM.winOnly = () => (MM.state.info && !MM.state.info.native
    ? `<div class="callout warn">${MM.icon('triangle-alert')}<div>This feature uses Windows APIs and is unavailable on this system.</div></div>` : '');
})();
