// Launch queue: a chip in the title bar while launches are waiting ("Launching 3 of 12"),
// and a window to see the order with an ETA, drag to reorder, launch one next, remove
// one, start the next one now, or clear the rest.
(function () {
  const MM = window.MM;
  let view = { current: null, items: [], avgMs: 0, doneInMs: 0 };
  let total = 0; // launches in this run (for "3 of 12")
  let done = 0;
  let openList = null; // re-render function of the open window, if any

  const mins = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? MM.t('{0} s').replace('{0}', s) : MM.t('{0} min').replace('{0}', Math.round(s / 60));
  };

  function chip() {
    const b = MM.$('#tb-queue');
    if (!b) return;
    const busy = view.current || view.items.length;
    b.classList.toggle('hidden', !busy);
    if (!busy) return;
    b.innerHTML = `${MM.icon('rocket', 14)}<span>${MM.esc(MM.t('Launching {0} of {1}').replace('{0}', Math.min(total, done + 1)).replace('{1}', total))}</span><span class="dim">· ${MM.esc(mins(view.doneInMs))}</span>`;
  }

  function listHtml() {
    const cur = view.current;
    const rows = view.items.map((it, i) => `<div class="item lq-item" draggable="true" data-qid="${MM.esc(it.qid)}">
        <span class="lq-grip" aria-hidden="true">${MM.icon('grip-vertical', 14)}</span><span class="badge">${i + 1}</span>
        <div class="grow"><div class="title" data-nt>${MM.esc(it.label)}</div><div class="meta">${MM.esc(MM.t('in about {0}').replace('{0}', mins(it.etaMs)))}</div></div>
        <button class="btn sm" data-q="first" title="${MM.esc(MM.t('Launch this one next'))}" ${i === 0 ? 'disabled' : ''}>${MM.icon('arrow-up-to-line', 14)}</button>
        <button class="btn sm icon danger" data-q="remove" title="${MM.esc(MM.t('Remove from the queue'))}">${MM.icon('x', 14)}</button></div>`).join('');
    return `${cur ? `<div class="item lq-now">${MM.icon('loader', 16)}<div class="grow"><div class="title" data-nt>${MM.esc(cur.label)}</div>
        <div class="meta">${MM.esc(cur.phase === 'batch' ? MM.t('Batch of {0} started. Waiting until they\'re in game').replace('{0}', cur.batch || '') : cur.phase === 'waiting' ? MM.t('Started. Waiting for the PC to settle') : cur.phase === 'updating' ? MM.t('Waiting for Roblox to finish updating') : MM.t('Starting Roblox'))} · ${MM.esc(MM.fmt.dur(Date.now() - cur.startedAt))}</div></div>
        ${cur.phase === 'waiting' || cur.phase === 'updating' || cur.phase === 'batch' ? `<button class="btn sm primary" data-q="next">${MM.icon('skip-forward', 14)}${MM.esc(MM.t('Next now'))}</button>` : ''}</div>` : ''}
      ${rows ? `<div class="list" id="lq-list">${rows}</div>` : `<div class="small dim" style="padding:8px 2px">${MM.esc(MM.t('Nothing else is waiting.'))}</div>`}
      <p class="hint">${MM.esc(MM.t('Drag to change the order. Each launch takes about {0} on this PC.').replace('{0}', mins(view.avgMs)))}</p>`;
  }

  MM.openLaunchQueue = () => {
    let box = null;
    const render = () => { if (box) box.innerHTML = listHtml(); };
    openList = render;
    MM.modal({
      title: 'Launch queue', icon: 'rocket', wide: true,
      body: '<div id="lq-box"></div>',
      buttons: [{ label: 'Clear the queue', value: 'clear', cls: 'ghost danger', handler: async () => { if (!view.items.length) return false; const r = await MM.call('launchqueue:clear'); if (r) MM.toast('info', 'Queue cleared', MM.t('{0} launches removed.').replace('{0}', r.removed)); return true; } },
        { label: 'Close', value: true, cls: 'primary' }],
      onMount: (m) => {
        box = m.querySelector('#lq-box');
        render();
        const t = setInterval(render, 1000);
        new MutationObserver((_, obs) => { if (!document.body.contains(m)) { clearInterval(t); openList = null; obs.disconnect(); } }).observe(document.body, { childList: true, subtree: true });
        m.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-q]');
          if (!b) return;
          const qid = b.closest('[data-qid]')?.dataset.qid;
          if (b.dataset.q === 'next') await MM.call('launchqueue:next');
          else if (b.dataset.q === 'first') await MM.call('launchqueue:move', qid, 0);
          else if (b.dataset.q === 'remove') { await MM.call('launchqueue:remove', qid); total = Math.max(done, total - 1); }
        });
        let dragging = null;
        m.addEventListener('dragstart', (e) => { const it = e.target.closest('.lq-item'); if (!it) return; dragging = it.dataset.qid; it.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
        m.addEventListener('dragend', (e) => { e.target.closest?.('.lq-item')?.classList.remove('dragging'); m.querySelectorAll('.drop-before').forEach(x => x.classList.remove('drop-before')); });
        m.addEventListener('dragover', (e) => {
          const it = e.target.closest('.lq-item');
          if (!dragging || !it) return;
          e.preventDefault();
          m.querySelectorAll('.drop-before').forEach(x => x.classList.remove('drop-before'));
          it.classList.add('drop-before');
        });
        m.addEventListener('drop', async (e) => {
          const it = e.target.closest('.lq-item');
          if (!dragging || !it) return;
          e.preventDefault();
          const to = view.items.findIndex(x => x.qid === it.dataset.qid);
          const from = view.items.findIndex(x => x.qid === dragging);
          const qid = dragging; dragging = null;
          if (to >= 0 && from >= 0 && to !== from && to !== from + 1) await MM.call('launchqueue:move', qid, from < to ? to - 1 : to); // dropped before item `to`
        });
      },
    });
  };

  MM.initLaunchQueue = () => {
    const b = MM.$('#tb-queue');
    if (b) b.onclick = MM.openLaunchQueue;
    MM.on('launchqueue:changed', (v) => {
      const before = (view.current ? 1 : 0) + view.items.length;
      const after = (v.current ? 1 : 0) + v.items.length;
      if (!before && after) { total = after; done = 0; } // a new run of launches
      else if (after > before) total += after - before; // more were added
      if (view.current && (!v.current || v.current.qid !== view.current.qid)) done++;
      if (!after) { total = 0; done = 0; }
      view = v;
      chip();
      if (openList) openList();
    });
    MM.call('launchqueue:view').then((v) => { if (v) { view = v; total = (v.current ? 1 : 0) + v.items.length; chip(); } });
  };
})();
