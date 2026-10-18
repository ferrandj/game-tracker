'use strict';
/*
 * Persistence layer: one JSON document holding every game, plus automatic snapshots.
 *
 * Design goals (in priority order):
 *   1. Never lose user data. Writes are atomic (tmp file + fsync + rename), the previous version is snapshotted
 *      before it is overwritten, and a corrupt state file is moved aside (never removed) and recovered from the
 *      newest valid snapshot.
 *   2. Never silently reset. If a state existed but nothing valid can be recovered, the server refuses to start.
 *   3. Granular API: every change is "this one game" or "this one achievement", so two devices editing at once
 *      never overwrite each other (there is no whole-document upload).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = 1;
const SNAPSHOT_EVERY_MS = 15 * 1000;
const SHRINK_RATIO = 0.6;

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function validDoc(d) {
  return isObj(d) && isObj(d.games) && Number.isInteger(d.rev) && d.rev >= 0;
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
  const m = /^state-(\d{8})-(\d{6})(\d{3})Z-r(\d+)(?:-([a-z-]+))?\.json$/.exec(name);
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
    this.stateFile = path.join(dir, 'state.json');
    this.backupDir = path.join(dir, 'backups');
    this.doc = null;
    this.lastSnapshot = 0;
  }

  init() {
    fs.mkdirSync(this.backupDir, { recursive: true });
    const found = fs.existsSync(this.stateFile);
    let doc = null;
    if (found) {
      doc = this._readValid(this.stateFile);
      if (!doc) {
        const aside = path.join(this.dir, 'state.corrupt-' + stamp(this.now()) + '.json');
        fs.renameSync(this.stateFile, aside);
        console.error('[store] state.json is unreadable; moved to ' + path.basename(aside));
      }
    }
    if (!doc) doc = this._recoverFromSnapshots();
    if (!doc) {
      if (found || this._hasCorruptLeftovers()) {
        throw new Error('No valid state could be recovered but previous data exists in ' + this.dir +
          '. Refusing to start with an empty library so nothing gets overwritten. Inspect the files and restore a backup manually.');
      }
      doc = { schema: SCHEMA, rev: 1, updatedAt: new Date(this.now()).toISOString(), games: {} };
      writeFileAtomic(this.stateFile, JSON.stringify(doc));
      console.log('[store] first start: created an empty library');
    } else if (!fs.existsSync(this.stateFile)) {
      writeFileAtomic(this.stateFile, JSON.stringify(doc));
    }
    this.doc = doc;
    return this;
  }

  _hasCorruptLeftovers() {
    return fs.readdirSync(this.dir).some(function (f) { return /^state\.corrupt-/.test(f); });
  }

  _readValid(file) {
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      return validDoc(d) ? d : null;
    } catch (e) { return null; }
  }

  _recoverFromSnapshots() {
    const list = this.listBackups();
    for (let i = 0; i < list.length; i++) {
      const d = this._readValid(path.join(this.backupDir, list[i].name));
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
    const text = JSON.stringify({ schema: SCHEMA, rev: cur.rev + 1, updatedAt: new Date(this.now()).toISOString(), games: games });
    const shrink = text.length < JSON.stringify(cur).length * SHRINK_RATIO;
    if (tag || shrink || this.now() - this.lastSnapshot >= this.snapshotEveryMs) this._snapshot(tag || (shrink ? 'shrink' : ''));
    writeFileAtomic(this.stateFile, text);
    this.doc = JSON.parse(text);
    return this.doc.rev;
  }

  _snapshot(tag) {
    const t = this.now();
    const name = 'state-' + stamp(t) + '-r' + this.doc.rev + (tag ? '-' + tag : '') + '.json';
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
    const d = this._readValid(file);
    if (!d) throw Object.assign(new Error('backup not found or unreadable'), { status: 404 });
    return this._commit(d.games, 'restore');
  }
}

function newId() { return crypto.randomUUID(); }

module.exports = { Store, newId, writeFileAtomic, isObj };
