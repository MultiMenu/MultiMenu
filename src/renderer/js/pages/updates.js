(function () {
  const MM = window.MM;

  MM.pages.updates = {
    render(root) {
      root.innerHTML = `
        <div class="page-head"><div><h1>Updates</h1><p>MultiMenu checks GitHub Releases for new versions, verifies every download's SHA-256 checksum, and keeps your accounts and settings.</p></div>
          <div class="actions"><button class="btn primary" data-act="check">${MM.icon('refresh-cw')}Check now</button></div></div>
        <div class="grid g3">
          <div class="card span2" id="u-status"></div>
          <div class="card"><h3>${MM.icon('sliders-horizontal')}Update settings</h3>
            ${MM.settingRow('Check automatically', 'On startup and every 6 hours.', MM.toggle('updates.autoCheck'))}
            <div class="field" style="margin:12px 0"><label>Channel</label><select class="input" data-setting="updates.channel"><option value="stable">Stable</option><option value="beta">Beta (pre-releases)</option></select></div>
            ${MM.settingRow('Require a code signature', 'Refuse installers that aren\'t validly signed (installed build only). Leave off unless you sign your releases.', MM.toggle('updates.requireSignature'))}
            <div class="field" style="margin-top:12px"><label>GitHub repository (owner/repo)</label><input class="input" data-setting="updates.repoOverride" placeholder="Uses the one built into this version"></div>
          </div>
          <div class="card span3"><h3>${MM.icon('history')}Update history</h3><div id="u-hist"></div></div>
        </div>`;
      MM.bindSettings(root);

      const render = (s) => {
        if (!s) return;
        const l = s.latest;
        const icon = { available: 'sparkles', current: 'circle-check', error: 'circle-alert', unconfigured: 'info', checking: 'refresh-cw', downloading: 'download', ready: 'shield-check', installing: 'download' }[s.status] || 'info';
        MM.$('#u-status', root).innerHTML = `<h3>${MM.icon(icon)}${s.status === 'available' ? 'Update available' : 'Status'}<span class="right">${s.checkedAt ? `checked ${MM.fmt.ago(s.checkedAt)}` : ''}</span></h3>
          <div class="row" style="gap:28px;margin-bottom:12px"><div class="stat"><div class="label">Installed</div><div class="value">v${MM.esc(s.current)}</div></div>
            ${l ? `<div class="stat"><div class="label">Latest</div><div class="value" style="color:var(--lavender)">v${MM.esc(l.version)}</div></div>` : ''}
            <div class="stat"><div class="label">Build</div><div class="value" style="font-size:18px">${s.kind === 'portable' ? 'Portable' : 'Installer'}</div></div>
            <div class="stat"><div class="label">Source</div><div class="value" style="font-size:14px">${MM.esc(s.repo || 'not set')}</div></div></div>
          <div class="callout ${s.status === 'error' ? 'err' : s.status === 'available' || s.status === 'ready' ? 'ok' : ''}">${MM.icon(icon)}<div>${MM.esc(s.message || 'Not checked yet.')}</div></div>
          ${['downloading', 'ready', 'installing'].includes(s.status) ? `<div class="progress"><i style="width:${Math.round((s.progress || 0) * 100)}%"></i></div>` : ''}
          ${s.downloaded ? `<div class="small muted mono" style="margin-top:8px">SHA-256 ${MM.esc(s.downloaded.sha256)} ✓${s.downloaded.signature?.status && s.downloaded.signature.status !== 'NotApplicable' ? ` · Signature: ${MM.esc(s.downloaded.signature.status)}` : ''}</div>` : ''}
          <div class="row" style="margin-top:14px">
            ${s.status === 'available' ? `<button class="btn primary" data-act="download">${MM.icon('download')}Download & Install</button>` : ''}
            ${s.status === 'ready' ? `<button class="btn primary" data-act="install">${MM.icon('rocket')}Install & restart</button>` : ''}
            ${l ? `<button class="btn" data-act="log">${MM.icon('list')}View changelog</button><button class="btn ghost" data-act="release">${MM.icon('external-link')}Release page</button>` : ''}
          </div>`;
        MM.$('#u-hist', root).innerHTML = s.history.length ? `<table class="tbl"><thead><tr><th>Date</th><th>From</th><th>To</th><th>Build</th></tr></thead><tbody>${s.history.map(h => `<tr><td>${MM.esc(MM.fmt.date(h.at))}</td><td>v${MM.esc(h.from)}</td><td>v${MM.esc(h.to)}</td><td>${MM.esc(h.kind)}</td></tr>`).join('')}</tbody></table>`
          : MM.empty('history', 'No updates installed yet', 'Updates you install from here are recorded.');
        current = s;
      };
      let current = null;

      MM.delegate(root, {
        check: async (b) => render(await MM.busy(b, () => MM.call('updates:check'))),
        download: async (b) => { const r = await MM.busy(b, () => MM.call('updates:download')); if (r) render(r); },
        install: async (b) => { if (await MM.confirm('Install the update now?', 'MultiMenu closes, installs the new version and starts again. Running Roblox clients keep running.', { ok: 'Install & restart' })) MM.busy(b, () => MM.call('updates:install')); },
        log: () => current?.latest && MM.showChangelog(current.latest),
        release: () => MM.call('updates:openRelease'),
      });
      MM.call('updates:status').then(render);
      return MM.on('updater:update', render);
    },
  };
})();
