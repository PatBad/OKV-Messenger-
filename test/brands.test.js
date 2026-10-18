'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const brandLib = require('../scripts/lib/brand');

const okv = () => JSON.parse(JSON.stringify(brandLib.loadBrand('okv')));
const problems = (b) => brandLib.validateBrand(b, b.id);

test('every brand in brands/ is valid', () => {
  const ids = brandLib.listBrands();
  assert.ok(ids.includes('okv'), 'the okv brand must exist');
  for (const id of ids) assert.doesNotThrow(() => brandLib.loadBrand(id), `brand ${id}`);
});

test('brands never clash with each other (install, network id, update file)', () => {
  assert.deepEqual(brandLib.validateAllBrands(), []);
});

test('the okv brand keeps the identity the installed copies already have', () => {
  const b = brandLib.loadBrand('okv');
  assert.equal(b.appId, 'com.okv.messenger');
  assert.equal(b.productName, 'OKV Messenger');
  assert.equal(b.packageName, 'okv-messenger');
  assert.equal(b.network.appId, 'okv-messenger');
  assert.equal(b.network.udpPort, 41234);
  assert.deepEqual(b.network.tcpPorts, [41235, 41236, 41237, 41238, 41239]);
  assert.deepEqual(
    b.departments.map((d) => d.id),
    ['principal', 'clinical', 'reception', 'other'],
  );
  assert.equal(b.update.channel, null);
  assert.equal(brandLib.updateFileName(b), 'latest.yml');
  assert.equal(brandLib.installerFileName(b, '1.2.3'), 'OKV-Messenger-Setup-1.2.3.exe');
});

test('the build configuration for okv matches the previous package.json settings', () => {
  const c = brandLib.builderConfig('okv');
  assert.equal(c.appId, 'com.okv.messenger');
  assert.equal(c.productName, 'OKV Messenger');
  assert.equal(c.win.artifactName, 'OKV-Messenger-Setup-${version}.${ext}');
  assert.equal(c.nsis.shortcutName, 'OKV Messenger');
  assert.deepEqual(c.publish, [{ provider: 'github', owner: 'PatBad', repo: 'OKV-Messenger-', releaseType: 'release' }]);
  assert.deepEqual(c.extraMetadata, {
    name: 'okv-messenger',
    productName: 'OKV Messenger',
    description: 'Always-on-top message board for sharing messages between departments of the clinic.',
    author: 'OKV',
  });
});

test('a brand with another update channel publishes under that channel', () => {
  const b = okv();
  b.id = 'other';
  b.update.channel = 'other';
  assert.equal(brandLib.updateFileName(b), 'other.yml');
});

test('mistakes in a brand file are reported', () => {
  const bad = (change) => {
    const b = okv();
    change(b);
    return problems(b);
  };
  assert.ok(bad((b) => (b.departments[1].id = 'principal')).some((e) => /used twice/.test(e)));
  assert.ok(bad((b) => (b.departments[0].id = 'all')).some((e) => /not "all"/.test(e)));
  assert.ok(bad((b) => (b.departments[0].color = 'purple')).some((e) => /colorDark|color/.test(e)));
  assert.ok(bad((b) => (b.quickMessages[0].to = 'nobody')).some((e) => /unknown department/.test(e)));
  assert.ok(bad((b) => (b.medicationAlertDept = 'nobody')).some((e) => /medicationAlertDept/.test(e)));
  assert.ok(bad((b) => (b.network.tcpPorts = [41235, 41237])).some((e) => /consecutive/.test(e)));
  assert.ok(bad((b) => (b.update.channel = 'latest')).some((e) => /channel/.test(e)));
  assert.ok(bad((b) => (b.productName = 'Bad/Name')).some((e) => /productName/.test(e)));
  assert.ok(bad((b) => delete b.appId).some((e) => /appId/.test(e)));
  assert.ok(brandLib.validateBrand(okv(), 'wrong-folder').some((e) => /folder name/.test(e)));
});

test('two brands that share an app id or update file are rejected', () => {
  const dir = path.join(brandLib.ROOT, 'brands', 'zz-clash-test');
  fs.mkdirSync(dir, { recursive: true });
  try {
    for (const f of ['logo.svg', 'icon.ico', 'icon.png']) fs.copyFileSync(path.join(brandLib.ROOT, 'brands', 'okv', f), path.join(dir, f));
    const b = okv();
    b.id = 'zz-clash-test';
    fs.writeFileSync(path.join(dir, 'brand.json'), JSON.stringify(b));
    const errors = brandLib.validateAllBrands();
    assert.ok(errors.some((e) => /appId/.test(e)));
    assert.ok(errors.some((e) => /network\.appId/.test(e)));
    assert.ok(errors.some((e) => /update file/.test(e)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the generated stylesheet defines a colour and a class for every department', () => {
  const b = okv();
  const css = fs.readFileSync(path.join(brandLib.ROOT, 'src', 'renderer', 'brand.css'), 'utf8');
  if (!css.includes('brands/okv/')) return; // another brand is applied in this working copy
  for (const d of b.departments) {
    assert.ok(css.includes(`--dept-${d.id}: ${d.color};`), `light colour for ${d.id}`);
    assert.ok(css.includes(`--dept-${d.id}: ${d.colorDark};`), `dark colour for ${d.id}`);
    assert.ok(css.includes(`.dept-${d.id} { --dept: var(--dept-${d.id}); }`), `class for ${d.id}`);
  }
});
