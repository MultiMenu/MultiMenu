// Dev-time script: copies the Lucide icons MultiMenu uses into src/renderer/js/icons.js.
// Usage: node scripts/build-icons.js <path-to-lucide-static/icons>
const fs = require('fs'); const path = require('path');
const dir = process.argv[2];
const names = ['layout-dashboard','users','user-plus','monitor-play','gauge','memory-stick','mouse-pointer-click','bot','webhook','refresh-cw','settings','chevrons-left','chevrons-right','minus','square','x','bell','play','square-stop','pause','circle-stop','plus','trash-2','pencil','star','copy','eye','log-in','cookie','file-up','file-down','dices','key-round','shield-check','cpu','activity','zap','sparkles','rocket','circle-alert','circle-check','info','triangle-alert','download','external-link','clock','folder-open','circle-dot','keyboard','repeat','timer','send','history','search','power','layers','tag','list','gamepad-2','monitor','sliders-horizontal','wand-sparkles','hard-drive','octagon-x','check','user','grip-vertical','tags','moon','circle-help','radar','calendar-clock','server','volume-x','pin','scroll-text','heart-pulse','picture-in-picture-2','archive','lock','gem','coins','chart-column','globe','save','undo-2','ban','crown','route','swords','filter','palette','trophy','wifi','wifi-off','bed','link','mail','signal','id-card','paintbrush','coffee','award','image','flask-conical','flame','compass','bookmark','layout-grid','command','upload','circle-x','mouse-pointer-2'];
const out = {};
for (const n of names) {
  const svg = fs.readFileSync(path.join(dir, `${n}.svg`), 'utf8');
  out[n] = svg.replace(/<!--.*?-->/s, '').match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1].replace(/\s+/g, ' ').trim();
}
const js = `// Icons from Lucide (https://lucide.dev), ISC License, Copyright (c) Lucide Icons and Contributors.
(function () {
  const PATHS = ${JSON.stringify(out)};
  window.MM = window.MM || {};
  MM.icon = function (name, size) {
    const s = size || 18;
    return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (PATHS[name] || '') + '</svg>';
  };
})();
`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'icons.js'), js);
console.log('wrote', Object.keys(out).length, 'icons');
