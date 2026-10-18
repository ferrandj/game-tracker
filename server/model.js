'use strict';
/* The shape of a game, what a client may change, and how achievement lists are merged. */
const { newId } = require('./store');
const { normalizeTitle } = require('./text');

const STATUSES = ['backlog', 'playing', 'finished', 'completed', 'dropped'];
const PLATFORMS = ['steam', 'pc', 'ps5', 'ps4', 'ps3', 'vita', 'xbox-series', 'xbox-one', 'xbox-360', 'switch', 'mobile', 'other'];
const TROPHY_TYPES = ['platinum', 'gold', 'silver', 'bronze'];

function str(v, max) { return typeof v === 'string' ? v.replace(/\u0000/g, '').slice(0, max) : ''; }
function httpUrl(v) { try { const u = new URL(String(v)); return /^https?:$/.test(u.protocol) ? u.toString() : null; } catch (e) { return null; } }
function bad(msg) { return Object.assign(new Error(msg), { status: 400 }); }

function cleanAchievement(a, keepDone) {
  const id = str(a && a.id, 120);
  const name = str(a && a.name, 300).trim();
  if (!id || !name) return null;
  const out = {
    id: id, name: name, description: str(a.description, 1000), icon: httpUrl(a.icon),
    hidden: !!a.hidden, rarity: typeof a.rarity === 'number' && isFinite(a.rarity) ? Math.max(0, Math.min(100, a.rarity)) : null,
    done: !!(keepDone && a.done), doneAt: keepDone && a.done && typeof a.doneAt === 'string' ? a.doneAt.slice(0, 40) : null
  };
  if (TROPHY_TYPES.indexOf(a.type) >= 0) out.type = a.type;
  return out;
}

function cleanAchSource(s) {
  if (!s || typeof s !== 'object' || !/^(steam|psn|manual)$/.test(s.provider)) return null;
  return { provider: s.provider, ref: str(s.ref, 80), fetchedAt: str(s.fetchedAt, 40) };
}

/** A full game record from trusted/merged data. */
function buildGame(input, nowIso) {
  const title = str(input.title, 200).trim();
  if (!title) throw bad('title is required');
  const platform = PLATFORMS.indexOf(input.platform) >= 0 ? input.platform : 'other';
  const game = {
    id: input.id || newId(), kind: 'game', title: title, platform: platform,
    sources: (input.sources || []).filter(function (s) { return s && /^(steam|rawg|igdb)$/.test(s.provider) && /^[\w-]{1,40}$/.test(String(s.id)); })
      .map(function (s) { return { provider: s.provider, id: String(s.id) }; }),
    cover: httpUrl(input.cover), art: httpUrl(input.art), description: str(input.description, 4000),
    year: Number.isInteger(input.year) && input.year > 1950 && input.year < 2200 ? input.year : null,
    genres: (input.genres || []).map(function (g) { return str(g, 60); }).filter(Boolean).slice(0, 8),
    developers: (input.developers || []).map(function (g) { return str(g, 80); }).filter(Boolean).slice(0, 5),
    status: STATUSES.indexOf(input.status) >= 0 ? input.status : 'backlog',
    rating: null, review: '', hours: null,
    achievements: (input.achievements || []).map(function (a) { return cleanAchievement(a, true); }).filter(Boolean).slice(0, 2000),
    achievementsSource: cleanAchSource(input.achievementsSource),
    guide: null, addedAt: input.addedAt || nowIso, updatedAt: nowIso
  };
  return game;
}

/** Fields the user can change with PATCH. Returns a function applying them to a game, or throws 400. */
function patchGame(game, p) {
  if ('title' in p) { const t = str(p.title, 200).trim(); if (!t) throw bad('title is required'); game.title = t; }
  if ('platform' in p) { if (PLATFORMS.indexOf(p.platform) < 0) throw bad('unknown platform'); game.platform = p.platform; }
  if ('status' in p) { if (STATUSES.indexOf(p.status) < 0) throw bad('unknown status'); game.status = p.status; }
  if ('rating' in p) {
    if (p.rating !== null && !(Number.isInteger(p.rating) && p.rating >= 1 && p.rating <= 10)) throw bad('rating must be 1..10 or null');
    game.rating = p.rating;
  }
  if ('review' in p) game.review = str(p.review, 8000);
  if ('hours' in p) {
    if (p.hours !== null && !(typeof p.hours === 'number' && isFinite(p.hours) && p.hours >= 0 && p.hours <= 100000)) throw bad('hours must be a positive number or null');
    game.hours = p.hours === null ? null : Math.round(p.hours * 10) / 10;
  }
  if ('description' in p) game.description = str(p.description, 4000);
  if ('cover' in p) game.cover = p.cover === null || p.cover === '' ? null : (httpUrl(p.cover) || (function () { throw bad('invalid cover URL'); })());
  if ('guideUrl' in p) {
    if (p.guideUrl === null || p.guideUrl === '') game.guide = null;
    else { const u = httpUrl(p.guideUrl); if (!u) throw bad('invalid guide URL'); game.guide = { url: u, title: '', matched: true, manual: true, checkedAt: new Date().toISOString() }; }
  }
  return game;
}

/**
 * Replace the achievement list by a fresh one from a source while keeping what the user ticked:
 * match by id first, then by name (ids can differ between two readings of the same page).
 * `done` is only ever turned on here, never off.
 */
function mergeAchievements(existing, fresh, nowIso) {
  const byId = {}, byName = {};
  existing.forEach(function (a) { byId[a.id] = a; byName[normalizeTitle(a.name)] = a; });
  const merged = fresh.map(function (f) {
    const old = byId[f.id] || byName[normalizeTitle(f.name)];
    const c = cleanAchievement(f, true);
    if (!c) return null;
    if (old && old.done) { c.done = true; c.doneAt = old.doneAt || c.doneAt; }
    else if (c.done && !c.doneAt) c.doneAt = nowIso;
    return c;
  }).filter(Boolean);
  // manual achievements (typed by the user) survive a refresh
  const names = new Set(merged.map(function (a) { return normalizeTitle(a.name); }));
  existing.forEach(function (a) {
    if (/^m:/.test(a.id) && !names.has(normalizeTitle(a.name))) merged.push(a);
  });
  return merged;
}

/** Lines like "Nom du succès - description" or "Nom | description" -> manual achievements. */
function parseManualList(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    const l = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    if (!l) return;
    const m = /^(.+?)\s*(?:\||\s[-–—]\s|:\s)\s*(.+)$/.exec(l);
    out.push({ name: (m ? m[1] : l).slice(0, 300), description: m ? m[2].slice(0, 1000) : '' });
  });
  return out;
}

function manualAchievement(a) {
  return { id: 'm:' + newId().slice(0, 12), name: str(a.name, 300).trim(), description: str(a.description, 1000), icon: null, hidden: false, rarity: null, done: false, doneAt: null };
}

/** Accepts a client-supplied export entry (import). Strict: anything odd is dropped. */
function sanitizeImported(g) {
  if (!g || typeof g !== 'object' || typeof g.id !== 'string' || !/^[\w-]{8,64}$/.test(g.id)) return null;
  let game;
  try { game = buildGame(Object.assign({}, g), g.addedAt || new Date().toISOString()); } catch (e) { return null; }
  game.id = g.id;
  game.sources = buildGame({ title: 'x', sources: g.sources }, '').sources;
  try { patchGame(game, { rating: g.rating === undefined ? null : g.rating, hours: g.hours === undefined ? null : g.hours, review: g.review || '' }); } catch (e) { game.rating = null; game.hours = null; }
  game.addedAt = typeof g.addedAt === 'string' ? g.addedAt.slice(0, 40) : game.addedAt;
  if (g.guide && httpUrl(g.guide.url)) game.guide = { url: httpUrl(g.guide.url), title: str(g.guide.title, 200), matched: !!g.guide.matched, manual: !!g.guide.manual, checkedAt: str(g.guide.checkedAt, 40) };
  return game;
}

module.exports = { cleanAchSource, STATUSES, PLATFORMS, TROPHY_TYPES, buildGame, patchGame, mergeAchievements, parseManualList, manualAchievement, cleanAchievement, sanitizeImported, httpUrl, str };
