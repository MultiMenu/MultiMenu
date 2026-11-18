(function () {
  const MM = window.MM;

  MM.pages.theme = {
    render(root) {
      let presets = {};
      root.innerHTML = `
        <div class="page-head"><div><h1>Theme studio</h1><p>Make MultiMenu yours: colours, glow, glass and your own background. Changes apply instantly.</p></div>
          <div class="actions"><button class="btn" data-act="importCode">${MM.icon('clipboard-paste')}Paste a code</button><button class="btn" data-act="shareTheme">${MM.icon('share-2')}Share as code</button><button class="btn ghost" data-act="import">${MM.icon('file-up')}Import file</button><button class="btn ghost" data-act="export">${MM.icon('file-down')}Export file</button></div></div>
        <div class="card" style="margin-bottom:16px"><h3>${MM.icon('sparkles')}Presets</h3><div class="grid g4" id="th-presets" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))"></div></div>
        <div class="grid g2">
          <div class="card"><h3>${MM.icon('palette')}Colours & effects</h3>
            <div class="field"><label>Main accent</label><input type="range" class="hue-range" min="0" max="360" data-setting="appearance.accentHue"></div>
            <div class="field" style="margin-top:12px"><label>Second accent (gradients and highlights)</label><input type="range" class="hue-range" min="0" max="360" data-setting="appearance.theme.secondaryHue"></div>
            <div class="setting-row" style="margin-top:8px"><div class="txt"><b>Glow</b><span>How much the neon glow shines. 0 turns it off.</span></div><div class="ctl"><input type="range" min="0" max="200" data-setting="appearance.theme.glow"></div></div>
            <div class="setting-row"><div class="txt"><b>Glass blur</b><span>Frosted-glass strength on cards. Lower is lighter on the GPU.</span></div><div class="ctl"><input type="range" min="0" max="40" data-setting="appearance.theme.blur"></div></div>
            ${MM.settingRow('Floating particles', 'Soft glowing particles behind the interface.', MM.toggle('appearance.particles'))}
            ${MM.settingRow('Animations', 'Page transitions, hover effects and the moving background.', MM.toggle('appearance.animations'))}
          </div>
          <div class="card"><h3>${MM.icon('image')}Background</h3>
            <div class="seg" id="th-bg"><button data-bg="gradient">Gradient</button><button data-bg="solid">Plain</button><button data-bg="image">Image</button><button data-bg="video">Video</button></div>
            <div id="th-bg-body" style="margin-top:12px"></div>
            <div class="setting-row" style="margin-top:8px"><div class="txt"><b>Darken background</b><span>Keeps text readable over busy images and videos.</span></div><div class="ctl"><input type="range" min="0" max="90" data-setting="appearance.theme.bgDim"></div></div>
            <div class="theme-preview" style="margin-top:12px"><div class="row"><button class="btn primary sm">${MM.icon('play', 14)}Primary</button><button class="btn sm">Button</button><span class="badge ok">OK</span><span class="badge warn">Warning</span></div>
              <div class="card" style="margin-top:12px;padding:12px"><b>Card preview</b><div class="small muted">This is how panels look with your settings.</div></div></div>
          </div>
        </div>`;

      const t = () => MM.state.settings.appearance.theme;
      const renderPresets = () => {
        MM.$('#th-presets', root).innerHTML = Object.entries(presets).map(([id, p]) => `<button class="theme-swatch ${t().preset === id ? 'on' : ''}" data-act="preset" data-id="${id}">
          <div class="sw-prev" style="background:${p.bgType === 'solid' ? `hsl(${p.accentHue},30%,6%)` : `radial-gradient(70% 90% at 20% 20%, hsla(${p.accentHue},90%,50%,.7), transparent 70%), radial-gradient(60% 80% at 90% 30%, hsla(${p.secondaryHue},90%,50%,.55), transparent 70%), #07040d`}"></div><b>${MM.esc(p.label)}</b></button>`).join('')
          + `<button class="theme-swatch ${t().preset === 'custom' ? 'on' : ''}" disabled style="cursor:default"><div class="sw-prev" style="display:grid;place-items:center;color:var(--muted)">${MM.icon('paintbrush', 26)}</div><b>Custom</b></button>`;
      };
      const renderBg = () => {
        const th = t();
        MM.$$('#th-bg button', root).forEach(b => b.classList.toggle('on', b.dataset.bg === th.bgType));
        const media = ['image', 'video'].includes(th.bgType);
        MM.$('#th-bg-body', root).innerHTML = media || th.pendingMedia
          ? `<div class="row"><button class="btn sm primary" data-act="pick">${MM.icon('folder-open', 14)}Choose ${th.pendingMedia || th.bgType}…</button>${(th.pendingMedia || th.bgType) === 'video' ? `<button class="btn sm" data-act="wePick">${MM.icon('image', 14)}From Wallpaper Engine</button>` : ''}${th.bgFile ? `<button class="btn sm ghost" data-act="clearBg">${MM.icon('x', 14)}Remove</button><span class="small muted">Using ${MM.esc(th.bgFile)}</span>` : ''}</div>
            <p class="hint">Images: PNG, JPG, WebP or GIF up to 12 MB. Videos: MP4 or WebM up to 30 MB, played muted on a loop. Videos use some GPU — Low-resource mode turns them off.</p>`
          : `<p class="hint">${th.bgType === 'solid' ? 'A calm, plain background tinted with your accent.' : 'The animated purple gradient that MultiMenu ships with, in your colours.'}</p>`;
      };
      const refresh = async () => { await MM.reloadSettings(); MM.go('theme'); };

      MM.bindSettings(root);
      MM.$('#th-bg', root).addEventListener('click', async (e) => {
        const b = e.target.closest('[data-bg]');
        if (!b) return;
        const kind = b.dataset.bg;
        if (['image', 'video'].includes(kind)) {
          if (t().bgFile && (kind === 'video') === /\.(mp4|webm)$/i.test(t().bgFile)) { await MM.setSetting('appearance.theme.bgType', kind); renderBg(); return; }
          const r = await MM.call('theme:pickBackground');
          if (r) { await refresh(); MM.toast('success', 'Background set'); }
          return;
        }
        await MM.setSetting('appearance.theme.bgType', kind);
        renderBg(); renderPresets();
      });
      document.addEventListener('mm:setting', function onSet(e) {
        if (!root.isConnected) { document.removeEventListener('mm:setting', onSet); return; }
        if (e.detail.key.startsWith('appearance.')) { MM.state.settings.appearance.theme.preset = e.detail.key === 'appearance.theme.preset' ? e.detail.value : (e.detail.key.startsWith('appearance.theme.') || e.detail.key === 'appearance.accentHue' ? 'custom' : t().preset); renderPresets(); }
      });
      MM.delegate(root, {
        preset: async (b) => { const r = await MM.call('theme:apply', b.dataset.id); if (r) refresh(); },
        pick: async () => { const r = await MM.call('theme:pickBackground'); if (r) { await refresh(); MM.toast('success', 'Background set'); } },
        wePick: async (b) => {
          const list = await MM.busy(b, () => MM.call('theme:weList'));
          if (!list) return;
          const body = list.length
            ? `<p class="small muted" style="margin-top:0">${MM.esc(MM.t('Video wallpapers you have in Wallpaper Engine. Scene and web wallpapers only play inside Wallpaper Engine, so they aren\'t listed.'))}</p>
              <div class="grid g3" style="gap:10px;max-height:60vh;overflow:auto">${list.map(w => `<button class="card hover" style="padding:8px;text-align:left" data-we="${MM.esc(w.id)}" ${w.fits ? '' : 'disabled'}>
                <div style="aspect-ratio:16/9;border-radius:8px;overflow:hidden;background:hsla(270,50%,8%,.6);margin-bottom:6px">${w.preview ? `<img src="${MM.esc(w.preview)}" alt="" style="width:100%;height:100%;object-fit:cover">` : ''}</div>
                <div class="small" data-nt style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${MM.esc(w.title)}</div>
                <div class="small muted">${w.fits ? `${w.sizeMB} MB` : MM.esc(MM.t('{0} MB: over 30 MB').replace('{0}', w.sizeMB))}</div></button>`).join('')}</div>`
            : `<p>${MM.esc(MM.t('No video wallpapers found. MultiMenu looks in your Steam library for Wallpaper Engine\'s Workshop items and your own projects.'))}</p>`;
          MM.modal({
            title: 'From Wallpaper Engine', wide: true, body, buttons: [{ label: 'Close', value: false, cls: 'ghost' }],
            onMount: (m, close) => m.addEventListener('click', async (e) => {
              const c = e.target.closest('[data-we]');
              if (!c || c.disabled) return;
              const r = await MM.busy(c, () => MM.call('theme:weUse', c.dataset.we));
              if (r) { close(true); await refresh(); MM.toast('success', 'Background set'); }
            }),
          });
        },
        clearBg: async () => { await MM.call('theme:clearBackground'); refresh(); },
        shareTheme: () => MM.shareCode('theme', 'current'),
        importCode: () => MM.importCode(),
        export: async () => { const p = await MM.call('theme:export'); if (p) { MM.toast('success', 'Theme exported', 'Share the .mmtheme file — others can import it here.'); } },
        import: async () => { const r = await MM.call('theme:import'); if (r) { await refresh(); MM.toast('success', 'Theme imported'); } },
      });
      MM.call('theme:presets').then(p => { presets = p || {}; renderPresets(); });
      renderBg();
    },
  };
})();
