(function () {
  const MM = window.MM;

  MM.pages.gallery = {
    render(root) {
      let data = { builtIn: [], online: [], fetchedAt: null, error: null }, trying = null, before = null;
      root.innerHTML = `
        <div class="page-head"><div><h1>Theme gallery</h1><p>Pick a look for MultiMenu. Try one on, then keep it or go back.</p></div>
          <div class="actions"><button class="btn" data-act="importCode">${MM.icon('clipboard-paste')}Paste a code</button><button class="btn" data-act="shareMine">${MM.icon('share-2')}Share my theme</button></div></div>
        <div id="gal-try"></div>
        <div class="card" style="margin-bottom:16px"><h3>${MM.icon('sparkles')}Built in</h3><div class="gal-grid" id="gal-built"></div></div>
        <div class="card"><h3>${MM.icon('palette')}More themes<span class="right"><button class="btn sm ghost" data-act="refresh">${MM.icon('refresh-cw', 14)}Refresh</button></span></h3>
          <p class="sub" id="gal-src"></p><div class="gal-grid" id="gal-online"></div></div>`;

      const num = (v, d) => (Number.isFinite(+v) ? +v : d);
      const card = (e, i, list) => {
        const t = e.theme, a = num(t.accentHue, 270), s = num(t.theme?.secondaryHue, a), glow = num(t.theme?.glow, 100);
        const on = trying?.id === e.id || (!trying && e.preset && MM.state.settings.appearance.theme.preset === e.preset);
        return `<div class="gal-card ${on ? 'on' : ''}" data-list="${list}" data-i="${i}">
          <div class="gal-prev" style="background:${MM.themeBg(t)}">
            <div class="gal-mock"><span class="gal-side"></span><span class="gal-main"><span class="gal-line"></span><span class="gal-line short"></span>
              <span class="gal-btn" style="background:linear-gradient(135deg,hsl(${a},90%,60%),hsl(${s},90%,58%));box-shadow:0 0 ${Math.round(glow / 9)}px hsla(${a},90%,60%,.8)"></span></span></div>
          </div>
          <div class="gal-meta"><div class="grow" style="min-width:0"><b data-nt>${MM.esc(e.name)}</b>${e.author ? `<div class="small muted" data-nt>${MM.esc(e.author)}</div>` : ''}</div>
            <button class="btn sm icon ghost" data-act="copy" title="Copy code">${MM.icon('copy', 14)}</button>
            <button class="btn sm ${on ? '' : 'primary'}" data-act="try" ${on ? 'disabled' : ''}>${on ? MM.icon('check', 14) : MM.icon('play', 14)}${on ? 'In use' : 'Try'}</button></div></div>`;
      };
      const render = () => {
        MM.$('#gal-built', root).innerHTML = data.builtIn.map((e, i) => card(e, i, 'builtIn')).join('');
        MM.$('#gal-online', root).innerHTML = data.online.length ? data.online.map((e, i) => card(e, i, 'online')).join('')
          : `<div class="small muted" style="grid-column:1/-1;padding:8px 2px">${MM.esc(MM.t(data.error ? 'No extra themes right now.' : 'Loading…'))}</div>`;
        MM.$('#gal-src', root).textContent = data.online.length
          ? MM.t('From MultiMenu\'s GitHub page. Checked {0}.').replace('{0}', MM.fmt.ago(data.fetchedAt))
          : data.error ? `${MM.t('Couldn\'t load more themes:')} ${data.error}` : '';
        MM.$('#gal-try', root).innerHTML = trying ? `<div class="callout gal-bar">${MM.icon('palette')}<div class="grow">${MM.esc(MM.t('Trying “{0}”. Keep it?').replace('{0}', trying.name))}</div>
          <button class="btn sm ghost" data-act="back">${MM.icon('undo-2', 14)}Go back</button><button class="btn sm primary" data-act="keep">${MM.icon('check', 14)}Keep it</button></div>` : '';
      };
      const load = async (refresh) => { const r = await MM.call('gallery:list', !!refresh); if (r) { data = r; render(); } };
      const entry = (b) => { const c = b.closest('.gal-card'); return data[c.dataset.list][+c.dataset.i]; };
      const snapshot = () => { const a = MM.state.settings.appearance; return { accentHue: a.accentHue, particles: a.particles, theme: { ...a.theme } }; };

      MM.delegate(root, {
        try: async (b) => {
          const e = entry(b);
          if (!trying) before = snapshot();
          const ok = e.preset ? await MM.call('theme:apply', e.preset) : await MM.call('share:import', e.code);
          if (!ok) return;
          await MM.reloadSettings();
          trying = { id: e.id, name: e.name };
          render();
        },
        keep: () => { trying = null; before = null; render(); MM.toast('success', 'Theme kept'); },
        back: async () => { if (before) { await MM.call('gallery:restore', before); await MM.reloadSettings(); } trying = null; before = null; render(); },
        copy: async (b) => { try { await navigator.clipboard.writeText(entry(b).code); MM.toast('success', 'Code copied', entry(b).name); } catch { MM.toast('error', 'Couldn\'t copy'); } },
        refresh: (b) => MM.busy(b, () => load(true)),
        shareMine: () => MM.shareCode('theme', 'current'),
        importCode: () => MM.importCode(),
      });
      load(false);
    },
  };
})();
