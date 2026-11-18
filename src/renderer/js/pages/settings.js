(function () {
  const MM = window.MM;
  const HOTKEYS = [['clickerToggle', 'Auto clicker on/off'], ['macroRecord', 'Macro record / stop'], ['macroPlay', 'Macro play / stop'], ['emergencyStop', 'Emergency stop (all automation)'], ['tileWindows', 'Tile Roblox windows'], ['miniPanel', 'Open / close mini panel'], ['closeAllRoblox', 'Close all Roblox now (panic button)'], ['focusMode', 'Focus mode on / off'], ['focusNext', 'Focus mode: next window'], ['pip', 'Picture-in-picture on / off'], ['altWall', 'Alt switcher'], ['pinWindow', 'Pin the Roblox window in front on top']];

  MM.HOTKEY_LABELS = HOTKEYS;

  MM.pages.settings = {
    render(root) {
      const info = MM.state.info;
      root.innerHTML = `
        <div class="page-head"><div><h1>Settings</h1><p>Appearance, startup, hotkeys, performance and security.</p></div>
          <div class="actions">
            <button class="btn" data-act="import">${MM.icon('file-up')}Import config</button>
            <button class="btn" data-act="export">${MM.icon('file-down')}Export config</button>
          </div></div>
        <div class="set-search"><span class="ic-wrap">${MM.icon('search', 16)}</span><input class="input" id="set-q" type="search" placeholder="Search settings…" autocomplete="off" spellcheck="false"><span class="small muted" id="set-count"></span></div>
        <div class="card hidden" id="set-none">${MM.empty('search', 'No settings match', 'Try a shorter word, like “tray”, “hotkey” or “memory”.')}</div>
        <div class="grid g2" id="set-grid">
          <div class="card"><h3>${MM.icon('sparkles')}Appearance</h3>
            <div class="setting-row"><div class="txt"><b>Language</b><span>Changes the language of the whole app. The window reloads.</span></div><div class="ctl"><button class="btn sm" data-act="language">${MM.icon('languages', 14)}<span data-nt>${MM.esc((window.MMTranslate.LANGS.find(l => l.id === (MM.state.settings.language || 'en')) || {}).name || 'English')}</span></button></div></div>
            <div class="setting-row"><div class="txt"><b>Accent colour</b><span>Shift the purple glow towards blue or pink. More in the Theme studio.</span></div><div class="ctl"><input type="range" min="0" max="360" data-setting="appearance.accentHue"><button class="btn sm" data-act="studio">${MM.icon('palette', 14)}Theme studio</button></div></div>
            <div class="setting-row"><div class="txt"><b>Light or dark</b><span>“Match Windows” switches by itself when Windows does.</span></div><div class="ctl"><select class="input sm" data-setting="appearance.mode" style="width:auto"><option value="dark">Dark</option><option value="light">Light</option><option value="system">Match Windows</option></select></div></div>
            <div class="setting-row"><div class="txt"><b>Spacing</b><span>Compact fits more on the screen.</span></div><div class="ctl"><select class="input sm" data-setting="appearance.density" style="width:auto"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div></div>
            ${MM.settingRow('High contrast', 'Stronger borders and brighter text, so everything is easier to read.', `<label class="toggle"><input type="checkbox" id="ap-hc" ${MM.getSetting('appearance.contrast') === 'high' ? 'checked' : ''}><span class="sw"></span></label>`)}
            <div class="setting-row"><div class="txt"><b>Text size</b><span>Makes everything in MultiMenu bigger or smaller.</span></div><div class="ctl"><input type="range" min="80" max="150" step="10" data-setting="appearance.textSize" id="ap-ts"><b id="ap-ts-v" style="min-width:46px;text-align:right"></b></div></div>
            ${MM.settingRow('Animations', 'Page transitions, hover effects and the moving background.', MM.toggle('appearance.animations'))}
            ${MM.settingRow('Floating particles', 'Soft glowing particles behind the interface.', MM.toggle('appearance.particles'))}
            <div class="setting-row"><div class="txt"><b>Particle amount</b><span>Fewer particles use less GPU.</span></div><div class="ctl"><input type="range" min="10" max="120" data-setting="appearance.particleCount"></div></div>
            ${MM.settingRow('Reduced motion', 'Turns off all animation. Also follows your Windows setting.', MM.toggle('appearance.reducedMotion'))}
            ${MM.settingRow('Loading screen', 'Show the animated splash when MultiMenu opens.', MM.toggle('startup.showLoadingScreen'))}
            ${MM.settingRow('Page tips', 'Short tips the first time you open each page.', MM.toggle('tour.enabled'))}
          </div>
          <div class="card"><h3>${MM.icon('power')}Startup & window</h3>
            ${MM.settingRow('Start with Windows', info.portable ? 'Portable build: keep MultiMenu in the same folder or this stops working.' : 'Opens MultiMenu when you sign in.', MM.toggle('startup.launchOnLogin'))}
            ${MM.settingRow('Start minimised to tray', 'Opens quietly in the system tray.', MM.toggle('startup.startMinimized'))}
            ${MM.settingRow('Close to tray', 'The X button hides MultiMenu instead of quitting. Quit from the tray icon.', MM.toggle('startup.closeToTray'))}
            ${MM.settingRow('Offer to resume after a restart', 'If your PC reboots or crashes, MultiMenu remembers which accounts were running and where.', MM.toggle('resume.enabled'))}
            ${MM.settingRow('Resume automatically', 'Skip the question (great with “Start with Windows”).', MM.toggle('resume.auto'))}
            ${MM.settingRow('Mini panel always on top', 'Keep the compact session panel above other windows (including Roblox).', MM.toggle('mini.alwaysOnTop'))}
            ${MM.settingRow('Open mini panel at startup', 'Shows the compact panel when MultiMenu starts.', MM.toggle('mini.openOnStart'))}
            ${MM.settingRow('Windows notifications', 'Show a Windows toast for crashes, failed launches and high usage.', MM.toggle('notifications.toasts'))}
            ${MM.settingRow('Offer to launch copied Roblox links', 'When you copy a game, private server or share link anywhere, MultiMenu asks which accounts to send there. Only Roblox links are looked at.', MM.toggle('clipboard.enabled'))}
          </div>
          <div class="card"><h3>${MM.icon('keyboard')}Hotkeys</h3><p class="sub">Global: they work while you're in Roblox. Use F1–F24, letters or numbers, optionally with Ctrl, Alt or Shift (e.g. Ctrl+Shift+K).</p>
            ${HOTKEYS.map(([k, label]) => `<div class="setting-row"><div class="txt"><b>${label}</b></div><div class="ctl"><input class="input sm" style="width:150px" data-setting="hotkeys.${k}" data-hotkey></div></div>`).join('')}
            <div class="setting-row" id="ak-row"><div class="txt"><b>Hotkeys per alt</b><span>Press the keys plus 1–9 to jump to the alt with that slot (set slots when you edit an account, or Accounts → More → Give hotkey slots).</span></div><div class="ctl">${MM.toggle('altKeys.enabled')}</div></div>
            <div class="form-grid"><div class="field"><label>Keys</label><select class="input" data-setting="altKeys.modifier"><option value="Ctrl+Alt">Ctrl+Alt+1…9</option><option value="Ctrl+Shift">Ctrl+Shift+1…9</option><option value="Alt+Shift">Alt+Shift+1…9</option><option value="Ctrl+Alt+Shift">Ctrl+Alt+Shift+1…9</option></select></div></div>
            ${MM.settingRow('Launch the alt if it isn\'t running', 'Otherwise the hotkey only switches to alts that are open.', MM.toggle('altKeys.launchIfClosed'))}
            <p class="hint">If your keyboard has an AltGr key, Ctrl+Alt+number may type symbols like @ instead. Pick Ctrl+Shift if that happens.</p>
          </div>
          <div class="card" id="lean-card"><h3>${MM.icon('cpu')}Performance<span class="right"><button class="btn sm primary" data-act="leanAll">${MM.icon('leaf', 14)}Use the least CPU and RAM</button></span></h3>
            <p class="sub">That button turns on every setting below that saves CPU and RAM, without changing what your alts do. Diet mode is separate (it needs a restart).</p>
            <div class="setting-row"><div class="txt"><b>Background checks</b><span>How often MultiMenu checks your clients, the background limiter, tiny windows, pop-ups, the 24/7 Watcher and the network monitor. Slower uses less CPU; MultiMenu then notices things a few seconds later.</span></div>
              <div class="ctl"><select class="input" data-setting="performance.checkSpeed"><option value="normal">Normal</option><option value="relaxed">Relaxed (half as often)</option><option value="slow">Slow (a quarter as often)</option></select></div></div>
            ${MM.settingRow('Pause page updates while hidden', 'While MultiMenu is minimised or in the tray, its pages stop redrawing live numbers. You see the latest ones as soon as you open it.', MM.toggle('performance.pauseHidden'))}
            <div class="setting-row"><div class="txt"><b>Free MultiMenu's memory when hidden</b><span>A minute after you hide MultiMenu, Windows moves the memory it isn't using out of RAM.</span><span class="small dim" id="lean-freed" style="display:block;margin-top:4px"></span></div><div class="ctl"><button class="btn sm" data-act="leanTrim">Free now</button>${MM.toggle('performance.trimSelf')}</div></div>
            ${MM.settingRow('Pause effects when MultiMenu isn\'t in front', 'The floating particles and a video background stop while you\'re in another window, like Roblox.', MM.toggle('appearance.pauseUnfocused'))}
            ${MM.settingRow('End Roblox\'s crash reporters', 'Every Roblox client starts a RobloxCrashHandler.exe that only waits for a crash. Ending them frees some RAM for each client. Your clients keep running; Roblox just can\'t send its own crash reports.', MM.toggle('performance.endCrashHandlers'))}
            ${MM.settingRow('Idle mode', 'While MultiMenu is hidden or minimised, it checks your PC less often and pauses GPU monitoring. Sessions, the watcher and automation keep running.', MM.toggle('performance.idleMode'))}
            ${MM.settingRow('Low-resource mode', 'Disables animations, blur and GPU monitoring; samples less often.', MM.toggle('performance.lowResourceMode'))}
            <div class="setting-row"><div class="txt"><b>Diet mode</b><span>For 8 GB PCs: MultiMenu runs fewer background processes, uses a smaller memory budget, closes its hidden window sooner and drops visual effects. Roblox itself is not affected. Takes effect after a restart.</span><span class="small" id="st-diet" style="display:block;margin-top:4px"></span></div><div class="ctl">${MM.toggle('performance.dietMode')}</div></div>
            <div class="setting-row"><div class="txt"><b>Deep idle</b><span>When MultiMenu has been hidden in the tray this long, close its window completely to free memory. Everything keeps running; the window comes back instantly when you open it. 0 = off.</span><span class="small dim" id="st-mem" style="display:block;margin-top:4px"></span></div><div class="ctl"><input class="input sm" type="number" min="0" max="240" style="width:70px" data-setting="performance.deepIdleMin"><span class="small muted">min</span></div></div>
            ${MM.settingRow('GPU monitoring', 'Reads Windows GPU counters through a background PowerShell process.', MM.toggle('performance.gpuMonitoring'))}
            <div class="form-grid" style="margin-top:10px">
              <div class="field"><label>Sample every (seconds)</label><input class="input" type="number" min="1" max="30" data-setting="performance.monitorIntervalSec"></div>
              <div class="field"><label>Alert when RAM above (%)</label><input class="input" type="number" min="50" max="100" data-setting="performance.alertRamPercent"></div>
              <div class="field"><label>Alert when CPU above (%)</label><input class="input" type="number" min="50" max="100" data-setting="performance.alertCpuPercent"></div>
              <div class="field"><label>…for at least (seconds)</label><input class="input" type="number" min="5" max="600" data-setting="performance.alertSustainSec"></div>
            </div>
          </div>
          <div class="card"><h3>${MM.icon('users')}Accounts & launching</h3>
            <div class="form-grid">
              <div class="field"><label>Default game (place ID or link)</label><input class="input" data-setting="accounts.defaultPlaceId" placeholder="Used when an account has none"></div>
              <div class="field"><label>Delay between launches (seconds)</label><input class="input" type="number" min="0" max="120" data-setting="accounts.launchDelaySec"></div>
              <div class="field"><label>Launch method</label><select class="input" data-setting="openMulti.launchMethod"><option value="protocol">Automatic: whatever opens Roblox links (recommended)</option><option value="direct">Start RobloxPlayerBeta.exe directly</option><option value="bloxstrap">Through Bloxstrap</option><option value="fishstrap">Through Fishstrap</option></select></div>
            </div>
            ${MM.settingRow('Smart launches', 'After each client starts, wait until your CPU calms down before the next one (instead of a fixed delay). Main accounts launch first.', MM.toggle('launch.smart'))}
            <div class="form-grid"><div class="field"><label>Calm means CPU below (%)</label><input class="input" type="number" min="20" max="100" data-setting="launch.cpuSettle"></div><div class="field"><label>Wait at most (seconds)</label><input class="input" type="number" min="5" max="300" data-setting="launch.maxWaitSec"></div></div>
            ${MM.settingRow('Launch in batches', 'Starts this many accounts, then waits until they\'re all in game and the PC has calmed down before starting the next batch. Easier on the CPU than loading everything at once. 0 = off.', '<input class="input sm" style="width:90px" type="number" min="0" max="50" data-setting="launch.batchSize">')}
            <div class="form-grid"><div class="field"><label>Wait for a batch at most (seconds)</label><input class="input" type="number" min="30" max="900" data-setting="launch.batchWaitSec"></div></div>
            ${MM.settingRow('Join another server if a server link fails', 'When an account can\'t get into the server you picked (full, closing, or it says you\'re already in), it joins a different server of the same game instead.', MM.toggle('launch.hopIfJoinFails'))}
            ${MM.settingRow('Check logins on startup', 'Marks accounts whose login has expired.', MM.toggle('accounts.refreshOnStart'))}
            ${MM.settingRow('Confirm before removing', 'Ask before deleting a saved account.', MM.toggle('accounts.confirmBeforeRemove'))}
            ${MM.settingRow('Enable OpenMulti at startup', 'Takes Roblox\'s single-instance lock when MultiMenu opens.', MM.toggle('openMulti.enabled'))}
            ${MM.settingRow('Label Roblox windows', 'Renames each Roblox window to “Roblox — <label>”. Clients opened outside MultiMenu are named too, once they join a game (read from their Roblox log).', MM.toggle('openMulti.labelWindows'))}
            ${MM.settingRow('Put my own graphics back', 'After an account with its own launch graphics starts, your normal Roblox graphics settings are restored (and again when it closes).', MM.toggle('openMulti.restoreGraphics'))}
            ${MM.settingRow('Lock purchases on roblox.com windows', 'In “Open roblox.com as this account” windows, block spending Robux and the Robux/Premium buy pages. Free items still work.', MM.toggle('browse.lockPurchases'))}
          </div>
          <div class="card"><h3>${MM.icon('shield-check')}Security & privacy</h3>
            <div class="stack">
              <div class="callout ${info.secureStorage ? 'ok' : 'err'}">${MM.icon(info.secureStorage ? 'shield-check' : 'circle-alert')}<div>${info.secureStorage ? 'Encryption active. Logins, saved passwords and webhook URLs are encrypted with Windows DPAPI for your Windows user only.' : 'Encryption is unavailable, so secrets can\'t be saved.'}</div></div>
              <div class="small muted">• No telemetry: MultiMenu only contacts Roblox (for your accounts), GitHub (update checks) and the Discord webhooks you add.<br>• Encrypted backups use a password you choose (scrypt + AES-256-GCM) so they can move between PCs.<br>• Cookies are never displayed, logged or exported. Logs are scrubbed automatically.<br>• Imported files are size-limited and validated before use.<br>• Background processes are listed openly: the GPU counter reader (PowerShell), the audio-mute helper (PowerShell, only when muting is on) and PresentMon when FPS monitoring is on.</div>
              ${info.portable ? `<div class="callout warn">${MM.icon('triangle-alert')}<div>Portable build: encrypted logins only work for the Windows user who saved them. Moving the folder to another PC means logging in again.</div></div>` : ''}
            </div>
          </div>
          <div class="card"><h3>${MM.icon('coffee')}Playtime reminders<span class="right">${MM.toggle('playtime.enabled')}<b style="margin-left:6px">On</b></span></h3>
            <p class="sub">A friendly nudge when an account has been on for a while. Sessions with the 24/7 Watcher on are treated as unattended and skipped.</p>
            <div class="form-grid"><div class="field"><label>Remind me every (minutes)</label><input class="input" type="number" min="15" max="1440" data-setting="playtime.remindMin"></div></div>
            ${MM.settingRow('Close the session at the limit', 'Instead of reminding, close the client when the time is up.', MM.toggle('playtime.closeAtLimit'))}
          </div>
          <div class="card spanall" id="lc-card"><h3>${MM.icon('scroll-text')}Roblox log cleaner<span class="right">${MM.toggle('robloxLogs.clean')}<b style="margin-left:6px">On</b></span></h3>
            <p class="sub">Roblox writes a log file for every client and never deletes them. Once an hour, delete old ones. Logs of running clients are never touched.</p>
            <div class="row" style="gap:12px"><span class="small muted">Delete logs older than</span><input class="input sm" type="number" min="1" max="720" style="width:70px" data-setting="robloxLogs.maxAgeHours"><span class="small muted">hours, and keep the folder under</span><input class="input sm" type="number" min="5" max="5000" style="width:80px" data-setting="robloxLogs.maxTotalMB"><span class="small muted">MB</span>
              <span class="spacer"></span><span class="small dim" id="lc-info"></span><button class="btn sm" data-act="cleanLogs">${MM.icon('trash-2', 14)}Clean now</button></div>
          </div>
          <div class="card spanall" id="ab-card"><h3>${MM.icon('archive')}Automatic backups<span class="right">${MM.toggle('autoBackup.enabled')}<b style="margin-left:6px">On</b></span></h3>
            <p class="sub">Every day, an encrypted backup of your accounts, presets, games and webhooks goes into a folder you choose — pick your OneDrive or Google Drive folder and it's off-site too.</p>
            <div id="ab-body"></div></div>
          <div class="card spanall" id="ph-card"><h3>${MM.icon('smartphone')}Phone dashboard<span class="right" id="ph-toggle"></span></h3>
            <p class="sub">Check on your alts from your phone's browser on the same Wi-Fi — see who's in game, rejoin or close an account and start a preset. Nothing to install on the phone. Only devices on your home network can reach it, and they need your PIN.</p>
            <div id="ph-body"></div>
          </div>
          <div class="card" id="ov-card"><h3>${MM.icon('id-card')}Name labels on Roblox windows<span class="right">${MM.toggle('overlay.enabled')}<b style="margin-left:6px">On</b></span></h3>
            <p class="sub">A small tag on each Roblox window with its name and hotkey slot. Clicks go straight through it, and it hides when another app is in front.</p>
            <div class="row" style="gap:14px;margin-bottom:10px"><label class="check-lbl small"><input type="checkbox" data-setting="overlay.fps"> FPS</label><label class="check-lbl small"><input type="checkbox" data-setting="overlay.ping"> Ping</label><label class="check-lbl small"><input type="checkbox" data-setting="overlay.uptime"> Time running</label><label class="check-lbl small"><input type="checkbox" data-setting="overlay.mem"> Memory</label></div>
            <div class="form-grid"><div class="field"><label>Corner</label><select class="input" data-setting="overlay.position"><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option></select></div>
              <div class="field"><label>Size (%)</label><input class="input" type="number" min="70" max="200" step="10" data-setting="overlay.scale"></div></div>
            <p class="hint">FPS needs PresentMon (Performance → FPS Centre).</p>
          </div>
          <div class="card spanall" id="api-card"><h3>${MM.icon('command')}Local API & command line</h3>
            <p class="sub">Control MultiMenu from scripts, a Stream Deck or the command line. Only programs on this PC can use it.</p>
            <div id="api-body"></div>
          </div>
          <div class="card spanall"><h3>${MM.icon('hard-drive')}Data & about</h3>
            <div class="row" style="gap:24px">
              <div><div class="small muted">Version</div><b data-admin-tap>v${MM.esc(info.version)} · ${info.portable ? 'Portable' : 'Installed'} · Electron ${MM.esc(info.electron)}</b></div>
              <div style="min-width:0"><div class="small muted">Data folder</div><b class="mono">${MM.esc(info.dataDir)}</b></div>
              <span class="spacer"></span>
              <button class="btn" data-act="wizard">${MM.icon('wand-sparkles')}Setup wizard</button>
              <button class="btn" data-act="tips">${MM.icon('lightbulb')}Show page tips again</button>
              <button class="btn" data-act="safeMode">${MM.icon('life-buoy')}Restart in safe mode</button>
              <button class="btn" data-act="data">${MM.icon('folder-open')}Open data folder</button>
              <button class="btn" data-act="logs">${MM.icon('list')}Open logs</button>
              <button class="btn danger" data-act="reset">${MM.icon('refresh-cw')}Reset settings</button>
            </div>
          </div>
        </div>`;
      MM.bindSettings(root);
      MM.$('#ap-hc', root).onchange = (e) => MM.setSetting('appearance.contrast', e.target.checked ? 'high' : 'normal');
      const tsLabel = () => { MM.$('#ap-ts-v', root).textContent = `${MM.$('#ap-ts', root).value}%`; };
      MM.$('#ap-ts', root).addEventListener('input', tsLabel); tsLabel();
      const lcInfo = (s) => { const el = MM.$('#lc-info', root); if (s && el) el.textContent = s.totalMB != null ? `${s.files} files · ${MM.fmt.mb(s.totalMB)} now` : 'Roblox logs folder not found'; };
      MM.call('logcleaner:status').then(lcInfo);
      MM.call('app:metrics').then(m => { const el = MM.$('#st-mem', root); if (m && el) el.textContent = `MultiMenu is using ${m.totalMB} MB right now (${m.rendererMB} MB of it is this window).`; });
      MM.$('[data-setting="appearance.accentHue"]', root).addEventListener('input', (e) => document.documentElement.style.setProperty('--hue', e.target.value));

      const renderAb = (s) => {
        if (!s) return;
        MM.$('#ab-body', root).innerHTML = `<div class="grid g3">
          <div class="field"><label>Folder</label><div class="row nowrap"><input class="input" readonly value="${MM.esc(s.config.folder || '')}" placeholder="Not chosen"><button class="btn" data-act="abFolder">${MM.icon('folder-open', 14)}Choose</button></div></div>
          <div class="field"><label>Backup password ${s.hasPassword ? '<span class="badge ok" style="margin-left:6px">set</span>' : ''}</label><div class="row nowrap"><input class="input" type="password" id="ab-pw" placeholder="${s.hasPassword ? 'Change password…' : '8+ characters'}" autocomplete="new-password"><button class="btn" data-act="abPw">${MM.icon('lock', 14)}Save</button></div></div>
          <div class="form-grid" style="grid-template-columns:1fr 1fr"><div class="field"><label>Time</label><input class="input" type="time" data-setting="autoBackup.time"></div><div class="field"><label>Keep newest</label><input class="input" type="number" min="1" max="60" data-setting="autoBackup.keep"></div></div>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn" data-act="abNow">${MM.icon('save', 14)}Back up now</button><button class="btn ghost" data-act="abOpen" ${s.config.folder ? '' : 'disabled'}>${MM.icon('folder-open', 14)}Open folder</button>
          <span class="small muted">${s.lastRun ? `Last backup ${MM.fmt.ago(s.lastRun)} · ${MM.esc(s.lastFile || '')}` : 'No automatic backup yet.'} · ${s.files.length} in folder</span>
          ${s.lastError ? `<span class="badge err">${MM.esc(s.lastError)}</span>` : ''}</div>
        <p class="hint" style="margin-top:8px">Restore any of these from Accounts → Restore with the same password. The password is stored encrypted on this PC so backups can run on their own — don't forget it, it can't be recovered.</p>`;
        MM.bindSettings(MM.$('#ab-body', root));
      };
      MM.call('autobackup:status').then(renderAb);

      // ---------- diet mode ----------
      const renderDiet = async () => {
        const m = await MM.call('app:mode'); const el = MM.$('#st-diet', root);
        if (!m || !el) return;
        const want = MM.getSetting('performance.dietMode');
        el.innerHTML = want !== m.diet ? `<span style="color:var(--warn)">${MM.esc(MM.t(want ? 'Restart MultiMenu to switch diet mode on.' : 'Restart MultiMenu to switch diet mode off.'))}</span> <button class="btn sm" data-act="restartNow">${MM.icon('refresh-cw', 13)}Restart now</button>` : m.diet ? `<span style="color:var(--ok)">${MM.esc(MM.t('Diet mode is on.'))}</span>` : '';
      };
      renderDiet();

      // ---------- phone dashboard ----------
      let ph = null, shownPin = null, phPick = '', phCheck = null;
      const renderPhone = async (st) => {
        ph = st && (!phPick || st.qrUrl === phPick || !st.urls.includes(phPick)) ? st : await MM.call('phone:status', phPick);
        if (!ph) return;
        MM.$('#ph-toggle', root).innerHTML = `<label class="toggle"><input type="checkbox" id="ph-on" ${ph.enabled ? 'checked' : ''} ${ph.hasPin ? '' : 'disabled'}><span class="sw"></span></label><b style="margin-left:6px">On</b>`;
        MM.$('#ph-on', root).onchange = async (e) => { const r = await MM.call('phone:enable', e.target.checked); if (r) { MM.state.settings.phone.enabled = r.enabled; renderPhone(r); if (r.running) MM.toast('success', 'Phone dashboard is on', 'If Windows asks, allow MultiMenu on private networks.'); } else e.target.checked = false; };
        const urls = ph.urls.length ? ph.urls : [];
        MM.$('#ph-body', root).innerHTML = `<div class="ph-wrap">
          <div class="ph-qr">${ph.running && ph.qr ? ph.qr : `<div class="ph-qr-off">${MM.icon('smartphone', 34)}<span>${MM.esc(MM.t(ph.hasPin ? 'Turn it on to get the QR code' : 'Set a PIN first'))}</span></div>`}</div>
          <div class="stack" style="flex:1;min-width:0">
            <div class="field"><label>1. PIN ${ph.hasPin ? '<span class="badge ok" style="margin-left:6px">set</span>' : ''}</label>
              <div class="row nowrap"><input class="input mono" id="ph-pin" inputmode="numeric" maxlength="6" placeholder="${ph.hasPin ? 'Type a new 6-digit PIN to change it' : '6 digits'}" autocomplete="off" style="max-width:260px"><button class="btn" data-act="phSetPin">${MM.icon('lock', 14)}Save PIN</button><button class="btn ghost" data-act="phNewPin">${MM.icon('dices', 14)}Make one for me</button></div>
              ${shownPin ? `<div class="callout ok" style="margin-top:8px">${MM.icon('key-round')}<div><div>Your new PIN:</div><b class="mono" data-nt style="font-size:18px;letter-spacing:.2em">${MM.esc(shownPin)}</b><div class="small">Write it down. MultiMenu only stores a scrambled copy and can't show it again.</div></div></div>` : ''}</div>
            <div class="field"><label>2. On your phone, scan the QR code or open</label>
              ${urls.length ? urls.slice(0, 5).map((u, i) => `<div class="row nowrap ph-addr ${u === ph.qrUrl ? 'on' : ''}"><b class="mono ph-url" data-nt>${MM.esc(u)}</b><span class="small muted ph-net"><span data-nt>${MM.esc(ph.networks?.[i] || '')}</span>${ph.virtual?.[i] ? ` · ${MM.esc(MM.t('VPN or virtual'))}` : ''}</span><span class="spacer"></span>${urls.length > 1 ? `<button class="btn sm ${u === ph.qrUrl ? '' : 'ghost'}" data-act="phPick" data-url="${MM.esc(u)}" title="Show this address as the QR code" ${u === ph.qrUrl ? 'disabled' : ''}>${MM.icon('qr-code', 13)}QR</button>` : ''}<button class="btn sm icon" data-act="phCopy" data-url="${MM.esc(u)}" title="Copy">${MM.icon('copy', 13)}</button></div>`).join('') : `<div class="small muted">No home network found. Connect this PC to Wi-Fi or Ethernet.</div>`}
              ${urls.length > 1 ? `<div class="small muted" style="margin-top:4px">Use the address on the same Wi-Fi as your phone (usually Wi-Fi or Ethernet, not a VPN).</div>` : ''}
              ${ph.error ? `<div class="badge err" style="margin-top:6px">${MM.esc(ph.error)}</div>` : ''}</div>
            <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
              <div class="field"><label>Port</label><input class="input" type="number" min="1024" max="65535" data-setting="phone.port"></div>
            </div>
            ${MM.settingRow('Allow control from the phone', 'Off = the phone can only look. On = it can also rejoin, close, tile and start presets.', MM.toggle('phone.allowControl'))}
            ${MM.settingRow('Live pictures of each alt', 'The phone shows a small picture of every running alt, refreshed every 10 seconds.', MM.toggle('phone.thumbs'))}
            ${(ph.remembered || []).length ? `<div class="field"><label>Remembered devices</label><div class="list">${ph.remembered.map(d => `<div class="item">${MM.icon('smartphone', 16)}<div class="grow"><div class="title" data-nt>${MM.esc((/iPhone|iPad|Android|Windows|Mac/.exec(d.agent || '') || [MM.t('Phone')])[0])}</div><div class="meta" data-nt>${MM.esc(d.ip)} · ${MM.esc(MM.t('last used'))} ${MM.fmt.ago(d.lastSeen || d.at)}</div></div><button class="btn sm ghost" data-act="phForget" data-dev="${MM.esc(d.id)}">${MM.icon('x', 13)}Forget</button></div>`).join('')}</div></div>` : ''}
            <div class="row"><span class="small muted">${ph.signedIn.length ? `${ph.signedIn.length} ${MM.t(ph.signedIn.length === 1 ? 'device signed in' : 'devices signed in')}: ${ph.signedIn.map(d => MM.esc(d.ip)).join(', ')}` : MM.t('No devices signed in.')}</span><span class="spacer"></span><button class="btn sm danger" data-act="phSignOut" ${ph.signedIn.length || (ph.remembered || []).length ? '' : 'disabled'}>${MM.icon('log-in', 14)}Sign out all devices</button></div>
            <p class="hint">Works on your home Wi-Fi only (not over mobile data). The first time, Windows may ask whether MultiMenu can use the network — allow it on private networks. The connection isn't encrypted, so don't turn this on at school, work or public Wi-Fi.</p>
            <div class="row"><button class="btn sm" data-act="phCheck" ${ph.running ? '' : 'disabled'}>${MM.icon('stethoscope', 14)}Phone can't connect? Check</button></div>
            ${phCheck ? `<div class="ph-check">${phCheck === 'busy' ? `<div class="small muted">${MM.esc(MM.t('Checking…'))}</div>` : phCheck.items.map(it => `<div class="ph-ck ${it.level}">${MM.icon({ ok: 'circle-check', warn: 'triangle-alert', err: 'circle-x', info: 'info' }[it.level] || 'info', 15)}<div class="grow">${MM.esc(MM.t(it.text))}${it.fix ? `<div style="margin-top:6px"><button class="btn sm" data-act="phFix" data-fix="${it.fix}">${MM.icon('external-link', 13)}${MM.esc(MM.t(it.fix === 'network' ? 'Open network settings' : 'Open firewall settings'))}</button></div>` : ''}</div></div>`).join('')}</div>` : ''}
          </div></div>`;
        MM.bindSettings(MM.$('#ph-body', root));
      };
      renderPhone();
      const offPhone = MM.on('phone:update', () => renderPhone());

      // ---------- local API & command line ----------
      let shownKey = null;
      const renderApi = async () => {
        const [st, cli] = await Promise.all([MM.call('api:status'), MM.call('api:cliInfo')]);
        if (!st) return;
        const el = MM.$('#api-body', root);
        el.innerHTML = `<div class="grid g2">
          <div class="stack">
            ${MM.settingRow('Local API', st.running ? `On at http://127.0.0.1:${st.port}` : 'Off', `<label class="toggle"><input type="checkbox" id="api-on" ${st.enabled ? 'checked' : ''}><span class="sw"></span></label>`)}
            <div class="field"><label>API key</label><div class="row nowrap"><input class="input mono" readonly value="${shownKey ? MM.esc(shownKey) : st.hasKey ? '••••••••••••••••••••••••' : ''}" placeholder="Turn the API on to make a key" data-nt>
              <button class="btn sm" data-act="apiCopy" ${st.hasKey ? '' : 'disabled'}>${MM.icon('copy', 14)}Copy key</button><button class="btn sm ghost" data-act="apiShow" ${st.hasKey ? '' : 'disabled'}>${MM.icon('eye', 14)}Show</button><button class="btn sm ghost" data-act="apiNew">${MM.icon('refresh-cw', 14)}New key</button></div></div>
            <div class="form-grid"><div class="field"><label>Port</label><input class="input" type="number" min="1024" max="65535" data-setting="api.port"></div></div>
            ${st.error ? `<div class="badge err">${MM.esc(st.error)}</div>` : ''}
            <p class="hint"><span class="mono" data-nt>Authorization: Bearer &lt;key&gt; → http://127.0.0.1:${st.port}/api/v1/&lt;command&gt;</span><br><span>${MM.esc(MM.t('Send the key with every request. GET /api/v1/help lists the commands.'))}</span> ${st.calls.count ? `<span>${MM.esc(MM.t('{0} calls since MultiMenu started.').replace('{0}', st.calls.count))}</span>` : ''}</p>
          </div>
          <div class="stack">
            ${MM.settingRow('Command line', 'Type mm status, mm launch tag:farm or mm help in a terminal.', MM.toggle('api.cli'))}
            ${cli ? `<div class="field"><label>Command-line helper</label><div class="row nowrap"><input class="input mono" readonly value="${MM.esc(cli.mm)}" data-nt><button class="btn sm" data-act="cliCopy">${MM.icon('copy', 14)}Copy</button><button class="btn sm ghost" data-act="cliFolder">${MM.icon('folder-open', 14)}Open folder</button></div>${cli.exists ? '' : '<div class="small muted">mm.cmd comes with the installed and portable builds.</div>'}</div>` : ''}
            <div class="setting-row"><div class="txt"><b>Stream Deck plugin</b><span>Buttons for launching alts, presets, switching windows, the watcher and eco mode. Needs the local API on.</span></div><div class="ctl"><button class="btn sm" data-act="sdInstall">${MM.icon('download', 14)}Install</button></div></div>
          </div></div>`;
        MM.bindSettings(el);
        MM.$('#api-on', el).onchange = async (e) => { const r = await MM.call('api:enable', e.target.checked); if (r) { MM.state.settings.api.enabled = r.enabled; renderApi(); } else e.target.checked = !e.target.checked; };
      };
      renderApi();
      const offApi = MM.on('api:update', () => renderApi());
      MM.delegate(root, {
        abFolder: async () => { const s = await MM.call('autobackup:pickFolder'); if (s) { MM.state.settings.autoBackup.folder = s.config.folder; renderAb(s); } },
        abPw: async () => { const v = MM.$('#ab-pw', root).value; const s = await MM.call('autobackup:setPassword', v); if (s) { MM.toast('success', 'Backup password saved'); renderAb(s); } },
        abNow: async (b) => { const r = await MM.busy(b, () => MM.call('autobackup:run')); if (r) { MM.toast('success', 'Backup saved', `${r.count} accounts → ${r.file}`); renderAb(await MM.call('autobackup:status')); } },
        abOpen: () => MM.call('autobackup:openFolder'),
      });
      MM.delegate(root, {
        studio: () => MM.go('theme'),
        leanAll: async (b) => {
          const all = await MM.busy(b, () => MM.call('lean:lightest'));
          if (!all) return;
          MM.state.settings = all; MM.applyAppearance(); MM.go('settings');
          MM.toast('success', 'Using the least CPU and RAM', 'Background checks slowed, effects off, page updates paused while hidden.');
        },
        leanTrim: async (b) => {
          const r = await MM.busy(b, () => MM.call('lean:trimSelf'));
          if (r) MM.$('#lean-freed', root).textContent = MM.t('Freed {0} MB just now').replace('{0}', r.freedMB);
        },
        language: () => MM.pickLanguage(),
        cleanLogs: async (b) => { const s = await MM.busy(b, () => MM.call('logcleaner:run')); lcInfo(s); if (s) MM.toast('success', 'Roblox logs cleaned', s.lastDeleted ? `Deleted ${s.lastDeleted} file${s.lastDeleted === 1 ? '' : 's'} (${MM.fmt.mb(s.lastFreedMB)}).` : 'Nothing old enough to delete.'); },
        export: async () => { const p = await MM.call('settings:export'); if (p) MM.toast('success', 'Configuration exported', 'Accounts, cookies and webhooks are not included.'); },
        import: async () => { const s = await MM.call('settings:import'); if (s) { MM.state.settings = s; MM.applyAppearance(); MM.go('settings'); MM.toast('success', 'Configuration imported'); } },
        reset: async () => { if (await MM.confirm('Reset all settings?', 'Accounts, macros and webhooks are kept. Only preferences go back to defaults.', { danger: true, ok: 'Reset' })) { MM.state.settings = await MM.call('settings:reset'); MM.applyAppearance(); MM.go('settings'); } },
        data: () => MM.call('app:openDataDir'),
        wizard: () => MM.runWizard(),
        tips: async () => { await MM.setSetting('tour.seen', []); await MM.setSetting('tour.enabled', true); MM.toast('info', 'Page tips are back', 'Open any page to see its tips.'); MM.tour?.maybe('settings', true); },
        safeMode: async () => { if (await MM.confirm('Restart in safe mode?', 'MultiMenu restarts with the watcher, schedules, hotkeys, trimmer, limiter, phone dashboard and other background features off. Your settings are not changed. Restart normally to get everything back.', { ok: 'Restart in safe mode' })) MM.call('app:restartSafe'); },
        restartNow: () => MM.call('app:restartNormal'),
        phSetPin: async () => { const v = MM.$('#ph-pin', root).value.trim(); const r = await MM.call('phone:setPin', v); if (r) { shownPin = v; MM.toast('success', 'PIN saved', 'Phones that were signed in need the new PIN.'); renderPhone(r); } },
        phNewPin: async () => { if (ph?.hasPin && !await MM.confirm('Make a new PIN?', 'Phones that are signed in are signed out.', { ok: 'New PIN' })) return; const r = await MM.call('phone:newPin'); if (r) { shownPin = r.pin; renderPhone(); } },
        phCopy: (b) => { navigator.clipboard.writeText(b.dataset.url); MM.toast('success', 'Address copied'); },
        apiCopy: async () => { const k = await MM.call('api:key'); if (k) { await navigator.clipboard.writeText(k); MM.toast('success', 'API key copied', 'Paste it into your script or the Stream Deck plugin.'); } },
        apiShow: async () => { shownKey = shownKey ? null : await MM.call('api:key'); renderApi(); },
        apiNew: async () => { if (!await MM.confirm('Make a new API key?', 'Scripts and the Stream Deck plugin need the new key afterwards.', { ok: 'New key' })) return; shownKey = await MM.call('api:newKey'); renderApi(); },
        cliCopy: async () => { const c = await MM.call('api:cliInfo'); if (c) { await navigator.clipboard.writeText(`"${c.mm}" status`); MM.toast('success', 'Command copied', 'Paste it into a terminal.'); } },
        cliFolder: () => MM.call('api:openFolder'),
        sdInstall: async () => { const r = await MM.call('streamdeck:install'); if (r) MM.toast('success', 'Opening the Stream Deck plugin', 'The Stream Deck app asks you to install it. Then paste your API key into any MultiMenu button.', 8000); },
        phForget: async (b) => { const r = await MM.call('phone:forget', b.dataset.dev); if (r) renderPhone(r); },
        phPick: async (b) => { phPick = b.dataset.url; phCheck = null; renderPhone(await MM.call('phone:status', phPick)); },
        phCheck: async () => { phCheck = 'busy'; renderPhone(ph); const r = await MM.call('phone:check', (ph?.qrUrl || '').replace(/^http:\/\/|:\d+$/g, '')); phCheck = r || null; renderPhone(); },
        phFix: (b) => MM.call('phone:openFix', b.dataset.fix),
        phSignOut: async () => { if (!await MM.confirm('Sign out every device?', 'Every phone needs the PIN again.', { danger: true, ok: 'Sign out all' })) return; await MM.call('phone:signOutAll'); MM.toast('info', 'All devices signed out'); renderPhone(); },
        logs: () => MM.call('app:openLogs'),
      });

      // ---------- settings search ----------
      const q = MM.$('#set-q', root);
      const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const textOf = (el) => `${el.textContent} ${MM.$$('input[placeholder]', el).map(i => i.placeholder).join(' ')}`;
      const others = document.createElement('div');
      others.className = 'card hidden'; others.id = 'set-others';
      MM.$('#set-none', root).after(others);
      const filter = () => {
        const v = norm(q.value.trim());
        let cardsShown = 0, hits = 0;
        for (const c of MM.$$('#set-grid > .card', root)) {
          const headHit = !!v && norm(c.querySelector('h3')?.textContent).includes(v);
          const items = MM.$$('.setting-row, .field', c).filter(el => !el.parentElement.closest('.setting-row, .field'));
          let any = false;
          for (const el of items) {
            const hit = !v || headHit || norm(textOf(el)).includes(v);
            el.classList.toggle('sr-hide', !hit);
            el.classList.toggle('sr-hit', !!v && hit && !headHit);
            if (hit) { any = true; if (v && !headHit) hits++; }
          }
          const show = !v || headHit || any || (!items.length && norm(textOf(c)).includes(v));
          c.classList.toggle('hidden', !show);
          c.classList.toggle('sr-card', !!v && show);
          if (show) cardsShown++;
        }
        // settings that live on other pages
        const words = v.split(/\s+/).filter(Boolean);
        const elsewhere = v ? (MM.SETTINGS_INDEX || []).filter(([, label, keys, page]) => page !== 'settings' && words.every(w => norm(`${MM.t(label)} ${label} ${keys}`).includes(w))) : [];
        others.classList.toggle('hidden', !elsewhere.length);
        others.innerHTML = elsewhere.length ? `<h3>${MM.icon('compass')}On other pages</h3><div class="list">${elsewhere.map(([, label, , page]) => `<div class="item hover" data-act="goPage" data-page="${MM.esc(page)}"><div class="grow"><div class="title">${MM.esc(label)}</div></div>${MM.icon('chevrons-right', 14)}</div>`).join('')}</div>` : '';
        MM.$('#set-none', root).classList.toggle('hidden', !v || cardsShown > 0 || elsewhere.length > 0);
        MM.$('#set-count', root).textContent = v ? (hits ? `${hits} ${MM.t(hits === 1 ? 'match' : 'matches')}` : '') : '';
      };
      q.addEventListener('input', filter);
      q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { q.value = ''; filter(); } });
      others.addEventListener('click', (e) => { const it = e.target.closest('[data-page]'); if (it) MM.go(it.dataset.page); });
      const onKey = (e) => { if ((e.ctrlKey && e.key.toLowerCase() === 'f') || (e.key === '/' && !e.target.closest('input,textarea,select'))) { e.preventDefault(); q.focus(); q.select(); } };
      document.addEventListener('keydown', onKey);
      const onSet = (e) => { if (e.detail.key === 'performance.dietMode') renderDiet(); };
      document.addEventListener('mm:setting', onSet);
      return () => { offPhone(); offApi(); document.removeEventListener('keydown', onKey); document.removeEventListener('mm:setting', onSet); };
    },
  };
})();