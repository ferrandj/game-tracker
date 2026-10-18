'use strict';
/*
 * Persistence layer: one JSON document holding every game, plus automatic snapshots.
 *
 * Design goals (in priority order):
 *   1. Never lose user data. Writes are atomic (tmp file + fsync + rename), the previous version is snapshotted
 *      before it is overwritten, and a corrupt state file is moved aside (never removed) and recovered from the
 *      newest valid snapshot.
 *   2. Never silently reset. If a state existed but nothing valid can be recovered, the server refuses to start.
 *   3. An update never changes the data. The file is only ever rewritten by a user action, or by a migration that is
 *      declared in migrations.js (copied raw to backups/ first, validated, written atomically). Data from a newer
 *      schema is refused untouched. See migrations.js for the rules.
 *   4. Granular API: every change is "this one game" or "this one achievement", so two devices editing at once
 *      never overwrite each other (there is no whole-document upload).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { CURRENT_SCHEMA, MIGRATIONS } = require('./migrations');

const SNAPSHOT_EVERY_MS = 15 * 1000;
const SHRINK_RATIO = 0.6;

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function validDoc(d) {
  return isObj(d) && isObj(d.games) && Number.isInteger(d.rev) && d.rev >= 0 && Number.isInteger(d.schema) && d.schema >= 1;
}

/** Thrown (and nothing else done) when the data was written by a newer release than this one. */
class NewerSchemaError extends Error {
  constructor(where, found, supported) {
    super(where + ' was written by a NEWER version of Game Tracker (data schema ' + found + ', this version understands up to ' + supported +
      '). Nothing was read into memory, moved or changed. Run the newer image again, or restore a backup made before the update.');
    this.name = 'NewerSchemaError';
  }
}

function fsyncDir(dir) {
  try {
    const fd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch (e) { /* not supported everywhere (e.g. some network filesystems) */ }
}

function writeFileAtomic(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  const fd = fs.openSync(tmp, 'w', 0o644);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  fsyncDir(path.dirname(file));
}

function stamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace('.', '').replace('T', '-'); // 20260101-120000123Z
}

function parseStamp(name) {
  const m = /^state-(\d{8})-(\d{6})(\d{3})Z-r(\d+)(?:-([a-z0-9-]+))?\.json$/.exec(name);
  if (!m) return null;
  const d = m[1], t = m[2];
  const ms = Date.parse(d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) + 'T' + t.slice(0, 2) + ':' + t.slice(2, 4) + ':' + t.slice(4, 6) + '.' + m[3] + 'Z');
  return { time: ms, rev: +m[4], tag: m[5] || '' };
}

class Store {
  constructor(dir, opts) {
    opts = opts || {};
    this.dir = dir;
    this.now = opts.now || Date.now;
    this.snapshotEveryMs = opts.snapshotEveryMs === undefined ? SNAPSHOT_EVERY_MS : opts.snapshotEveryMs;
    this.schema = opts.schema || CURRENT_SCHEMA;
    this.migrations = opts.migrations || MIGRATIONS;
    this.appVersion = opts.appVersion ? String(opts.appVersion) : '';
    this.versionFile = path.join(dir, '.version');
    this.stateFile = path.join(dir, 'state.json');
    this.backupDir = path.join(dir, 'backups');
    this.doc = null;
    this.lastSnapshot = 0;
  }

  init() {
    const found = fs.existsSync(this.stateFile);
    let doc = null;
    if (found) {
      doc = this._readValid(this.stateFile, 'state.json');
      if (!doc) {
        const aside = path.join(this.dir, 'state.corrupt-' + stamp(this.now()) + '.json');
        fs.renameSync(this.stateFile, aside);
        console.error('[store] state.json is unreadable; moved to ' + path.basename(aside));
      }
    }
    const fromFile = !!doc;
    if (!doc) doc = this._recoverFromSnapshots();
    if (!doc) {
      if (found || this._hasCorruptLeftovers()) {
        throw new Error('No valid state could be recovered but previous data exists in ' + this.dir +
          '. Refusing to start with an empty library so nothing gets overwritten. Inspect the files and restore a backup manually.');
      }
      doc = { schema: this.schema, rev: 1, updatedAt: new Date(this.now()).toISOString(), games: {} };
      writeFileAtomic(this.stateFile, JSON.stringify(doc));
      console.log('[store] first start: created an empty library');
    }
    // Safety net: the first start after an update keeps an exact copy of the data as the previous version left it.
    if (fromFile) this._noteVersion();
    if (doc.schema < this.schema) doc = this._migrateOnDisk(doc, fromFile);
    else if (!fs.existsSync(this.stateFile)) writeFileAtomic(this.stateFile, JSON.stringify(doc));
    this.doc = doc;
    return this;
  }

  /** Raw byte-for-byte copy of state.json into backups/ (never a re-serialisation). */
  _copyRaw(tag) {
    const raw = fs.readFileSync(this.stateFile);
    let rev = 0;
    try { rev = JSON.parse(raw.toString('utf8')).rev || 0; } catch (e) { /* the name only */ }
    const name = 'state-' + stamp(this.now()) + '-r' + rev + '-' + tag + '.json';
    fs.mkdirSync(this.backupDir, { recursive: true });
    writeFileAtomic(path.join(this.backupDir, name), raw);
    return name;
  }

  _noteVersion() {
    if (!this.appVersion) return;
    let last = null;
    try { last = fs.readFileSync(this.versionFile, 'utf8').trim(); } catch (e) { /* first run of a build that records versions */ }
    if (last === this.appVersion) return;
    const name = this._copyRaw('update');
    writeFileAtomic(this.versionFile, this.appVersion + '\n');
    console.log('[store] first start of version ' + this.appVersion + (last ? ' (was ' + last + ')' : '') + ': data copied to backups/' + name + ', not modified');
  }

  /** Apply the declared migrations in memory, step by step, validating each result. Throws without touching anything. */
  _migrate(doc) {
    let d = doc;
    while (d.schema < this.schema) {
      const step = this.migrations[d.schema];
      if (typeof step !== 'function') throw new Error('No migration declared from data schema ' + d.schema + ' to ' + (d.schema + 1) + '.');
      let next;
      try { next = step(JSON.parse(JSON.stringify(d))); } catch (e) { throw new Error('Migration from schema ' + d.schema + ' failed: ' + e.message); }
      if (!validDoc(next) || next.schema !== d.schema + 1) throw new Error('Migration from schema ' + d.schema + ' did not produce a valid schema ' + (d.schema + 1) + ' document.');
      d = next;
    }
    return d;
  }

  /** Migrate the state file: raw copy first, then validate, then one atomic write. On any failure the file is left as it was. */
  _migrateOnDisk(doc, fromFile) {
    const from = doc.schema;
    let migrated;
    try { migrated = this._migrate(doc); } catch (e) {
      throw new Error(e.message + ' The data in ' + this.dir + ' was NOT changed. Run the previous image again and report this.');
    }
    if (fromFile) this._copyRaw('pre-migration');
    migrated.rev = doc.rev + 1;
    migrated.updatedAt = new Date(this.now()).toISOString();
    writeFileAtomic(this.stateFile, JSON.stringify(migrated));
    console.log('[store] data migrated from schema ' + from + ' to ' + migrated.schema + ' (the original is in backups/, tag pre-migration)');
    return migrated;
  }

  _hasCorruptLeftovers() {
    return fs.readdirSync(this.dir).some(function (f) { return /^state\.corrupt-/.test(f); });
  }

  /** The parsed document, null when unreadable / invalid. Throws NewerSchemaError (and does nothing else) for data from the future. */
  _readValid(file, label) {
    let d;
    try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
    if (isObj(d) && isObj(d.games) && Number.isInteger(d.schema) && d.schema > this.schema) throw new NewerSchemaError(label || path.basename(file), d.schema, this.schema);
    return validDoc(d) ? d : null;
  }

  _recoverFromSnapshots() {
    const list = this.listBackups();
    for (let i = 0; i < list.length; i++) {
      const d = this._readValid(path.join(this.backupDir, list[i].name), 'backup ' + list[i].name);
      if (d) {
        console.error('[store] recovered state from backup ' + list[i].name);
        return d;
      }
    }
    return null;
  }

  get rev() { return this.doc.rev; }

  list() {
    const games = Object.keys(this.doc.games).map((id) => this.doc.games[id]);
    games.sort(function (a, b) { return String(b.addedAt).localeCompare(String(a.addedAt)); });
    return games;
  }

  get(id) { return this.doc.games[id] || null; }

  /** Add a game (id must be new). */
  create(game) {
    if (this.doc.games[game.id]) throw Object.assign(new Error('game already exists'), { status: 409 });
    this._commit(Object.assign({}, this.doc.games, { [game.id]: game }));
    return game;
  }

  /** Replace one game with fn(copy). fn may throw. Returns the new game, or null when it does not exist. */
  update(id, fn) {
    const cur = this.doc.games[id];
    if (!cur) return null;
    const next = fn(JSON.parse(JSON.stringify(cur)));
    next.updatedAt = new Date(this.now()).toISOString();
    this._commit(Object.assign({}, this.doc.games, { [id]: next }));
    return next;
  }

  /** Delete a game. A tagged snapshot is taken first so it can always be restored by hand. */
  remove(id) {
    if (!this.doc.games[id]) return false;
    const rest = Object.assign({}, this.doc.games);
    delete rest[id];
    this._commit(rest, 'delete');
    return true;
  }

  /** Merge games from an export. Existing games are never overwritten or removed. Returns { added, skipped }. */
  importGames(games) {
    const next = Object.assign({}, this.doc.games);
    let added = 0, skipped = 0;
    games.forEach(function (g) {
      if (next[g.id]) skipped++;
      else { next[g.id] = g; added++; }
    });
    if (added) this._commit(next, 'import');
    return { added: added, skipped: skipped };
  }

  _commit(games, tag) {
    const cur = this.doc;
    // spread the current document first: a top-level field this version does not know is kept, never dropped
    const text = JSON.stringify(Object.assign({}, cur, { schema: cur.schema, rev: cur.rev + 1, updatedAt: new Date(this.now()).toISOString(), games: games }));
    const shrink = text.length < JSON.stringify(cur).length * SHRINK_RATIO;
    if (tag || shrink || this.now() - this.lastSnapshot >= this.snapshotEveryMs) this._snapshot(tag || (shrink ? 'shrink' : ''));
    writeFileAtomic(this.stateFile, text);
    this.doc = JSON.parse(text);
    return this.doc.rev;
  }

  _snapshot(tag) {
    const t = this.now();
    const name = 'state-' + stamp(t) + '-r' + this.doc.rev + (tag ? '-' + tag : '') + '.json';
    fs.mkdirSync(this.backupDir, { recursive: true });
    writeFileAtomic(path.join(this.backupDir, name), JSON.stringify(this.doc));
    this.lastSnapshot = t;
    this._prune();
    return name;
  }

  /* Keep: everything < 2 days, hourly < 14 days, daily < 180 days, monthly forever. Tagged snapshots are never pruned. */
  _prune() {
    const now = this.now();
    const items = this.listBackups(); // newest first
    const seen = new Set();
    items.forEach((it) => {
      if (it.tag) return;
      const age = now - it.time, iso = new Date(it.time).toISOString();
      let key = null;
      if (age < 2 * 864e5) return;
      else if (age < 14 * 864e5) key = 'h' + iso.slice(0, 13);
      else if (age < 180 * 864e5) key = 'd' + iso.slice(0, 10);
      else key = 'm' + iso.slice(0, 7);
      if (seen.has(key)) {
        try { fs.unlinkSync(path.join(this.backupDir, it.name)); } catch (e) { /* ignore */ }
      } else seen.add(key);
    });
  }

  listBackups() {
    let names = [];
    try { names = fs.readdirSync(this.backupDir); } catch (e) { return []; }
    const out = [];
    names.forEach((name) => {
      const p = parseStamp(name);
      if (!p) return;
      let size = 0;
      try { size = fs.statSync(path.join(this.backupDir, name)).size; } catch (e) { return; }
      out.push({ name: name, time: p.time, rev: p.rev, tag: p.tag, size: size });
    });
    out.sort(function (a, b) { return b.time - a.time || b.rev - a.rev; });
    return out;
  }

  /** Restore a snapshot as the new current state (the state being replaced is snapshotted first). */
  restore(name) {
    if (!parseStamp(name)) throw Object.assign(new Error('unknown backup'), { status: 400 });
    const file = path.join(this.backupDir, name);
    let d = this._readValid(file, 'backup ' + name);
    if (!d) throw Object.assign(new Error('backup not found or unreadable'), { status: 404 });
    d = this._migrate(d); // a backup made by an older release is brought up to date in memory, the backup file itself stays as it is
    return this._commit(d.games, 'restore');
  }
}

function newId() { return crypto.randomUUID(); }

module.exports = { Store, NewerSchemaError, newId, writeFileAtomic, isObj };
