'use strict';

// Makes the working copy of the app use one brand: writes src/brand.json, src/renderer/brand.css,
// src/renderer/index.html, assets/logo.svg + icons and build/installer.nsh from brands/<id>/.
// All of those are generated and git-ignored. Run by `npm start` and `npm test` automatically.
//
//   node scripts/apply-brand.js            (the BRAND environment variable, or okv)
//   node scripts/apply-brand.js noordhoek

const { applyBrand, DEFAULT_BRAND } = require('./lib/brand');

const id = process.argv[2] || process.env.BRAND || DEFAULT_BRAND;
try {
  const brand = applyBrand(id);
  console.log(`Brand applied: ${brand.productName} (${brand.id})`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
