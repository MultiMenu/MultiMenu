// Overlay labels page. Draws the pills the main process sends; never takes input.
(function () {
  const host = document.getElementById('labels');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.mm.on('overlay:labels', ({ labels, position, scale }) => {
    document.documentElement.style.setProperty('--s', String((scale || 100) / 100));
    host.innerHTML = labels.map(l => `<div class="lbl ${esc(l.state)} ${esc(l.tier || '')}" data-id="${esc(l.id)}">${l.slot ? `<span class="slot">${esc(l.slot)}</span>` : '<span class="dot"></span>'}<span class="name">${esc(l.name)}</span>${l.info ? `<span class="info">${esc(l.info)}</span>` : ''}${l.slot ? '<span class="dot"></span>' : ''}</div>`).join('');
    host.querySelectorAll('.lbl').forEach((el, i) => {
      const r = labels[i].rect, pad = 8;
      const w = el.offsetWidth, h = el.offsetHeight;
      const right = /right/.test(position || ''), bottom = /bottom/.test(position || '');
      el.style.left = `${Math.round(right ? r.x + r.width - w - pad : r.x + pad)}px`;
      el.style.top = `${Math.round(bottom ? r.y + r.height - h - pad : r.y + pad)}px`;
      el.style.maxWidth = `${Math.max(80, r.width - pad * 2)}px`;
    });
  });
})();
