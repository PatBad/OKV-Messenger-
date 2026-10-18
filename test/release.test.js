'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const brandLib = require('../scripts/lib/brand');

test('the checksum is read from an electron-builder update file', () => {
  const yml = `version: 1.12.0
files:
  - url: OKV-Messenger-Setup-1.12.0.exe
    sha512: AAAA1111
    size: 5
path: OKV-Messenger-Setup-1.12.0.exe
sha512: BA2BfDz27pp/+Q==
releaseDate: '2026-10-18T10:56:44.829Z'
`;
  assert.equal(brandLib.parseSha512(yml), 'BA2BfDz27pp/+Q==');
  assert.throws(() => brandLib.parseSha512('version: 1.0.0\n'), /no sha512/);
});

test('brands.json lists each brand with the exact installer name, checksum and size', () => {
  const okv = brandLib.loadBrand('okv');
  const m = brandLib.releaseManifest('1.13.0', [{ brand: okv, sha512: 'abc', size: 123 }]);
  assert.deepEqual(m, {
    version: '1.13.0',
    brands: [{ id: 'okv', productName: 'OKV Messenger', installer: 'OKV-Messenger-Setup-1.13.0.exe', sha512: 'abc', size: 123 }],
  });
});

test('install.ps1 is valid PowerShell and plain ASCII (Windows PowerShell reads it as ANSI)', { skip: process.platform !== 'win32' }, () => {
  const file = path.join(__dirname, '..', 'install.ps1');
  const text = require('fs').readFileSync(file);
  assert.ok(text.every((byte) => byte < 128), 'install.ps1 must only contain ASCII characters');
  const script =
    '$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($env:PS_FILE_TO_CHECK,[ref]$null,[ref]$e);if($e){$e|ForEach-Object{$_.Message};exit 1}';
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', env: { ...process.env, PS_FILE_TO_CHECK: file } });
  if (r.error && r.error.code === 'ENOENT') return; // no PowerShell here
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
