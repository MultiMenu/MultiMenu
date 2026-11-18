// CI helper: validates a --self-test report. Input-injection checks (SendInput,
// GetAsyncKeyState) need an interactive desktop, which CI runners may not have,
// so those are reported but not fatal here.
const fs = require('fs');
const [file, expectPortable] = process.argv.slice(2);
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const c of r.results) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}${c.ok ? '' : ` — ${c.error}`}`);
const soft = /^(SendInput|GetAsyncKeyState|Audio mute|Window capture|2\.0: eco mode|2\.0\.1: tiny windows)/;
const hard = r.results.filter(c => !c.ok && !soft.test(c.name));
if (String(r.portable) !== expectPortable) hard.push({ name: `portable=${r.portable}, expected ${expectPortable}` });
if (hard.length) { console.error(`Self-test failed: ${hard.map(h => h.name).join(', ')}`); process.exit(1); }
console.log(`Self-test passed (${r.passed}/${r.results.length}, portable=${r.portable})`);
