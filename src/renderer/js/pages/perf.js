(function () {
  const MM = window.MM;
  const LABELS = {
    'perf.fpsCap': 'FPS cap', 'perf.lowGraphics': 'Lowest graphics', 'perf.lighter': 'Lighter rendering', 'perf.flags.msaa': 'Anti-aliasing (MSAA)', 'perf.flags.texture': 'Texture quality',
    'perf.flags.mode': 'Rendering mode', 'perf.flags.graySky': 'Grey sky', 'perf.flags.noGrass': 'No grass', 'perf.flags.lowestQuality': 'Lowest render quality', 'perf.flags.pauseLighting': 'Pause lighting updates', 'perf.reducedMotion': 'Reduce motion',
    'perf.minimize': 'Minimise once in game', 'perf.tiny': 'Start alts tiny', 'perf.tinyW': 'Tiny width', 'perf.tinyH': 'Tiny height', 'perf.mute': 'Mute once in game',
    'limiter.eco': 'Eco mode for background alts', 'ramTrimmer.enabled': 'RAM Trimmer', 'ramTrimmer.intervalSec': 'RAM Trimmer interval',
  };
  const OPT = {
    msaa: { default: 'Roblox default', x1: '×1 (off)', x2: '×2', x4: '×4' },
    texture: { default: 'Roblox default', lowest: 'Lowest', low: 'Low', medium: 'Medium', high: 'High' },
    mode: { default: 'Roblox default', d3d11: 'Direct3D 11', vulkan: 'Vulkan', opengl: 'OpenGL' },
  };
  const TIER = { light: ['ok', 'Plenty of room'], tight: ['warn', 'Tight'], over: ['err', 'Too much for this PC'] };
  const fmt = (key, v) => {
    if (typeof v === 'boolean') return MM.t(v ? 'On' : 'Off');
    if (key === 'perf.fpsCap') return v > 0 ? `${v} FPS` : MM.t('Roblox\'s own');
    if (key === 'ramTrimmer.intervalSec') return `${Math.round(v / 60)} min`;
    if (key === 'perf.tinyW' || key === 'perf.tinyH') return `${v} px`;
    const k = key.split('.').pop();
    return MM.t(OPT[k]?.[v] || String(v ?? '—'));
  };

  MM.pages.perf = {
    render(root) {
      let info = null, result = null, measuring = false;
      root.innerHTML = `
        <div class="page-head"><div><h1>Alt performance <span class="badge" id="pf-badge"></span></h1><p>Choose how hard your alts work your PC. You see every change before it's applied.</p></div></div>
        <div class="pf-presets" id="pf-presets" role="radiogroup" aria-label="Presets"></div>
        <div class="card pf-pc" id="pf-pc"></div>
        <h3 class="pf-h">${MM.icon('sliders-horizontal')}Fine-tune</h3>
        <div class="card pf-tune">
          <div class="pf-row"><div class="txt"><b>FPS cap</b><span>The most frames each alt draws per second. Lower uses less of your PC.</span><button class="pf-more" data-more="fps">${MM.icon('chevrons-right', 12)}More</button><p class="pf-why hidden" data-why="fps">Roblox takes any cap from 5 to 360, not only the ones in its menu. Alts you aren't watching rarely need more than 10–30.</p></div>
            <div class="ctl pf-fps"><input type="range" min="5" max="240" id="pf-fps-r" aria-label="FPS cap"><input class="input sm" type="number" min="5" max="360" id="pf-fps-n" aria-label="FPS cap"><span class="small muted">FPS</span><label class="toggle"><input type="checkbox" id="pf-fps-on"><span class="sw"></span></label></div></div>
          <div class="pf-row"><div class="txt"><b>Lowest graphics</b><span>Saves a lot of GPU and CPU with many alts. Your own Roblox graphics are put back afterwards.</span></div><div class="ctl">${MM.toggle('perf.lowGraphics')}</div></div>
          <div class="pf-row"><div class="txt"><b>Lighter rendering</b><span>Uses the rendering flags below. Much less GPU memory per alt.</span><button class="pf-more" data-more="lighter">${MM.icon('chevrons-right', 12)}More</button><p class="pf-why hidden" data-why="lighter">Only flags on Roblox's allowlist are used. They are written just before each alt starts, and your own ClientAppSettings.json is put back as soon as it has started.</p></div><div class="ctl">${MM.toggle('perf.lighter')}</div></div>
          <div class="pf-sub" id="pf-flags">
            <div class="pf-row"><div class="txt"><b>Anti-aliasing (MSAA)</b><span>Lower is faster, but edges look jagged.</span></div><div class="ctl"><select class="input sm" data-setting="perf.flags.msaa">${Object.entries(OPT.msaa).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div></div>
            <div class="pf-row"><div class="txt"><b>Texture quality</b><span>Lowest uses the least GPU memory.</span></div><div class="ctl"><select class="input sm" data-setting="perf.flags.texture">${Object.entries(OPT.texture).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div></div>
            <div class="pf-row"><div class="txt"><b>Rendering mode</b><span>Only change it if you get glitches or crashes. Roblox may ignore Vulkan and OpenGL.</span></div><div class="ctl"><select class="input sm" data-setting="perf.flags.mode">${Object.entries(OPT.mode).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div></div>
            <div class="pf-label small muted">Strip visuals</div>
            ${MM.settingRow('Grey sky', 'Replaces the sky with flat grey.', MM.toggle('perf.flags.graySky'))}
            ${MM.settingRow('No grass', 'Removes rendered grass.', MM.toggle('perf.flags.noGrass'))}
            ${MM.settingRow('Lowest render quality', 'Forces Roblox\'s lowest internal quality level.', MM.toggle('perf.flags.lowestQuality'))}
            ${MM.settingRow('Pause lighting updates', 'Stops Roblox updating its lighting, so lighting can look wrong.', MM.toggle('perf.flags.pauseLighting'))}
            ${MM.settingRow('Reduce motion', 'Turns on Roblox\'s own Reduce motion setting for alts: fewer camera and interface animations.', MM.toggle('perf.reducedMotion'))}
            <div class="callout warn hidden" id="pf-boot">${MM.icon('info')}<div>You launch through Bloxstrap or Fishstrap, which use their own Fast Flags. Set these in their Fast Flag editor instead.</div></div>
          </div>
          <div class="pf-row"><div class="txt"><b>Minimise once in game</b><span>Each alt minimises when it reaches a game, without taking your focus. The Alt Wall keeps its last picture.</span></div><div class="ctl">${MM.toggle('perf.minimize')}</div></div>
          <div class="pf-row"><div class="txt"><b>Start alts tiny</b><span>Each alt shrinks to a tiny window when it reaches a game, as small as you like (this is the size of the game picture). Smaller windows draw less.</span>
              <div class="row" style="margin-top:8px;gap:8px"><input class="input sm" type="number" min="16" max="7680" data-setting="perf.tinyW" style="width:90px" aria-label="Width"><span class="muted">×</span><input class="input sm" type="number" min="16" max="4320" data-setting="perf.tinyH" style="width:90px" aria-label="Height"><span class="small muted">px</span></div></div>
            <div class="ctl">${MM.toggle('perf.tiny')}</div></div>
          <div class="pf-row"><div class="txt"><b>Mute once in game</b><span>Each alt is muted when it reaches a game. Unmute one in the Windows volume mixer.</span></div><div class="ctl">${MM.toggle('perf.mute')}</div></div>
          <div class="pf-row"><div class="txt"><b>Eco mode for background alts</b><span>Windows 11 efficiency mode and below-normal priority for alts you aren't using.</span></div><div class="ctl"><label class="toggle"><input type="checkbox" id="pf-eco"><span class="sw"></span></label></div></div>
          <div class="pf-row"><div class="txt"><b>RAM Trimmer</b><span>Frees memory alts aren't using, on a timer.</span>
              <div class="row" style="margin-top:8px;gap:8px"><span class="small muted">Every</span><input class="input sm" type="number" min="1" max="120" id="pf-trim-min" style="width:80px" aria-label="Minutes"><span class="small muted">min</span></div></div>
            <div class="ctl"><label class="toggle"><input type="checkbox" id="pf-trim"><span class="sw"></span></label></div></div>
          <p class="hint" style="margin:12px 0 0">${MM.icon('crown', 12)} Main accounts always launch at full quality. Changes apply from the next launch.</p>
        </div>`;
      MM.bindSettings(root);

      const all = () => MM.state.settings;
      const cur = () => (info ? info.order.find(id => Object.entries(info.presets[id].values).every(([k, v]) => MM.getSetting(k) === v)) || null : null);
      const renderPresets = () => {
        if (!info) return;
        const c = cur();
        MM.$('#pf-badge', root).innerHTML = c ? `${MM.icon('circle-check', 12)}${MM.esc(MM.t(info.presets[c].label))}` : `${MM.icon('circle-dot', 12)}${MM.esc(MM.t('Your own mix'))}`;
        MM.$('#pf-presets', root).innerHTML = info.order.map(id => {
          const p = info.presets[id];
          return `<button class="card pf-preset ${c === id ? 'on' : ''}" role="radio" aria-checked="${c === id}" data-preset="${id}">
            <div class="row nowrap"><b>${MM.esc(p.label)}</b><span class="spacer"></span><span class="pf-radio"></span></div>
            <div class="small muted">${MM.esc(p.desc)}</div>
            <ul>${p.facts.slice(0, 3).map(f => `<li>${MM.esc(f)}</li>`).join('')}</ul>${p.facts.length > 3 ? `<span class="small dim" title="${MM.esc(p.facts.slice(3).map(f => MM.t(f)).join('\n'))}">+${p.facts.length - 3}</span>` : ''}</button>`;
        }).join('');
      };
      const renderTune = () => {
        const s = all();
        const cap = s.perf.fpsCap;
        const on = cap > 0;
        MM.$('#pf-fps-on', root).checked = on;
        MM.$('#pf-fps-r', root).value = on ? Math.min(240, cap) : 30;
        MM.$('#pf-fps-n', root).value = on ? cap : 30;
        MM.$('#pf-fps-r', root).disabled = !on; MM.$('#pf-fps-n', root).disabled = !on;
        MM.$('#pf-flags', root).classList.toggle('hidden', !s.perf.lighter);
        MM.$('#pf-boot', root).classList.toggle('hidden', !info?.bootstrapper);
        MM.$('#pf-eco', root).checked = !!s.limiter.eco;
        MM.$('#pf-trim', root).checked = !!s.ramTrimmer.enabled;
        MM.$('#pf-trim-min', root).value = Math.max(1, Math.round((s.ramTrimmer.intervalSec || 60) / 60));
        renderPresets();
      };
      const renderPc = () => {
        const el = MM.$('#pf-pc', root);
        const planned = MM.getSetting('perf.planned') || 4;
        const head = `<div class="row" style="gap:12px"><div class="grow"><b style="font:600 15px var(--display)">For this PC</b><div class="small muted">${MM.esc(MM.t(measuring ? 'Measuring your running alts for about 25 seconds…' : result ? 'Measured with the settings your running alts use now.' : 'Start an alt and let it reach a game, then measure what it costs.'))}</div></div>
          <span class="small muted">Plan for</span><input class="input sm" type="number" min="1" max="60" id="pf-plan" value="${planned}" style="width:70px" aria-label="Alts to plan for"><span class="small muted">alts</span>
          <button class="btn sm ${measuring ? '' : 'primary'}" data-act="measure" ${measuring ? 'disabled' : ''}>${MM.icon(measuring ? 'clock' : 'gauge', 14)}${MM.esc(MM.t(measuring ? 'Measuring…' : 'Measure'))}</button></div>`;
        let body = '';
        if (measuring) body = '<div class="progress pf-prog" style="margin-top:12px"><i></i></div>';
        else if (result) {
          const [cls, label] = TIER[result.tier];
          body = `<div class="pf-result"><span class="badge ${cls}">${MM.esc(MM.t(label))}</span>
            <div class="small">${MM.esc(MM.t('One alt uses about {0} MB and {1}% CPU.').replace('{0}', result.memPerMB).replace('{1}', result.cpuPer))} ${MM.esc(MM.t('{0} alts would use about {1}% of your memory and {2}% of your CPU.').replace('{0}', result.planned).replace('{1}', result.ramPct).replace('{2}', result.cpuPct))} <b>${MM.esc(MM.t('This PC can run about {0} like this.').replace('{0}', result.fits))}</b></div>
            <ul class="small muted">${result.reasons.map(r => `<li>${MM.esc(r)}</li>`).join('')}</ul>
            <div class="row">${result.preset ? `<button class="btn sm primary" data-act="usePreset" data-preset="${result.preset}">${MM.icon('sparkles', 14)}${MM.esc(MM.t('Switch to {0}').replace('{0}', MM.t(info.presets[result.preset].label)))}</button>` : ''}${Object.keys(result.values).length ? `<button class="btn sm" data-act="useSuggest">${MM.icon('wand-sparkles', 14)}Apply suggestions</button>` : ''}</div></div>`;
        }
        el.innerHTML = head + body;
        MM.$('#pf-plan', el).onchange = (e) => MM.setSetting('perf.planned', Math.max(1, Math.min(60, Number(e.target.value) || 1)));
      };

      // Review: every change, before anything is applied.
      const review = async (title, values) => {
        const changes = Object.entries(values).filter(([k, v]) => MM.getSetting(k) !== v);
        if (!changes.length) { MM.toast('info', 'Already set', 'Nothing would change.'); return false; }
        const ok = await MM.modal({
          title, icon: 'sliders-horizontal', desc: 'These settings change. Main accounts keep full quality. It applies from the next launch.',
          body: `<div class="list pf-review">${changes.map(([k, v]) => `<div class="item"><div class="grow"><div class="title">${MM.esc(MM.t(LABELS[k] || k))}</div></div><span class="small dim">${MM.esc(fmt(k, MM.getSetting(k)))}</span>${MM.icon('chevrons-right', 13)}<b class="small">${MM.esc(fmt(k, v))}</b></div>`).join('')}</div>`,
          buttons: [{ label: 'Cancel', value: false, cls: 'ghost' }, { label: 'Apply', value: true, cls: 'primary', icon: 'check' }],
        });
        if (!ok) return false;
        const r = await MM.call('perf:apply', Object.fromEntries(changes));
        if (r) { MM.state.settings = r.settings; MM.bindSettings(root); renderTune(); MM.toast('success', 'Performance settings applied', MM.t('{0} changes').replace('{0}', r.changed)); }
        return !!r;
      };

      const setCap = async (v) => { await MM.setSetting('perf.fpsCap', v); renderTune(); };
      MM.$('#pf-fps-r', root).addEventListener('input', (e) => { MM.$('#pf-fps-n', root).value = e.target.value; });
      MM.$('#pf-fps-r', root).addEventListener('change', (e) => setCap(Number(e.target.value)));
      MM.$('#pf-fps-n', root).addEventListener('change', (e) => setCap(Math.max(5, Math.min(360, Number(e.target.value) || 30))));
      MM.$('#pf-fps-on', root).addEventListener('change', (e) => setCap(e.target.checked ? Math.max(5, Number(MM.$('#pf-fps-n', root).value) || 30) : 0));
      MM.$('#pf-eco', root).addEventListener('change', async (e) => { const r = await MM.call('limiter:eco', e.target.checked); if (!r) e.target.checked = !e.target.checked; else { MM.state.settings.limiter.eco = r.eco; renderPresets(); } });
      MM.$('#pf-trim', root).addEventListener('change', async (e) => { const r = await MM.call(e.target.checked ? 'trimmer:start' : 'trimmer:stop'); if (!r) e.target.checked = !e.target.checked; else { MM.state.settings.ramTrimmer.enabled = e.target.checked; renderPresets(); } });
      MM.$('#pf-trim-min', root).addEventListener('change', async (e) => { await MM.setSetting('ramTrimmer.intervalSec', Math.max(1, Math.min(120, Number(e.target.value) || 5)) * 60); renderPresets(); });
      MM.delegate(root, {
        measure: async () => {
          measuring = true; result = null; renderPc();
          const r = await MM.call('perf:measure', MM.getSetting('perf.planned') || 4);
          measuring = false; result = r || null; renderPc();
        },
        usePreset: (b) => review(MM.t(info.presets[b.dataset.preset].label), info.presets[b.dataset.preset].values),
        useSuggest: () => review(MM.t('Suggested changes'), result.values),
      });
      root.addEventListener('click', (e) => {
        const p = e.target.closest('[data-preset]');
        if (p && !p.dataset.act) { review(MM.t(info.presets[p.dataset.preset].label), info.presets[p.dataset.preset].values); return; }
        const m = e.target.closest('[data-more]');
        if (m) { const w = root.querySelector(`[data-why="${m.dataset.more}"]`); w.classList.toggle('hidden'); m.classList.toggle('open', !w.classList.contains('hidden')); }
      });
      const onSet = (e) => { if (/^(perf|limiter|ramTrimmer)\./.test(e.detail.key)) renderTune(); };
      document.addEventListener('mm:setting', onSet);
      MM.call('perf:info').then(i => { info = i; renderTune(); renderPc(); });
      const offs = [MM.on('perf:changed', (i) => { info = i; renderTune(); }), MM.on('trimmer:update', (s) => { MM.state.settings.ramTrimmer.enabled = !!s.running; renderTune(); })];
      return () => { document.removeEventListener('mm:setting', onSet); offs.forEach(f => f()); };
    },
  };
})();
