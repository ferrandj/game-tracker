'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./store');
const { createProviders } = require('./providers');
const { createCatalog } = require('./catalog');
const { createImages } = require('./images');
const model = require('./model');

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
const GUIDE_TIMEOUT_MS = 8000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self'; " +
  "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let n = 0;
    req.on('data', function (c) {
      n += c.length;
      if (n > limit) { reject(Object.assign(new Error('payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const text = (await readBody(req, limit || MAX_JSON_BYTES)).toString('utf8');
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (v === null || typeof v !== 'object') throw new Error('not an object');
    return v;
  } catch (e) { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

function send(res, status, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  if (body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body);
    h['Content-Type'] = 'application/json; charset=utf-8';
  }
  res.writeHead(status, h);
  res.end(body);
}

function withTimeout(promise, ms, fallback) {
  let t;
  return Promise.race([promise, new Promise(function (resolve) { t = setTimeout(function () { resolve(fallback); }, ms); })]).finally(function () { clearTimeout(t); });
}

function createServer(opts) {
  const store = opts.store;
  const catalog = opts.catalog;
  const images = opts.images;
  const PUBLIC_DIR = path.resolve(opts.publicDir || process.env.PUBLIC_DIR || path.join(__dirname, '..', 'web', 'dist'));
  const authUser = opts.authUser, authPass = opts.authPassword;
  const version = String(opts.version || process.env.APP_VERSION || 'dev');
  const now = opts.now || function () { return new Date().toISOString(); };

  function game(id) {
    const g = store.get(id);
    if (!g) throw Object.assign(new Error('game not found'), { status: 404 });
    return g;
  }

  /** Re-read the achievements from the source for the game's platform and merge them into the stored game. */
  async function fetchAchievements(id) {
    const g = game(id);
    const got = await catalog.achievementsFor(g);
    return store.update(id, function (cur) {
      cur.achievements = model.mergeAchievements(cur.achievements, got.list, now());
      cur.achievementsSource = model.cleanAchSource(got.source);
      return cur;
    });
  }

  async function lookupGuide(id) {
    const g = game(id);
    const guide = await catalog.guideFor(g.title);
    return store.update(id, function (cur) {
      // a link typed by hand is never replaced by an automatic one
      if (cur.guide && cur.guide.manual) return cur;
      cur.guide = { url: guide.url, title: guide.title, matched: guide.matched, checkedAt: now() };
      return cur;
    });
  }

  async function api(req, res, url) {
    const m = req.method, p = url.pathname;
    if (m !== 'GET' && m !== 'HEAD') {
      // CSRF guard: custom header (forces a CORS preflight, which we never grant) + same-origin check.
      if (req.headers['x-tracker-client'] !== '1') return send(res, 403, { error: 'missing client header' });
      const origin = req.headers.origin;
      if (origin) {
        let ok = false;
        try { ok = new URL(origin).host === req.headers.host; } catch (e) { ok = false; }
        if (!ok) return send(res, 403, { error: 'cross-origin request refused' });
      }
    }
    if (p === '/api/version' && m === 'GET') return send(res, 200, { version: version });
    if (p === '/api/config' && m === 'GET') return send(res, 200, Object.assign({ version: version, statuses: model.STATUSES, platforms: model.PLATFORMS }, catalog.info()));

    if (p === '/api/search' && m === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
      if (q.length < 2) return send(res, 200, { results: [], errors: {} });
      return send(res, 200, await catalog.search(q));
    }

    if (p === '/api/img' && m === 'GET') {
      const hit = await images.get(url.searchParams.get('u') || '');
      if (!hit) return send(res, 404, { error: 'image not available' });
      res.writeHead(200, {
        'Content-Type': hit.type, 'Content-Length': hit.size, 'Cache-Control': 'private, max-age=2592000, immutable',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"
      });
      if (m === 'HEAD') return res.end();
      return fs.createReadStream(hit.path).pipe(res);
    }

    if (p === '/api/games' && m === 'GET') return send(res, 200, { rev: store.rev, games: store.list() });

    if (p === '/api/games' && m === 'POST') {
      const body = await readJson(req);
      const sources = Array.isArray(body.sources) ? body.sources.slice(0, 4) : [];
      const meta = await catalog.resolve(sources, { title: body.title, cover: body.cover, art: body.art, year: body.year });
      const g = model.buildGame({
        title: meta.title || body.title, platform: body.platform, sources: sources, cover: meta.cover, art: meta.art, description: meta.description || body.description,
        year: meta.year, genres: meta.genres, developers: meta.developers, status: body.status
      }, now());
      const warnings = [];
      const wantPs = /^(ps5|ps4|ps3|vita)$/.test(g.platform);
      const [ach, guide] = await Promise.all([
        body.fetchAchievements === false ? null : catalog.achievementsFor(g).catch(function (e) { warnings.push(e.userFacing ? e.message : 'Succès indisponibles pour le moment (' + e.message + ').'); return null; }),
        wantPs ? withTimeout(catalog.guideFor(g.title), GUIDE_TIMEOUT_MS, null).catch(function () { return null; }) : null
      ]);
      if (ach) {
        g.achievements = model.mergeAchievements([], ach.list, now());
        g.achievementsSource = model.cleanAchSource(ach.source);
      }
      if (guide) g.guide = { url: guide.url, title: guide.title, matched: guide.matched, checkedAt: now() };
      store.create(g);
      return send(res, 201, { game: g, warnings: warnings });
    }

    if (p === '/api/export' && m === 'GET') {
      return send(res, 200, JSON.stringify({ app: 'game-tracker', exportedAt: now(), games: store.list() }, null, 2), {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="game-tracker-export-' + now().slice(0, 10) + '.json"'
      });
    }
    if (p === '/api/import' && m === 'POST') {
      const body = await readJson(req, MAX_IMPORT_BYTES);
      if (!Array.isArray(body.games)) return send(res, 400, { error: 'not a Game Tracker export' });
      const games = body.games.map(model.sanitizeImported).filter(Boolean);
      return send(res, 200, Object.assign({ received: body.games.length, valid: games.length }, store.importGames(games)));
    }
    if (p === '/api/backups' && m === 'GET') return send(res, 200, { backups: store.listBackups() });
    if (p === '/api/backups/restore' && m === 'POST') {
      const body = await readJson(req, 4096);
      return send(res, 200, { rev: store.restore(String(body.name || '')) });
    }

    const gm = /^\/api\/games\/([\w-]{8,64})(?:\/(achievements|guide)(?:\/([^/]+))?)?$/.exec(p);
    if (!gm) return send(res, 404, { error: 'not found' });
    const id = gm[1], sub = gm[2], arg = gm[3];

    if (!sub) {
      if (m === 'GET') return send(res, 200, { game: game(id) });
      if (m === 'PATCH') {
        const body = await readJson(req);
        game(id);
        return send(res, 200, { game: store.update(id, function (g) { return model.patchGame(g, body); }) });
      }
      if (m === 'DELETE') { game(id); store.remove(id); return send(res, 200, { ok: true }); }
    }

    if (sub === 'guide' && m === 'POST') { game(id); return send(res, 200, { game: await lookupGuide(id) }); }

    if (sub === 'achievements') {
      if (!arg && m === 'POST') {
        // add by hand: { name, description } or { text } (one per line)
        const body = await readJson(req);
        const items = body.text !== undefined ? model.parseManualList(body.text) : [{ name: body.name, description: body.description }];
        const fresh = items.filter(function (a) { return a.name && String(a.name).trim(); }).map(model.manualAchievement);
        if (!fresh.length) return send(res, 400, { error: 'nothing to add' });
        game(id);
        return send(res, 200, { game: store.update(id, function (g) {
          g.achievements = g.achievements.concat(fresh).slice(0, 2000);
          if (!g.achievementsSource) g.achievementsSource = { provider: 'manual', ref: '', fetchedAt: now() };
          return g;
        }), added: fresh.length });
      }
      if (arg === 'fetch' && m === 'POST') { game(id); return send(res, 200, { game: await fetchAchievements(id) }); }
      if (arg === 'all' && m === 'POST') {
        const body = await readJson(req);
        game(id);
        const done = !!body.done;
        return send(res, 200, { game: store.update(id, function (g) {
          g.achievements.forEach(function (a) { if (a.done !== done) { a.done = done; a.doneAt = done ? now() : null; } });
          return g;
        }) });
      }
      if (arg && m === 'PUT') {
        const body = await readJson(req);
        const aid = decodeURIComponent(arg);
        if (!game(id).achievements.some(function (a) { return a.id === aid; })) return send(res, 404, { error: 'achievement not found' });
        return send(res, 200, { game: store.update(id, function (g) {
          g.achievements.forEach(function (a) {
            if (a.id === aid) { a.done = !!body.done; a.doneAt = a.done ? now() : null; }
          });
          return g;
        }) });
      }
      if (arg && m === 'DELETE') {
        const aid = decodeURIComponent(arg);
        if (!/^m:/.test(aid)) return send(res, 400, { error: 'only achievements added by hand can be removed' });
        game(id);
        return send(res, 200, { game: store.update(id, function (g) { g.achievements = g.achievements.filter(function (a) { return a.id !== aid; }); return g; }) });
      }
    }
    return send(res, 404, { error: 'not found' });
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed', { 'Content-Type': 'text/plain' });
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain' }); }
    if (rel.indexOf('\0') >= 0) return send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain' });
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (file !== PUBLIC_DIR && file.indexOf(PUBLIC_DIR + path.sep) !== 0) return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
    fs.stat(file, function (err, st) {
      if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size,
        // Vite fingerprints everything under /assets, so those files can be cached forever
        'Cache-Control': /\/assets\//.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache'
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  return http.createServer(function (req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (!res.hasHeader('Content-Security-Policy')) res.setHeader('Content-Security-Policy', CSP);
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain' }); }
    if (url.pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
    if (authUser && authPass) {
      const h = req.headers.authorization || '';
      let ok = false;
      if (h.indexOf('Basic ') === 0) {
        const dec = Buffer.from(h.slice(6), 'base64').toString('utf8');
        const i = dec.indexOf(':');
        ok = i >= 0 && safeEqual(dec.slice(0, i), authUser) && safeEqual(dec.slice(i + 1), authPass);
      }
      if (!ok) return send(res, 401, 'Authentication required', { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Basic realm="Game Tracker", charset="UTF-8"' });
    }
    if (url.pathname.indexOf('/api/') === 0) {
      api(req, res, url).catch(function (e) {
        if (!e.status) console.error('[error]', req.method, url.pathname, e);
        if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'internal error', code: e.code });
        else res.destroy();
      });
      return;
    }
    serveStatic(req, res, url);
  });
}

/**
 * NAS-friendly start-up. The container starts as root, looks at who owns the data folder and then runs the server as that
 * user (or, when Docker created the folder as root, hands it to the unprivileged user 1000). Privileges are dropped before
 * anything listens on the network, so the server itself never runs as root. If the container was started with a fixed
 * non-root user (compose "user:"), nothing changes and that user must be able to write to the folder.
 */
function dropPrivileges(dataDir) {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return null;
  const st = fs.statSync(dataDir);
  let uid = st.uid, gid = st.gid;
  if (uid === 0) { uid = 1000; gid = 1000; }
  // make sure everything already inside belongs to that user too (ownership only, nothing is ever deleted or rewritten)
  const todo = [dataDir];
  while (todo.length) {
    const dir = todo.pop();
    const own = fs.lstatSync(dir);
    if (own.uid !== uid || own.gid !== gid) fs.lchownSync(dir, uid, gid);
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name), e = fs.lstatSync(full);
      if (e.isDirectory()) todo.push(full);
      else if (e.uid !== uid || e.gid !== gid) fs.lchownSync(full, uid, gid);
    }
  }
  process.setgroups([]);
  process.setgid(gid);
  process.setuid(uid);
  return { uid: uid, gid: gid };
}

function describeFolder(dir) {
  try { const st = fs.statSync(dir); return 'owner ' + st.uid + ':' + st.gid + ', mode ' + (st.mode & 0o777).toString(8); } catch (e) { return 'unreadable (' + e.code + ')'; }
}

function main() {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  const port = parseInt(process.env.PORT || '8080', 10);
  console.log('[game-tracker] starting v' + (process.env.APP_VERSION || 'dev') + ' as uid ' + (process.getuid ? process.getuid() : '?') + ', data folder ' + dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const before = describeFolder(dataDir);
  const dropped = dropPrivileges(dataDir);
  if (dropped) console.log('[game-tracker] data folder had ' + before + ' -> running as uid ' + dropped.uid + ', gid ' + dropped.gid);
  try { fs.accessSync(dataDir, fs.constants.W_OK); } catch (e) {
    throw new Error(dataDir + ' is not writable by this user (uid ' + process.getuid() + '; the folder has ' + describeFolder(dataDir) + '). Fix the folder permissions or run the container with `user: "UID:GID"` of the folder owner.');
  }
  const every = process.env.SNAPSHOT_INTERVAL_SEC === undefined ? undefined : Math.max(0, parseFloat(process.env.SNAPSHOT_INTERVAL_SEC)) * 1000;
  const store = new Store(dataDir, { snapshotEveryMs: every }).init();
  const providers = createProviders(process.env);
  const catalog = createCatalog(providers);
  const extraImageHosts = String(process.env.IMAGE_ALLOW_PREFIXES || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  const images = createImages(path.join(dataDir, 'covers'), globalThis.fetch, extraImageHosts);
  const info = catalog.info();
  const server = createServer({ store: store, catalog: catalog, images: images, authUser: process.env.AUTH_USER, authPassword: process.env.AUTH_PASSWORD });
  server.listen(port, '0.0.0.0', function () {
    console.log('[game-tracker] version ' + (process.env.APP_VERSION || 'dev') + ' listening on :' + port + ', data in ' + dataDir + ', ' + store.list().length + ' game(s), revision ' + store.rev);
    console.log('[game-tracker] search: ' + info.search.join(', ') + ' | steam achievements: ' + info.steamAchievements + ' | PSN trophies: ' + (info.psn ? 'on' : 'off (set PSN_NPSSO)'));
  });
  const stop = function () { server.close(function () { process.exit(0); }); setTimeout(function () { process.exit(0); }, 3000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('[fatal]', e.message); process.exit(1); }
}

module.exports = { createServer };
