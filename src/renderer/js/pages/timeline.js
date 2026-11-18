(function () {
  const MM = window.MM;
  const KINDS = { crash: ['err', 'Crash'], disconnect: ['warn', 'Disconnect'], freeze: ['warn', 'Froze'], stuck: ['warn', 'Stuck loading'], memory: ['mem', 'Memory restart'], rejoin: ['ok', 'Rejoined'] };
  const RANGES = [[24, '24 hours'], [72, '3 days'], [168, '7 days'], [336, '14 days']];

  MM.pages.timeline = {
    render(root) {
      let hours = 24, data = null;
      root.innerHTML = `
        <div class="page-head"><div><h1>Timeline</h1><p>When each alt was running, and where something went wrong.</p></div>
          <div class="actions"><div class="seg" id="tl-range">${RANGES.map(([h, l]) => `<button data-h="${h}">${l}</button>`).join('')}</div></div></div>
        <div class="card"><div class="row small muted" style="gap:14px;margin-bottom:12px"><span class="tl-key"><i class="bar"></i>Running</span>${Object.entries(KINDS).map(([, [c, l]]) => `<span class="tl-key"><i class="mk ${c}"></i>${l}</span>`).join('')}</div>
          <div class="tl" id="tl"></div></div>`;
      const fmtRange = (a, b) => `${new Date(a).toLocaleString(MM.loc(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })} – ${new Date(b).toLocaleTimeString(MM.loc(), { hour: '2-digit', minute: '2-digit' })}`;
      const render = () => {
        MM.$$('#tl-range button', root).forEach(b => b.classList.toggle('on', +b.dataset.h === hours));
        const el = MM.$('#tl', root);
        if (!data?.rows.length) { el.innerHTML = MM.empty('history', 'Nothing in this range', 'Sessions show up here as soon as alts run.'); return; }
        const { from, to } = data;
        const pct = (t) => `${((t - from) / (to - from)) * 100}%`;
        const step = hours <= 24 ? 3 : hours <= 72 ? 12 : 24;
        const ticks = [];
        const first = new Date(from); first.setMinutes(0, 0, 0); first.setHours(Math.ceil(first.getHours() / step) * step);
        for (let t = first.getTime(); t < to; t += step * 3600000) ticks.push(t);
        el.innerHTML = `<div class="tl-row tl-axis"><div class="tl-name"></div><div class="tl-track">${ticks.map(t => `<span style="left:${pct(t)}">${MM.esc(step >= 24 ? new Date(t).toLocaleDateString(MM.loc(), { weekday: 'short', day: 'numeric' }) : new Date(t).toLocaleTimeString(MM.loc(), { hour: '2-digit', minute: '2-digit' }))}</span>`).join('')}</div></div>
          ${data.rows.map(r => `<div class="tl-row"><div class="tl-name"><b data-nt>${MM.esc(r.label)}</b><span class="small dim">${MM.fmt.dur(r.ms)}</span></div><div class="tl-track">${ticks.map(t => `<i class="tl-grid" style="left:${pct(t)}"></i>`).join('')}
            ${r.spans.map(s => `<div class="tl-span ${s.live ? 'live' : ''} ${s.reason === 'crash' ? 'crash' : ''}" style="left:${pct(s.start)};width:max(3px, calc(${pct(s.end)} - ${pct(s.start)}))" title="${MM.esc(`${s.game || ''}\n${fmtRange(s.realStart, s.realEnd || Date.now())} (${MM.fmt.dur((s.realEnd || Date.now()) - s.realStart)})${s.reason ? ` · ${MM.t(s.reason)}` : ''}`)}"></div>`).join('')}
            ${r.marks.map(m => `<i class="tl-mark mk ${(KINDS[m.kind] || ['', ''])[0]}" style="left:${pct(m.at)}" title="${MM.esc(`${MM.t((KINDS[m.kind] || ['', m.kind])[1])} · ${new Date(m.at).toLocaleString(MM.loc())}${m.detail ? `\n${m.detail}` : ''}`)}"></i>`).join('')}</div></div>`).join('')}`;
      };
      const load = async () => { data = await MM.call('timeline:query', hours); render(); };
      MM.$('#tl-range', root).addEventListener('click', (e) => { const b = e.target.closest('[data-h]'); if (b) { hours = +b.dataset.h; load(); } });
      load();
      const t = setInterval(load, 60000);
      const offs = [MM.on('sessions:changed', () => setTimeout(load, 500))];
      return () => { clearInterval(t); offs.forEach(f => f()); };
    },
  };
})();
