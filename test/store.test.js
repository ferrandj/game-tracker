'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Store } = require('../server/store');
const { tmpDir } = require('./helpers');

const game = (id, extra) => Object.assign({ id: id, title: 'Game ' + id, addedAt: '2026-01-0' + id.slice(-1) + 'T00:00:00Z', achievements: [] }, extra);

test('first start creates an empty library; data survives a restart', () => {
  const dir = tmpDir();
  const s = new Store(dir, { snapshotEveryMs: 0 }).init();
  assert.deepEqual(s.list(), []);
  s.create(game('game-0001'));
  const again = new Store(dir).init();
  assert.equal(again.list().length, 1);
  assert.equal(again.get('game-0001').title, 'Game game-0001');
});

test('update changes one game, stamps updatedAt and never mutates the stored copy before commit', () => {
  const s = new Store(tmpDir(), { snapshotEveryMs: 0 }).init();
  s.create(game('game-0001'));
  s.create(game('game-0002'));
  const next = s.update('game-0001', (g) => { g.title = 'Renamed'; return g; });
  assert.equal(next.title, 'Renamed');
  assert.ok(next.updatedAt);
  assert.equal(s.get('game-0002').title, 'Game game-0002');
  assert.throws(() => s.update('game-0002', () => { throw new Error('boom'); }), /boom/);
  assert.equal(s.get('game-0002').title, 'Game game-0002');
  assert.equal(s.update('nope-nope', (g) => g), null);
});

test('list is newest first; duplicate ids are refused', () => {
  const s = new Store(tmpDir(), { snapshotEveryMs: 0 }).init();
  s.create(game('game-0001'));
  s.create(game('game-0003'));
  s.create(game('game-0002'));
  assert.deepEqual(s.list().map((g) => g.id), ['game-0003', 'game-0002', 'game-0001']);
  assert.throws(() => s.create(game('game-0001')), /already exists/);
});

test('remove takes a tagged snapshot that can be restored', () => {
  const dir = tmpDir();
  const s = new Store(dir, { snapshotEveryMs: 1e12 }).init();
  s.create(game('game-0001'));
  assert.equal(s.remove('game-0001'), true);
  assert.equal(s.remove('game-0001'), false);
  assert.equal(s.list().length, 0);
  const snap = s.listBackups().find((b) => b.tag === 'delete');
  assert.ok(snap, 'a delete snapshot exists');
  s.restore(snap.name);
  assert.equal(s.list().length, 1);
});

test('corrupt state.json is kept aside and the newest backup is loaded', () => {
  const dir = tmpDir();
  const s = new Store(dir, { snapshotEveryMs: 0 }).init();
  s.create(game('game-0001'));
  s.create(game('game-0002'));
  fs.writeFileSync(path.join(dir, 'state.json'), '{ broken');
  const r = new Store(dir).init();
  assert.ok(fs.readdirSync(dir).some((f) => /^state\.corrupt-/.test(f)));
  assert.ok(r.list().length >= 1, 'recovered from a snapshot');
});

test('refuses to start empty when data existed but nothing can be recovered', () => {
  const dir = tmpDir();
  new Store(dir, { snapshotEveryMs: 0 }).init();
  fs.rmSync(path.join(dir, 'backups'), { recursive: true, force: true });
  fs.writeFileSync(path.join(dir, 'state.json'), 'garbage');
  assert.throws(() => new Store(dir).init(), /Refusing to start/);
  assert.ok(fs.existsSync(path.join(dir, 'state.json')) === false, 'the bad file was moved, not deleted');
  assert.ok(fs.readdirSync(dir).some((f) => /^state\.corrupt-/.test(f)));
  assert.throws(() => new Store(dir).init(), /Refusing to start/, 'still refuses on the next start');
});

test('importGames adds new games and never overwrites existing ones', () => {
  const s = new Store(tmpDir(), { snapshotEveryMs: 0 }).init();
  s.create(game('game-0001', { title: 'Mine' }));
  const r = s.importGames([game('game-0001', { title: 'Theirs' }), game('game-0002')]);
  assert.deepEqual(r, { added: 1, skipped: 1 });
  assert.equal(s.get('game-0001').title, 'Mine');
  assert.ok(s.listBackups().some((b) => b.tag === 'import'));
});

test('a big shrink is snapshotted first', () => {
  const s = new Store(tmpDir(), { snapshotEveryMs: 1e12 }).init();
  s.create(game('game-0001', { review: 'x'.repeat(5000) }));
  s.update('game-0001', (g) => { g.review = ''; return g; });
  assert.ok(s.listBackups().some((b) => b.tag === 'shrink'));
});

test('restore rejects unknown or invalid names', () => {
  const s = new Store(tmpDir(), { snapshotEveryMs: 0 }).init();
  assert.throws(() => s.restore('../../etc/passwd'), /unknown backup/);
  assert.throws(() => s.restore('state-20260101-000000000Z-r1.json'), /not found/);
});
