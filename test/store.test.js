'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { MessageStore, sanitizeMessage } = require('../src/main/store');
const { tempDir, makeMessage } = require('./helpers');

test('sanitizeMessage accepts valid messages and rejects bad ones', () => {
  const good = makeMessage({ text: '  Call Mrs Smith about Bella  ', author: ' Sam ' });
  const clean = sanitizeMessage(good);
  assert.equal(clean.text, 'Call Mrs Smith about Bella');
  assert.equal(clean.author, 'Sam');

  assert.equal(sanitizeMessage({ ...good, from: 'hackers' }), null);
  assert.equal(sanitizeMessage({ ...good, to: 'nobody' }), null);
  assert.equal(sanitizeMessage({ ...good, text: '   ' }), null);
  assert.equal(sanitizeMessage({ ...good, text: 'x'.repeat(4001) }), null);
  assert.equal(sanitizeMessage({ ...good, id: 'bad id!' }), null);
  assert.equal(sanitizeMessage({ ...good, createdAt: 'yesterday' }), null);
  assert.equal(sanitizeMessage({ ...good, urgent: 'yes' }), null);
  assert.equal(sanitizeMessage(null), null);
  // Extra fields are dropped.
  assert.equal(sanitizeMessage({ ...good, evil: '<script>' }).evil, undefined);
});

test('store persists messages and reloads them in order', () => {
  const dir = tempDir();
  const store = new MessageStore(dir).load();
  const a = makeMessage({ text: 'first' });
  const b = makeMessage({ text: 'second' });
  const c = makeMessage({ text: 'third' });
  store.add([c, a], { local: true });
  store.add([b, a]); // a is a duplicate
  assert.equal(store.count, 3);
  assert.deepEqual(store.query().messages.map((m) => m.text), ['first', 'second', 'third']);

  // Simulate a crash mid-write.
  fs.appendFileSync(store.file, '{"id":"broken');
  const reloaded = new MessageStore(dir).load();
  assert.equal(reloaded.count, 3);
  assert.deepEqual(reloaded.query().messages.map((m) => m.text), ['first', 'second', 'third']);
  assert.equal(reloaded.byId.get(a.id).local, true);
  assert.equal(reloaded.byId.get(b.id).local, undefined);
  assert.deepEqual(reloaded.digest(), store.digest());
});

test('digest is independent of arrival order', () => {
  const msgs = [makeMessage(), makeMessage(), makeMessage(), makeMessage()];
  const s1 = new MessageStore(tempDir()).load();
  const s2 = new MessageStore(tempDir()).load();
  s1.add(msgs);
  s2.add([...msgs].reverse());
  assert.deepEqual(s1.digest(), s2.digest());
  s2.add([makeMessage()]);
  assert.notEqual(s1.digest().hash, s2.digest().hash);
});

test('query filters, searches and pages', () => {
  const store = new MessageStore(tempDir()).load();
  store.add([
    makeMessage({ from: 'reception', to: 'clinical', text: 'Dog in room 2' }),
    makeMessage({ from: 'clinical', to: 'reception', text: 'Bill ready for Max' }),
    makeMessage({ from: 'principal', to: 'all', text: 'Staff meeting 5pm', urgent: true }),
    makeMessage({ from: 'reception', to: 'all', text: 'Courier arrived', author: 'Priya' }),
  ]);
  const texts = (r) => r.messages.map((m) => m.text);

  // "For us" means addressed directly to our department, not to everyone.
  assert.deepEqual(texts(store.query({ filter: 'to-us', department: 'reception' })), ['Bill ready for Max']);
  assert.deepEqual(texts(store.query({ filter: 'to-us', department: 'principal' })), []);
  assert.deepEqual(texts(store.query({ filter: 'from-us', department: 'reception' })), [
    'Dog in room 2',
    'Courier arrived',
  ]);
  assert.deepEqual(texts(store.query({ filter: 'urgent' })), ['Staff meeting 5pm']);
  assert.deepEqual(texts(store.query({ search: 'MAX' })), ['Bill ready for Max']);
  assert.deepEqual(texts(store.query({ search: 'priya' })), ['Courier arrived']);

  const page1 = store.query({ limit: 2 });
  assert.equal(page1.more, true);
  assert.deepEqual(texts(page1), ['Staff meeting 5pm', 'Courier arrived']);
  const page2 = store.query({ limit: 2, before: page1.messages[0] });
  assert.equal(page2.more, false);
  assert.deepEqual(texts(page2), ['Dog in room 2', 'Bill ready for Max']);
});

test('unread count ignores own messages, other departments and old history', () => {
  const store = new MessageStore(tempDir()).load();
  const old = makeMessage({ text: 'before install' });
  const since = old.createdAt + 1;
  store.add([old]);
  store.add([makeMessage({ to: 'clinical', text: 'for clinical' })]);
  store.add([makeMessage({ to: 'reception', text: 'for someone else' })]);
  store.add([makeMessage({ to: 'all', text: 'mine' })], { local: true });
  store.add([makeMessage({ to: 'all', text: 'everyone' })]);

  assert.deepEqual(store.unread({ department: 'clinical', lastReadAt: 0, since }), { count: 2, urgent: false });
  assert.deepEqual(store.unread({ department: 'clinical', lastReadAt: Date.now() + 1, since }), { count: 0, urgent: false });

  store.add([makeMessage({ to: 'clinical', text: 'now!', urgent: true })]);
  assert.deepEqual(store.unread({ department: 'clinical', lastReadAt: 0, since }), { count: 3, urgent: true });
});
