(function () {
  const MM = window.MM;
  const ST = { ok: ['ok', 'circle-check'], warn: ['warn', 'triangle-alert'], fail: ['err', 'circle-x'], info: ['info', 'info'] };

  MM.pages.doctor = {
    render(root) {
      root.innerHTML = `
        <div class="page-head"><div><h1>MultiMenu Doctor</h1><p>Checks the things that most often go wrong, and fixes them in one click where it safely can.</p></div>
          <div class="actions"><button class="btn" data-act="fixAll" disabled>${MM.icon('wand-sparkles')}Fix the safe ones</button><button class="btn primary" data-act="run">${MM.icon('refresh-cw')}Check again</button></div></div>
        <div class="card doc-sum" id="doc-sum"></div>
        <div class="card"><div class="list doc-list" id="doc-list"><div class="small muted" style="padding:10px">Checking…</div></div></div>`;
      const render = (r) => {
        if (!r) return;
        const bad = r.checks.filter(c => c.status === 'fail').length, warns = r.checks.filter(c => c.status === 'warn').length;
        MM.$('#doc-sum', root).innerHTML = `<div class="row" style="gap:16px"><div class="doc-orb ${bad ? 'err' : warns ? 'warn' : 'ok'}">${MM.icon(bad || warns ? 'heart-pulse' : 'shield-check', 26)}</div>
          <div class="grow"><b style="font:600 18px var(--display)">${MM.esc(r.summary)}</b><div class="small muted">${MM.esc(MM.t('{0} checks').replace('{0}', r.checks.length))} · ${MM.fmt.clock(r.at)}</div></div></div>`;
        const order = { fail: 0, warn: 1, info: 2, ok: 3 };
        MM.$('#doc-list', root).innerHTML = r.checks.slice().sort((a, b) => order[a.status] - order[b.status]).map(c => `<div class="item doc ${ST[c.status][0]}">${MM.icon(ST[c.status][1], 18)}<div class="grow"><div class="title">${MM.esc(c.title)}</div>${c.detail ? `<div class="meta" data-nt>${MM.esc(MM.t(c.detail))}</div>` : ''}</div>
            ${c.fix && c.status !== 'ok' ? `<button class="btn sm ${c.status === 'fail' || c.status === 'warn' ? 'primary' : ''}" data-act="fix" data-fix="${MM.esc(c.fix.id)}">${MM.esc(c.fix.label)}</button>` : ''}</div>`).join('');
        MM.$('[data-act="fixAll"]', root).disabled = !r.checks.some(c => c.fix?.safe && c.status !== 'ok');
      };
      const run = async (b) => { const r = await MM.busy(b, () => MM.call('doctor:run')); render(r); };
      MM.delegate(root, {
        run: (b) => run(b),
        fix: async (b) => {
          const id = b.dataset.fix;
          if (id.startsWith('page:')) { MM.go(id.slice(5)); return; }
          const r = await MM.busy(b, () => MM.call('doctor:fix', id));
          if (r) { MM.toast('success', 'Done', r.message); render(r); }
        },
        fixAll: async (b) => { const r = await MM.busy(b, () => MM.call('doctor:fixAll')); if (r) { MM.toast('success', r.fixed.length ? `Fixed ${r.fixed.length}` : 'Nothing to fix', r.fixed.join(' · ')); render(r); } },
      });
      run();
    },
  };
})();
