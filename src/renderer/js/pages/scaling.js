(function () {
  const MM = window.MM;

  MM.pages.scaling = {
    render(root) {
      let accounts = [], tags = [], rot = null, sc = null, lim = null;
      root.innerHTML = `
        <div class="page-head"><div><h1>Rotation & Scaling</h1><p>Let MultiMenu decide how many alts run, and which ones.</p></div></div>
        <div class="grid g2">
          <div class="card" id="rot-card"><h3>${MM.icon('repeat')}Rotation<span class="right"><label class="toggle"><input type="checkbox" id="rot-on"><span class="sw"></span></label><b style="margin-left:6px">On</b></span></h3>
            <p class="sub">Run a few alts at a time from a bigger group, and swap them for the next ones on a timer.</p>
            <div id="rot-pool"></div>
            <div class="form-grid" style="margin-top:10px">
              <div class="field"><label>Alts at a time</label><input class="input" type="number" min="1" max="50" data-setting="rotation.size"></div>
              <div class="field"><label>Swap every (minutes)</label><input class="input" type="number" min="5" max="1440" data-setting="rotation.everyMin"></div>
              <div class="field" style="grid-column:1/-1"><label>Game</label><input class="input" data-setting="rotation.game" placeholder="Blank = each account's default game"></div>
            </div>
            ${MM.settingRow('24/7 Watcher', 'Rejoin rotated alts if they crash or disconnect.', MM.toggle('rotation.watch'))}
            <div id="rot-live"></div>
          </div>
          <div class="card" id="sc-card"><h3>${MM.icon('gauge')}Auto-scale<span class="right"><label class="toggle"><input type="checkbox" id="sc-on"><span class="sw"></span></label><b style="margin-left:6px">On</b></span></h3>
            <p class="sub">Launch alts while your PC has room. When it runs low, close the least important first. Main accounts are never closed.</p>
            <div id="sc-pool"></div>
            <div class="field" style="margin-top:10px"><label>RAM budget</label><div class="seg" id="sc-budget"><button data-b="free">Keep RAM free</button><button data-b="cap">Cap Roblox's RAM</button></div></div>
            <div class="form-grid">
              <div class="field" id="sc-free-f"><label>Keep free (GB)</label><input class="input" type="number" min="0.5" max="64" step="0.5" data-setting="autoScale.freeGB"></div>
              <div class="field hidden" id="sc-cap-f"><label>Roblox may use (GB)</label><input class="input" type="number" min="1" max="512" step="1" data-setting="autoScale.capGB"></div>
              <div class="field"><label>CPU limit (%)</label><input class="input" type="number" min="30" max="100" data-setting="autoScale.cpuMax"></div>
              <div class="field"><label>Never fewer than</label><input class="input" type="number" min="0" max="50" data-setting="autoScale.min"></div>
              <div class="field"><label>Never more than</label><input class="input" type="number" min="1" max="50" data-setting="autoScale.max"></div>
              <div class="field" style="grid-column:1/-1"><label>Game</label><input class="input" data-setting="autoScale.game" placeholder="Blank = each account's default game"></div>
            </div>
            ${MM.settingRow('24/7 Watcher', 'Rejoin alts it launched if they crash or disconnect.', MM.toggle('autoScale.watch'))}
            <div id="sc-live"></div>
          </div>
          <div class="card spanall" id="eco-card"><h3>${MM.icon('leaf')}Eco mode<span class="right"><label class="toggle"><input type="checkbox" id="eco-on"><span class="sw"></span></label><b style="margin-left:6px">On</b></span></h3>
            <p class="sub">Puts background alts in Windows 11's efficiency mode with below-normal priority, so they use less CPU and power. The window you're using and Main accounts run normally. Turns on the background limiter.</p>
            <div id="eco-live" class="row small muted"></div>
          </div>
        </div>`;
      MM.bindSettings(root);

      const pool = (el, key) => {
        const c = MM.getSetting(key);
        const byTag = !!c.tag;
        el.innerHTML = `<div class="field"><label>Accounts</label><div class="seg" data-who><button data-w="pick" class="${byTag ? '' : 'on'}">Pick accounts</button><button data-w="tag" class="${byTag ? 'on' : ''}">Everyone with a tag</button></div></div>
          <div class="chips ${byTag ? 'hidden' : ''}" data-chips></div>
          <div class="${byTag ? '' : 'hidden'}" data-tagf><select class="input" data-tag data-nt>${tags.map(t => `<option value="${MM.esc(t.tag)}" ${c.tag === t.tag ? 'selected' : ''}>#${MM.esc(t.tag)} (${t.count})</option>`).join('') || `<option value="">${MM.esc(MM.t('No tags yet'))}</option>`}</select></div>`;
        MM.accountPicker(el.querySelector('[data-chips]'), accounts, { selected: c.accountIds, onChange: (ids) => MM.setSetting(`${key}.accountIds`, ids) });
        el.querySelector('[data-who]').onclick = async (e) => {
          const b = e.target.closest('[data-w]'); if (!b) return;
          el.querySelectorAll('[data-who] button').forEach(x => x.classList.toggle('on', x === b));
          el.querySelector('[data-chips]').classList.toggle('hidden', b.dataset.w === 'tag');
          el.querySelector('[data-tagf]').classList.toggle('hidden', b.dataset.w !== 'tag');
          await MM.setSetting(`${key}.tag`, b.dataset.w === 'tag' ? (el.querySelector('[data-tag]').value || '') : '');
        };
        el.querySelector('[data-tag]').onchange = (e) => MM.setSetting(`${key}.tag`, e.target.value);
      };

      const renderRot = (r) => {
        rot = r || rot; if (!rot) return;
        MM.$('#rot-on', root).checked = rot.enabled;
        const mins = rot.nextAt ? Math.max(0, Math.round((rot.nextAt - Date.now()) / 60000)) : null;
        MM.$('#rot-live', root).innerHTML = `<div class="rot-live">
          <div class="row"><b>${MM.esc(MM.t('Running now'))}</b><span class="spacer"></span>${rot.enabled && mins != null ? `<span class="small muted">${MM.esc(MM.t('Next swap in {0} min').replace('{0}', mins))}</span>` : ''}<button class="btn sm" data-act="rotNow" ${rot.pool.length ? '' : 'disabled'}>${MM.icon('skip-forward', 14)}Swap now</button></div>
          <div class="chips" style="margin:8px 0">${rot.current.length ? rot.current.map(a => `<span class="chip plain on" data-nt>${MM.esc(a.name)}</span>`).join('') : `<span class="small muted">${MM.esc(MM.t('Nobody yet'))}</span>`}</div>
          <div class="small dim">${MM.esc(MM.t('{0} accounts in the rotation').replace('{0}', rot.pool.length))}</div>
          ${rot.history.length ? `<div class="list" style="margin-top:8px">${rot.history.slice(0, 4).map(h => `<div class="item"><span class="small dim">${MM.fmt.clock(h.at)}</span><div class="grow small" data-nt>${h.in.length ? `+ ${MM.esc(h.in.join(', '))}` : ''}${h.out.length ? ` &nbsp;− ${MM.esc(h.out.join(', '))}` : ''}</div></div>`).join('')}</div>` : ''}</div>`;
      };
      const renderSc = (s) => {
        sc = s || sc; if (!sc) return;
        MM.$('#sc-on', root).checked = sc.enabled;
        const b = sc.config.budget;
        MM.$$('#sc-budget button', root).forEach(x => x.classList.toggle('on', x.dataset.b === b));
        MM.$('#sc-free-f', root).classList.toggle('hidden', b !== 'free'); MM.$('#sc-cap-f', root).classList.toggle('hidden', b !== 'cap');
        const ICON = { up: 'rocket', down: 'square-stop', hold: 'pause' };
        MM.$('#sc-live', root).innerHTML = `<div class="rot-live">
          ${sc.now ? `<div class="row small"><span class="badge dim">${MM.icon('memory-stick', 12)}${sc.now.freeGB} GB ${MM.esc(MM.t('free'))}</span><span class="badge dim">${MM.icon('gamepad-2', 12)}Roblox ${sc.now.robloxGB} GB</span><span class="badge dim">${MM.icon('cpu', 12)}CPU ${sc.now.cpu}%</span><span class="badge dim">${MM.esc(MM.t('{0} in the pool').replace('{0}', sc.pool))}</span></div>` : ''}
          <div class="list" style="margin-top:8px">${sc.decisions.length ? sc.decisions.slice(0, 5).map(d => `<div class="item">${MM.icon(ICON[d.action] || 'circle-dot', 14)}<div class="grow small">${d.label ? `<b data-nt>${MM.esc(d.label)}</b> · ` : ''}${MM.esc(d.reason)}</div><span class="small dim">${MM.fmt.clock(d.at)}</span></div>`).join('') : `<div class="small muted">${MM.esc(MM.t(sc.enabled ? 'Watching your PC…' : 'Off'))}</div>`}</div></div>`;
      };
      const renderEco = (l) => {
        lim = l || lim; if (!lim) return;
        MM.$('#eco-on', root).checked = !!(lim.config.eco && lim.running);
        const n = (lim.clients || []).filter(c => c.ecoOn).length;
        MM.$('#eco-live', root).innerHTML = `${lim.ecoSupported ? `<span class="badge ok">${MM.icon('leaf', 12)}${MM.esc(MM.t('Efficiency mode available'))}</span>` : `<span class="badge warn">${MM.esc(MM.t('No efficiency mode on this Windows: below-normal priority only'))}</span>`}
          ${lim.running ? `<span>${MM.esc(MM.t('{0} alts in eco mode now').replace('{0}', n))}</span>` : ''}`;
      };

      const load = async () => {
        const [a, r, s, l] = await Promise.all([MM.call('accounts:list'), MM.call('rotation:status'), MM.call('autoscale:status'), MM.call('limiter:status')]);
        accounts = (a?.accounts || []).filter(x => x.status !== 'expired'); tags = a?.tags || [];
        pool(MM.$('#rot-pool', root), 'rotation'); pool(MM.$('#sc-pool', root), 'autoScale');
        renderRot(r); renderSc(s); renderEco(l);
      };
      MM.$('#rot-on', root).onchange = async (e) => { const r = await MM.call('rotation:enable', e.target.checked); if (r) { MM.state.settings.rotation.enabled = r.enabled; renderRot(r); } };
      MM.$('#sc-on', root).onchange = async (e) => { const r = await MM.call('autoscale:enable', e.target.checked); if (r) { MM.state.settings.autoScale.enabled = r.enabled; renderSc(r); } };
      MM.$('#eco-on', root).onchange = async (e) => { const r = await MM.call('limiter:eco', e.target.checked); if (!r) e.target.checked = !e.target.checked; else { MM.state.settings.limiter.eco = r.eco; MM.call('limiter:status').then(renderEco); } };
      MM.$('#sc-budget', root).onclick = async (e) => { const b = e.target.closest('[data-b]'); if (!b) return; await MM.setSetting('autoScale.budget', b.dataset.b); MM.call('autoscale:status').then(renderSc); };
      MM.delegate(root, { rotNow: async (b) => { const r = await MM.busy(b, () => MM.call('rotation:now')); if (r) { MM.toast('info', 'Rotation', r.message); MM.call('rotation:status').then(renderRot); } } });
      load();
      const t = setInterval(() => { MM.call('autoscale:status').then(renderSc); MM.call('rotation:status').then(renderRot); }, 20000);
      const offs = [MM.on('rotation:update', renderRot), MM.on('autoscale:update', renderSc), MM.on('limiter:update', renderEco), MM.on('accounts:changed', load)];
      return () => { clearInterval(t); offs.forEach(f => f()); };
    },
  };
})();
