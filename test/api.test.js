'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Store } = require('../server/store');
const { createServer } = require('../server/index');
const { createCatalog } = require('../server/catalog');
const { createProviders } = require('../server/providers');
const { createImages } = require('../server/images');
const { tmpDir, fakeFetch, json, html } = require('./helpers');

const STEAM_PAGE = '<div class="achieveRow "><div class="achieveImgHolder"><img src="https://cdn.cloudflare.steamstatic.com/a.jpg"></div><div class="achieveTxtHolder"><div class="achievePercent">10.0%</div><div class="achieveTxt"><h3>Premier pas</h3><h5>Commencer</h5></div></div></div>' +
  '<div class="achieveRow "><div class="achieveImgHolder"><img src="https://cdn.cloudflare.steamstatic.com/b.jpg"></div><div class="achieveTxtHolder"><div class="achievePercent">2.5%</div><div class="achieveTxt"><h3>Légende</h3><h5>Tout finir</h5></div></div></div>';

function upstream() {
  return fakeFetch([
    ['/api/storesearch/', { items: [{ type: 'app', id: 1245620, name: 'ELDEN RING' }] }],
    ['/api/appdetails', { 1245620: { success: true, data: { name: 'ELDEN RING', short_description: 'Un grand RPG.', release_date: { date: '2022' }, genres: [{ description: 'RPG' }], developers: ['FromSoftware'] } } }],
    ['/stats/1245620/achievements', html(STEAM_PAGE)],
    ['/wp-json/wp/v2/search', [{ title: 'Guide des trophées de Elden Ring', url: 'https://www.psthc.fr/guide-trophees-elden-ring/' }]],
    [(u) => u.startsWith('https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/library'), () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } })]
  ]);
}

async function boot(over) {
  over = over || {};
  const dir = tmpDir();
  const f = over.fetch || upstream();
  const store = new Store(dir, { snapshotEveryMs: 0 }).init();
  const catalog = createCatalog(createProviders(over.env || {}, f));
  const images = createImages(path.join(dir, 'covers'), f);
  const server = createServer(Object.assign({ store, catalog, images, publicDir: dir, version: 'test' }, over.server || {}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (method, p, body, headers) => {
    const res = await fetch(base + p, { method, headers: Object.assign({ 'x-tracker-client': '1', 'content-type': 'application/json' }, headers || {}), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: res.status, data, headers: res.headers };
  };
  return { base, call, store, f, dir, close: () => new Promise((r) => server.close(r)) };
}

test('config, search merges sources, and one source failing does not hide the others', async () => {
  const t = await boot();
  try {
    assert.equal((await t.call('GET', '/api/config')).data.steamAchievements, 'page');
    const r = await t.call('GET', '/api/search?q=elden');
    assert.equal(r.status, 200);
    assert.equal(r.data.results[0].title, 'ELDEN RING');
    assert.deepEqual(r.data.results[0].sources, [{ provider: 'steam', id: '1245620' }]);
    assert.deepEqual((await t.call('GET', '/api/search?q=e')).data.results, []);
  } finally { await t.close(); }
  const down = await boot({ env: { RAWG_KEY: 'k' }, fetch: fakeFetch([['/api/storesearch/', { items: [{ type: 'app', id: 1, name: 'Zelda' }] }], ['api.rawg.io', json({}, 500)]]) });
  try {
    const r = await down.call('GET', '/api/search?q=zelda');
    assert.equal(r.data.results.length, 1);
    assert.match(r.data.errors.rawg, /HTTP 500/);
  } finally { await down.close(); }
});

test('search merges the same game found in two databases into one card', async () => {
  const f = fakeFetch([
    ['/api/storesearch/', { items: [{ type: 'app', id: 1245620, name: 'ELDEN RING' }] }],
    ['api.rawg.io/api/games?', { results: [{ id: 326243, name: 'Elden Ring', released: '2022-02-25', background_image: 'https://media.rawg.io/x.jpg', platforms: [{ platform: { slug: 'playstation5' } }] }] }]
  ]);
  const t = await boot({ env: { RAWG_KEY: 'k' }, fetch: f });
  try {
    const r = (await t.call('GET', '/api/search?q=elden ring')).data.results;
    assert.equal(r.length, 1);
    assert.deepEqual(r[0].sources.map((s) => s.provider).sort(), ['rawg', 'steam']);
    assert.equal(r[0].year, 2022);
    assert.match(r[0].cover, /library_600x900_2x/);
    assert.deepEqual(r[0].platforms.sort(), ['playstation5', 'steam']);
  } finally { await t.close(); }
});

test('adding a Steam game stores details and its achievements; ticking, progress and refresh keep them', async () => {
  const t = await boot();
  try {
    const add = await t.call('POST', '/api/games', { sources: [{ provider: 'steam', id: '1245620' }], platform: 'steam', title: 'x' });
    assert.equal(add.status, 201);
    const g = add.data.game;
    assert.equal(g.title, 'ELDEN RING');
    assert.equal(g.description, 'Un grand RPG.');
    assert.equal(g.year, 2022);
    assert.equal(g.status, 'backlog');
    assert.equal(g.achievements.length, 2);
    assert.deepEqual(g.achievementsSource.provider, 'steam');
    assert.equal(g.guide, null, 'psthc is for PlayStation games only');

    const aid = g.achievements[0].id;
    const tick = await t.call('PUT', '/api/games/' + g.id + '/achievements/' + encodeURIComponent(aid), { done: true });
    assert.equal(tick.data.game.achievements[0].done, true);
    assert.ok(tick.data.game.achievements[0].doneAt);

    const fresh = await t.call('POST', '/api/games/' + g.id + '/achievements/fetch');
    assert.equal(fresh.data.game.achievements[0].done, true, 'refresh keeps what was ticked');

    const all = await t.call('POST', '/api/games/' + g.id + '/achievements/all', { done: true });
    assert.ok(all.data.game.achievements.every((a) => a.done));
    const none = await t.call('POST', '/api/games/' + g.id + '/achievements/all', { done: false });
    assert.ok(none.data.game.achievements.every((a) => !a.done && a.doneAt === null));
    assert.equal((await t.call('PUT', '/api/games/' + g.id + '/achievements/unknown', { done: true })).status, 404);
  } finally { await t.close(); }
});

test('PlayStation games get the psthc guide link; a missing PSN account explains how to get trophies', async () => {
  const t = await boot();
  try {
    const add = await t.call('POST', '/api/games', { sources: [{ provider: 'steam', id: '1245620' }], platform: 'ps5' });
    assert.equal(add.status, 201);
    assert.equal(add.data.game.guide.url, 'https://www.psthc.fr/guide-trophees-elden-ring/');
    assert.equal(add.data.game.guide.matched, true);
    assert.equal(add.data.game.achievements.length, 0);
    assert.match(add.data.warnings[0], /PSN_NPSSO/);
  } finally { await t.close(); }
});

test('manual games: paste a list of achievements, add one, remove one, hand-written guide link survives lookups', async () => {
  const t = await boot();
  try {
    const add = await t.call('POST', '/api/games', { title: 'Mon jeu indé', platform: 'switch' });
    assert.equal(add.status, 201);
    assert.equal(add.data.warnings.length, 1);
    const id = add.data.game.id;
    const paste = await t.call('POST', '/api/games/' + id + '/achievements', { text: '- Premier sang : tuer un ennemi\n2) Finir le jeu | en moins de 3h\n\nSecret' });
    assert.equal(paste.data.added, 3);
    const names = paste.data.game.achievements.map((a) => [a.name, a.description]);
    assert.deepEqual(names, [['Premier sang', 'tuer un ennemi'], ['Finir le jeu', 'en moins de 3h'], ['Secret', '']]);
    const one = await t.call('POST', '/api/games/' + id + '/achievements', { name: 'Collectionneur' });
    assert.equal(one.data.game.achievements.length, 4);
    const mid = one.data.game.achievements[3].id;
    assert.match(mid, /^m:/);
    assert.equal((await t.call('DELETE', '/api/games/' + id + '/achievements/' + encodeURIComponent(mid))).data.game.achievements.length, 3);
    assert.equal((await t.call('POST', '/api/games/' + id + '/achievements', { name: '   ' })).status, 400);

    await t.call('PATCH', '/api/games/' + id, { guideUrl: 'https://www.psthc.fr/mon-guide/' });
    const looked = await t.call('POST', '/api/games/' + id + '/guide');
    assert.equal(looked.data.game.guide.url, 'https://www.psthc.fr/mon-guide/');
  } finally { await t.close(); }
});

test('rating, status, hours and review are validated', async () => {
  const t = await boot();
  try {
    const id = (await t.call('POST', '/api/games', { title: 'Hades', platform: 'pc', fetchAchievements: false })).data.game.id;
    const ok = await t.call('PATCH', '/api/games/' + id, { rating: 9, status: 'completed', hours: 41.26, review: 'Excellent' });
    assert.deepEqual([ok.data.game.rating, ok.data.game.status, ok.data.game.hours, ok.data.game.review], [9, 'completed', 41.3, 'Excellent']);
    for (const bad of [{ rating: 0 }, { rating: 11 }, { rating: 4.5 }, { status: 'nope' }, { hours: -1 }, { platform: 'dreamcast' }, { title: ' ' }, { cover: 'javascript:alert(1)' }]) {
      assert.equal((await t.call('PATCH', '/api/games/' + id, bad)).status, 400, JSON.stringify(bad));
    }
    const cleared = await t.call('PATCH', '/api/games/' + id, { rating: null, hours: null });
    assert.deepEqual([cleared.data.game.rating, cleared.data.game.hours], [null, null]);
    assert.equal((await t.call('PATCH', '/api/games/00000000-0000-0000-0000-000000000000', { rating: 3 })).status, 404);
    assert.equal((await t.call('POST', '/api/games', { platform: 'pc' })).status, 400, 'a title is required');
  } finally { await t.close(); }
});

test('delete, export and import round trip (import never overwrites)', async () => {
  const t = await boot();
  try {
    const a = (await t.call('POST', '/api/games', { title: 'A', platform: 'pc', fetchAchievements: false })).data.game;
    await t.call('PATCH', '/api/games/' + a.id, { rating: 7 });
    const exp = (await t.call('GET', '/api/export')).data;
    assert.equal(exp.app, 'game-tracker');
    assert.equal(exp.games.length, 1);
    assert.equal((await t.call('DELETE', '/api/games/' + a.id)).status, 200);
    assert.equal((await t.call('GET', '/api/games')).data.games.length, 0);
    const imp = await t.call('POST', '/api/import', exp);
    assert.deepEqual([imp.data.added, imp.data.skipped, imp.data.valid], [1, 0, 1]);
    assert.equal((await t.call('GET', '/api/games/' + a.id)).data.game.rating, 7);
    const again = await t.call('POST', '/api/import', exp);
    assert.deepEqual([again.data.added, again.data.skipped], [0, 1]);
    const junk = await t.call('POST', '/api/import', { games: [{ id: '../x', title: 'bad' }, { nope: 1 }] });
    assert.deepEqual([junk.data.valid, junk.data.added], [0, 0]);
    assert.equal((await t.call('POST', '/api/import', { nope: 1 })).status, 400);
  } finally { await t.close(); }
});

test('writes need the client header and a same-origin request; reads do not', async () => {
  const t = await boot();
  try {
    assert.equal((await t.call('POST', '/api/games', { title: 'X' }, { 'x-tracker-client': '0' })).status, 403);
    assert.equal((await t.call('POST', '/api/games', { title: 'X' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await t.call('POST', '/api/games', { title: 'X', fetchAchievements: false }, { origin: t.base })).status, 201);
    assert.equal((await fetch(t.base + '/api/games')).status, 200);
    assert.equal((await t.call('GET', '/api/nope')).status, 404);
    const bad = await fetch(t.base + '/api/games', { method: 'POST', headers: { 'x-tracker-client': '1' }, body: '{nope' });
    assert.equal(bad.status, 400);
  } finally { await t.close(); }
});

test('optional password protects the app and the API, but not /healthz', async () => {
  const t = await boot({ server: { authUser: 'me', authPassword: 'secret' } });
  try {
    assert.equal((await fetch(t.base + '/healthz')).status, 200);
    assert.equal((await fetch(t.base + '/api/games')).status, 401);
    const good = 'Basic ' + Buffer.from('me:secret').toString('base64');
    assert.equal((await fetch(t.base + '/api/games', { headers: { authorization: good } })).status, 200);
    assert.equal((await fetch(t.base + '/api/games', { headers: { authorization: 'Basic ' + Buffer.from('me:wrong').toString('base64') } })).status, 401);
  } finally { await t.close(); }
});

test('image proxy: only known HTTPS image hosts, cached on disk, strict headers', async () => {
  const t = await boot();
  try {
    const u = 'https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/library_600x900_2x.jpg';
    const ok = await fetch(t.base + '/api/img?u=' + encodeURIComponent(u));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/jpeg');
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
    const before = t.f.calls.length;
    assert.equal((await fetch(t.base + '/api/img?u=' + encodeURIComponent(u))).status, 200);
    assert.equal(t.f.calls.length, before, 'second request comes from the disk cache');
    for (const bad of ['http://cdn.cloudflare.steamstatic.com/a.jpg', 'https://evil.example/a.jpg', 'https://127.0.0.1/a.jpg', 'https://steamstatic.com.evil.example/a.jpg', 'https://user:pw@cdn.cloudflare.steamstatic.com/a.jpg', 'file:///etc/passwd', '']) {
      assert.equal((await fetch(t.base + '/api/img?u=' + encodeURIComponent(bad))).status, 404, bad);
    }
    assert.equal((await fetch(t.base + '/api/img?u=' + encodeURIComponent('https://cdn.cloudflare.steamstatic.com/missing.jpg'))).status, 404);
  } finally { await t.close(); }
});

test('serves the built app and refuses path traversal', async () => {
  const fs = require('fs');
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'index.html'), '<div id="root"></div>');
  const t = await boot({ server: { publicDir: dir } });
  try {
    const home = await fetch(t.base + '/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal((await fetch(t.base + '/..%2f..%2f..%2fetc%2fpasswd')).status, 403);
    assert.equal((await fetch(t.base + '/nothing.js')).status, 404);
  } finally { await t.close(); }
});
