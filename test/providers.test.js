'use strict';
/* The data sources are tested against canned answers in the formats documented by each service. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeFetch, json, html } = require('./helpers');
const { createSteam } = require('../server/providers/steam');
const { createRawg } = require('../server/providers/rawg');
const { createIgdb } = require('../server/providers/igdb');
const { createPsn } = require('../server/providers/psn');
const { createPsthc } = require('../server/providers/psthc');
const { similarity, normalizeTitle, htmlToText } = require('../server/text');

test('text: titles are compared the way people read them', () => {
  assert.equal(normalizeTitle('The Witcher® 3: Wild Hunt'), 'the witcher 3 wild hunt');
  assert.equal(similarity('Elden Ring', 'ELDEN RING™'), 1);
  assert.ok(similarity('Elden Ring', 'Elden Ring Deluxe Edition') >= 0.8);
  assert.ok(similarity('Elden Ring', 'Dark Souls III') < 0.3);
  assert.equal(similarity('', 'x'), 0);
  assert.equal(htmlToText('<p>Un &amp; deux</p><br>trois<ul><li>a</li></ul>'), 'Un & deux\n\ntrois a');
});

const STEAM_PAGE = `
<div id="personalAchieve"></div>
<div class="achieveRow ">
  <div class="achieveImgHolder"><img src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1/a.jpg" width="64" height="64" border="0"></div>
  <div class="achieveTxtHolder"><div class="achievePercent">57.1%</div><div class="achieveTxt"><h3>Elden Ring</h3><h5>Vaincre le dernier boss &amp; devenir seigneur</h5></div></div>
</div>
<div class="achieveRow ">
  <div class="achieveImgHolder"><img src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1/b.jpg"></div>
  <div class="achieveTxtHolder"><div class="achievePercent">3,4%</div><div class="achieveTxt"><h3>Elden Ring</h3><h5></h5></div></div>
</div>`;

test('steam: search keeps apps only and builds portrait + header images', async () => {
  const f = fakeFetch([['/api/storesearch/', { total: 3, items: [{ type: 'app', id: 1245620, name: 'ELDEN RING', tiny_image: 'x' }, { type: 'sub', id: 9, name: 'Bundle' }, { type: 'app', id: 5, name: '' }] }]]);
  const steam = createSteam({ fetch: f });
  const r = await steam.search('elden ring');
  assert.equal(r.length, 1);
  assert.equal(r[0].provider, 'steam');
  assert.match(r[0].cover, /apps\/1245620\/library_600x900_2x\.jpg$/);
  assert.match(r[0].art, /apps\/1245620\/header\.jpg$/);
  assert.match(f.calls[0].url, /term=elden%20ring&l=french/);
});

test('steam: details', async () => {
  const f = fakeFetch([['/api/appdetails', { 1245620: { success: true, data: { name: 'ELDEN RING', short_description: 'Un <b>RPG</b> &amp; plus', release_date: { date: '24 févr. 2022' }, genres: [{ description: 'RPG' }], developers: ['FromSoftware'], achievements: { total: 42 } } } }]]);
  const d = await createSteam({ fetch: f }).details('1245620');
  assert.equal(d.title, 'ELDEN RING');
  assert.equal(d.description, 'Un RPG & plus');
  assert.equal(d.year, 2022);
  assert.deepEqual(d.genres, ['RPG']);
  await assert.rejects(createSteam({ fetch: fakeFetch([['/api/appdetails', { 7: { success: false } }]]) }).details('7'), /no such app/);
});

test('steam: achievements from the public page when there is no key', async () => {
  const f = fakeFetch([['/stats/1245620/achievements', html(STEAM_PAGE)]]);
  const steam = createSteam({ fetch: f });
  assert.equal(steam.achievementMode, 'page');
  const list = await steam.achievements('1245620');
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'Elden Ring');
  assert.equal(list[0].description, 'Vaincre le dernier boss & devenir seigneur');
  assert.equal(list[0].rarity, 57.1);
  assert.equal(list[1].rarity, 3.4);
  assert.notEqual(list[0].id, list[1].id, 'two achievements with the same name still get distinct ids');
});

test('steam: achievements from the official API with a key (schema + rarity), falling back to the page', async () => {
  const f = fakeFetch([
    ['GetSchemaForGame', { game: { availableGameStats: { achievements: [{ name: 'ACH_1', displayName: 'Premier', description: 'Desc', hidden: 0, icon: 'https://cdn.cloudflare.steamstatic.com/i.jpg' }, { name: 'ACH_2', displayName: 'Secret', hidden: 1 }] } } }],
    ['GetGlobalAchievementPercentagesForApp', { achievementpercentages: { achievements: [{ name: 'ACH_1', percent: '45.678' }] } }]
  ]);
  const steam = createSteam({ fetch: f, key: 'K' });
  assert.equal(steam.achievementMode, 'key');
  const list = await steam.achievements('1');
  assert.deepEqual(list.map((a) => [a.id, a.name, a.hidden, a.rarity]), [['ACH_1', 'Premier', false, 45.7], ['ACH_2', 'Secret', true, null]]);
  assert.match(f.calls[0].url, /key=K&appid=1&l=french/);
  const broken = createSteam({ fetch: fakeFetch([['GetSchemaForGame', json({}, 403)], ['/stats/1/achievements', html(STEAM_PAGE)]]), key: 'bad' });
  assert.equal((await broken.achievements('1')).length, 2);
});

test('steam: findByTitle only accepts a close match', async () => {
  const f = fakeFetch([['/api/storesearch/', { items: [{ type: 'app', id: 1, name: 'Elden Ring' }, { type: 'app', id: 2, name: 'Ring of Pain' }] }]]);
  const steam = createSteam({ fetch: f });
  assert.equal((await steam.findByTitle('Elden Ring')).id, '1');
  assert.equal(await steam.findByTitle('Something else entirely'), null);
});

test('rawg: search and details', async () => {
  const f = fakeFetch([
    ['/games?key=', { results: [{ id: 3328, name: 'The Witcher 3', released: '2015-05-18', background_image: 'https://media.rawg.io/a.jpg', platforms: [{ platform: { slug: 'pc' } }] }] }],
    ['/games/3328', { id: 3328, name: 'The Witcher 3', description_raw: 'Great game', released: '2015-05-18', genres: [{ name: 'RPG' }], developers: [{ name: 'CD PROJEKT RED' }], background_image: 'https://media.rawg.io/a.jpg' }]
  ]);
  const rawg = createRawg({ fetch: f, key: 'K' });
  const s = await rawg.search('witcher');
  assert.deepEqual([s[0].provider, s[0].year, s[0].cover, s[0].platforms], ['rawg', 2015, null, ['pc']]);
  const d = await rawg.details('3328');
  assert.deepEqual([d.description, d.developers, d.year], ['Great game', ['CD PROJEKT RED'], 2015]);
});

test('igdb: gets a token once, then searches with Apicalypse and builds cover URLs', async () => {
  let tokens = 0;
  const f = fakeFetch([
    [/oauth2\/token/, () => { tokens++; return json({ access_token: 'T', expires_in: 3600 }); }],
    [(u, i) => u.endsWith('/games') && /search "Elden Ring"/.test(i.body || ''), [{ id: 119133, name: 'Elden Ring', first_release_date: 1645747200, cover: { image_id: 'co4jni' }, screenshots: [{ image_id: 'sc1' }], platforms: [{ slug: 'ps5' }] }]],
    [(u, i) => u.endsWith('/games') && /where id = 119133/.test(i.body || ''), [{ id: 119133, name: 'Elden Ring', summary: 'Résumé', first_release_date: 1645747200, genres: [{ name: 'RPG' }], involved_companies: [{ developer: true, company: { name: 'FromSoftware' } }, { developer: false, company: { name: 'Bandai' } }], cover: { image_id: 'co4jni' }, artworks: [{ image_id: 'ar1' }] }]]
  ]);
  const igdb = createIgdb({ fetch: f, clientId: 'id', clientSecret: 'secret' });
  const s = await igdb.search('Elden Ring');
  assert.equal(s[0].year, 2022);
  assert.equal(s[0].cover, 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co4jni.jpg');
  const d = await igdb.details('119133');
  assert.deepEqual([d.developers, d.art], [['FromSoftware'], 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/ar1.jpg']);
  assert.equal(tokens, 1);
  const call = f.calls.find((c) => c.url.endsWith('/games'));
  assert.equal(call.init.headers['Client-ID'], 'id');
  assert.equal(call.init.headers.Authorization, 'Bearer T');
  await assert.rejects(igdb.details('1; drop'), /bad id/);
});

test('igdb: a quote in the query cannot break out of the Apicalypse string', async () => {
  const f = fakeFetch([[/oauth2\/token/, { access_token: 'T' }], [(u) => u.endsWith('/games'), []]]);
  const igdb = createIgdb({ fetch: f, clientId: 'id', clientSecret: 's' });
  await igdb.search('a"; fields *; where id = 1; "');
  const body = f.calls.find((c) => c.url.endsWith('/games')).init.body;
  const clause = body.slice(0, body.indexOf('"; fields name'));
  assert.equal((clause.match(/"/g) || []).length, 1, 'only the opening delimiter precedes the closing one: ' + clause);
});

function psnRoutes() {
  return [
    [/oauth\/authorize/, (u, i) => {
      assert.match(i.headers.Cookie, /^npsso=NPSSO$/);
      assert.equal(i.redirect, 'manual');
      return new Response(null, { status: 302, headers: { location: 'com.scee.psxandroid.scecompcall://redirect/?code=v3.CODE&cid=1' } });
    }],
    [/oauth\/token/, (u, i) => { assert.match(i.body, /code=v3\.CODE/); assert.match(i.headers.Authorization, /^Basic /); return json({ access_token: 'AT', expires_in: 3600 }); }],
    ['/users/me/trophyTitles', { trophyTitles: [{ npCommunicationId: 'NPWR22000_00', npServiceName: 'trophy2', trophyTitleName: 'ELDEN RING', trophyTitlePlatform: 'PS5' }, { npCommunicationId: 'NPWR11111_00', npServiceName: 'trophy', trophyTitleName: 'Bloodborne', trophyTitlePlatform: 'PS4' }] }],
    ['/users/me/npCommunicationIds/NPWR22000_00', { trophies: [{ trophyId: 0, earned: true, earnedDateTime: '2026-03-01T10:00:00Z' }, { trophyId: 1, earned: false }] }],
    ['/npCommunicationIds/NPWR22000_00/trophyGroups/all/trophies', { trophies: [
      { trophyId: 0, trophyHidden: false, trophyType: 'platinum', trophyName: 'Elden Ring', trophyDetail: 'Tous les trophées', trophyIconUrl: 'https://image.api.playstation.com/a.png', trophyEarnedRate: '5.2' },
      { trophyId: 1, trophyHidden: true, trophyType: 'bronze', trophyName: 'Secret', trophyDetail: '', trophyEarnedRate: '80' }
    ] }]
  ];
}

test('psn: authenticates with the npsso, finds the game in the account and reads trophies with earned state', async () => {
  const f = fakeFetch(psnRoutes());
  const psn = createPsn({ fetch: f, npsso: 'NPSSO' });
  const hit = await psn.findByTitle('Elden Ring', 'PS5');
  assert.equal(hit.ref, 'NPWR22000_00|trophy2');
  const list = await psn.achievements(hit.ref);
  assert.deepEqual(list.map((t) => [t.id, t.type, t.done, t.hidden, t.rarity]), [['psn:0', 'platinum', true, false, 5.2], ['psn:1', 'bronze', false, true, 80]]);
  assert.equal(list[0].doneAt, '2026-03-01T10:00:00Z');
  assert.equal(await psn.findByTitle('Never played this'), null);
  assert.equal(f.calls.filter((c) => /oauth\/token/.test(c.url)).length, 1, 'token reused');
  await assert.rejects(psn.achievements('../../x|trophy'), /bad reference/);
});

test('psn: an expired npsso gives a readable error', async () => {
  const f = fakeFetch([[/oauth\/authorize/, new Response(null, { status: 302, headers: { location: 'https://my.account.sony.com/login' } })]]);
  await assert.rejects(createPsn({ fetch: f, npsso: 'old' }).listTitles(), /npsso refused/);
});

const PSTHC_RESULTS = `
<nav><a href="/">Accueil</a><a href="/category/guides/">Guides</a></nav>
<article><h2><a href="https://www.psthc.fr/guide-trophees-elden-ring/">Guide des trophées de Elden Ring</a></h2></article>
<article><h2><a href="https://www.psthc.fr/guide-trophees-elden-ring-nightreign/">Guide des trophées de Elden Ring Nightreign</a></h2></article>
<a href="https://evil.example/guide-elden-ring">Elden Ring guide</a>`;

test('psthc: direct link to the guide through the search API', async () => {
  const f = fakeFetch([['/wp-json/wp/v2/search', [{ id: 1, title: 'Guide des trophées de Elden Ring', url: 'https://www.psthc.fr/guide-trophees-elden-ring/#top' }]]]);
  const g = await createPsthc({ fetch: f }).guideFor('Elden Ring');
  assert.deepEqual(g, { url: 'https://www.psthc.fr/guide-trophees-elden-ring/', title: 'Guide des trophées de Elden Ring', matched: true });
});

test('psthc: falls back to the HTML results, ignores navigation and other sites', async () => {
  const f = fakeFetch([['/wp-json/', json({}, 404)], ['/?s=Elden%20Ring', html(PSTHC_RESULTS)]]);
  const g = await createPsthc({ fetch: f }).guideFor('Elden Ring');
  assert.equal(g.url, 'https://www.psthc.fr/guide-trophees-elden-ring/');
  assert.equal(g.matched, true);
});

test('psthc: no clear match -> the site search page, never an error', async () => {
  const f = fakeFetch([['/wp-json/', json({}, 404)], ['/?s=', html('<a href="/category/x">Rien</a>')]]);
  const g = await createPsthc({ fetch: f }).guideFor('Jeu Inconnu');
  assert.deepEqual(g, { url: 'https://www.psthc.fr/?s=Jeu%20Inconnu', title: '', matched: false });
  const down = await createPsthc({ fetch: async () => { throw new Error('offline'); } }).guideFor('Zelda');
  assert.equal(down.matched, false);
});
