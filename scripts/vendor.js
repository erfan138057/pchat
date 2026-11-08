'use strict';

/**
 * Copy the browser libraries and the Persian font from node_modules into
 * public/, so the app runs with no network access and no runtime deps.
 *
 * Usage: npm install && npm run vendor
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function copy(from, to) {
  if (!fs.existsSync(from)) {
    console.error('missing (run "npm install" first):', path.relative(root, from));
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const kb = (fs.statSync(to).size / 1024).toFixed(1);
  console.log('  ' + path.relative(root, to).replace(/\\/g, '/') + '  (' + kb + ' KB)');
}

function firstExisting(candidates) {
  return candidates.find((file) => fs.existsSync(file)) || candidates[0];
}

const nm = (...parts) => path.join(root, 'node_modules', ...parts);

console.log('pchat: updating vendored assets');

copy(nm('marked', 'lib', 'marked.umd.js'), path.join(root, 'public', 'vendor', 'marked.js'));

copy(
  firstExisting([nm('dompurify', 'dist', 'purify.min.js'), nm('dompurify', 'dist', 'purify.js')]),
  path.join(root, 'public', 'vendor', 'purify.js')
);

copy(
  nm('vazirmatn', 'fonts', 'webfonts', 'Vazirmatn-Regular.woff2'),
  path.join(root, 'public', 'fonts', 'Vazirmatn-Regular.woff2')
);

copy(
  nm('vazirmatn', 'fonts', 'webfonts', 'Vazirmatn[wght].woff2'),
  path.join(root, 'public', 'fonts', 'Vazirmatn-Variable.woff2')
);

if (process.exitCode) {
  console.error('pchat: some assets were not copied.');
} else {
  console.log('pchat: done.');
}
