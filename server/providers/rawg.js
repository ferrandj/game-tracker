'use strict';
/* RAWG (https://rawg.io/apidocs): large multi-platform catalogue. Needs a free key in RAWG_KEY. */
const { getJson } = require('./http');
const { htmlToText } = require('../text');

function createRawg(opts) {
  const fetchFn = opts.fetch;
  const key = opts.key;
  const base = (opts.base || 'https://api.rawg.io/api').replace(/\/$/, '');

  async function search(q) {
    const data = await getJson(fetchFn, base + '/games?key=' + encodeURIComponent(key) + '&search=' + encodeURIComponent(q) + '&page_size=12&search_precise=true');
    return (data.results || []).filter(function (g) { return g && g.id && g.name; }).map(function (g) {
      const y = /^(\d{4})/.exec(g.released || '');
      return {
        provider: 'rawg', id: String(g.id), title: g.name, year: y ? +y[1] : null, cover: null, art: g.background_image || null,
        platforms: (g.platforms || []).map(function (p) { return p.platform && p.platform.slug; }).filter(Boolean)
      };
    });
  }

  async function details(id) {
    const g = await getJson(fetchFn, base + '/games/' + encodeURIComponent(id) + '?key=' + encodeURIComponent(key));
    const y = /^(\d{4})/.exec(g.released || '');
    return {
      provider: 'rawg', id: String(g.id), title: g.name,
      description: String(g.description_raw || htmlToText(g.description || '')).slice(0, 4000),
      year: y ? +y[1] : null, released: g.released || '',
      genres: (g.genres || []).map(function (x) { return x.name; }),
      developers: (g.developers || []).map(function (x) { return x.name; }),
      cover: null, art: g.background_image || null, background: g.background_image_additional || null
    };
  }

  return { id: 'rawg', search: search, details: details };
}

module.exports = { createRawg };
