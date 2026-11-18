// Translates the interface on the fly. Pages are written in English; every text
// node and tooltip that appears is looked up in the chosen language's dictionary
// (see translate.js). Nothing is translated when the language is English.
// The dictionary is fetched once per window; app.js waits for MMI18NReady before
// drawing the first page, so nothing flashes in English.
window.MMT = (s) => s;
window.MMLang = 'en';
window.MMI18NReady = (async () => {
  let info = window.mm && window.mm.i18n; // the UI test harness passes it directly
  if (!info) { try { info = await window.mm.invoke('app:i18n'); } catch { info = null; } }
  setup(info || { lang: 'en', dict: {} });
})();

function setup(info) {
  const t = window.MMTranslate.create(info.dict);
  window.MMT = t;
  window.MMLang = info.lang;
  document.documentElement.lang = info.lang;
  if (info.lang === 'en' || !t.size) return;

  const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'KBD']);
  const done = new WeakMap(); // text node -> the translation we wrote

  const skipEl = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (SKIP.has(e.tagName) || e.isContentEditable || (e.dataset && 'nt' in e.dataset)) return true;
    }
    return false;
  };

  function textNode(n) {
    const v = n.data;
    if (done.get(n) === v || !/[A-Za-z]/.test(v)) return;
    if (skipEl(n.parentElement)) return;
    const out = t(v);
    done.set(n, out);
    if (out !== v) n.data = out;
  }
  function attrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v || el[`__mm_${a}`] === v) continue;
      const out = t(v);
      el[`__mm_${a}`] = out;
      if (out !== v) el.setAttribute(a, out);
    }
  }
  function walk(rootNode) {
    if (rootNode.nodeType === 3) return textNode(rootNode);
    if (rootNode.nodeType !== 1 || SKIP.has(rootNode.tagName)) return;
    attrs(rootNode);
    const w = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === 3) textNode(n); else attrs(n);
    }
  }

  const obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(walk);
      else if (m.type === 'characterData') textNode(m.target);
      else if (m.type === 'attributes') attrs(m.target);
    }
  });
  walk(document.body);
  document.title = t(document.title);
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
