// Accessibility and keyboard: screen-reader labels for icon buttons, spoken toasts,
// Ctrl+1–9 to jump between sections, "?" for the shortcut list, and a skip link.
(function () {
  const MM = window.MM;

  // Icon-only buttons get their tooltip as a label (it follows translation too).
  const label = (el) => {
    if (!el.title || el.getAttribute('aria-label') === el.title) return;
    if (!el.textContent.trim() || el.dataset.ariaFromTitle) { el.setAttribute('aria-label', el.title); el.dataset.ariaFromTitle = '1'; }
  };
  const scan = (root) => {
    if (root.nodeType !== 1) return;
    if (root.matches('button[title], [role="button"][title], a[title]')) label(root);
    root.querySelectorAll('button[title], [role="button"][title], a[title]').forEach(label);
  };
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'attributes') label(m.target);
      else m.addedNodes.forEach(scan);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });

  // Toasts are read out; errors interrupt.
  const toasts = document.getElementById('toasts');
  if (toasts) { toasts.setAttribute('role', 'status'); toasts.setAttribute('aria-live', 'polite'); }
  const baseToast = MM.toast;
  MM.toast = (level, ...rest) => {
    baseToast(level, ...rest);
    if (level === 'error') toasts?.lastElementChild?.setAttribute('role', 'alert');
  };

  const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const sections = () => (MM.NAV || []).filter(n => n !== '-');

  MM.showShortcuts = () => {
    if (document.querySelector('.keys-help')) return;
    const hk = MM.state?.settings?.hotkeys || {};
    const row = (k, text) => `<div><span>${MM.esc(MM.t(text))}</span><span>${k.split('+').map(x => `<kbd>${MM.esc(x)}</kbd>`).join('+')}</span></div>`;
    const ak = MM.state?.settings?.altKeys;
    MM.modal({
      title: 'Keyboard shortcuts', icon: 'keyboard', wide: true,
      body: `<div class="keys-help">
        <div class="grp">${MM.esc(MM.t('In MultiMenu'))}</div>
        ${row('Ctrl+K', 'Search everything')}${row('?', 'This list')}${row('Esc', 'Close a window or menu')}${row('Tab', 'Move between buttons')}
        ${sections().slice(0, 9).map((s, i) => row(`Ctrl+${i + 1}`, s.label)).join('')}
        <div class="grp">${MM.esc(MM.t('Anywhere, even in Roblox'))}</div>
        ${(MM.HOTKEY_LABELS || []).filter(([k]) => hk[k]).map(([k, text]) => row(hk[k], text)).join('')}
        ${ak?.enabled ? row(`${ak.modifier}+1–9`, 'Jump to the alt in that slot') : ''}
      </div><p class="hint" style="margin-top:12px">${MM.esc(MM.t('Change the “anywhere” keys in Settings → Hotkeys.'))}</p>`,
    });
  };

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    // Ctrl+1–9: sections in the order of the sidebar.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
      const s = sections()[Number(e.key) - 1];
      if (s && !document.querySelector('.modal-back')) { e.preventDefault(); MM.go(s.id); setTimeout(() => document.getElementById('main')?.focus({ preventScroll: true }), 60); }
      return;
    }
    if (e.key === '?' && !e.ctrlKey && !e.altKey && !typing(document.activeElement) && !document.querySelector('.modal-back, .palette-back')) {
      e.preventDefault();
      MM.showShortcuts();
    }
  });

  document.getElementById('skip-link')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('main')?.focus(); });
})();
