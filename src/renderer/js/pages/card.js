(function () {
  const MM = window.MM;

  // Profile card: a shareable picture of your MultiMenu stats.
  MM.pages.card = {
    render(root) {
      let stats = null, accounts = [], who = null;
      root.innerHTML = `
        <div class="page-head"><div><h1>Profile card</h1><p>A picture of your play history to share with friends. Made from your local Stats only.</p></div>
          <div class="actions"><button class="btn primary" data-act="save">${MM.icon('download')}Save as image</button></div></div>
        <div id="pc-card"></div>
        <div class="row" style="margin-top:12px"><span class="small muted">Card shows</span><select class="input sm" id="pc-who" style="width:220px"></select></div>`;

      const renderCard = () => {
        const a = accounts.find(x => x.id === who) || accounts[0];
        const t = stats?.totals || {};
        const games = stats?.topGames || [];
        MM.$('#pc-card', root).innerHTML = `<div class="pcard" id="pc-pcard">
          <div class="mark">MULTIMENU</div>
          <div class="who">${MM.avatar(a?.avatarUrl, a?.username || 'You')}<div><h2>${MM.esc(a ? (a.alias || a.displayName || a.username) : 'Player')}</h2><div style="opacity:.75">${a ? `@${MM.esc(a.username)} · ` : ''}${accounts.length} account${accounts.length === 1 ? '' : 's'}${t.since ? ` · since ${MM.esc(new Date(t.since + 'T12:00').toLocaleDateString(MM.loc(), { month: 'short', year: 'numeric' }))}` : ''}</div></div></div>
          <div class="nums">
            <div><b>${t.hours ?? 0}</b><span>hours</span></div>
            <div><b>${t.launches ?? 0}</b><span>launches</span></div>
            <div><b>${stats?.streak?.longest ?? 0}</b><span>best streak</span></div>
            <div><b>${t.activeDays ?? 0}</b><span>days played</span></div>
          </div>
          <div class="medals">${games.length ? games.slice(0, 5).map(g => `<span>${MM.icon('gamepad-2', 12)}${MM.esc(g.name)} · ${g.hours}h</span>`).join('') : '<span style="opacity:.7">No games recorded yet</span>'}</div>
        </div>`;
      };

      const load = async () => {
        const [s, accs] = await Promise.all([MM.call('stats:overview'), MM.call('accounts:list')]);
        stats = s; accounts = accs?.accounts || [];
        if (!who) who = MM.getSetting('follow.mainAccountId') || accounts.find(x => x.favourite)?.id || accounts[0]?.id || null;
        MM.$('#pc-who', root).innerHTML = accounts.map(a => `<option value="${MM.esc(a.id)}" ${a.id === who ? 'selected' : ''}>${MM.esc(a.alias || a.displayName || a.username)}</option>`).join('') || '<option>No accounts</option>';
        renderCard();
      };
      MM.$('#pc-who', root).addEventListener('change', (e) => { who = e.target.value; renderCard(); });
      MM.delegate(root, {
        save: async () => {
          const el = MM.$('#pc-pcard', root);
          if (!el) return;
          const p = await MM.call('stats:saveImage', MM.captureRect(el), 'card');
          if (p) MM.toast('success', 'Profile card saved', p);
        },
      });
      load();
    },
  };
})();
