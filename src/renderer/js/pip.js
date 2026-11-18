// Picture-in-picture window: a live view of one Roblox client.
// The stream comes from Windows' window capture via the main process and is
// only shown here; nothing is recorded or saved.
(function () {
  const MM = window.MM;
  const video = MM.$('#p-video'), msg = MM.$('#p-msg'), pick = MM.$('#p-pick');
  let stream = null, info = null, starting = false;

  MM.$('#p-focus').innerHTML = MM.icon('external-link', 14);
  MM.$('#p-close').innerHTML = MM.icon('x', 15);
  MM.$('#p-close').onclick = () => MM.api('pip:close');
  const focusIt = () => MM.api('pip:focusTarget').catch(e => show(e.message));
  MM.$('#p-focus').onclick = focusIt;
  video.addEventListener('click', focusIt);

  const show = (text) => { msg.textContent = text ? MM.t(text) : ''; msg.classList.toggle('on', !!text); };
  const stop = () => { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } video.srcObject = null; };

  const renderPick = () => {
    if (!info) return;
    pick.innerHTML = info.sessions.map(s => `<option value="${MM.esc(s.id)}" ${s.id === info.target ? 'selected' : ''}>${MM.esc(s.label)}</option>`).join('');
    document.title = info.label ? `PiP — ${info.label}` : 'MultiMenu PiP';
  };

  async function start() {
    if (starting) return;
    starting = true;
    stop();
    try {
      if (!info?.target || !info.sessions.some(s => s.id === info.target)) { show('This session has ended.'); return; }
      show('Connecting…');
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: info.fps, max: info.fps } }, audio: false });
      video.srcObject = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => show('The window closed or was minimised.'));
      show('');
    } catch {
      show('Couldn\'t show this window. Make sure it isn\'t minimised.');
    } finally { starting = false; }
  }

  pick.addEventListener('change', async () => {
    const r = await MM.call('pip:set', pick.value);
    if (r) { info = r; renderPick(); start(); }
  });

  MM.on('pip:target', (r) => { const changed = !info || r.target !== info.target; info = r; renderPick(); if (changed || !stream) start(); });
  MM.on('sessions:changed', async () => {
    const r = await MM.api('pip:info').catch(() => null);
    if (!r) return;
    const gone = !r.sessions.some(s => s.id === r.target);
    info = r; renderPick();
    if (gone) { stop(); show('This session has ended.'); }
  });

  (async () => {
    await window.MMI18NReady;
    info = await MM.api('pip:info');
    renderPick();
    start();
  })();
})();
