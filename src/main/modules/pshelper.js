'use strict';
// PowerShell helper scripts (text recognition, spoken alerts) are written as plain .ps1
// files to MultiMenu's own data folder, where you can read them, and run from there.
const fs = require('fs');
const path = require('path');
const paths = require('../paths');

/** Writes the script to <data>/helpers/<name>.ps1 (only when it changed) and returns the path. */
function scriptFile(name, script) {
  const dir = path.join(paths.dataDir, 'helpers');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.ps1`);
  const text = `\uFEFF${script}`;
  let same = false;
  try { same = fs.readFileSync(file, 'utf8') === text; } catch { /* not written yet */ }
  if (!same) fs.writeFileSync(file, text, 'utf8');
  return file;
}

module.exports = { scriptFile };
