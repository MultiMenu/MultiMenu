(function () {
  const MM = window.MM;
  MM.pages.achievements = {
    render(root) {
      root.innerHTML = `
        <div class="page-head"><div><h1>Achievements</h1><p>Little milestones, worked out on this PC from your own stats.</p></div>
          <div class="actions"><button class="btn primary" data-act="wrapped">${MM.icon('sparkles')}Play my Wrapped</button></div></div>
        <div class="card" id="ach-sum"></div>
        <div class="ach-grid" id="ach-grid"></div>`;
      const render = (st) => {
        if (!st) return;
        const pct = Math.round((st.unlocked / st.total) * 100);
        MM.$('#ach-sum', root).innerHTML = `<div class="row" style="gap:16px"><div class="ach-big">${MM.icon('trophy', 26)}</div><div class="grow"><b style="font:600 18px var(--display)">${MM.esc(MM.t('{0} of {1} unlocked').replace('{0}', st.unlocked).replace('{1}', st.total))}</b><div class="meter" style="margin-top:8px"><i style="width:${pct}%"></i></div></div></div>`;
        const list = st.list.slice().sort((a, b) => (b.done - a.done) || ((b.at || 0) - (a.at || 0)) || (b.current / b.goal - a.current / a.goal));
        MM.$('#ach-grid', root).innerHTML = list.map(a => `<div class="card ach ${a.done ? 'done' : ''}">
            <div class="ach-icon">${MM.icon(a.icon, 22)}</div>
            <div class="grow"><b>${MM.esc(a.title)}</b><div class="small muted">${MM.esc(a.desc)}</div>
              ${a.done ? `<div class="small" style="color:var(--ok);margin-top:6px">${MM.icon('circle-check', 12)} ${a.at ? MM.esc(new Date(a.at).toLocaleDateString(MM.loc())) : ''}</div>`
                : `<div class="meter" style="margin-top:8px"><i style="width:${Math.round((a.current / a.goal) * 100)}%"></i></div><div class="small dim" style="margin-top:4px">${a.current.toLocaleString()} / ${a.goal.toLocaleString()}</div>`}</div></div>`).join('');
      };
      MM.delegate(root, { wrapped: () => MM.playWrapped?.('month') });
      MM.call('achievements:status').then(render);
      const off = MM.on('achievements:update', render);
      return () => off();
    },
  };
})();
