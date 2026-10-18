'use strict';
/* IGDB (https://api-docs.igdb.com): best covers and the widest catalogue. Needs a free Twitch application: IGDB_CLIENT_ID + IGDB_CLIENT_SECRET. */
const { getJson, request, UpstreamError } = require('./http');

function createIgdb(opts) {
  const fetchFn = opts.fetch;
  const clientId = opts.clientId, clientSecret = opts.clientSecret;
  const base = (opts.base || 'https://api.igdb.com/v4').replace(/\/$/, '');
  const tokenUrl = opts.tokenUrl || 'https://id.twitch.tv/oauth2/token';
  const imgBase = (opts.imgBase || 'https://images.igdb.com/igdb/image/upload').replace(/\/$/, '');
  const now = opts.now || Date.now;
  let token = null, expires = 0;

  async function auth() {
    if (token && now() < expires - 60000) return token;
    const data = await getJson(fetchFn, tokenUrl + '?client_id=' + encodeURIComponent(clientId) + '&client_secret=' + encodeURIComponent(clientSecret) + '&grant_type=client_credentials', { method: 'POST' });
    if (!data.access_token) throw new UpstreamError('IGDB: no token');
    token = data.access_token;
    expires = now() + (data.expires_in || 3600) * 1000;
    return token;
  }

  async function query(endpoint, body) {
    const t = await auth();
    const res = await request(fetchFn, base + endpoint, {
      method: 'POST', body: body,
      headers: { 'Client-ID': clientId, Authorization: 'Bearer ' + t, 'Content-Type': 'text/plain', Accept: 'application/json' }
    });
    const text = await res.text();
    if (res.status === 401) { token = null; throw new UpstreamError('IGDB: token refused'); }
    if (!res.ok) throw new UpstreamError('IGDB: HTTP ' + res.status);
    try { return JSON.parse(text); } catch (e) { throw new UpstreamError('IGDB: invalid JSON'); }
  }

  const image = (size, id) => imgBase + '/' + size + '/' + id + '.jpg';
  const year = (g) => (g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null);
  const esc = (s) => String(s).replace(/[\\"]/g, ' ');

  async function search(q) {
    const rows = await query('/games', 'search "' + esc(q) + '"; fields name,first_release_date,cover.image_id,screenshots.image_id,platforms.slug; where version_parent = null; limit 12;');
    return rows.filter(function (g) { return g && g.id && g.name; }).map(function (g) {
      return {
        provider: 'igdb', id: String(g.id), title: g.name, year: year(g),
        cover: g.cover && g.cover.image_id ? image('t_cover_big_2x', g.cover.image_id) : null,
        art: g.screenshots && g.screenshots[0] ? image('t_screenshot_big', g.screenshots[0].image_id) : null,
        platforms: (g.platforms || []).map(function (p) { return p.slug; }).filter(Boolean)
      };
    });
  }

  async function details(id) {
    if (!/^\d+$/.test(String(id))) throw new UpstreamError('IGDB: bad id', 400);
    const rows = await query('/games', 'fields name,summary,storyline,first_release_date,genres.name,involved_companies.developer,involved_companies.company.name,cover.image_id,artworks.image_id,screenshots.image_id; where id = ' + id + ';');
    const g = rows[0];
    if (!g) throw new UpstreamError('IGDB: no such game', 404);
    const shot = (g.artworks && g.artworks[0]) || (g.screenshots && g.screenshots[0]);
    return {
      provider: 'igdb', id: String(g.id), title: g.name, description: String(g.summary || g.storyline || '').slice(0, 4000),
      year: year(g), released: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : '',
      genres: (g.genres || []).map(function (x) { return x.name; }),
      developers: (g.involved_companies || []).filter(function (c) { return c.developer && c.company; }).map(function (c) { return c.company.name; }),
      cover: g.cover && g.cover.image_id ? image('t_cover_big_2x', g.cover.image_id) : null,
      art: shot ? image('t_screenshot_big', shot.image_id) : null, background: null
    };
  }

  return { id: 'igdb', search: search, details: details };
}

module.exports = { createIgdb };
