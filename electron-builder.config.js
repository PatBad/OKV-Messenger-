'use strict';

// Used when electron-builder is run directly (e.g. `npx electron-builder --win --dir`). Pick the
// brand with the BRAND environment variable; it defaults to okv. `npm run dist` goes through
// scripts/build.js instead, which does the same for every brand.

const { builderConfig, DEFAULT_BRAND } = require('./scripts/lib/brand');

module.exports = builderConfig(process.env.BRAND || DEFAULT_BRAND);
