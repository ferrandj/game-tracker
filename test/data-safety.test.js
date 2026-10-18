'use strict';
/*
 * DATA IS PRIORITY ONE. These tests pin the promise: an update never changes the user's data, except through a
 * migration that is declared in server/migrations.js (copied raw first, validated, written atomically, tested on
 * frozen data written by the old release). See server/migrations.js for what a developer must do to change the schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Store } = require('../server/store');
const { CURRENT_SCHEMA, MIGRATIONS } = require('../server/migrations');
const { createServer } = require('../server/index');
const { createCatalog } = require('../server/catalog');
const { createProviders } = require('../server/providers');
const { createImages } = require('../server/images');
const { tmpDir, fakeFetch } = require('./helpers');

const FIXTURES = path.join(__dirname, 'fixtures');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tree = (dir) => fs.readdirSync(dir, { recursive: true }).map(String).sort();

/** A copy of what a previous release left in the data folder. */
function dataFolderFrom(version) {
  const dir = tmpDir('gt-data-');
  fs.copyFileSync(path.join(FIXTURES, 'data-v' + version, 'state.json'), path.join(dir, 'state.json'));
  return dir;
}

// ---------------------------------------------------------------------------------------------------------------
// The frozen fixtures: written once by the release that had that schema, NEVER regenerated.
// ---------------------------------------------------------------------------------------------------------------
test('the frozen fixtures are really frozen (if this fails someone regenerated one: do not, add a new fixture for the new schema instead)', () => {
  const listed = fs.readFileSync(path.join(FIXTURES, 'SHA256SUMS'), 'utf8').trim().split('\n').map((l) => l.split(/\s+/));
  const dirs = fs.readdirSync(FIXTURES).filter((n) => /^data-v\d+$/.test(n));
  assert.deepEqual(listed.map((l) => l[1]).sort(), dirs.map((d) => d + '/state.json').sort(), 'every fixture must be listed in test/fixtures/SHA256SUMS');
  listed.forEach(([hash, file]) => assert.equal(sha(path.join(FIXTURES, file)), hash, file + ' was modified'));
});

test('every schema version up to the current one has a frozen fixture, and a migration to the next one', () => {
  const versions = fs.readdirSync(FIXTURES).map((n) => /^data-v(\d+)$/.exec(n)).filter(Boolean).map((m) => +m[1]).sort((a, b) => a - b);
  for (let v = 1; v <= CURRENT_SCHEMA; v++) assert.ok(versions.includes(v), 'missing test/fixtures/data-v' + v + '/state.json (frozen data written by the release with schema ' + v + ')');
  for (let v = 1; v < CURRENT_SCHEMA; v++) assert.equal(typeof MIGRATIONS[v], 'function', 'missing MIGRATIONS[' + v + '] in server/migrations.js');
  versions.forEach((v) => assert.equal(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'data-v' + v, 'state.json'), 'utf8')).schema, v));
});

test('EVERY historical fixture opens with the current code and ends up complete and valid', () => {
  fs.readdirSync(FIXTURES).filter((n) => /^data-v\d+$/.test(n)).forEach((n) => {
    const dir = dataFolderFrom(+n.slice(6));
    const s = new Store(dir, { appVersion: '9.9.9' }).init();
    assert.equal(s.doc.schema, CURRENT_SCHEMA, n);
    const games = s.list();
    assert.equal(games.length, 3, n + ': no game lost');
    const hades = s.get('11111111-1111-4111-8111-111111111111');
    assert.deepEqual([hades.title, hades.rating, hades.hours, hades.status], ['Hades', 9, 42.5, 'playing'], n);
    assert.equal(hades.achievements.filter((a) => a.done).length, 1, n + ': ticked achievements kept');
    assert.match(hades.review, /géniale « avec des accents » é à ç — et des emojis 🎮\.$/, n + ': text kept exactly');
    assert.equal(s.get('22222222-2222-4222-8222-222222222222').guide.url, 'https://www.psthc.fr/guide-trophees-bloodborne/', n);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// An update of the application never touches the data.
// ---------------------------------------------------------------------------------------------------------------
test('starting a NEW version on existing data leaves state.json byte-for-byte identical, and keeps a raw copy', () => {
  const dir = dataFolderFrom(1);
  const before = sha(path.join(dir, 'state.json'));
  new Store(dir, { appVersion: '1.0.0' }).init();
  assert.equal(sha(path.join(dir, 'state.json')), before, 'first start of 1.0.0');
  const copies = fs.readdirSync(path.join(dir, 'backups')).filter((n) => /-update\.json$/.test(n));
  assert.equal(copies.length, 1);
  assert.equal(sha(path.join(dir, 'backups', copies[0])), before, 'the copy is exact');

  new Store(dir, { appVersion: '1.0.1' }).init(); // an update
  assert.equal(sha(path.join(dir, 'state.json')), before, 'after the update to 1.0.1');
  assert.equal(fs.readdirSync(path.join(dir, 'backups')).filter((n) => /-update\.json$/.test(n)).length, 2, 'one copy per version change');

  new Store(dir, { appVersion: '1.0.1' }).init(); // a plain restart
  new Store(dir, { appVersion: '1.0.1' }).init();
  assert.equal(sha(path.join(dir, 'state.json')), before, 'restarts');
  assert.equal(fs.readdirSync(path.join(dir, 'backups')).filter((n) => /-update\.json$/.test(n)).length, 2, 'restarts add nothing');
});

test('the running server only changes state.json when the user acts: reads, searches, config, images never write', async () => {
  const dir = dataFolderFrom(1);
  const f = fakeFetch([['/api/storesearch/', { items: [] }]]);
  const store = new Store(dir, { appVersion: '1.0.0' }).init();
  const before = sha(path.join(dir, 'state.json'));
  const server = createServer({ store, catalog: createCatalog(createProviders({}, f)), images: createImages(path.join(dir, 'covers'), f), publicDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const p of ['/api/games', '/api/games/11111111-1111-4111-8111-111111111111', '/api/config', '/api/version', '/api/search?q=hades', '/api/export', '/api/backups', '/api/img?u=https%3A%2F%2Fevil.example%2Fa.png', '/healthz', '/']) await fetch(base + p);
    assert.equal(sha(path.join(dir, 'state.json')), before);
    // and a user action does change it
    await fetch(base + '/api/games/11111111-1111-4111-8111-111111111111', { method: 'PATCH', headers: { 'x-tracker-client': '1', 'content-type': 'application/json' }, body: '{"rating":3}' });
    assert.notEqual(sha(path.join(dir, 'state.json')), before);
  } finally { await new Promise((r) => server.close(r)); }
});

test('what a user edits is changed field by field: fields this version does not know (written by a newer one) survive', () => {
  const dir = dataFolderFrom(1);
  const file = path.join(dir, 'state.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  doc.futureTopLevel = { keep: true };
  doc.games['11111111-1111-4111-8111-111111111111'].futureField = { tags: ['a', 'b'] };
  fs.writeFileSync(file, JSON.stringify(doc));
  const s = new Store(dir, { appVersion: '1.0.0' }).init();
  s.update('11111111-1111-4111-8111-111111111111', (g) => { g.rating = 4; return g; });
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(after.futureTopLevel, { keep: true });
  assert.deepEqual(after.games['11111111-1111-4111-8111-111111111111'].futureField, { tags: ['a', 'b'] });
  assert.equal(after.games['11111111-1111-4111-8111-111111111111'].rating, 4);
});

// ---------------------------------------------------------------------------------------------------------------
// Data from the future is never touched by an older release.
// ---------------------------------------------------------------------------------------------------------------
test('an OLDER release refuses data written by a NEWER schema, and changes nothing at all', () => {
  const dir = dataFolderFrom(1);
  const file = path.join(dir, 'state.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  doc.schema = CURRENT_SCHEMA + 1;
  fs.writeFileSync(file, JSON.stringify(doc));
  const before = sha(file), files = tree(dir);
  assert.throws(() => new Store(dir, { appVersion: '0.9.0' }).init(), /NEWER version.*Nothing was read into memory, moved or changed/s);
  assert.equal(sha(file), before, 'state.json untouched');
  assert.deepEqual(tree(dir), files, 'no file created, moved or renamed (not even as "corrupt")');
});

test('newer-schema data is also refused when it only sits in a backup that would be used for recovery', () => {
  const dir = tmpDir('gt-data-');
  const s = new Store(dir, { snapshotEveryMs: 0 }).init();
  s.create({ id: 'game-0001', title: 'A', addedAt: 'x', achievements: [] });
  const newer = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  newer.schema = CURRENT_SCHEMA + 1;
  fs.writeFileSync(path.join(dir, 'backups', 'state-20990101-000000000Z-r99.json'), JSON.stringify(newer));
  fs.writeFileSync(path.join(dir, 'state.json'), '{ broken');
  assert.throws(() => new Store(dir).init(), /NEWER version/);
});

// ---------------------------------------------------------------------------------------------------------------
// Declared migrations: the only way data is ever rewritten by an update.
// ---------------------------------------------------------------------------------------------------------------
const v1to2 = (doc) => {
  Object.keys(doc.games).forEach((id) => { doc.games[id].libraryNote = (doc.games[id].review || '').slice(0, 5); });
  doc.schema = 2;
  return doc;
};
const v2to3 = (doc) => { doc.extra = 'v3'; doc.schema = 3; return doc; };

test('a declared migration: raw copy first, result valid, written once, never re-run', () => {
  const dir = dataFolderFrom(1);
  const file = path.join(dir, 'state.json');
  const before = sha(file);
  const s = new Store(dir, { schema: 2, migrations: { 1: v1to2 }, appVersion: '2.0.0' }).init();
  assert.equal(s.doc.schema, 2);
  assert.equal(s.get('11111111-1111-4111-8111-111111111111').libraryNote, 'Excel');
  assert.equal(s.list().length, 3);
  const pre = fs.readdirSync(path.join(dir, 'backups')).filter((n) => /-pre-migration\.json$/.test(n));
  assert.equal(pre.length, 1);
  assert.equal(sha(path.join(dir, 'backups', pre[0])), before, 'the pre-migration copy is the exact old file');
  const migrated = sha(file);
  new Store(dir, { schema: 2, migrations: { 1: v1to2 }, appVersion: '2.0.0' }).init();
  assert.equal(sha(file), migrated, 'second start does not migrate again');
});

test('migrations chain step by step (1 -> 2 -> 3)', () => {
  const dir = dataFolderFrom(1);
  const s = new Store(dir, { schema: 3, migrations: { 1: v1to2, 2: v2to3 } }).init();
  assert.equal(s.doc.schema, 3);
  assert.equal(s.doc.extra, 'v3');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).schema, 3);
});

test('a failing, missing or invalid migration leaves the data exactly as it was and refuses to start', () => {
  const cases = [
    ['throws', { 1: () => { throw new Error('boom'); } }, /Migration from schema 1 failed: boom/],
    ['missing', {}, /No migration declared from data schema 1 to 2/],
    ['wrong schema', { 1: (d) => d }, /did not produce a valid schema 2/],
    ['not a document', { 1: () => ({ schema: 2 }) }, /did not produce a valid schema 2/],
    ['loses the games', { 1: (d) => { delete d.games; d.schema = 2; return d; } }, /did not produce a valid schema 2/]
  ];
  cases.forEach(([name, migrations, re]) => {
    const dir = dataFolderFrom(1);
    const file = path.join(dir, 'state.json'), before = sha(file);
    assert.throws(() => new Store(dir, { schema: 2, migrations }).init(), re, name);
    assert.equal(sha(file), before, name + ': state.json untouched');
    assert.ok(!fs.readdirSync(dir).some((n) => /corrupt/.test(n)), name + ': not treated as corrupt');
  });
});

test('a migration works on a copy: a half-done step can never leak into the stored data', () => {
  const dir = dataFolderFrom(1);
  const before = sha(path.join(dir, 'state.json'));
  assert.throws(() => new Store(dir, { schema: 2, migrations: { 1: (d) => { d.games = {}; throw new Error('crash midway'); } } }).init(), /crash midway/);
  assert.equal(sha(path.join(dir, 'state.json')), before);
});

test('restoring a backup made by an older release migrates it in memory; the backup file stays as it was', () => {
  const dir = tmpDir('gt-data-');
  fs.mkdirSync(path.join(dir, 'backups'));
  const snap = 'state-20260101-000000000Z-r5.json';
  fs.copyFileSync(path.join(FIXTURES, 'data-v1', 'state.json'), path.join(dir, 'backups', snap));
  const s = new Store(dir, { schema: 2, migrations: { 1: v1to2 }, snapshotEveryMs: 0 }).init(); // starts empty (no state), then restores
  assert.equal(s.list().length, 3, 'recovered from the old-schema backup, migrated');
  assert.equal(s.doc.schema, 2);
  s.restore(snap);
  assert.equal(s.doc.schema, 2);
  assert.equal(s.get('11111111-1111-4111-8111-111111111111').libraryNote, 'Excel');
  assert.equal(sha(path.join(dir, 'backups', snap)), sha(path.join(FIXTURES, 'data-v1', 'state.json')), 'the old backup is unchanged');
});
