'use strict';

// The clinic this copy of the app is built for (name, departments, colours, network id, ...).
// src/brand.json is generated from brands/<id>/brand.json by scripts/apply-brand.js, which
// `npm start`, `npm test` and `npm run dist` run for you.

let brand;
try {
  brand = require('../brand.json');
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
  throw new Error('src/brand.json is missing. Run "npm run brand" (or "node scripts/apply-brand.js okv") first.');
}

module.exports = brand;
