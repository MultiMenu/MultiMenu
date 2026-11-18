// Admin mode pages: Overview, Live, Data, Windows, Tools and Console.
// Only reachable once admin mode is unlocked (see runtime.js). English only.
(function () {
  const MM = window.MM;
  const A = (ch, ...a) => window.mm.invoke(ch, ...a);
  const call = async (ch, ...a) => {
    try { return await A(ch, ...a); } catch (e) { if (e.code !== 'CANCELLED') MM.toast('error', 'Admin', e.message); return undefined; }
  };
  const esc = MM.esc, icon = MM.icon;
  const num = (n, d = 0) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
  const bytes = (b) => (b == null ? '—' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : MM.fmt.bytes(b));
  const time = (t) => (t ? new Date(t).toLocaleTimeString([], { hour12: false }) + `.${String(new Date(t).getMilliseconds()).padStart(3, '0')}` : '');
  const dateTime = (t) => (t ? new Date(t).toLocaleString([], { hour12: false }) : '—');
  const yes = (on, a = 'On', b = 'Off') => `<span class="badge ${on ? 'ok' : 'dim'}">${on ? a : b}</span>`;
  const head = (title, sub, actions = '') => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="actions">${actions}</div></div>`;
  const kv = (o) => `<div class="adm-kv">${Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `<span>${esc(k)}</span><b class="mono">${v === null || v === '' ? '<i class="dim">—</i>' : typeof v === 'object' ? esc(JSON.stringify(v)) : esc(String(v))}</b>`).join('')}</div>`;
  const seg = (id, items, on) => `<div class="seg" id="${id}">${items.map(([v, label]) => `<button data-v="${esc(v)}" class="${v === on ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>`;
  const spark = (vals, max, cls = '') => {
    if (!vals.length) return '';
    const m = Math.max(max || 0, ...vals, 1), w = 120, h = 28;
    const pts = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1) * w).toFixed(1)},${(h - (v / m) * (h - 2) - 1).toFixed(1)}`).join(' ');
    return `<svg class="adm-spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" /></svg>`;
  };
  const copy = (text, what = 'Copied') => navigator.clipboard.writeText(text).then(() => MM.toast('success', what)).catch(() => MM.toast('error', 'Could not copy'));
  const fresh = (root) => { root.setAttribute('data-nt', ''); root.classList.add('adm-page'); };

  /** JSON shown as a small coloured tree (strings, numbers, keys). */
  function jsonHtml(v, depth = 0) {
    if (v === null) return '<i class="j-null">null</i>';
    if (typeof v === 'string') return `<i class="j-str">"${esc(v)}"</i>`;
    if (typeof v === 'number' || typeof v === 'boolean') return `<i class="j-num">${esc(String(v))}</i>`;
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      if (depth > 6) return `[… ${v.length}]`;
      return `<details ${depth < 1 ? 'open' : ''}><summary>[${v.length}]</summary>${v.slice(0, 300).map((x, i) => `<div class="j-row"><i class="j-key">${i}</i>: ${jsonHtml(x, depth + 1)}</div>`).join('')}${v.length > 300 ? `<div class="dim">… ${v.length - 300} more</div>` : ''}</details>`;
    }
    if (typeof v === 'object') {
      const keys = Object.keys(v);
      if (!keys.length) return '{}';
      if (depth > 6) return `{… ${keys.length}}`;
      return `<details ${depth < 2 ? 'open' : ''}><summary>{${keys.length}}</summary>${keys.map(k => `<div class="j-row"><i class="j-key">${esc(k)}</i>: ${jsonHtml(v[k], depth + 1)}</div>`).join('')}</details>`;
    }
    return esc(String(v));
  }
  MM.adminJson = jsonHtml;

  // =====================================================================
  // Overview
  // =====================================================================
  MM.pages.admhome = {
    render(root) {
      fresh(root);
      const st = MM.admin;
      const exp = st.exp ? `expires ${dateTime(st.exp)}` : 'never expires';
      root.innerHTML = `${head('Admin overview', `Unlocked for <b>${esc(st.name || 'admin')}</b> · code ${esc(st.id || '')} · ${esc(exp)}`,
        `<button class="btn" data-act="devtools">${icon('square-terminal')}DevTools</button><button class="btn" data-act="reload">${icon('refresh-cw')}Reload</button><button class="btn" data-act="bundle">${icon('file-json')}Debug bundle</button><button class="btn danger" data-act="lock">${icon('lock')}Lock</button>`)}
        <div class="adm-tiles" id="ov-tiles"></div>
        <div class="grid cols-2 adm-grid">
          <div class="card"><h3>${icon('cpu')}MultiMenu processes<span class="right" id="ov-proc-sum"></span></h3><div id="ov-proc"></div></div>
          <div class="card"><h3>${icon('app-window')}Windows</h3><div id="ov-win"></div></div>
          <div class="card"><h3>${icon('zap')}Running features</h3><div class="adm-chips" id="ov-feat"></div></div>
          <div class="card"><h3>${icon('package')}Versions &amp; system</h3><div id="ov-ver"></div></div>
          <div class="card"><h3>${icon('folder-open')}Folders</h3><div id="ov-paths"></div></div>
          <div class="card"><h3>${icon('binary')}Handles &amp; listeners</h3><div id="ov-res"></div></div>
          <div class="card"><h3>${icon('monitor-cog')}Graphics</h3><div id="ov-gpu"></div></div>
          <div class="card"><h3>${icon('terminal')}Command line &amp; environment</h3><div id="ov-argv"></div></div>
        </div>`;
      const hist = { cpu: [], rss: [], heap: [], lag: [] };
      let first = true;
      const draw = (o) => {
        if (!o || !root.isConnected) return;
        const m = o.main;
        hist.cpu.push(m.cpu); hist.rss.push(m.rssMB); hist.heap.push(m.heapMB); hist.lag.push(m.lag?.p99 || 0);
        for (const k of Object.keys(hist)) if (hist[k].length > 60) hist[k].shift();
        const handles = Object.values(m.resources || {}).reduce((a, b) => a + b, 0);
        const procMB = o.processes.reduce((n, p) => n + p.memMB, 0), procCpu = o.processes.reduce((n, p) => n + p.cpu, 0);
        const tile = (label, value, unit, sub, sp, cls = '') => `<div class="card adm-tile ${cls}"><div class="label">${esc(label)}</div><div class="value">${value}<small>${esc(unit)}</small></div><div class="sub small muted">${sub}</div>${sp}</div>`;
        MM.$('#ov-tiles', root).innerHTML = [
          tile('Main process CPU', num(m.cpu, 1), '%', `all processes ${num(procCpu, 1)}%`, spark(hist.cpu, 100)),
          tile('Main memory', num(m.rssMB), 'MB', `all processes ${num(procMB)} MB`, spark(hist.rss)),
          tile('JS heap', num(m.heapMB, 1), 'MB', `of ${num(m.heapLimitMB)} MB limit · ${num(m.externalMB)} MB external`, spark(hist.heap)),
          tile('Event loop lag (p99)', m.lag ? num(m.lag.p99, 1) : '—', 'ms', m.lag ? `mean ${num(m.lag.mean, 1)} · max ${num(m.lag.max, 1)} ms` : 'measuring…', spark(hist.lag, 50), m.lag && m.lag.p99 > 100 ? 'warn' : ''),
          tile('Handles', num(handles), '', `${num(m.busListeners)} bus listeners on ${num(m.busEvents)} events`, ''),
          tile('Uptime', MM.fmt.dur(o.app.uptimeSec * 1000), '', `pid ${o.app.pid}${o.app.safeMode ? ' · safe mode' : ''}${o.app.diet ? ' · diet' : ''}`, ''),
        ].join('');
        MM.$('#ov-proc-sum', root).textContent = `${o.processes.length} processes`;
        MM.$('#ov-proc', root).innerHTML = `<table class="tbl adm-tbl"><thead><tr><th>Type</th><th>Pid</th><th>Name</th><th>CPU</th><th>Memory</th><th>Private</th></tr></thead><tbody>${o.processes.map(p => `<tr><td class="nw" title="${p.sandboxed ? 'Sandboxed' : ''}">${esc(p.type)}${p.sandboxed ? ` ${icon('shield-check', 12)}` : ''}</td><td class="mono">${p.pid}</td><td class="adm-cut">${esc(p.name)}</td><td>${num(p.cpu, 1)}%</td><td>${num(p.memMB)} MB</td><td>${num(p.privateMB)} MB</td></tr>`).join('')}</tbody></table>`;
        MM.$('#ov-win', root).innerHTML = `<table class="tbl adm-tbl"><thead><tr><th>Window</th><th>Page</th><th>Size</th><th>Zoom</th><th>State</th></tr></thead><tbody>${o.windows.map(w => `<tr><td class="adm-cut">${esc(w.title || '—')}</td><td class="mono">${esc(w.file)}</td><td class="mono">${w.bounds.width}×${w.bounds.height}</td><td>${w.zoom}</td><td>${w.crashed ? '<span class="badge err">crashed</span>' : w.visible ? yes(true, w.focused ? 'focused' : 'visible') : '<span class="badge dim">hidden</span>'}</td></tr>`).join('')}</tbody></table>`;
        MM.$('#ov-feat', root).innerHTML = o.features.map(f => `<span class="badge ${f.on ? 'ok' : 'dim'}" title="${esc(f.detail)}">${icon(f.on ? 'circle-check' : 'circle-dot', 12)}${esc(f.name)}${f.detail && f.on ? ` · ${esc(f.detail)}` : ''}</span>`).join('');
        if (first) {
          first = false;
          MM.$('#ov-ver', root).innerHTML = kv({ MultiMenu: `${o.versions.app}${o.app.portable ? ' (portable)' : ' (installed)'}${o.app.packaged ? '' : ' · from source'}`, Electron: o.versions.electron, Chromium: o.versions.chrome, Node: o.versions.node, V8: o.versions.v8, koffi: o.versions.koffi, Windows: o.system.os, Wine: o.system.wine ? 'yes' : 'no', CPU: `${o.system.cpuModel} (${o.system.cpus} threads)`, Memory: `${o.system.freeGB} GB free of ${o.system.totalGB} GB${o.system.memoryLoad != null ? ` · load ${o.system.memoryLoad}%` : ''}`, 'PC uptime': `${o.system.uptimeH} h`, Language: `${o.app.language} (Windows: ${o.app.locale})`, 'Updated from': o.app.updatedFrom ? `v${o.app.updatedFrom.from}` : null });
          const open = { data: 'data', logs: 'logs', exe: 'app', userData: null, app: null, temp: null };
          MM.$('#ov-paths', root).innerHTML = `<div class="adm-kv">${Object.entries(o.paths).map(([k, v]) => `<span>${esc(k)}</span><b class="mono adm-path">${esc(v)}${open[k] ? `<button class="btn sm ghost" data-act="open" data-w="${open[k]}">${icon('folder-open', 14)}</button>` : ''}</b>`).join('')}</div>
            <div class="row" style="margin-top:10px"><button class="btn sm" data-act="open" data-w="admin">${icon('folder-open', 14)}Admin folder</button><button class="btn sm" data-act="open" data-w="backups">${icon('archive', 14)}Backups</button><button class="btn sm" data-act="open" data-w="updates">${icon('download', 14)}Updates</button></div>`;
          const gpu = o.gpu || {};
          MM.$('#ov-gpu', root).innerHTML = `<div class="adm-chips">${Object.entries(gpu).map(([k, v]) => `<span class="badge ${/^enabled/.test(v) ? 'ok' : /disabled|unavailable/.test(v) ? 'warn' : 'dim'}" title="${esc(v)}">${esc(k)}: ${esc(v.replace(/_/g, ' '))}</span>`).join('')}</div>`;
          MM.$('#ov-argv', root).innerHTML = `<div class="mono adm-pre">${o.argv.map(esc).join('<br>') || '<span class="dim">no arguments</span>'}</div>${Object.keys(o.env).length ? kv(o.env) : '<p class="small muted">No MULTIMENU_ or ELECTRON_ variables set.</p>'}`;
        }
        const res = Object.entries(m.resources || {}).sort((a, b) => b[1] - a[1]);
        MM.$('#ov-res', root).innerHTML = res.length ? `<div class="adm-kv">${res.map(([k, v]) => `<span>${esc(k)}</span><b class="mono">${v}</b>`).join('')}</div>` : '<p class="small muted">Not available in this Node version.</p>';
      };
      const tick = async () => draw(await call('admin:overview'));
      tick();
      const t = setInterval(tick, 2000);
      MM.delegate(root, {
        devtools: () => call('admin:devtools'),
        reload: () => call('admin:reload'),
        lock: async () => { if (await MM.confirm('Lock admin mode?', 'The admin pages and lab switches go away until you enter a code again.', { ok: 'Lock' })) call('admin:lock'); },
        bundle: async (b) => { const r = await MM.busy(b, () => call('admin:bundle')); if (r) MM.toast('success', 'Debug bundle saved', `${r.file} · ${bytes(r.bytes)}`); },
        open: (b) => call('admin:open', b.dataset.w),
      });
      return () => clearInterval(t);
    },
  };

  // =====================================================================
  // Live: log, events, commands, network
  // =====================================================================
  MM.pages.admlive = {
    render(root, params) {
      fresh(root);
      let view = params.view || 'log', paused = false, q = '', level = 'all', ipcMode = 'stats', sortBy = 'n';
      const data = { log: [], bus: [], ipc: [], net: [], stats: [] };
      root.innerHTML = `${head('Live', 'What MultiMenu is doing right now. Secrets, tokens and webhook links are hidden before anything reaches this page.',
        `<button class="btn" data-act="pause">${icon('pause')}Pause</button><button class="btn" data-act="copy">${icon('copy')}Copy</button><button class="btn" data-act="clear">${icon('eraser')}Clear</button>`)}
        <div class="card adm-live">
          <div class="row adm-bar">${seg('lv-view', [['log', 'Log'], ['bus', 'Events'], ['ipc', 'Commands'], ['net', 'Network']], view)}
            <input class="input" id="lv-q" placeholder="Filter…" spellcheck="false">
            <select class="input adm-sel" id="lv-level"><option value="all">All levels</option><option value="INFO">Info and up</option><option value="WARN">Warnings and errors</option><option value="ERROR">Errors</option><option value="DEBUG">Debug only</option></select>
            ${seg('lv-ipc', [['stats', 'Per command'], ['calls', 'Recent calls']], ipcMode)}
            <span class="spacer"></span><span class="small muted" id="lv-count"></span></div>
          <div class="adm-scroll" id="lv-body"></div>
        </div>`;
      const body = MM.$('#lv-body', root);
      const LV = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
      const match = (s) => !q || String(s).toLowerCase().includes(q);
      const rowsFor = () => {
        if (view === 'log') return data.log.filter(l => (level === 'all' || (level === 'DEBUG' ? l.level === 'DEBUG' : (LV[l.level] ?? 1) >= LV[level])) && match(`${l.scope} ${l.msg}`));
        if (view === 'bus') return data.bus.filter(b => match(`${b.name} ${b.data}`));
        if (view === 'net') return data.net.filter(n => match(`${n.method} ${n.host}${n.path} ${n.status}`));
        return ipcMode === 'stats' ? data.stats.filter(s => match(s.channel)) : data.ipc.filter(c => match(c.channel));
      };
      const draw = () => {
        if (!root.isConnected) return;
        MM.$('#lv-level', root).classList.toggle('hidden', view !== 'log');
        MM.$('#lv-ipc', root).classList.toggle('hidden', view !== 'ipc');
        const rows = rowsFor();
        MM.$('#lv-count', root).textContent = `${rows.length} shown`;
        const newest = (list) => list.slice(-500).reverse();
        if (view === 'log') {
          body.innerHTML = rows.length ? `<table class="tbl adm-tbl"><tbody>${newest(rows).map(l => `<tr class="lv-${esc(l.level.toLowerCase())}"><td class="mono t">${time(l.at)}</td><td><span class="lvl">${esc(l.level)}</span></td><td class="mono sc">${esc(l.scope)}</td><td class="mono msg">${esc(l.msg)}</td></tr>`).join('')}</tbody></table>` : MM.empty('scroll-text', 'No log lines', q ? 'Nothing matches the filter.' : 'New lines appear here as they are written.');
        } else if (view === 'bus') {
          body.innerHTML = rows.length ? `<table class="tbl adm-tbl"><thead><tr><th>Time</th><th>Event</th><th>Listeners</th><th>Data</th></tr></thead><tbody>${newest(rows).map(b => `<tr><td class="mono t">${time(b.at)}</td><td class="mono">${esc(b.name)}</td><td>${b.listeners}</td><td class="mono msg adm-cut" title="${esc(b.data)}">${esc(b.data)}</td></tr>`).join('')}</tbody></table>` : MM.empty('radio', 'No events yet', 'Events between MultiMenu\'s parts show up here.');
        } else if (view === 'net') {
          body.innerHTML = rows.length ? `<table class="tbl adm-tbl"><thead><tr><th>Time</th><th>Method</th><th>Host</th><th>Path</th><th>Status</th><th>Time to reply</th></tr></thead><tbody>${newest(rows).map(n => `<tr><td class="mono t">${time(n.at)}</td><td class="mono">${esc(n.method)}</td><td class="mono">${esc(n.host)}</td><td class="mono adm-cut">${esc(n.path)}</td><td>${n.status ? `<span class="badge ${n.status < 300 ? 'ok' : n.status < 500 ? 'warn' : 'err'}">${n.status}</span>` : `<span class="badge err" title="${esc(n.error || '')}">failed</span>`}</td><td>${num(n.ms)} ms</td></tr>`).join('')}</tbody></table>` : MM.empty('network', 'No requests yet', 'Web requests MultiMenu makes (Roblox, GitHub, Discord…) appear here, without tokens or query strings.');
        } else if (ipcMode === 'stats') {
          const sorted = rows.slice().sort((a, b) => (sortBy === 'channel' ? a.channel.localeCompare(b.channel) : b[sortBy] - a[sortBy]));
          const th = (k, l) => `<th class="sort ${sortBy === k ? 'on' : ''}" data-sort="${k}">${l}</th>`;
          body.innerHTML = rows.length ? `<table class="tbl adm-tbl"><thead><tr>${th('channel', 'Command')}${th('n', 'Calls')}${th('avg', 'Average')}${th('max', 'Slowest')}${th('errors', 'Errors')}${th('last', 'Last')}</tr></thead><tbody>${sorted.map(s => `<tr><td class="mono">${esc(s.channel)}</td><td>${num(s.n)}</td><td class="${s.avg > 200 ? 'adm-warn' : ''}">${num(s.avg, 1)} ms</td><td class="${s.max > 1000 ? 'adm-warn' : ''}">${num(s.max, 1)} ms</td><td>${s.errors ? `<span class="badge err">${s.errors}</span>` : '0'}</td><td class="small muted">${MM.fmt.ago(s.last)}</td></tr>`).join('')}</tbody></table>` : MM.empty('square-terminal', 'No commands yet', 'Every call from the window to MultiMenu is timed here.');
        } else {
          body.innerHTML = rows.length ? `<table class="tbl adm-tbl"><thead><tr><th>Time</th><th>Command</th><th>Took</th><th>Result</th></tr></thead><tbody>${newest(rows).map(c => `<tr><td class="mono t">${time(c.at)}</td><td class="mono">${esc(c.channel)}</td><td class="${c.ms > 200 ? 'adm-warn' : ''}">${num(c.ms, 1)} ms</td><td>${c.ok ? '<span class="badge ok">ok</span>' : `<span class="badge err">error</span> <span class="small mono">${esc(c.error || '')}</span>`}</td></tr>`).join('')}</tbody></table>` : MM.empty('square-terminal', 'No commands yet', '');
        }
      };
      let drawT = null;
      const soon = () => { if (!drawT) drawT = setTimeout(() => { drawT = null; if (!paused) draw(); }, 250); };
      const statsFrom = () => {
        const m = new Map(data.stats.map(s => [s.channel, s]));
        return m;
      };
      const load = async () => {
        const f = await call('admin:feed');
        if (!f) return;
        Object.assign(data, f);
        draw();
      };
      const off = MM.on('admin:feed', (b) => {
        for (const k of ['log', 'bus', 'ipc', 'net']) if (b[k]?.length) { data[k].push(...b[k]); if (data[k].length > 1200) data[k].splice(0, data[k].length - 1000); }
        if (b.ipc?.length) {
          const m = statsFrom();
          for (const c of b.ipc) {
            const s = m.get(c.channel) || { channel: c.channel, n: 0, errors: 0, avg: 0, max: 0, last: 0 };
            s.avg = +((s.avg * s.n + c.ms) / (s.n + 1)).toFixed(1); s.n++; s.max = Math.max(s.max, c.ms); s.last = c.at; if (!c.ok) s.errors++;
            m.set(c.channel, s);
          }
          data.stats = [...m.values()];
        }
        soon();
      });
      call('admin:watch', true);
      load();
      MM.$('#lv-view', root).addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; view = b.dataset.v; MM.$$('#lv-view button', root).forEach(x => x.classList.toggle('on', x === b)); draw(); });
      MM.$('#lv-ipc', root).addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; ipcMode = b.dataset.v; MM.$$('#lv-ipc button', root).forEach(x => x.classList.toggle('on', x === b)); draw(); });
      MM.$('#lv-q', root).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
      MM.$('#lv-level', root).addEventListener('change', (e) => { level = e.target.value; draw(); });
      body.addEventListener('click', (e) => { const th = e.target.closest('[data-sort]'); if (th) { sortBy = th.dataset.sort; draw(); } });
      MM.delegate(root, {
        pause: (b) => { paused = !paused; b.innerHTML = paused ? `${icon('play')}Resume` : `${icon('pause')}Pause`; b.classList.toggle('on', paused); if (!paused) draw(); },
        clear: async () => { await call('admin:clearFeed', view === 'ipc' ? 'ipc' : view); if (view === 'ipc') { data.ipc = []; data.stats = []; } else data[view] = []; draw(); },
        copy: () => {
          const rows = rowsFor();
          const text = view === 'log' ? rows.map(l => `${new Date(l.at).toISOString()} [${l.level}] [${l.scope}] ${l.msg}`).join('\n')
            : view === 'bus' ? rows.map(b => `${new Date(b.at).toISOString()} ${b.name} ${b.data}`).join('\n')
              : view === 'net' ? rows.map(n => `${new Date(n.at).toISOString()} ${n.method} ${n.host}${n.path} ${n.status || n.error} ${n.ms}ms`).join('\n')
                : ipcMode === 'stats' ? rows.map(s => `${s.channel}\t${s.n}\t${s.avg}\t${s.max}\t${s.errors}`).join('\n') : rows.map(c => `${new Date(c.at).toISOString()} ${c.channel} ${c.ms}ms ${c.ok ? 'ok' : c.error}`).join('\n');
          copy(text, `${rows.length} lines copied`);
        },
      });
      return () => { off(); clearTimeout(drawT); call('admin:watch', false); };
    },
  };

  // =====================================================================
  // Data: settings, data files, snapshots, achievements
  // =====================================================================
  MM.pages.admdata = {
    render(root, params) {
      fresh(root);
      let view = params.view || 'settings';
      root.innerHTML = `${head('Data', 'Every setting and data file, with secrets hidden. Snapshots let you try anything and put it all back.',
        `<button class="btn" data-act="bundle">${icon('file-json')}Debug bundle</button><button class="btn" data-act="openData">${icon('folder-open')}Data folder</button>`)}
        <div class="row adm-bar">${seg('dt-view', [['settings', 'Settings'], ['files', 'Data files'], ['snapshots', 'Snapshots'], ['achievements', 'Achievements']], view)}</div>
        <div id="dt-body"></div>`;
      const host = MM.$('#dt-body', root);
      let gen = 0; // bumped on every view switch, so a slow load can't draw over the next view
      const views = {
        async settings() {
          const g = gen;
          const rows = await call('admin:settings');
          if (!rows || g !== gen) return;
          let q = '', changedOnly = false;
          host.innerHTML = `<div class="card"><div class="row adm-bar"><input class="input" id="st-q" placeholder="Filter settings…" spellcheck="false"><label class="check-lbl small"><input type="checkbox" id="st-ch"> Changed only</label><span class="spacer"></span><span class="small muted" id="st-n"></span></div><div class="adm-scroll tall" id="st-list"></div></div>`;
          const ctl = (r) => {
            if (r.secret) return `<span class="badge dim">${icon('lock', 12)}${esc(r.value || 'empty')}</span>`;
            const v = r.value;
            if (r.type === 'boolean') return `<label class="toggle"><input type="checkbox" data-key="${esc(r.key)}" ${v ? 'checked' : ''}><span class="sw"></span></label>`;
            if (r.enum) return `<select class="input adm-sel" data-key="${esc(r.key)}">${r.enum.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
            if (r.type === 'number') return `<input class="input adm-in" type="number" data-key="${esc(r.key)}" value="${esc(v)}" ${r.range ? `min="${r.range[0]}" max="${r.range[1]}"` : ''} step="any">`;
            if (r.type === 'list') return `<input class="input adm-in wide" data-key="${esc(r.key)}" data-list="1" value="${esc((v || []).join(', '))}" spellcheck="false">`;
            if (r.type === 'string') return `<input class="input adm-in wide" data-key="${esc(r.key)}" value="${esc(v)}" spellcheck="false">`;
            return `<span class="mono small">${esc(JSON.stringify(v))}</span>`;
          };
          const draw = () => {
            const shown = rows.filter(r => (!changedOnly || r.changed) && (!q || r.key.toLowerCase().includes(q) || String(JSON.stringify(r.value)).toLowerCase().includes(q)));
            MM.$('#st-n', host).textContent = `${shown.length} of ${rows.length} · ${rows.filter(r => r.changed).length} changed`;
            MM.$('#st-list', host).innerHTML = `<table class="tbl adm-tbl"><thead><tr><th>Setting</th><th>Value</th><th>Default</th><th></th></tr></thead><tbody>${shown.map(r => `<tr class="${r.changed ? 'adm-changed' : ''}"><td class="mono">${esc(r.key)}${r.range ? ` <span class="dim small">${r.range[0]}–${r.range[1]}</span>` : ''}</td><td>${ctl(r)}</td><td class="mono small muted adm-cut" title="${esc(JSON.stringify(r.def))}">${esc(JSON.stringify(r.def))}</td><td>${r.changed && !r.secret ? `<button class="btn sm ghost" data-reset="${esc(r.key)}" title="Back to the default">${icon('rotate-ccw', 14)}</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
          };
          const save = async (el) => {
            const key = el.dataset.key, r = rows.find(x => x.key === key);
            let value = el.type === 'checkbox' ? el.checked : el.dataset.list ? el.value.split(',').map(s => s.trim()).filter(Boolean) : r.type === 'number' ? Number(el.value) : el.value;
            const ok = await MM.setSetting(key, value);
            const now = MM.getSetting(key);
            if (ok !== false) { r.value = now; r.changed = JSON.stringify(now) !== JSON.stringify(r.def); MM.toast('success', 'Saved', `${key} = ${JSON.stringify(now)}`, 2500); }
            draw();
          };
          host.onchange = (e) => { if (e.target.dataset.key) save(e.target); };
          host.onclick = async (e) => {
            const b = e.target.closest('[data-reset]');
            if (!b) return;
            const key = b.dataset.reset;
            const res = await call('admin:settingReset', key);
            if (res) { await MM.reloadSettings?.(); const r = rows.find(x => x.key === key); r.value = res.value; r.changed = false; draw(); MM.toast('success', 'Back to the default', key, 2500); }
          };
          MM.$('#st-q', host).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
          MM.$('#st-ch', host).addEventListener('change', (e) => { changedOnly = e.target.checked; draw(); });
          draw();
        },
        async files() {
          const g = gen;
          const list = await call('admin:stores');
          if (!list || g !== gen) return;
          host.innerHTML = `<div class="grid adm-files"><div class="card"><h3>${icon('database')}Data files<span class="right">${list.length} files · ${bytes(list.reduce((n, f) => n + f.bytes, 0))}</span></h3>
            <div class="list">${list.map(f => `<button class="item adm-file" data-file="${esc(f.name)}"><div class="grow"><b class="mono">${esc(f.name)}</b><div class="small muted">${f.error ? `<span class="badge err">${esc(f.error)}</span>` : esc(Object.entries(f.summary || {}).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · '))}</div></div><div class="small muted right">${bytes(f.bytes)}<br>${MM.fmt.ago(f.mtime)}</div></button>`).join('')}</div></div>
            <div class="card adm-viewer"><h3>${icon('braces')}<span id="fv-name">Pick a file</span><span class="right"><button class="btn sm ghost hidden" id="fv-copy">${icon('copy', 14)}Copy</button></span></h3><div class="adm-json" id="fv-body"><p class="small muted">The file as MultiMenu last saved it, with every secret replaced by ‹hidden›.</p></div></div></div>`;
          let current = null;
          host.onchange = null;
          host.onclick = async (e) => {
            const b = e.target.closest('[data-file]');
            if (b) {
              MM.$$('.adm-file', host).forEach(x => x.classList.toggle('on', x === b));
              const v = await call('admin:store', b.dataset.file);
              if (v === undefined) return;
              current = v;
              MM.$('#fv-name', host).textContent = b.dataset.file;
              MM.$('#fv-body', host).innerHTML = jsonHtml(v);
              MM.$('#fv-copy', host).classList.remove('hidden');
            }
            if (e.target.closest('#fv-copy') && current) copy(JSON.stringify(current, null, 2), 'Copied (secrets stay hidden)');
          };
        },
        async snapshots() {
          const g = gen;
          const draw = async () => {
            const list = await call('admin:snapshots');
            if (!list || g !== gen) return;
            host.innerHTML = `<div class="card"><h3>${icon('history')}Snapshots<span class="right"><button class="btn sm" data-snap="open">${icon('folder-open', 14)}Folder</button><button class="btn sm primary" data-snap="take">${icon('camera', 14)}Take a snapshot</button></span></h3>
              <p class="small muted">A snapshot copies every data file and macro. Restoring restarts MultiMenu and puts them back exactly (the data from just before is kept as another snapshot). The newest 30 are kept.</p>
              ${list.length ? `<table class="tbl adm-tbl"><thead><tr><th>Name</th><th>Taken</th><th>Version</th><th>Files</th><th>Size</th><th></th></tr></thead><tbody>${list.map(s => `<tr><td><b>${esc(s.label)}</b><div class="mono small dim">${esc(s.id)}</div></td><td>${dateTime(s.at)}</td><td>v${esc(s.version)}</td><td>${s.files.length} + ${s.macros || 0} macros</td><td>${bytes(s.bytes)}</td><td class="adm-acts"><button class="btn sm" data-snap="restore" data-id="${esc(s.id)}">${icon('rotate-ccw', 14)}Restore</button><button class="btn sm ghost" data-snap="delete" data-id="${esc(s.id)}" title="Delete">${icon('trash-2', 14)}</button></td></tr>`).join('')}</tbody></table>` : MM.empty('history', 'No snapshots yet', 'Take one before trying something risky.')}</div>`;
          };
          host.onclick = async (e) => {
            const b = e.target.closest('[data-snap]');
            if (!b) return;
            const act = b.dataset.snap;
            if (act === 'take') { const label = await MM.prompt('Take a snapshot', 'Name', 'Before testing', { ok: 'Take snapshot' }); if (label == null) return; const r = await MM.busy(b, () => call('admin:snapshot', label)); if (r) MM.toast('success', 'Snapshot taken', `${r.files.length} files, ${bytes(r.bytes)}`); draw(); }
            if (act === 'open') call('admin:open', 'snapshots');
            if (act === 'delete') { if (await MM.confirm('Delete this snapshot?', b.dataset.id, { danger: true, ok: 'Delete' })) { await call('admin:removeSnapshot', b.dataset.id); draw(); } }
            if (act === 'restore') { if (await MM.confirm('Restore this snapshot?', 'MultiMenu restarts and every data file goes back to how it was then. Your current data is kept as a snapshot first.', { danger: true, ok: 'Restore and restart' })) call('admin:restore', b.dataset.id); }
          };
          draw();
        },
        async achievements() {
          const g = gen;
          const draw = async () => {
            const st = await call('admin:achievements');
            if (!st || g !== gen) return;
            host.innerHTML = `<div class="card"><h3>${icon('trophy')}Achievements<span class="right">${st.unlocked} of ${st.total} unlocked<button class="btn sm danger" data-ach="reset">${icon('rotate-ccw', 14)}Reset all</button></span></h3>
              <table class="tbl adm-tbl"><thead><tr><th>Achievement</th><th>Progress</th><th>Unlocked</th><th></th></tr></thead><tbody>${st.list.map(a => `<tr><td>${icon(a.icon, 15)} <b>${esc(a.title)}</b><div class="small muted">${esc(a.desc)}</div></td><td>${num(a.current)} / ${num(a.goal)}</td><td>${a.at ? dateTime(a.at) : a.done ? 'pending' : '<span class="dim">—</span>'}</td><td><button class="btn sm ghost" data-ach="show" data-id="${esc(a.id)}">${icon('eye', 14)}Show pop-up</button></td></tr>`).join('')}</tbody></table></div>`;
          };
          host.onclick = async (e) => {
            const b = e.target.closest('[data-ach]');
            if (!b) return;
            if (b.dataset.ach === 'show') call('admin:simulate', { kind: 'achievement', type: b.dataset.id });
            if (b.dataset.ach === 'reset' && await MM.confirm('Reset every achievement?', 'Unlocks and counters are forgotten. Ones your stats already earn unlock again (with pop-ups) on the next check.', { danger: true, ok: 'Reset' })) { await call('admin:reset', 'achievements'); draw(); }
          };
          draw();
        },
      };
      // Views set host.onclick / onchange (not addEventListener), so switching views never stacks handlers.
      const show = (v) => {
        view = v;
        gen++;
        MM.$$('#dt-view button', root).forEach(x => x.classList.toggle('on', x.dataset.v === v));
        host.onclick = null; host.onchange = null;
        host.innerHTML = '<p class="small muted" style="padding:8px">Loading…</p>';
        views[v]();
      };
      MM.$('#dt-view', root).addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) show(b.dataset.v); });
      MM.delegate(root, {
        bundle: async (b) => { const r = await MM.busy(b, () => call('admin:bundle')); if (r) MM.toast('success', 'Debug bundle saved', `${r.file} · ${bytes(r.bytes)}`); },
        openData: () => call('admin:open', 'data'),
      });
      show(view);
    },
  };

  // =====================================================================
  // Windows toolbox
  // =====================================================================
  MM.pages.admwin = {
    render(root) {
      fresh(root);
      let all = false, auto = true;
      root.innerHTML = `${head('Windows', 'Every Roblox window with its real size, style and process. Change them one at a time without the tiler.',
        `<label class="check-lbl small"><input type="checkbox" id="wn-all"> All windows</label><label class="check-lbl small"><input type="checkbox" id="wn-auto" checked> Refresh every 3 s</label><button class="btn" data-act="refresh">${icon('refresh-cw')}Refresh</button>`)}
        <div class="card"><div id="wn-body"></div></div>`;
      let rows = [];
      const draw = async () => {
        const r = await call('admin:windows', { all });
        if (!r || !root.isConnected) return;
        if (!r.available) { MM.$('#wn-body', root).innerHTML = `<div class="callout warn">${icon('triangle-alert')}<div>Window tools use Windows APIs and aren't available here.</div></div>`; return; }
        rows = r.list;
        MM.$('#wn-body', root).innerHTML = rows.length ? `<table class="tbl adm-tbl"><thead><tr><th>Window</th><th>Process</th><th>Outer size</th><th>Inside</th><th>Style</th><th>State</th><th></th></tr></thead><tbody>${rows.map(w => `<tr>
          <td><b class="adm-cut">${esc(w.session?.label || w.title || '(no title)')}</b><div class="mono small dim">${esc(w.className)}${w.session ? ` · ${esc(w.session.status)}` : ''}</div></td>
          <td class="mono">${w.pid}${w.process ? `<div class="small muted">${num(w.process.memMB)} MB · ${num(w.process.cpu, 1)}%${w.priority ? ` · ${esc(w.priority)}` : ''}</div>` : ''}</td>
          <td class="mono">${w.rect ? `${w.rect.width}×${w.rect.height}<div class="small dim">at ${w.rect.x}, ${w.rect.y}</div>` : '—'}</td>
          <td class="mono">${w.client ? `${w.client.width}×${w.client.height}` : '—'}</td>
          <td class="mono small">${esc(w.style || '—')}</td>
          <td class="adm-chips">${w.minimized ? '<span class="badge dim">minimised</span>' : ''}${w.hung ? '<span class="badge err">not responding</span>' : ''}${w.keptTiny ? `<span class="badge ok">kept at ${w.keptTiny.w}×${w.keptTiny.h}</span>` : ''}${w.own ? '<span class="badge">MultiMenu</span>' : ''}${w.roblox ? '' : '<span class="badge dim">other app</span>'}</td>
          <td><button class="btn sm" data-menu="${esc(w.id)}">${icon('ellipsis', 15)}</button></td></tr>`).join('')}</tbody></table>` : MM.empty('app-window', all ? 'No windows' : 'No Roblox windows', all ? '' : 'Open a Roblox client, or tick "All windows".');
      };
      const act = async (id, action, arg) => { const r = await call('admin:window', id, action, arg); if (r !== undefined) { MM.toast(r === false ? 'warn' : 'success', `${action}: ${r === false ? 'Windows said no' : 'done'}`, '', 2000); setTimeout(draw, 300); } };
      MM.$('#wn-body', root).addEventListener('click', (e) => {
        const b = e.target.closest('[data-menu]');
        if (!b) return;
        const w = rows.find(x => x.id === b.dataset.menu);
        if (!w) return;
        MM.menu(b, [
          { label: 'Bring to front', icon: 'app-window', run: () => act(w.id, 'focus') },
          { label: 'Minimise', icon: 'minus', run: () => act(w.id, 'minimize') },
          { label: 'Restore', icon: 'square', run: () => act(w.id, 'restore') },
          { label: 'Always on top', icon: 'pin', run: () => act(w.id, 'topmost', { on: true }) },
          { label: 'Not on top', icon: 'pin-off', run: () => act(w.id, 'topmost', { on: false }) },
          '-',
          { label: 'Resize…', icon: 'ruler', run: async () => {
            const v = await MM.prompt('Resize window', 'Width × height (add "keep" to hold the size)', w.rect ? `${w.rect.width}x${w.rect.height}` : '800x600', { ok: 'Resize' });
            const m = v && /^(\d+)\s*[x×*, ]\s*(\d+)\s*(keep)?/i.exec(v.trim());
            if (m) act(w.id, 'resize', { width: +m[1], height: +m[2], keep: !!m[3] });
          } },
          ...(w.keptTiny ? [{ label: 'Stop holding the size', icon: 'lock-open', run: () => act(w.id, 'release') }] : []),
          { label: 'Rename title…', icon: 'pencil', run: async () => { const t = await MM.prompt('Window title', 'Title', w.title); if (t != null) act(w.id, 'title', { title: t }); } },
          '-',
          { label: 'Trim memory', icon: 'memory-stick', run: () => act(w.id, 'trim') },
          { label: 'Eco mode on', icon: 'leaf', run: () => act(w.id, 'eco', { on: true }) },
          { label: 'Eco mode off', icon: 'leaf', run: () => act(w.id, 'eco', { on: false }) },
          ...['idle', 'below', 'normal', 'above', 'high'].map(p => ({ label: `Priority: ${p}`, icon: 'gauge', run: () => act(w.id, 'priority', { value: p }) })),
          '-',
          { label: 'Ask it to close', icon: 'x', run: () => act(w.id, 'close') },
          { label: 'End the process', icon: 'octagon-x', danger: true, run: async () => { if (await MM.confirm('End this process?', `${w.title || w.className} (pid ${w.pid}) is closed at once, without saving.`, { danger: true, ok: 'End process' })) act(w.id, 'kill'); } },
        ]);
      });
      MM.$('#wn-all', root).addEventListener('change', (e) => { all = e.target.checked; draw(); });
      MM.$('#wn-auto', root).addEventListener('change', (e) => { auto = e.target.checked; });
      MM.delegate(root, { refresh: () => draw() });
      draw();
      const t = setInterval(() => { if (auto && !document.querySelector('.mm-menu, .modal-back')) draw(); }, 3000);
      return () => clearInterval(t);
    },
  };

  // =====================================================================
  // Tools
  // =====================================================================
  const LAB = [
    ['inspector', 'Element inspector', 'Hover shows any element\'s selector and size; Alt+click copies it.'],
    ['outlines', 'Layout outlines', 'Draws a thin outline round every box, to spot spacing problems.'],
    ['fps', 'FPS meter', 'Frames per second, slow frames, JS memory and element count, bottom left.'],
    ['slow', 'Slow animations', 'Every animation and transition at one fifth speed.'],
    ['pseudo', 'Pseudo-language', 'Every translatable string shows as ⟦Ŝţŕîñĝ⟧. Plain English left over was missed by the translation tools.'],
    ['verbose', 'Verbose logging', 'Writes every command, event and web request to the log (as DEBUG lines).'],
    ['demoBadge', 'Demo badge', 'Shows a small "Demo data" button while demo mode is on. Turn off for clean recordings.'],
  ];
  MM.pages.admtools = {
    render(root) {
      fresh(root);
      const f = MM.admin.flags || {};
      root.innerHTML = `${head('Tools', 'Updates, lab switches, profiling, storage, crash tests and resets.')}
        <div class="grid cols-2 adm-grid">
          <div class="card"><h3>${icon('flask-conical')}Lab switches</h3>
            ${LAB.map(([k, t, d]) => MM.settingRow(t, d, `<label class="toggle"><input type="checkbox" data-flag="${k}" ${f[k] ? 'checked' : ''}><span class="sw"></span></label>`)).join('')}
            <div class="row" style="margin-top:12px"><button class="btn" data-act="demo">${icon('eye')}${MM.admin.demo ? 'Leave demo mode' : 'Demo mode'}</button><span class="small muted grow">Sample accounts and clients in this window (for videos and screenshots). Your real ones keep running. Ctrl+Alt+Shift+D switches it.</span></div>
          </div>
          <div class="card"><h3>${icon('download')}Updates</h3><div id="up-state" class="small"></div>
            <div class="row" style="margin:10px 0"><input class="input" id="up-pretend" placeholder="Act as version, e.g. 1.6.0" style="max-width:220px"><button class="btn sm" data-act="pretend">Apply</button><button class="btn sm ghost" data-act="unpretend">Clear</button><button class="btn sm" data-act="upcheck">${icon('refresh-cw', 14)}Check</button><button class="btn sm ghost" data-act="upreset" title="Clear a stuck download">${icon('eraser', 14)}Reset</button></div>
            <p class="small muted">Acting as an older version lets you try the whole update (download, checks, install) on the real release. It lasts until MultiMenu restarts.</p>
            <div class="row"><button class="btn sm" data-act="releases">${icon('tag', 14)}Load releases</button><button class="btn sm ghost" data-act="goUpdates">Updates page</button></div>
            <div id="up-rel"></div>
          </div>
          <div class="card"><h3>${icon('camera')}Screenshots &amp; window size</h3>
            <div class="row"><button class="btn" data-act="shot">${icon('camera')}Screenshot</button><button class="btn ghost" data-act="open" data-w="screenshots">${icon('folder-open')}Folder</button></div>
            <div class="row" style="margin-top:12px">${[[1280, 800], [1440, 900], [1600, 1000], [1920, 1080]].map(([w, h]) => `<button class="btn sm" data-act="size" data-w="${w}" data-h="${h}">${w}×${h}</button>`).join('')}</div>
            <p class="small muted">Sets the inside of the window to an exact size, so every screenshot matches.</p></div>
          <div class="card"><h3>${icon('activity')}Profiling</h3>
            <div class="row"><button class="btn" data-act="cpu">${icon('timer')}CPU profile (10 s)</button><button class="btn" data-act="heap">${icon('memory-stick')}Heap snapshot</button><button class="btn" data-act="gc">${icon('eraser')}Collect garbage</button><button class="btn ghost" data-act="open" data-w="profiles">${icon('folder-open')}Folder</button></div>
            <p class="small muted">Profiles are for the main process. Open .cpuprofile and .heapsnapshot files in DevTools (Performance / Memory tab). For the window, use DevTools directly.</p>
            <div class="small mono" id="prof-out"></div></div>
          <div class="card"><h3>${icon('hard-drive')}Storage</h3><div id="st-folders"><p class="small muted">Measuring…</p></div></div>
          <div class="card"><h3>${icon('languages')}Translations</h3><div id="tr-body"><p class="small muted">Loading…</p></div></div>
          <div class="card"><h3>${icon('bug')}Crash tests</h3>
            <p class="small muted">Each one really happens, so you can check MultiMenu recovers and reports it properly.</p>
            <div class="row">${[['renderer', 'Crash the window'], ['main', 'Error in main'], ['rejection', 'Unhandled rejection'], ['hang', 'Freeze main 6 s'], ['gpu', 'Crash the GPU process']].map(([k, l]) => `<button class="btn sm" data-act="crash" data-k="${k}">${esc(l)}</button>`).join('')}</div></div>
          <div class="card"><h3>${icon('rotate-ccw')}Resets</h3>
            <div class="row">${[['wizard', 'Setup wizard'], ['tour', 'Page tips'], ['language', 'Language picker'], ['achievements', 'Achievements'], ['stats', 'Stats'], ['notifications', 'Notifications']].map(([k, l]) => `<button class="btn sm" data-act="reset" data-k="${k}">${esc(l)}</button>`).join('')}</div>
            <div class="row" style="margin-top:12px"><button class="btn sm danger" data-act="factory">${icon('skull', 14)}Factory reset…</button><button class="btn sm" data-act="relaunch">${icon('refresh-cw', 14)}Restart MultiMenu</button><button class="btn sm" data-act="safe">${icon('life-buoy', 14)}Restart in safe mode</button></div></div>
          <div class="card"><h3>${icon('keyboard')}Hotkeys</h3><div id="hk-body"><p class="small muted">Loading…</p></div></div>
        </div>`;
      const upDraw = async () => {
        const s = await call('updates:status');
        if (!s || !root.isConnected) return;
        MM.$('#up-state', root).innerHTML = `${kv({ Installed: `v${MM.state.info.version}`, 'Acting as': s.pretend ? `v${s.pretend}` : null, Status: `${s.status}${s.message ? ` — ${s.message}` : ''}`, Channel: s.channel, Repository: s.repo || 'not set', 'Last check': s.checkedAt ? MM.fmt.ago(s.checkedAt) : 'never' })}`;
      };
      const folders = async () => {
        const list = await call('admin:folders');
        if (!list || !root.isConnected) return;
        MM.$('#st-folders', root).innerHTML = `<table class="tbl adm-tbl"><tbody>${list.map(x => `<tr><td>${esc(x.name)}</td><td class="mono">${bytes(x.bytes)}</td><td>${x.clearable ? `<button class="btn sm ghost" data-act="clearFolder" data-k="${x.id}">${icon('eraser', 14)}Clear</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
      };
      const i18n = async () => {
        const c = await call('admin:i18n');
        if (!c || !root.isConnected) return;
        MM.$('#tr-body', root).innerHTML = `<p class="small muted">${c.total} strings · showing ${esc(c.current)}${c.pseudo ? ' (pseudo-language on)' : ''}</p><table class="tbl adm-tbl"><thead><tr><th>Language</th><th>Strings</th><th>Missing</th><th>Same as English</th></tr></thead><tbody>${c.languages.map(l => `<tr><td>${esc(l.name)} <span class="dim mono">${esc(l.id)}</span></td><td>${l.count}</td><td>${l.missingCount ? `<button class="btn sm ghost" data-act="missing" data-k="${esc(l.id)}">${l.missingCount}</button>` : '<span class="badge ok">0</span>'}</td><td>${l.same}</td></tr>`).join('')}</tbody></table>`;
        root._i18n = c;
      };
      const hotkeys = async () => {
        const h = await call('admin:hotkeys');
        if (!root.isConnected) return;
        const entries = h && typeof h === 'object' ? Object.entries(h) : [];
        MM.$('#hk-body', root).innerHTML = entries.length ? `<div class="adm-kv">${entries.map(([k, v]) => `<span>${esc(k)}</span><b class="mono">${esc(typeof v === 'object' ? JSON.stringify(v) : String(v))}</b>`).join('')}</div>` : '<p class="small muted">No hotkey results yet.</p>';
      };
      upDraw(); folders(); i18n(); hotkeys();
      const offUp = MM.on('updater:update', () => upDraw());
      root.addEventListener('change', async (e) => {
        const k = e.target.dataset.flag;
        if (!k) return;
        await MM.adminSetFlags({ [k]: e.target.checked });
        if (k === 'pseudo') MM.toast('info', 'Reloading…');
      });
      MM.delegate(root, {
        demo: () => call('admin:demo', !MM.admin.demo),
        pretend: async () => { const v = MM.$('#up-pretend', root).value.trim(); if (v) { await call('admin:pretendVersion', v); upDraw(); } },
        unpretend: async () => { await call('admin:pretendVersion', null); upDraw(); },
        upcheck: async (b) => { await MM.busy(b, () => call('updates:check')); upDraw(); },
        upreset: async () => { await call('admin:resetUpdater'); upDraw(); },
        goUpdates: () => MM.go('updates'),
        releases: async (b) => {
          const list = await MM.busy(b, () => call('admin:releases'));
          if (!list) return;
          MM.$('#up-rel', root).innerHTML = `<table class="tbl adm-tbl" style="margin-top:10px"><thead><tr><th>Version</th><th>Published</th><th>Downloads</th><th></th></tr></thead><tbody>${list.map(r => `<tr><td><b>${esc(r.tag)}</b>${r.prerelease ? ' <span class="badge warn">beta</span>' : ''}${r.current ? ' <span class="badge ok">installed</span>' : ''}</td><td>${dateTime(Date.parse(r.publishedAt))}</td><td>${num(r.downloads)}</td><td>${r.installable ? `<button class="btn sm" data-act="offer" data-k="${esc(r.tag)}">Install this</button>` : '<span class="small dim">no installer</span>'}</td></tr>`).join('')}</tbody></table>`;
        },
        offer: async (b) => {
          if (!await MM.confirm(`Install ${b.dataset.k}?`, 'It goes through the normal download and checks. Older versions may not understand data saved by newer ones, so take a snapshot first.', { ok: 'Continue' })) return;
          const s = await call('admin:offerVersion', b.dataset.k);
          if (s) { MM.toast('info', s.message); MM.go('updates'); }
        },
        shot: async (b) => { const r = await MM.busy(b, () => call('admin:screenshot')); if (r) MM.toast('success', 'Screenshot saved', `${r.name} (${r.width}×${r.height})`); },
        size: async (b) => { const r = await call('admin:windowSize', +b.dataset.w, +b.dataset.h); if (r) MM.toast('success', `Window is ${r.width}×${r.height}`, '', 2000); },
        open: (b) => call('admin:open', b.dataset.w),
        cpu: async (b) => { MM.$('#prof-out', root).textContent = 'Recording for 10 seconds…'; const r = await MM.busy(b, () => call('admin:cpuProfile', 10)); MM.$('#prof-out', root).textContent = r ? `Saved ${r.name} (${bytes(r.bytes)}, ${r.samples} samples)` : ''; },
        heap: async (b) => { MM.$('#prof-out', root).textContent = 'Writing… (MultiMenu pauses for a moment)'; const r = await MM.busy(b, () => call('admin:heapSnapshot')); MM.$('#prof-out', root).textContent = r ? `Saved ${r.name} (${bytes(r.bytes)})` : ''; },
        gc: async () => { const r = await call('admin:gc'); if (r) MM.$('#prof-out', root).textContent = `Heap ${r.before.heapMB} → ${r.after.heapMB} MB · memory ${r.before.rssMB} → ${r.after.rssMB} MB`; },
        clearFolder: async (b) => { if (await MM.confirm('Clear this folder?', b.closest('tr').firstElementChild.textContent, { ok: 'Clear' })) { await call('admin:clearFolder', b.dataset.k); folders(); } },
        missing: (b) => {
          const l = root._i18n?.languages.find(x => x.id === b.dataset.k);
          if (!l) return;
          MM.modal({ title: `Missing in ${l.name}`, icon: 'languages', wide: true, body: `<div data-nt class="mono small adm-pre">${l.missing.map(esc).join('<br>')}${l.missingCount > l.missing.length ? `<br>… ${l.missingCount - l.missing.length} more` : ''}</div>`, buttons: [{ label: 'Copy', value: null, handler: () => { copy(l.missing.join('\n')); return false; } }, { label: 'Close', value: null, cls: 'primary' }] });
        },
        crash: async (b) => {
          const k = b.dataset.k;
          const what = { renderer: 'This window crashes and should reload by itself within a few seconds.', main: 'An error is thrown in the main process (it is logged and reported as an app error).', rejection: 'A promise fails with nobody catching it (it is logged).', hang: 'The main process freezes for 6 seconds: windows and hotkeys stop responding, then recover.', gpu: 'The graphics process crashes; Chromium restarts it.' }[k];
          if (await MM.confirm('Run this crash test?', what, { danger: true, ok: 'Do it' })) call('admin:crash', k);
        },
        reset: async (b) => { const r = await call('admin:reset', b.dataset.k); if (r) MM.toast('success', r); },
        factory: async () => {
          let typed = '';
          const ok = await MM.modal({
            title: 'Factory reset', icon: 'skull',
            body: `<div data-nt><p class="small">Every account, setting, preset, macro and statistic is removed and MultiMenu restarts like a new install. A snapshot of everything is taken first, so you can restore it from Admin → Data → Snapshots.</p><div class="field"><label>Type RESET to confirm</label><input class="input" id="fr-in" autocomplete="off"></div></div>`,
            buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Reset everything', value: true, cls: 'danger', handler: (m) => { typed = m.querySelector('#fr-in').value.trim(); if (typed !== 'RESET') { m.querySelector('#fr-in').focus(); return false; } return true; } }],
          });
          if (ok) call('admin:reset', 'factory', typed);
        },
        relaunch: () => call('admin:relaunch'),
        safe: () => call('app:restartSafe'),
      });
      return () => offUp();
    },
  };

  // =====================================================================
  // Console: run any command, send test events
  // =====================================================================
  const HISTORY_KEY = 'mm-admin-console';
  const loadHistory = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]').slice(0, 30); } catch { return []; } };
  const saveHistory = (h) => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 30))); } catch { /* storage off */ } };

  MM.pages.admconsole = {
    render(root) {
      fresh(root);
      let history = loadHistory();
      root.innerHTML = `${head('Console', 'Run any MultiMenu command the window can run, and send test events through the real alert paths.')}
        <div class="grid cols-2 adm-grid">
          <div class="card spanall"><h3>${icon('square-terminal')}Command</h3>
            <div class="row adm-bar"><input class="input mono" id="cs-ch" list="cs-list" placeholder="accounts:list" spellcheck="false" style="max-width:280px"><datalist id="cs-list"></datalist>
              <input class="input mono grow" id="cs-args" placeholder='Arguments as JSON, e.g. ["a1", { "x": 1 }]' spellcheck="false"><button class="btn primary" data-act="run">${icon('play')}Run</button></div>
            <p class="small muted">Commands do exactly what the buttons that use them do (including deleting things). Results are what the window would see.</p>
            <div class="row adm-bar"><span class="small muted" id="cs-meta"></span><span class="spacer"></span><button class="btn sm ghost hidden" id="cs-copy">${icon('copy', 14)}Copy result</button></div>
            <div class="adm-json tall" id="cs-out"><p class="small muted">The result appears here.</p></div>
            <div class="adm-hist" id="cs-hist"></div></div>
          <div class="card"><h3>${icon('send')}Test events</h3>
            <p class="small muted">Goes through notifications, Discord webhooks, phone/email alerts and voice exactly like the real thing, marked [TEST].</p>
            <div class="row"><select class="input adm-sel" id="ev-type"></select><button class="btn" data-act="event">${icon('send')}Send</button></div>
            <label class="check-lbl small" style="margin-top:8px"><input type="checkbox" id="ev-auto"> Let automations react too</label></div>
          <div class="card"><h3>${icon('bell')}Notifications</h3>
            <div class="row">${['info', 'success', 'warn', 'error'].map(l => `<button class="btn sm" data-act="notify" data-k="${l}">${esc(l)}</button>`).join('')}</div>
            <div class="row" style="margin-top:10px"><button class="btn sm" data-act="native">${icon('monitor-cog', 14)}Windows notification</button><button class="btn sm" data-act="speech">${icon('megaphone', 14)}Speak</button></div>
            <div class="row" style="margin-top:10px">${['info', 'success', 'warn', 'error'].map(l => `<button class="btn sm ghost" data-act="toast" data-k="${l}">Toast: ${esc(l)}</button>`).join('')}</div></div>
        </div>`;
      const out = MM.$('#cs-out', root);
      let lastResult;
      const drawHist = () => {
        MM.$('#cs-hist', root).innerHTML = history.length ? `<div class="small muted" style="margin:12px 0 6px">Recent</div>${history.map((h, i) => `<button class="chip" data-hist="${i}" title="${esc(h.args)}"><span class="mono">${esc(h.ch)}</span>${h.args && h.args !== '[]' ? ` <span class="dim mono">${esc(h.args.slice(0, 40))}</span>` : ''}</button>`).join('')}` : '';
      };
      const run = async () => {
        const ch = MM.$('#cs-ch', root).value.trim();
        const raw = MM.$('#cs-args', root).value.trim() || '[]';
        if (!/^[a-z]+:[a-zA-Z]+$/.test(ch)) { MM.toast('warn', 'Type a command like accounts:list'); return; }
        let args;
        try { args = JSON.parse(raw); if (!Array.isArray(args)) args = [args]; } catch (e) { MM.toast('error', 'Arguments are not valid JSON', e.message); return; }
        history = [{ ch, args: raw }, ...history.filter(h => !(h.ch === ch && h.args === raw))].slice(0, 30);
        saveHistory(history); drawHist();
        const t0 = performance.now();
        try {
          const r = await A(ch, ...args);
          lastResult = r;
          MM.$('#cs-meta', root).innerHTML = `<span class="badge ok">ok</span> ${num(performance.now() - t0, 1)} ms · ${esc(typeof r)}${Array.isArray(r) ? ` (${r.length} items)` : ''}`;
          out.innerHTML = r === undefined ? '<p class="small muted">No result (undefined).</p>' : jsonHtml(r);
        } catch (e) {
          lastResult = { error: e.message, code: e.code };
          MM.$('#cs-meta', root).innerHTML = `<span class="badge err">error</span> ${num(performance.now() - t0, 1)} ms`;
          out.innerHTML = `<div class="callout err">${icon('circle-x')}<div class="mono">${esc(e.message)}${e.code ? ` (${esc(e.code)})` : ''}</div></div>`;
        }
        MM.$('#cs-copy', root).classList.remove('hidden');
      };
      MM.$('#cs-args', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
      MM.$('#cs-ch', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
      MM.$('#cs-copy', root).addEventListener('click', () => copy(JSON.stringify(lastResult, null, 2)));
      MM.$('#cs-hist', root).addEventListener('click', (e) => { const b = e.target.closest('[data-hist]'); if (!b) return; const h = history[+b.dataset.hist]; MM.$('#cs-ch', root).value = h.ch; MM.$('#cs-args', root).value = h.args === '[]' ? '' : h.args; });
      drawHist();
      call('admin:channels').then((list) => { if (list && root.isConnected) MM.$('#cs-list', root).innerHTML = list.map(c => `<option value="${esc(c)}">`).join(''); });
      call('discord:events').then((ev) => {
        if (!ev || !root.isConnected) return;
        MM.$('#ev-type', root).innerHTML = Object.entries(ev).map(([k, t]) => `<option value="${esc(k)}">${esc(t)}</option>`).join('');
      });
      MM.delegate(root, {
        run: () => run(),
        event: async () => { const type = MM.$('#ev-type', root).value; if (await call('admin:simulate', { kind: 'event', type, automations: MM.$('#ev-auto', root).checked })) MM.toast('success', 'Test event sent', type, 2500); },
        notify: (b) => call('admin:simulate', { kind: 'notify', level: b.dataset.k }),
        native: () => call('admin:simulate', { kind: 'native' }),
        speech: () => call('admin:simulate', { kind: 'speech' }),
        toast: (b) => MM.toast(b.dataset.k, `[TEST] ${b.dataset.k}`, 'A toast drawn by the window only.'),
      });
    },
  };
})();
