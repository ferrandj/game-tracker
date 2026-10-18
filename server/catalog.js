'use strict';
/* Puts the data sources together: one merged search, one merged "details" per game, achievements by platform. */
const { similarity, normalizeTitle } = require('./text');
const { UpstreamError } = require('./providers/http');

const PRIORITY_COVER = ['igdb', 'steam', 'rawg'];
const PRIORITY_ART = ['igdb', 'steam', 'rawg'];
const PRIORITY_DESC = ['steam', 'igdb', 'rawg'];
const PRIORITY_TITLE = ['igdb', 'steam', 'rawg'];

function userError(code, message, status) {
  return Object.assign(new Error(message), { code: code, status: status || 422, userFacing: true });
}

function firstBy(list, order, field) {
  for (const p of order) {
    const hit = list.find(function (d) { return d.provider === p && d[field] && (!Array.isArray(d[field]) || d[field].length); });
    if (hit) return hit[field];
  }
  return Array.isArray(list[0] && list[0][field]) ? [] : null;
}

function createCatalog(providers, opts) {
  opts = opts || {};
  const now = opts.now || Date.now;
  const searchers = ['igdb', 'steam', 'rawg'].filter(function (k) { return providers[k]; });

  function info() {
    return {
      search: searchers,
      steamAchievements: providers.steam ? providers.steam.achievementMode : null,
      psn: !!providers.psn,
      guides: !!providers.psthc
    };
  }

  /** Merged search. Returns { results, errors } — one source being down never blocks the others. */
  async function search(q) {
    const settled = await Promise.all(searchers.map(function (k) {
      return providers[k].search(q).then(function (r) { return { k: k, r: r }; }, function (e) { return { k: k, e: e }; });
    }));
    const errors = {};
    const groups = [];
    settled.forEach(function (s) {
      if (s.e) { errors[s.k] = s.e.message; console.warn('[search] ' + s.k + ' failed: ' + s.e.message); return; }
      s.r.forEach(function (item) {
        const norm = normalizeTitle(item.title);
        const g = groups.find(function (x) {
          return x.norm === norm && !x.sources.some(function (src) { return src.provider === item.provider; }) &&
            (!x.year || !item.year || Math.abs(x.year - item.year) <= 1);
        });
        if (g) {
          g.sources.push({ provider: item.provider, id: item.id });
          g.items.push(item);
        } else groups.push({ norm: norm, year: item.year, sources: [{ provider: item.provider, id: item.id }], items: [item] });
      });
    });
    const results = groups.map(function (g) {
      const items = g.items;
      const year = items.map(function (i) { return i.year; }).find(Boolean) || null;
      const platforms = Array.from(new Set([].concat.apply([], items.map(function (i) { return i.platforms || []; }))));
      return {
        key: g.sources.map(function (s) { return s.provider + ':' + s.id; }).join('+'),
        title: firstBy(items, PRIORITY_TITLE, 'title') || items[0].title, year: year,
        cover: firstBy(items, PRIORITY_COVER, 'cover'), art: firstBy(items, PRIORITY_ART, 'art'),
        platforms: platforms, sources: g.sources,
        score: similarity(q, items[0].title) + (g.sources.length > 1 ? 0.05 : 0)
      };
    });
    results.sort(function (a, b) { return b.score - a.score; });
    results.forEach(function (r) { delete r.score; });
    return { results: results.slice(0, 16), errors: errors };
  }

  /** Details from every source of a game, merged. Missing sources are tolerated; `fallback` fills what is missing. */
  async function resolve(sources, fallback) {
    fallback = fallback || {};
    const settled = await Promise.all((sources || []).filter(function (s) { return providers[s.provider] && providers[s.provider].details; }).map(function (s) {
      return providers[s.provider].details(s.id).then(function (d) { return d; }, function () { return null; });
    }));
    const ds = settled.filter(Boolean);
    return {
      title: firstBy(ds, PRIORITY_TITLE, 'title') || fallback.title,
      description: firstBy(ds, PRIORITY_DESC, 'description') || '',
      cover: firstBy(ds, PRIORITY_COVER, 'cover') || fallback.cover || null,
      art: firstBy(ds, PRIORITY_ART, 'art') || fallback.art || null,
      year: firstBy(ds, PRIORITY_TITLE, 'year') || fallback.year || null,
      genres: firstBy(ds, PRIORITY_TITLE, 'genres') || [],
      developers: firstBy(ds, PRIORITY_TITLE, 'developers') || [],
      resolved: ds.length
    };
  }

  /**
   * The achievements / trophies of `game` for its current platform.
   * Returns { source:{provider,ref,fetchedAt}, list }. Throws a user-facing error when there is no way to get them.
   */
  async function achievementsFor(game) {
    const at = new Date(now()).toISOString();
    const p = game.platform;
    if (p === 'steam' || p === 'pc') {
      const steam = providers.steam;
      let id = (game.sources.find(function (s) { return s.provider === 'steam'; }) || {}).id;
      if (!id) {
        const hit = await steam.findByTitle(game.title).catch(function () { return null; });
        id = hit && hit.id;
      }
      if (!id) throw userError('no_steam_match', 'Aucun jeu Steam ne correspond à « ' + game.title + ' ». Ajoute les succès à la main.');
      const list = await steam.achievements(id);
      if (!list.length) throw userError('no_achievements', 'Steam ne liste aucun succès pour ce jeu.');
      return { source: { provider: 'steam', ref: String(id), fetchedAt: at }, list: list };
    }
    if (/^(ps5|ps4|ps3|vita)$/.test(p)) {
      if (!providers.psn) throw userError('psn_disabled', 'Les trophées PlayStation se lisent depuis ton compte PSN : renseigne PSN_NPSSO (voir le README), ou ajoute les trophées à la main.');
      const hit = await providers.psn.findByTitle(game.title, p === 'vita' ? 'PSVITA' : p.toUpperCase());
      if (!hit) throw userError('psn_not_found', '« ' + game.title + ' » n’est pas dans la liste de trophées de ton compte PSN (lance le jeu une fois sur la console), ou ajoute les trophées à la main.');
      const list = await providers.psn.achievements(hit.ref);
      return { source: { provider: 'psn', ref: hit.ref, fetchedAt: at }, list: list };
    }
    throw userError('no_provider', 'Pas de source automatique pour cette plateforme : ajoute les succès à la main (ou colle une liste).');
  }

  function guideFor(title) { return providers.psthc.guideFor(title); }

  return { info: info, search: search, resolve: resolve, achievementsFor: achievementsFor, guideFor: guideFor, UpstreamError: UpstreamError };
}

module.exports = { createCatalog, userError };
