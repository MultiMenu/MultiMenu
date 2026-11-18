// Translation core shared by the main process (require) and the UI (<script>).
// Dictionaries map the English text to the translation. Keys may contain
// placeholders {0}, {1}... for the variable parts, e.g. "{0} accounts running".
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MMTranslate = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const LANGS = [
    { id: 'en', name: 'English', english: 'English' },
    { id: 'es', name: 'Español', english: 'Spanish' },
    { id: 'de', name: 'Deutsch', english: 'German' },
    { id: 'fr', name: 'Français', english: 'French' },
    { id: 'pt', name: 'Português (Brasil)', english: 'Portuguese' },
    { id: 'nb', name: 'Norsk', english: 'Norwegian' },
    { id: 'it', name: 'Italiano', english: 'Italian' },
    { id: 'pl', name: 'Polski', english: 'Polish' },
    { id: 'tr', name: 'Türkçe', english: 'Turkish' },
    { id: 'ru', name: 'Русский', english: 'Russian' },
    { id: 'id', name: 'Bahasa Indonesia', english: 'Indonesian' },
    { id: 'vi', name: 'Tiếng Việt', english: 'Vietnamese' },
    { id: 'fil', name: 'Filipino', english: 'Filipino' },
  ];
  const norm = s => s.replace(/\s+/g, ' ').trim();
  // A placeholder normally holds a number or a name. If what it captured is untranslated
  // English prose, the template matched the wrong sentence.
  const PROSE = /\b(the|this|that|your|you|for|to|of|and|is|are|was|has|have|not|with|from|it|be|can|will|when|only)\b/i;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function create(dict) {
    dict = dict || {};
    const exact = new Map();
    const templates = [];
    for (const [k, v] of Object.entries(dict)) {
      if (typeof v !== 'string' || !v) continue;
      const key = norm(k);
      if (/\{\d\}/.test(key)) {
        const parts = key.split(/\{(\d)\}/);
        let src = '^';
        const order = [];
        parts.forEach((p, i) => { if (i % 2) { src += '(.*?)'; order.push(Number(p)); } else src += esc(p); });
        // A template made only of placeholders and punctuation would match anything.
        const literal = parts.filter((_, i) => i % 2 === 0).join(' ');
        if (!/[A-Za-zÀ-ÿ]{2}/.test(literal)) continue;
        // "{0} of {1}" is open at both ends with one word inside: only trust it with numbers ("9.6 GB of 14.9 GB").
        const loose = !parts[0] && !parts[parts.length - 1] && (literal.match(/[A-Za-z]{2,}/g) || []).length < 2;
        templates.push({ re: new RegExp(`${src}$`, 's'), order, out: v, lead: parts[0], loose });
      } else exact.set(key, v);
    }
    // Longest literal text first, so specific templates win over general ones.
    templates.sort((a, b) => b.re.source.replace(/\(\.\*\?\)/g, '').length - a.re.source.replace(/\(\.\*\?\)/g, '').length);
    const cache = new Map();
    const empty = exact.size === 0 && templates.length === 0;

    const PEEL = /^([•·→←—–|,:;\-\s]+)?([\s\S]*?)([\s·•:,;.…\-—–|]+)?$/;
    function core(text, depth) {
      if (exact.has(text)) return exact.get(text);
      if (depth > 3) return null;
      const r = templ(text, depth);
      if (r != null) return r;
      // Joined messages ("Last used 2h ago · Default game 123", "Error 267: Kicked. Try again."):
      // translate each part on its own.
      for (const sep of [' · ', ' — ', ': ', '. ']) {
        if (!text.includes(sep)) continue;
        const parts = text.split(sep);
        let any = false;
        const outParts = parts.map((p, i) => {
          const dot = sep === '. ' && i < parts.length - 1;
          const x = (dot ? exact.get(`${p}.`) : null) ?? core(p, depth + 1);
          if (x != null) any = true;
          return dot && x != null && x.endsWith('.') ? x.slice(0, -1) : (x ?? p);
        });
        if (any) return outParts.join(sep);
      }
      // Leading/trailing punctuation left over from inline markup: "· Emergency stop", "running ·".
      const m = PEEL.exec(text);
      if (m && (m[1] || m[3]) && m[2] && m[2] !== text) {
        const lead = m[1] || '', rest = text.slice(lead.length);
        if (lead && rest) { const y = exact.get(rest) ?? templ(rest, depth + 1); if (y != null) return lead + y; }
        const x = exact.get(m[2]) ?? templ(m[2], depth + 1);
        if (x != null) return lead + x + (m[3] || '');
      }
      return null;
    }
    function templ(text, depth) {
      if (depth > 3) return null;
      for (const t of templates) {
        if (t.lead && !text.startsWith(t.lead)) continue;
        const m = t.re.exec(text);
        if (!m) continue;
        if (t.loose && m.slice(1).some(g => g && !/\d/.test(g))) continue;
        const vals = [];
        let bad = false;
        t.order.forEach((n, i) => {
          const g = m[i + 1];
          if (!/[A-Za-z]{2}/.test(g)) { vals[n] = g; return; }
          const x = core(norm(g), depth + 1);
          if (x == null && PROSE.test(g)) bad = true;
          vals[n] = x ?? g;
        });
        if (bad) continue;
        return t.out.replace(/\{(\d)\}/g, (_, n) => vals[Number(n)] ?? '');
      }
      return null;
    }

    /** Translate one string; keeps its leading/trailing whitespace. Unknown text comes back unchanged. */
    function t(text) {
      if (empty || typeof text !== 'string' || !/[A-Za-z]/.test(text)) return text;
      const key = norm(text);
      if (!key) return text;
      let out = cache.get(key);
      if (out === undefined) {
        out = core(key, 0);
        if (cache.size > 5000) cache.clear();
        cache.set(key, out);
      }
      if (out == null) return text;
      const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
      return lead + out + trail;
    }
    t.has = (text) => t(text) !== text;
    t.size = exact.size + templates.length;
    return t;
  }

  return { LANGS, create, norm };
}));
