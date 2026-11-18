// Alt switcher: a quick pop-up of every running alt. Pick one to bring its window to the front.
(function () {
  const MM = window.MM;
  const grid = MM.$('#sw-grid');
  let tiles = [], sel = 0, shots = {}, timer = null;

  const draw = () => {
    grid.innerHTML = tiles.length ? tiles.map((t, i) => `<button class="sw-tile ${i === sel ? 'on' : ''} ${t.tier ? `tier-${MM.esc(t.tier)}` : ''}" role="option" aria-selected="${i === sel}" data-i="${i}">
        <div class="sw-shot">${shots[t.id] ? `<img src="${shots[t.id]}" alt="">` : `<div class="sw-none">${MM.avatar(t.avatarUrl, t.label)}<span class="small dim">${MM.esc(MM.t(t.status === 'running' ? 'Minimised' : 'Starting…'))}</span></div>`}
          <span class="sw-key">${t.slot || (i < 9 ? i + 1 : '')}</span></div>
        <div class="sw-name"><span class="dot ${t.state === 'not responding' ? 'err' : t.status === 'running' ? 'live' : 'warn'}"></span><span data-nt>${MM.esc(t.label)}</span></div>
        <div class="sw-meta small dim" data-nt>${MM.esc(t.game || '')}</div></button>`).join('')
      : `<div class="sw-empty">${MM.empty('monitor-play', 'No alts running', 'Launch some from MultiMenu first.')}</div>`;
  };
  const load = async () => {
    const d = await MM.call('wall:data');
    tiles = (d?.tiles || []).filter(t => t.status === 'running' || t.status === 'launching');
    sel = Math.min(sel, Math.max(0, tiles.length - 1));
    draw();
    const s = await MM.call('wall:thumbs', 240);
    if (s) { shots = s; draw(); }
  };
  const pick = async (i) => {
    const t = tiles[i];
    if (!t || t.status !== 'running') return;
    await MM.call('switcher:close');
    MM.call('tiler:focus', t.id);
  };
  grid.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pick(+b.dataset.i); });
  document.addEventListener('keydown', (e) => {
    const cols = Math.max(1, Math.round(grid.clientWidth / 248));
    if (e.key === 'Escape') { MM.call('switcher:close'); return; }
    if (e.key === 'Enter') { pick(sel); return; }
    const n = Number(e.key);
    if (n >= 1 && n <= 9) { const i = tiles.findIndex(t => t.slot === n); pick(i >= 0 ? i : n - 1); return; }
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Tab: e.shiftKey ? -1 : 1 }[e.key];
    if (move && tiles.length) { e.preventDefault(); sel = (sel + move + tiles.length) % tiles.length; draw(); }
  });
  const start = () => { sel = 0; shots = {}; load(); clearInterval(timer); timer = setInterval(load, 3000); };
  MM.on('switcher:show', start);
  window.addEventListener('blur', () => clearInterval(timer));
  window.MMI18NReady.then(start);
})();
