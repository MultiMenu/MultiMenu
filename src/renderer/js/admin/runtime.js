// Admin mode in the page: the hidden unlock, the Admin section in the sidebar,
// lab switches (element inspector, outlines, slow motion, FPS meter) and demo mode.
// Nothing here does anything until MultiMenu says admin mode is unlocked.
// Admin text is English only (this folder is not translated).
(function () {
  const MM = window.MM;
  MM.admin = { unlocked: false };
  const real = (ch, ...a) => window.mm.invoke(ch, ...a);
  MM.adminApi = real;

  const SECTION = {
    id: 'adm', label: 'Admin', icon: 'shield-check',
    tabs: [['admhome', 'Overview', 'gauge'], ['admlive', 'Live', 'activity'], ['admdata', 'Data', 'database'], ['admwin', 'Windows', 'app-window'], ['admtools', 'Tools', 'wrench'], ['admconsole', 'Console', 'square-terminal']],
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(s);
    });
  }

  /** Called by app.js before anything else loads. */
  MM.adminBoot = async () => {
    let st = { unlocked: false };
    try { st = await real('admin:status'); } catch { return; }
    MM.admin = st || { unlocked: false };
    if (!MM.admin.unlocked) return;
    if (MM.admin.demo) await startDemo();
    // Demo mode is for recording: the Admin section stays out of the sidebar (Ctrl+K still finds it).
    if (!MM.admin.demo && !MM.NAV.includes(SECTION)) MM.NAV.push('-', SECTION);
    MM.adminApplyFlags(MM.admin.flags || {});
    document.documentElement.classList.add('adm-on');
  };

  async function startDemo() {
    try {
      await loadScript('js/demo/demo-data.js');
      await loadScript('js/demo/demo-api.js');
    } catch (e) { console.error(e); return; }
    const demo = window.__MM_DEMO;
    if (!demo) return;
    const info = await real('app:info').catch(() => null);
    MM.demo = {
      invoke: async (ch, ...a) => {
        const r = await demo.invoke(ch, ...a);
        return ch === 'app:info' && r && info ? { ...r, version: info.version, electron: info.electron } : r;
      },
      on: (ev, cb) => demo.on(ev, cb),
    };
    // A little life: the PC monitor and charts move like the real thing.
    let t = 0;
    setInterval(() => {
      t++;
      const wave = (base, amp, p) => Math.max(0, Math.min(100, base + amp * Math.sin((t + p) / 4) + (Math.random() - 0.5) * 4));
      const ram = wave(63, 4, 3);
      demo._emit?.('system:sample', { t: Date.now(), cpu: wave(32, 10, 0), ramPercent: ram, ramUsed: ram / 100 * 16e9, ramTotal: 16e9, gpu: wave(45, 12, 7), gpuStatus: 'ok', roblox: { count: 2, memMB: 2200 + Math.round(Math.random() * 60), cpu: wave(20, 5, 2) }, appMemMB: 168 });
    }, 2000);
  }

  function leaveDemoBadge() {
    if (!MM.admin.demo || MM.admin.flags?.demoBadge === false || document.getElementById('adm-demo')) return;
    const b = document.createElement('button');
    b.id = 'adm-demo';
    b.dataset.nt = '';
    b.title = 'Sample data is showing. Click (or press Ctrl+Alt+Shift+D) to go back to your real data.';
    b.innerHTML = `${MM.icon('eye', 14)}<span>Demo data</span>`;
    b.onclick = () => real('admin:demo', false);
    document.body.appendChild(b);
  }

  // ---------- unlock ----------
  MM.adminUnlockPrompt = async (prefill = '') => {
    if (MM.admin.unlocked) { MM.go('admhome'); return; }
    const ok = await MM.modal({
      title: 'Admin mode', icon: 'shield-check', cls: 'adm-unlock',
      body: `<div data-nt><p class="small muted" style="margin:0 0 10px">Paste an admin code made in the MultiMenu Dev Console.</p>
        <textarea class="input mono" id="adm-code" rows="4" spellcheck="false" autocomplete="off" placeholder="MMA-…">${MM.esc(prefill)}</textarea>
        <div class="adm-err hidden" id="adm-err"></div></div>`,
      buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, {
        label: 'Unlock', value: true, cls: 'primary', icon: 'lock-open',
        handler: async (m) => {
          try { await real('admin:unlock', m.querySelector('#adm-code').value); return true; } catch (e) {
            const el = m.querySelector('#adm-err');
            el.textContent = e.message; el.classList.remove('hidden');
            return false;
          }
        },
      }],
    });
    if (ok) { MM.toast('success', 'Admin mode unlocked'); setTimeout(() => location.reload(), 500); }
  };

  // Seven quick clicks on the version number (sidebar or Settings → Data & about).
  let taps = [];
  document.addEventListener('click', (e) => {
    if (!e.target.closest || !e.target.closest('[data-admin-tap]')) return;
    const now = Date.now();
    taps = taps.filter(t => now - t < 3000);
    taps.push(now);
    if (taps.length >= 7) { taps = []; MM.adminUnlockPrompt(); }
  });

  // Pasting a code into Ctrl+K.
  MM.adminPaletteItem = (q) => ({
    kind: 'Admin', icon: 'shield-check', label: MM.admin.unlocked ? 'Open admin mode' : 'Unlock admin mode with this code',
    run: async () => {
      if (MM.admin.unlocked) { MM.go('admhome'); return; }
      try { await real('admin:unlock', q); MM.toast('success', 'Admin mode unlocked'); setTimeout(() => location.reload(), 500); } catch (e) { MM.toast('error', 'Admin mode', e.message); }
    },
  });

  MM.adminCommands = () => {
    if (!MM.admin.unlocked) return [];
    const flag = (k, label, icon, keys) => ({ kind: 'Admin', label: `Admin: ${label} ${MM.admin.flags?.[k] ? 'off' : 'on'}`, icon, keys: `admin lab ${keys}`, run: () => MM.adminSetFlags({ [k]: !MM.admin.flags?.[k] }) });
    return [
      { kind: 'Admin', label: 'Admin: open DevTools', icon: 'square-terminal', keys: 'admin devtools inspect console debug', run: () => real('admin:devtools') },
      { kind: 'Admin', label: 'Admin: reload the window', icon: 'refresh-cw', keys: 'admin reload refresh', run: () => real('admin:reload') },
      { kind: 'Admin', label: MM.admin.demo ? 'Admin: leave demo mode' : 'Admin: demo mode (sample data)', icon: 'eye', keys: 'admin demo sample fake promo record video', run: () => real('admin:demo', !MM.admin.demo) },
      { kind: 'Admin', label: 'Admin: screenshot of this window', icon: 'camera', keys: 'admin screenshot capture png', run: async () => { const r = await real('admin:screenshot'); MM.toast('success', 'Screenshot saved', `${r.name} (${r.width}×${r.height})`); } },
      flag('inspector', 'element inspector', 'scan', 'inspector element selector hover'),
      flag('outlines', 'layout outlines', 'ruler', 'outline boxes layout css'),
      flag('fps', 'FPS meter', 'gauge', 'fps frames meter performance'),
      flag('slow', 'slow animations', 'timer', 'slow motion animations'),
      { kind: 'Admin', label: 'Admin: lock admin mode', icon: 'lock', keys: 'admin lock leave exit', run: () => real('admin:lock') },
    ];
  };

  document.addEventListener('keydown', (e) => {
    if (!MM.admin.unlocked) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && e.altKey && e.shiftKey && k === 'd') { e.preventDefault(); real('admin:demo', !MM.admin.demo); }
    else if (e.ctrlKey && e.shiftKey && !e.altKey && k === 'i') { e.preventDefault(); real('admin:devtools'); }
    else if (e.ctrlKey && e.shiftKey && !e.altKey && k === 'r') { e.preventDefault(); real('admin:reload'); }
  }, true);

  // ---------- lab switches ----------
  MM.adminSetFlags = async (patch) => {
    const flags = await real('admin:flags', patch);
    MM.admin.flags = flags;
    MM.adminApplyFlags(flags);
    document.dispatchEvent(new CustomEvent('mm:adminflags', { detail: flags }));
    return flags;
  };

  MM.adminApplyFlags = (f) => {
    document.body.classList.toggle('adm-outlines', !!f.outlines);
    inspector(!!f.inspector);
    slowMotion(!!f.slow);
    fpsMeter(!!f.fps);
    leaveDemoBadge();
  };

  // Element inspector: hover shows the element's selector and size; Alt+click copies it.
  let insp = null;
  function selectorOf(el) {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 5 && e !== document.body; e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) { parts.unshift(`${s}#${e.id}`); break; }
      const cls = [...e.classList].filter(c => !/^(on|active|hidden)$/.test(c)).slice(0, 2);
      if (cls.length) s += `.${cls.join('.')}`;
      for (const a of ['data-act', 'data-page', 'data-setting', 'data-hub-tab']) if (e.hasAttribute(a)) { s += `[${a}="${e.getAttribute(a)}"]`; break; }
      parts.unshift(s);
    }
    return parts.join(' > ');
  }
  function inspector(on) {
    if (!on) { if (insp) { document.removeEventListener('mousemove', insp.move, true); document.removeEventListener('click', insp.click, true); insp.tip.remove(); insp.box.remove(); insp = null; } return; }
    if (insp) return;
    const tip = document.createElement('div'); tip.id = 'adm-insp'; tip.dataset.nt = '';
    const box = document.createElement('div'); box.id = 'adm-insp-box';
    document.body.append(box, tip);
    let raf = 0, last = null;
    const move = (e) => {
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = document.elementFromPoint(last.clientX, last.clientY);
        if (!el || el === tip || el === box) return;
        const r = el.getBoundingClientRect();
        Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        tip.textContent = `${selectorOf(el)}  ·  ${Math.round(r.width)}×${Math.round(r.height)}  ·  Alt+click copies`;
        const x = Math.min(window.innerWidth - tip.offsetWidth - 8, last.clientX + 14), y = last.clientY + 18 + tip.offsetHeight > window.innerHeight ? last.clientY - tip.offsetHeight - 10 : last.clientY + 18;
        Object.assign(tip.style, { left: `${Math.max(4, x)}px`, top: `${y}px` });
      });
    };
    const click = (e) => {
      if (!e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el) navigator.clipboard.writeText(selectorOf(el)).then(() => MM.toast('success', 'Selector copied', selectorOf(el))).catch(() => {});
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    insp = { tip, box, move, click };
  }

  let slowTimer = null;
  function slowMotion(on) {
    clearInterval(slowTimer); slowTimer = null;
    const rate = on ? 0.2 : 1;
    const apply = () => { for (const a of document.getAnimations()) if (a.playbackRate !== rate) a.playbackRate = rate; };
    apply();
    if (on) slowTimer = setInterval(apply, 100);
  }

  // FPS meter: frames per second, slow frames, JS memory and how many elements the page has.
  let fpsState = null;
  function fpsMeter(on) {
    if (!on) { if (fpsState) { cancelAnimationFrame(fpsState.raf); clearInterval(fpsState.timer); fpsState.el.remove(); fpsState = null; } return; }
    if (fpsState) return;
    const el = document.createElement('div'); el.id = 'adm-fps'; el.dataset.nt = '';
    document.body.appendChild(el);
    const st = { el, frames: 0, slow: 0, last: performance.now(), raf: 0, timer: 0, hist: [] };
    const tick = (t) => {
      st.frames++;
      if (t - st.last > 50) st.slow++;
      st.last = t;
      st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
    let prev = performance.now();
    st.timer = setInterval(() => {
      const now = performance.now();
      const fps = Math.round(st.frames * 1000 / (now - prev));
      prev = now; st.frames = 0;
      st.hist.push(fps); if (st.hist.length > 40) st.hist.shift();
      const mem = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB` : '—';
      const max = Math.max(60, ...st.hist);
      const bars = st.hist.map(v => `<i style="height:${Math.max(2, Math.round(v / max * 22))}px" class="${v < 30 ? 'bad' : v < 50 ? 'meh' : ''}"></i>`).join('');
      el.innerHTML = `<b>${fps}</b> fps<span>${st.slow} slow</span><span>${mem}</span><span>${document.getElementsByTagName('*').length} el</span><div class="bars">${bars}</div>`;
    }, 500);
    fpsState = st;
  }
})();
