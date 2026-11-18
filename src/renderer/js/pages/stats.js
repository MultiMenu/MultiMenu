(function () {
  const MM = window.MM;
  const monthName = (m) => new Date(`${m}-15T12:00`).toLocaleDateString(MM.loc(), { month: 'long', year: 'numeric' });
  const h = (ms) => (ms / 3600000);

  MM.pages.stats = {
    render(root) {
      let data = null, which = 'wrapped';
      root.innerHTML = `
        <div class="page-head"><div><h1>Stats</h1><p>Everything your accounts have done with MultiMenu: hours, streaks, stability and your monthly Wrapped.</p></div>
          <div class="actions"><div class="seg" id="st-month"><button data-m="wrapped" class="on">This month</button><button data-m="lastMonth">Last month</button></div><button class="btn" data-act="playYear">${MM.icon('trophy')}This year</button><button class="btn primary" data-act="play">${MM.icon('sparkles')}Play Wrapped</button><button class="btn" data-act="save">${MM.icon('download')}Save Wrapped as image</button></div></div>
        <div class="row" id="st-pills" style="margin-bottom:16px"></div>
        <div class="card" style="margin-bottom:16px"><h3>${MM.icon('lightbulb')}Insights</h3><div id="st-insights"></div></div>
        <div class="grid g3">
          <div class="span2" id="st-wrapped"></div>
          <div class="card"><h3>${MM.icon('crown')}Most stable account</h3><div id="st-stable"></div><h3 style="margin-top:18px">${MM.icon('gamepad-2')}Top games</h3><div id="st-games"></div></div>
          <div class="card spanall"><h3>${MM.icon('calendar-clock')}Activity — last 6 months<span class="right" id="st-heat-info"></span></h3><div class="heat" id="st-heat"></div>
            <div class="heat-legend">Less <i style="background:hsla(270,30%,30%,.18)"></i><i style="background:hsla(270,80%,45%,.35)"></i><i style="background:hsla(270,85%,55%,.55)"></i><i style="background:hsla(270,90%,62%,.8)"></i><i style="background:var(--lavender)"></i> More</div></div>
          <div class="card spanall"><h3>${MM.icon('users')}Leaderboard (all time)</h3><div id="st-board"></div></div>
        </div>`;

      const renderWrapped = () => {
        const w = data[which];
        const el = MM.$('#st-wrapped', root);
        el.innerHTML = `<div class="wrapped" id="st-wrap-card">
          <div class="kicker">MULTIMENU WRAPPED</div>
          <h2>Your <span>${MM.esc(monthName(w.month))}</span></h2>
          <div class="row" style="align-items:flex-end;gap:14px"><div class="big">${w.hours}</div><div style="padding-bottom:10px"><b style="font-size:18px">hours online</b><div class="muted">across ${w.activeDays} active day${w.activeDays === 1 ? '' : 's'}</div></div></div>
          <div class="tiles">
            <div><span>Top account</span><b>${w.topAccount ? `${MM.esc(w.topAccount.label)} · ${w.topAccount.hours}h` : '—'}</b></div>
            <div><span>Top game</span><b>${w.topGame ? `${MM.esc(w.topGame.name)} · ${w.topGame.hours}h` : '—'}</b></div>
            <div><span>Best day</span><b>${w.bestDay ? `${MM.esc(new Date(w.bestDay.day + 'T12:00').toLocaleDateString(MM.loc(), { weekday: 'short', day: 'numeric', month: 'short' }))} · ${w.bestDay.hours}h` : '—'}</b></div>
            <div><span>Auto-rejoins</span><b>${w.rejoins} saves${w.memRestarts ? ` · ${w.memRestarts} memory` : ''}</b></div>
            <div><span>Launches</span><b>${w.launches}</b></div>
            <div><span>Problems caught</span><b>${w.problems}</b></div>
          </div>
          <div class="mark"><div class="logo-mark">M</div>MultiMenu</div>
        </div>`;
      };

      const render = () => {
        const t = data.totals;
        MM.$('#st-pills', root).innerHTML = `
          <div class="statpill"><b>${t.hours}</b><span>hours total</span></div>
          <div class="statpill"><b>${t.activeDays}</b><span>active days</span></div>
          <div class="statpill"><b style="color:${data.streak.current ? 'var(--warn)' : 'var(--dim)'}">${data.streak.current}🔥</b><span>day streak</span></div>
          <div class="statpill"><b>${data.streak.longest}</b><span>longest streak</span></div>
          <div class="statpill"><b style="color:var(--ok)">${t.rejoins}</b><span>auto-rejoins</span></div>
          <div class="statpill"><b>${t.problems}</b><span>problems caught</span></div>
          <div class="statpill"><b>${t.launches}</b><span>launches</span></div>`;
        renderWrapped();
        const ms = data.mostStable;
        MM.$('#st-stable', root).innerHTML = ms ? `<div class="item"><span style="font-size:26px">🏆</span><div class="grow"><div class="title">${MM.esc(ms.label)}</div><div class="meta">${h(ms.uptimeMs).toFixed(1)}h online · ${ms.problems ? `${ms.perDay.toFixed(2)} issues/day` : 'zero problems'}</div></div></div>`
          : '<div class="small muted">Needs at least 3 hours of play on one account.</div>';
        const maxG = Math.max(1, ...data.topGames.map(g => g.hours));
        MM.$('#st-games', root).innerHTML = data.topGames.length ? data.topGames.map(g => `<div class="gbar"><div class="name">${MM.esc(g.name)}</div><div class="bar"><i style="width:${(g.hours / maxG) * 100}%"></i></div><div class="h">${g.hours}h</div></div>`).join('') : '<div class="small muted">Game hours are recorded while accounts run.</div>';
        const max = Math.max(1, ...data.heat.map(x => x.hours));
        const level = (v) => (v <= 0 ? '' : v < max * 0.25 ? 'l1' : v < max * 0.5 ? 'l2' : v < max * 0.8 ? 'l3' : 'l4');
        // pad so the first column starts on Monday
        const first = new Date(data.heat[0].day + 'T12:00').getDay();
        const pad = (first + 6) % 7;
        MM.$('#st-heat', root).innerHTML = '<i style="visibility:hidden"></i>'.repeat(pad) + data.heat.map(x => `<i class="${level(x.hours)}" title="${MM.esc(new Date(x.day + 'T12:00').toLocaleDateString())}: ${x.hours}h"></i>`).join('');
        MM.$('#st-heat-info', root).textContent = t.since ? `tracking since ${new Date(t.since + 'T12:00').toLocaleDateString(MM.loc())}` : '';
        MM.$('#st-board', root).innerHTML = data.accounts.length ? `<table class="tbl"><thead><tr><th>#</th><th>Account</th><th>Hours</th><th>Active days</th><th>Launches</th><th>Rejoins</th><th>Problems / day</th></tr></thead><tbody>${data.accounts.map((a, i) => `<tr><td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td><td><b>${MM.esc(a.label)}</b></td><td>${h(a.uptimeMs).toFixed(1)}</td><td>${a.activeDays}</td><td>${a.launches}</td><td>${a.rejoins}</td><td><span class="badge ${a.perDay === 0 ? 'ok' : a.perDay < 3 ? 'warn' : 'err'}">${a.perDay.toFixed(2)}</span></td></tr>`).join('')}</tbody></table>`
          : MM.empty('chart-column', 'No stats yet', 'Launch some accounts — hours, streaks and your Wrapped build up automatically.');
      };

      MM.$('#st-month', root).addEventListener('click', (e) => {
        const b = e.target.closest('[data-m]');
        if (!b || !data) return;
        which = b.dataset.m;
        MM.$$('#st-month button', root).forEach(x => x.classList.toggle('on', x === b));
        renderWrapped();
      });
      MM.delegate(root, {
        save: async () => {
          const p = await MM.call('stats:saveImage', MM.captureRect(MM.$('#st-wrap-card', root)));
          if (p) MM.toast('success', 'Wrapped saved', p);
        },
        play: () => MM.playWrapped(which === 'lastMonth' ? 'lastMonth' : 'month'),
        playYear: () => MM.playWrapped('year'),
      });
      MM.renderInsights(MM.$('#st-insights', root), { limit: 6 });
      MM.call('stats:overview').then(d => { if (d) { data = d; render(); } });
      const t = setInterval(() => MM.call('stats:overview').then(d => { if (d) { data = d; render(); } }), 60000);
      return () => clearInterval(t);
    },
  };
})();
