'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  FileStore,
  cleanFileName,
  isBlockedName,
  looksExecutable,
  detectKind,
  imageMime,
  checkBytes,
  inspectFile,
  sha256,
} = require('../src/main/files');
const { sanitizeMessage, sanitizeAttachment, MessageStore } = require('../src/main/store');
const { LIMITS } = require('../src/main/constants');
const { tempDir, makeMessage, makePng, makeJpegHeader, makePdf, makeGif } = require('./helpers');

test('file names are made safe to show and to save', () => {
  assert.equal(cleanFileName('Lab results.pdf'), 'Lab results.pdf');
  assert.equal(cleanFileName('C:\\Users\\Me\\Desktop\\scan 1.png'), 'scan 1.png');
  assert.equal(cleanFileName('../../etc/passwd'), 'passwd');
  assert.equal(cleanFileName('what?<is>:this*.txt'), 'whatis this.txt'.replace('is ', 'is'));
  assert.equal(cleanFileName('report.pdf   '), 'report.pdf');
  assert.equal(cleanFileName('...'), 'file');
  assert.equal(cleanFileName(''), 'file');
  assert.equal(cleanFileName(null), 'file');
  assert.equal(cleanFileName('invoice\u202egpj.exe'), 'invoicegpj.exe', 'a right-to-left override can’t disguise the extension');
  const long = cleanFileName(`${'a'.repeat(300)}.xlsx`);
  assert.ok(long.length <= LIMITS.FILE_NAME && long.endsWith('.xlsx'), 'long names keep their extension');
});

test('programs, scripts, web pages and macro files are blocked by name', () => {
  for (const bad of ['setup.exe', 'run.BAT', 'x.ps1', 'a.vbs', 'a.js', 'page.html', 'link.lnk', 'macro.xlsm', 'letter.docm', 'disk.iso', 'logo.svg', 'a.msi', 'x.scr', 'x.hta', 'photo.jpg.exe', 'a.cmd', 'tool.jar']) {
    assert.equal(isBlockedName(bad), true, bad);
  }
  for (const ok of ['scan.pdf', 'results.xlsx', 'letter.docx', 'photo.jpg', 'x-ray.png', 'notes.txt', 'data.csv', 'pack.zip', 'slides.pptx', 'exe.txt', 'noextension']) {
    assert.equal(isBlockedName(ok), false, ok);
  }
});

test('programs are recognised by their content, whatever they are called', () => {
  assert.equal(looksExecutable(Buffer.from('MZ\x90\x00\x03\x00\x00\x00')), true);
  assert.equal(looksExecutable(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])), true);
  assert.equal(looksExecutable(makePdf()), false);
  assert.equal(looksExecutable(makePng()), false);
  assert.throws(() => inspectFile(Buffer.from('MZ\x90\x00\x03\x00\x00\x00rest of a program'), 'holiday photo.pdf'), /can’t be sent/);
  assert.equal(checkBytes(Buffer.from('MZ\x90\x00\x03\x00')), false);
});

test('images are recognised by content, with their size', () => {
  assert.deepEqual(detectKind(makePng({ width: 120, height: 80 })), { kind: 'image', mime: 'image/png', w: 120, h: 80 });
  assert.deepEqual(detectKind(makeJpegHeader({ width: 1600, height: 1200 })), { kind: 'image', mime: 'image/jpeg', w: 1600, h: 1200 });
  const bmp = Buffer.alloc(54);
  bmp.write('BM');
  bmp.writeInt32LE(300, 18);
  bmp.writeInt32LE(-200, 22); // negative height means top-down
  assert.deepEqual(detectKind(bmp), { kind: 'image', mime: 'image/bmp', w: 300, h: 200 });
  const webp = Buffer.alloc(40);
  webp.write('RIFF', 0);
  webp.write('WEBP', 8);
  webp.write('VP8X', 12);
  webp.writeUIntLE(799, 24, 3);
  webp.writeUIntLE(599, 27, 3);
  assert.deepEqual(detectKind(webp), { kind: 'image', mime: 'image/webp', w: 800, h: 600 });
  assert.equal(detectKind(makeGif()).mime, 'image/gif');

  assert.deepEqual(detectKind(makePdf()), { kind: 'file' });
  assert.deepEqual(detectKind(Buffer.from('plain text')), { kind: 'file' });
  assert.equal(imageMime(makePdf()), null);
  assert.equal(imageMime(makePng()), 'image/png');
  // A PNG renamed to .pdf is still shown as the image it really is.
  assert.equal(inspectFile(makePng(), 'scan.pdf').kind, 'image');
});

test('inspectFile gives clear reasons for refusing a file', () => {
  assert.deepEqual(inspectFile(makePdf(), 'C:\\x\\Estimate.pdf'), { name: 'Estimate.pdf', size: makePdf().length, kind: 'file' });
  assert.throws(() => inspectFile(Buffer.alloc(0), 'empty.txt'), /empty/);
  assert.throws(() => inspectFile(Buffer.alloc(LIMITS.FILE_BYTES + 1, 65), 'big.txt'), /too large \(the limit is 15 MB\)/);
  assert.throws(() => inspectFile(makePdf(), 'tool.exe'), /programs, scripts, web pages and macro files/);
  assert.throws(() => inspectFile('not bytes', 'a.txt'), /empty/);
});

test('FileStore keeps each file once, by fingerprint, and checks what it is given', () => {
  const dir = tempDir();
  const store = new FileStore(dir);
  const png = makePng({ seed: 3 });
  const saved = store.add(png, 'x-ray.png');
  assert.deepEqual(saved, { hash: sha256(png), name: 'x-ray.png', size: png.length, kind: 'image', w: 64, h: 48 });
  assert.deepEqual(store.read(saved.hash), png);
  assert.equal(store.add(png, 'copy of x-ray.png').hash, saved.hash, 'the same bytes are stored once');
  assert.equal(fs.readdirSync(path.join(dir, 'files')).length, 1);
  assert.equal(store.pathOf(saved.hash), path.join(dir, 'files', saved.hash));

  const announced = [];
  store.on('added', (h) => announced.push(h));
  const pdf = makePdf('fetched');
  assert.throws(() => store.addVerified(sha256(png), pdf), /does not match/);
  assert.throws(() => store.addVerified(sha256(Buffer.from('MZ\x90\x00\x03\x00')), Buffer.from('MZ\x90\x00\x03\x00')), /does not match/, 'a program is refused even with the right fingerprint');
  store.addVerified(sha256(pdf), pdf);
  store.addVerified(sha256(pdf), pdf);
  assert.deepEqual(announced, [sha256(pdf)]);

  for (const bad of ['../../config', '..\\..\\config.json', 'abc', sha256(pdf).toUpperCase(), `${sha256(pdf)}.pdf`, '']) {
    assert.equal(store.has(bad), false, bad);
    assert.equal(store.read(bad), null, bad);
    assert.equal(store.pathOf(bad), null, bad);
  }
});

test('FileStore archives and removes files', () => {
  const dir = tempDir();
  const store = new FileStore(dir);
  const saved = store.add(makePdf('old'), 'old.pdf');
  assert.equal(store.archive(saved.hash), true);
  assert.equal(store.has(saved.hash), false);
  assert.ok(fs.existsSync(path.join(dir, 'archive', 'files', saved.hash)));
  assert.equal(store.archive(saved.hash), false);
  const other = store.add(makePdf('other'), 'other.pdf');
  assert.equal(store.remove(other.hash), true);
  assert.equal(store.remove(other.hash), false);
});

test('a message keeps valid attachments and silently drops unsafe or malformed ones', () => {
  const att = (over = {}) => ({ hash: sha256(Buffer.from(String(Math.random()))), size: 1000, name: 'Estimate.pdf', kind: 'file', ...over });
  const good = att();
  const image = att({ name: 'x-ray.png', kind: 'image', w: 640, h: 480 });
  const clean = sanitizeMessage({ ...makeMessage({ text: '[Attachment]' }), attachments: [good, image, { ...att(), evil: 1 }] });
  assert.equal(clean.attachments.length, 3);
  assert.deepEqual(clean.attachments[1], image);
  assert.equal('evil' in clean.attachments[2], false);

  const bad = [
    att({ name: 'setup.exe' }),
    att({ name: 'folder\\..\\run.bat' }),
    att({ hash: 'short' }),
    att({ size: 0 }),
    att({ size: LIMITS.FILE_BYTES + 1 }),
    att({ kind: 'program' }),
    att({ name: 42 }),
    null,
    'file',
  ];
  const m = sanitizeMessage({ ...makeMessage({ text: '[Attachment]' }), attachments: [...bad, good] });
  assert.deepEqual(m.attachments, [good], 'only the good one survives, and the message itself is kept');
  assert.equal('attachments' in sanitizeMessage({ ...makeMessage(), attachments: bad }), false);
  assert.equal('attachments' in sanitizeMessage({ ...makeMessage(), attachments: 'nope' }), false);

  const many = Array.from({ length: 9 }, () => att());
  assert.equal(sanitizeMessage({ ...makeMessage(), attachments: many }).attachments.length, LIMITS.MAX_ATTACHMENTS);
  assert.equal(sanitizeAttachment({ ...image, w: 0, h: 0 }).w, undefined, 'bad dimensions are dropped, not the file');
  assert.equal(sanitizeAttachment({ ...att({ name: 'photo.jpg.exe' }) }), null);
});

test('quotes of an attachment-only message show no text', () => {
  const store = new MessageStore(tempDir()).load();
  const att = { hash: 'a'.repeat(64), size: 10, name: 'a.pdf', kind: 'file' };
  const withFiles = makeMessage({ text: '[Attachment]', attachments: [att, att] });
  const captioned = makeMessage({ text: 'Here is the estimate', attachments: [att] });
  store.add([withFiles, captioned]);
  assert.deepEqual([store.quote(withFiles.id).text, store.quote(withFiles.id).files], ['', 2]);
  assert.deepEqual([store.quote(captioned.id).text, store.quote(captioned.id).files], ['Here is the estimate', 1]);
});
