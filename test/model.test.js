'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../server/model');
const { createCatalog } = require('../server/catalog');
const { createProviders } = require('../server/providers');
const { fakeFetch, json, html } = require('./helpers');

const NOW = '2026-05-01T10:00:00.000Z';
const ach = (id, name, extra) => Object.assign({ id, name, description: '', icon: null, hidden: false, rarity: null, done: false, doneAt: null }, extra);

test('mergeAchievements keeps what was ticked (by id, then by name) and never un-ticks', () => {
  const existing = [ach('a', 'One', { done: true, doneAt: '2026-01-01' }), ach('b', 'Two'), ach('m:1', 'Mine')];
  const fresh = [ach('a', 'One'), ach('x', 'two'), ach('c', 'Three', { done: true })];
  const out = model.mergeAchievements(existing, fresh, NOW);
  assert.deepEqual(out.map((a) => [a.id, a.done]), [['a', true], ['x', false], ['c', true], ['m:1', false]]);
  assert.equal(out[0].doneAt, '2026-01-01');
  assert.equal(out[2].doneAt, NOW, 'earned on the console without a date: stamped now');
});

test('parseManualList understands bullets, numbers and three separators', () => {
  const r = model.parseManualList('- Un : deux\n2) Trois | quatre\n• Cinq - six\nSept\n\n   \nHuit-neuf');
  assert.deepEqual(r.map((x) => [x.name, x.description]), [['Un', 'deux'], ['Trois', 'quatre'], ['Cinq', 'six'], ['Sept', ''], ['Huit-neuf', '']]);
});

test('buildGame cleans everything it is given', () => {
  const g = model.buildGame({ title: '  Hades \u0000', platform: 'nope', sources: [{ provider: 'steam', id: '1' }, { provider: 'evil', id: '2' }, { provider: 'rawg', id: '../x' }], cover: 'javascript:alert(1)', art: 'https://x.example/a.jpg', year: 1800, genres: ['a', '', 'b'], status: 'wat',
    achievements: [ach('1', 'ok', { done: true }), { id: '', name: 'no id' }, { id: '2', name: '' }, ach('3', 'rare', { rarity: 400, type: 'diamond' })] }, NOW);
  assert.deepEqual([g.title, g.platform, g.cover, g.art, g.year, g.status], ['Hades', 'other', null, 'https://x.example/a.jpg', null, 'backlog']);
  assert.deepEqual(g.sources, [{ provider: 'steam', id: '1' }]);
  assert.deepEqual(g.genres, ['a', 'b']);
  assert.deepEqual(g.achievements.map((a) => [a.id, a.done, a.rarity, a.type]), [['1', true, null, undefined], ['3', false, 100, undefined]]);
  assert.throws(() => model.buildGame({ title: '   ' }, NOW), /title is required/);
});

test('sanitizeImported accepts real exports and drops anything suspicious', () => {
  const good = model.buildGame({ title: 'Imported', platform: 'ps5', rating: 8 }, NOW);
  good.rating = 8; good.review = 'ok'; good.hours = 3.5; good.guide = { url: 'https://www.psthc.fr/x/', title: 't', matched: true };
  const out = model.sanitizeImported(JSON.parse(JSON.stringify(good)));
  assert.equal(out.id, good.id);
  assert.deepEqual([out.rating, out.review, out.hours, out.guide.url], [8, 'ok', 3.5, 'https://www.psthc.fr/x/']);
  assert.equal(model.sanitizeImported({ id: '../etc', title: 'x' }), null);
  assert.equal(model.sanitizeImported({ id: 'abcdefgh', title: '' }), null);
  assert.equal(model.sanitizeImported(null), null);
  const odd = model.sanitizeImported({ id: 'abcdefgh', title: 'Odd', rating: 99, guide: { url: 'javascript:1' } });
  assert.deepEqual([odd.rating, odd.guide], [null, null]);
});

function catalogWith(env, routes) { return createCatalog(createProviders(env, fakeFetch(routes))); }
const game = (over) => Object.assign({ title: 'Hades', platform: 'steam', sources: [] }, over);

test('catalog: Steam game found by title when it came from another database; a wrong title is explained', async () => {
  const c = catalogWith({}, [['/api/storesearch/', { items: [{ type: 'app', id: 1145360, name: 'Hades' }] }], ['/stats/1145360/', html('<div class="achieveRow "><h3>Un</h3><h5>d</h5></div>')]]);
  const r = await c.achievementsFor(game());
  assert.deepEqual([r.source.provider, r.source.ref, r.list.length], ['steam', '1145360', 1]);
  await assert.rejects(c.achievementsFor(game({ title: 'Totally unknown thing' })), /Aucun jeu Steam/);
});

test('catalog: PlayStation needs the PSN account; a game never played is explained', async () => {
  await assert.rejects(catalogWith({}, []).achievementsFor(game({ platform: 'ps5' })), (e) => e.code === 'psn_disabled' && e.userFacing);
  const psn = [
    [/oauth\/authorize/, new Response(null, { status: 302, headers: { location: 'x://r/?code=C' } })],
    [/oauth\/token/, { access_token: 'T' }],
    ['/trophyTitles', { trophyTitles: [{ npCommunicationId: 'NPWR1_00', npServiceName: 'trophy', trophyTitleName: 'Bloodborne', trophyTitlePlatform: 'PS4' }] }],
    ['/users/me/npCommunicationIds/', { trophies: [{ trophyId: 0, earned: true }] }],
    ['/npCommunicationIds/NPWR1_00/', { trophies: [{ trophyId: 0, trophyName: 'Platine', trophyType: 'platinum' }] }]
  ];
  const c = catalogWith({ PSN_NPSSO: 'x' }, psn);
  const r = await c.achievementsFor(game({ title: 'Bloodborne', platform: 'ps4' }));
  assert.deepEqual([r.source.provider, r.list[0].done, r.list[0].type], ['psn', true, 'platinum']);
  await assert.rejects(c.achievementsFor(game({ title: 'Elden Ring', platform: 'ps5' })), (e) => e.code === 'psn_not_found');
  await assert.rejects(c.achievementsFor(game({ platform: 'xbox-one' })), (e) => e.code === 'no_provider');
});

test('catalog: details fall back to what the client sent when every source is down', async () => {
  const c = catalogWith({}, [['/api/appdetails', json({}, 500)]]);
  const meta = await c.resolve([{ provider: 'steam', id: '1' }], { title: 'Hades', cover: 'https://x.example/c.jpg', year: 2020 });
  assert.deepEqual([meta.title, meta.cover, meta.year, meta.resolved], ['Hades', 'https://x.example/c.jpg', 2020, 0]);
});
