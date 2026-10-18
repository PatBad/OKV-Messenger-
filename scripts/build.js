'use strict';

// Builds the Windows installer for one brand, several, or all of them. Each brand's files go to
// dist/<id>/. Also writes dist/brands.json (what install.ps1 reads to find each installer) and
// dist/release-files.txt (the files to publish with a release).
//
//   node scripts/build.js              all brands
//   node scripts/build.js okv          just one
//   node scripts/build.js okv noordhoek

const fs = require('fs');
const path = require('path');
const { build, Platform } = require('electron-builder');
const brandLib = require('./lib/brand');

async function main() {
  const wanted = process.argv.slice(2);
  const ids = wanted.length ? wanted : brandLib.listBrands();
  const clashes = brandLib.validateAllBrands(brandLib.listBrands());
  if (clashes.length) throw new Error(`Brands clash with each other:\n  - ${clashes.join('\n  - ')}`);

  const version = require('../package.json').version;
  const dist = path.join(brandLib.ROOT, 'dist');
  const files = [];
  const manifestItems = [];

  for (const id of ids) {
    const brand = brandLib.applyBrand(id);
    console.log(`\n=== Building ${brand.productName} ${version} ===`);
    await build({ targets: Platform.WINDOWS.createTarget(), config: brandLib.builderConfig(id), publish: 'never' });

    const out = path.join('dist', id);
    const expected = [brandLib.installerFileName(brand, version), `${brandLib.installerFileName(brand, version)}.blockmap`, brandLib.updateFileName(brand)];
    for (const name of expected) {
      if (!fs.existsSync(path.join(brandLib.ROOT, out, name))) throw new Error(`Expected ${out}/${name} but it was not built`);
      files.push(`${out}/${name}`.replace(/\\/g, '/'));
    }
    manifestItems.push({
      brand,
      sha512: brandLib.parseSha512(fs.readFileSync(path.join(brandLib.ROOT, out, brandLib.updateFileName(brand)), 'utf8')),
      size: fs.statSync(path.join(brandLib.ROOT, out, brandLib.installerFileName(brand, version))).size,
    });
  }

  fs.writeFileSync(path.join(dist, 'brands.json'), `${JSON.stringify(brandLib.releaseManifest(version, manifestItems), null, 2)}\n`);
  files.push('dist/brands.json');
  fs.writeFileSync(path.join(dist, 'release-files.txt'), `${files.join('\n')}\n`);
  console.log(`\nBuilt ${ids.length} brand(s). Files for the release:\n  ${files.join('\n  ')}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
