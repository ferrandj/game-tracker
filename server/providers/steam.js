'use strict';
/*
 * Steam: search + details work without any key (public store endpoints).
 * Achievements: with STEAM_API_KEY the official schema is used (clean, with hidden flags); without it the public
 * community page /stats/<appid>/achievements is read, which gives the same names, descriptions, icons and rarity.
 */
const { getJson, getText, UpstreamError } = require('./http');
const { stripTags, normalizeTitle, similarity, slug, htmlToText } = require('../text');

function createSteam(opts) {
  const fetchFn = opts.fetch;
  const key = opts.key || '';
  const storeBase = (opts.storeBase || 'https://store.steampowered.com').replace(/\/$/, '');
  const apiBase = (opts.apiBase || 'https://api.steampowered.com').replace(/\/$/, '');
  const communityBase = (opts.communityBase || 'https://steamcommunity.com').replace(/\/$/, '');
  const cdn = (opts.cdn || 'https://cdn.cloudflare.steamstatic.com').replace(/\/$/, '');

  const art = (id) => cdn + '/steam/apps/' + id + '/header.jpg';
  const cover = (id) => cdn + '/steam/apps/' + id + '/library_600x900_2x.jpg';

  async function search(q) {
    const data = await getJson(fetchFn, storeBase + '/api/storesearch/?term=' + encodeURIComponent(q) + '&l=french&cc=fr');
    return (data.items || []).filter(function (it) { return it && it.type === 'app' && it.id && it.name; }).slice(0, 12).map(function (it) {
      return { provider: 'steam', id: String(it.id), title: it.name, year: null, cover: cover(it.id), art: art(it.id), platforms: ['steam'] };
    });
  }

  async function details(id) {
    const data = await getJson(fetchFn, storeBase + '/api/appdetails?appids=' + encodeURIComponent(id) + '&l=french&cc=fr');
    const entry = data && data[id];
    if (!entry || !entry.success || !entry.data) throw new UpstreamError('Steam: no such app', 404);
    const d = entry.data;
    const m = /(\d{4})/.exec(d.release_date && d.release_date.date || '');
    return {
      provider: 'steam', id: String(id), title: d.name,
      description: htmlToText(d.short_description || d.about_the_game || '').slice(0, 4000),
      year: m ? +m[1] : null,
      released: d.release_date && d.release_date.date || '',
      genres: (d.genres || []).map(function (g) { return g.description; }),
      developers: d.developers || [],
      cover: cover(id),
      art: art(id),
      background: d.background_raw || d.background || null,
      achievementTotal: d.achievements && d.achievements.total || 0
    };
  }

  /** Official schema + global percentages. Needs STEAM_API_KEY. */
  async function achievementsFromApi(id) {
    const schema = await getJson(fetchFn, apiBase + '/ISteamUserStats/GetSchemaForGame/v2/?key=' + encodeURIComponent(key) + '&appid=' + encodeURIComponent(id) + '&l=french');
    const list = schema && schema.game && schema.game.availableGameStats && schema.game.availableGameStats.achievements || [];
    let pct = {};
    try {
      const g = await getJson(fetchFn, apiBase + '/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=' + encodeURIComponent(id));
      (g && g.achievementpercentages && g.achievementpercentages.achievements || []).forEach(function (a) { pct[a.name] = parseFloat(a.percent); });
    } catch (e) { pct = {}; }
    return list.map(function (a) {
      const p = pct[a.name];
      return {
        id: String(a.name), name: String(a.displayName || a.name), description: String(a.description || ''),
        icon: a.icon || null, hidden: !!a.hidden, rarity: Number.isFinite(p) ? Math.round(p * 10) / 10 : null
      };
    });
  }

  /** Public community page: no key needed. */
  function parseCommunityPage(html) {
    const out = [];
    const rows = String(html).split(/<div class="achieveRow\b/i).slice(1);
    rows.forEach(function (row) {
      const name = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(row);
      if (!name) return;
      const desc = /<h5[^>]*>([\s\S]*?)<\/h5>/i.exec(row);
      const img = /<img[^>]+src="([^"]+)"/i.exec(row);
      const pc = /class="achievePercent"[^>]*>\s*([\d.,]+)\s*%/i.exec(row);
      const title = stripTags(name[1]);
      if (!title) return;
      out.push({
        id: 's:' + slug(title), name: title, description: desc ? stripTags(desc[1]) : '',
        icon: img ? img[1] : null, hidden: false, rarity: pc ? Math.round(parseFloat(pc[1].replace(',', '.')) * 10) / 10 : null
      });
    });
    // ids must be unique even if two achievements share a name
    const seen = {};
    out.forEach(function (a) { seen[a.id] = (seen[a.id] || 0) + 1; if (seen[a.id] > 1) a.id += '-' + seen[a.id]; });
    return out;
  }

  async function achievementsFromPage(id) {
    const html = await getText(fetchFn, communityBase + '/stats/' + encodeURIComponent(id) + '/achievements/?l=french');
    return parseCommunityPage(html);
  }

  async function achievements(id) {
    if (key) {
      try {
        const list = await achievementsFromApi(id);
        if (list.length) return list;
      } catch (e) { /* fall through to the public page */ }
    }
    return achievementsFromPage(id);
  }

  /** Find the Steam app of a game by title (used when the game was found in another database). */
  async function findByTitle(title) {
    const found = await search(title);
    let best = null, bestScore = 0;
    found.forEach(function (r) {
      const s = similarity(title, r.title);
      if (s > bestScore) { best = r; bestScore = s; }
    });
    return best && bestScore >= 0.8 ? best : null;
  }

  return {
    id: 'steam', search: search, details: details, achievements: achievements, findByTitle: findByTitle,
    achievementMode: key ? 'key' : 'page', parseCommunityPage: parseCommunityPage, normalizeTitle: normalizeTitle
  };
}

module.exports = { createSteam };
