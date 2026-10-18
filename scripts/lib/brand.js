'use strict';

// Everything that makes one clinic's copy of the app different from another's lives in
// brands/<id>/ (a brand.json plus logo.svg, icon.ico, icon.png). This module loads and checks a
// brand, "applies" it (writes the generated files the app reads) and produces the electron-builder
// configuration for it. Used by scripts/apply-brand.js, scripts/build.js and electron-builder.config.js.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BRANDS_DIR = path.join(ROOT, 'brands');
const DEFAULT_BRAND = 'okv';

const HEX = /^#[0-9a-f]{6}$/i;
const SLUG = /^[a-z][a-z0-9-]*$/;

function listBrands() {
  return fs
    .readdirSync(BRANDS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(BRANDS_DIR, d.name, 'brand.json')))
    .map((d) => d.name)
    .sort();
}

/** Returns a list of problems with a brand object (empty when it is fine). */
function validateBrand(b, folderName) {
  const errors = [];
  const need = (cond, msg) => {
    if (!cond) errors.push(msg);
  };
  const str = (v) => typeof v === 'string' && v.trim() !== '';

  need(b && typeof b === 'object', 'brand.json must be an object');
  if (errors.length) return errors;

  need(SLUG.test(b.id || ''), 'id must be lower-case letters, digits and dashes');
  need(b.id === folderName, `id "${b.id}" must match the folder name "${folderName}"`);
  for (const key of ['packageName', 'productName', 'shortName', 'organisation', 'description', 'appId']) {
    need(str(b[key]), `${key} is required`);
  }
  need(/^[A-Za-z0-9 ]+$/.test(b.productName || ''), 'productName may only have letters, digits and spaces (it becomes folder and file names)');
  need(/^[a-z0-9-]+$/.test(b.packageName || ''), 'packageName must be lower-case letters, digits and dashes');
  need(/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9-]*)+$/.test(b.appId || ''), 'appId must look like com.clinic.messenger');

  const n = b.network || {};
  need(/^[a-z0-9-]+$/.test(n.appId || ''), 'network.appId must be lower-case letters, digits and dashes');
  const port = (p) => Number.isInteger(p) && p >= 1024 && p <= 65535;
  need(port(n.udpPort), 'network.udpPort must be a port number');
  need(
    Array.isArray(n.tcpPorts) &&
      n.tcpPorts.length > 0 &&
      n.tcpPorts.every(port) &&
      n.tcpPorts.every((p, i) => i === 0 || p === n.tcpPorts[i - 1] + 1),
    'network.tcpPorts must be a list of consecutive port numbers',
  );

  const u = b.update || {};
  need(str(u.owner) && str(u.repo), 'update.owner and update.repo are required');
  need(u.channel === null || (typeof u.channel === 'string' && SLUG.test(u.channel) && u.channel !== 'latest'), 'update.channel must be null (the default "latest") or a lower-case name');

  for (const mode of ['light', 'dark']) {
    const t = (b.theme || {})[mode] || {};
    for (const key of ['primary', 'primaryHover', 'primarySoft', 'onPrimary']) need(HEX.test(t[key] || ''), `theme.${mode}.${key} must be a colour like #0f766e`);
  }

  const depts = Array.isArray(b.departments) ? b.departments : [];
  need(depts.length >= 2, 'at least two departments are needed');
  const ids = new Set();
  for (const d of depts) {
    need(d && SLUG.test(d.id || '') && d.id !== 'all', `department id "${d && d.id}" must be lower-case letters, digits and dashes, and not "all"`);
    need(d && !ids.has(d.id), `department id "${d && d.id}" is used twice`);
    if (d) ids.add(d.id);
    need(d && str(d.label) && str(d.hint), `department "${d && d.id}" needs a label and a hint`);
    need(d && HEX.test(d.color || '') && HEX.test(d.colorDark || ''), `department "${d && d.id}" needs color and colorDark like #7c3aed`);
  }

  const quick = Array.isArray(b.quickMessages) ? b.quickMessages : [];
  need(quick.length <= 8, 'at most 8 quick messages');
  for (const q of quick) {
    need(q && str(q.text) && typeof q.urgent === 'boolean', 'each quick message needs text and urgent (true/false)');
    need(q && (q.to === 'all' || ids.has(q.to)), `quick message "${q && q.text}" is addressed to an unknown department`);
  }
  need(ids.has(b.medicationAlertDept), 'medicationAlertDept must be one of the department ids');

  for (const f of ['logo.svg', 'icon.ico', 'icon.png']) {
    need(fs.existsSync(path.join(BRANDS_DIR, folderName, f)), `${f} is missing from brands/${folderName}/`);
  }
  return errors;
}

function loadBrand(id) {
  const file = path.join(BRANDS_DIR, id, 'brand.json');
  if (!fs.existsSync(file)) throw new Error(`No brand "${id}". Brands available: ${listBrands().join(', ') || '(none)'}`);
  const brand = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateBrand(brand, id);
  if (errors.length) throw new Error(`brands/${id}/brand.json has problems:\n  - ${errors.join('\n  - ')}`);
  return brand;
}

/** Checks that no two brands would clash (same install, same network, same update file). */
function validateAllBrands(ids = listBrands()) {
  const errors = [];
  const brands = ids.map(loadBrand);
  const seen = (label, pick) => {
    const map = new Map();
    for (const b of brands) {
      const key = pick(b);
      if (map.has(key)) errors.push(`${label} "${key}" is used by both ${map.get(key)} and ${b.id}`);
      else map.set(key, b.id);
    }
  };
  seen('appId', (b) => b.appId);
  seen('productName', (b) => b.productName);
  seen('network.appId', (b) => b.network.appId);
  seen('update file', (b) => updateFileName(b));
  return errors;
}

const slug = (b) => b.productName.replace(/\s+/g, '-');
const installerFileName = (b, version) => `${slug(b)}-Setup-${version}.exe`;
const updateFileName = (b) => `${b.update.channel || 'latest'}.yml`;

/** The "sha512:" value electron-builder wrote into an update file (latest.yml, <channel>.yml). */
function parseSha512(yml) {
  const m = /^sha512:\s*(\S+)\s*$/m.exec(yml);
  if (!m) throw new Error('no sha512 found in the update file');
  return m[1];
}

/**
 * brands.json, published with every release. install.ps1 reads it to find each clinic's installer and
 * check the download. items: [{ brand, sha512, size }].
 */
function releaseManifest(version, items) {
  return {
    version,
    brands: items.map(({ brand, sha512, size }) => ({
      id: brand.id,
      productName: brand.productName,
      installer: installerFileName(brand, version),
      sha512,
      size,
    })),
  };
}

// ---------- applying a brand ----------

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function fill(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in values)) throw new Error(`Unknown placeholder ${m}`);
    return values[key];
  });
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function brandCss(b) {
  const lines = (t, pick, pad) =>
    [
      `--primary: ${t.primary};`,
      `--primary-hover: ${t.primaryHover};`,
      `--primary-soft: ${t.primarySoft};`,
      `--on-primary: ${t.onPrimary};`,
      ...b.departments.map((d) => `--dept-${d.id}: ${d[pick]};`),
    ]
      .map((l) => pad + l)
      .join('\n');
  const rules = b.departments.map((d) => `.dept-${d.id} { --dept: var(--dept-${d.id}); }`).join('\n');
  return `/* Generated from brands/${b.id}/brand.json by scripts/apply-brand.js. Do not edit. */
:root {
${lines(b.theme.light, 'color', '  ')}
}

@media (prefers-color-scheme: dark) {
  :root {
${lines(b.theme.dark, 'colorDark', '    ')}
  }
}

${rules}
`;
}

/** Writes the generated files the app and installer use for this brand (all git-ignored). */
function applyBrand(id) {
  const brand = loadBrand(id);
  const from = (f) => path.join(BRANDS_DIR, id, f);

  copy(from('logo.svg'), path.join(ROOT, 'assets', 'logo.svg'));
  copy(from('icon.ico'), path.join(ROOT, 'assets', 'icon.ico'));
  copy(from('icon.png'), path.join(ROOT, 'assets', 'icon.png'));
  copy(from('icon.ico'), path.join(ROOT, 'build', 'icon.ico'));
  copy(from('icon.png'), path.join(ROOT, 'build', 'icon.png'));

  fs.writeFileSync(path.join(ROOT, 'src', 'brand.json'), `${JSON.stringify(brand, null, 2)}\n`);
  fs.writeFileSync(path.join(ROOT, 'src', 'renderer', 'brand.css'), brandCss(brand));

  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.template.html'), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), fill(html, { productName: escapeHtml(brand.productName) }));

  const { tcpPorts, udpPort } = brand.network;
  const nsh = fs.readFileSync(path.join(ROOT, 'build', 'installer.template.nsh'), 'utf8');
  fs.writeFileSync(
    path.join(ROOT, 'build', 'installer.nsh'),
    fill(nsh, {
      productName: brand.productName,
      udpPort: String(udpPort),
      tcpPorts: tcpPorts.length > 1 ? `${tcpPorts[0]}-${tcpPorts[tcpPorts.length - 1]}` : String(tcpPorts[0]),
    }),
  );
  return brand;
}

/** The electron-builder configuration for a brand (the installer, shortcuts and update source). */
function builderConfig(id) {
  const b = loadBrand(id);
  const publish = { provider: 'github', owner: b.update.owner, repo: b.update.repo, releaseType: 'release' };
  if (b.update.channel) publish.channel = b.update.channel;
  return {
    appId: b.appId,
    productName: b.productName,
    copyright: b.organisation,
    extraMetadata: { name: b.packageName, productName: b.productName, description: b.description, author: b.organisation },
    directories: { output: `dist/${b.id}`, buildResources: 'build' },
    files: ['src/**/*', '!src/renderer/index.template.html', 'assets/**/*', 'package.json'],
    win: {
      target: [{ target: 'nsis', arch: ['x64'] }],
      icon: 'build/icon.ico',
      artifactName: `${slug(b)}-Setup-\${version}.\${ext}`,
    },
    nsis: {
      oneClick: true,
      perMachine: false,
      runAfterFinish: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: b.productName,
      include: 'build/installer.nsh',
    },
    publish: [publish],
  };
}

module.exports = {
  ROOT,
  DEFAULT_BRAND,
  listBrands,
  loadBrand,
  validateBrand,
  validateAllBrands,
  applyBrand,
  builderConfig,
  slug,
  installerFileName,
  updateFileName,
  parseSha512,
  releaseManifest,
};
