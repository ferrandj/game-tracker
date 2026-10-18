'use strict';
/*
 * PlayStation trophies, read from YOUR PlayStation Network account with the (unofficial) mobile-app API.
 * Sony publishes no public trophy API for other people's games, so this needs the npsso cookie of your own account
 * (PSN_NPSSO, valid ~2 months; see README) and only lists games that appear in your trophy list.
 * What you already earned on the console is ticked automatically.
 */
const { request, getJson, UpstreamError } = require('./http');
const { similarity } = require('../text');

const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const CLIENT_SECRET = 'ucPjka5tntB2KqsP';
const REDIRECT = 'com.scee.psxandroid.scecompcall://redirect';
const SCOPE = 'psn:mobile.v2.core psn:clientapp';

function createPsn(opts) {
  const fetchFn = opts.fetch;
  const npsso = opts.npsso;
  const authBase = (opts.authBase || 'https://ca.account.sony.com').replace(/\/$/, '');
  const apiBase = (opts.apiBase || 'https://m.np.playstation.com').replace(/\/$/, '');
  const now = opts.now || Date.now;
  let token = null, expires = 0;
  let titles = null, titlesAt = 0;

  async function auth() {
    if (token && now() < expires - 60000) return token;
    const url = authBase + '/api/authz/v3/oauth/authorize?access_type=offline&client_id=' + CLIENT_ID +
      '&response_type=code&scope=' + encodeURIComponent(SCOPE) + '&redirect_uri=' + encodeURIComponent(REDIRECT);
    const r1 = await request(fetchFn, url, { headers: { Cookie: 'npsso=' + npsso }, redirect: 'manual' });
    const loc = r1.headers.get('location') || '';
    const m = /[?&]code=([^&]+)/.exec(loc);
    if (!m) throw new UpstreamError('PlayStation: npsso refused (expired? get a new one)', 502);
    const body = 'code=' + encodeURIComponent(m[1]) + '&redirect_uri=' + encodeURIComponent(REDIRECT) + '&grant_type=authorization_code&token_format=jwt';
    const data = await getJson(fetchFn, authBase + '/api/authz/v3/oauth/token', {
      method: 'POST', body: body,
      headers: { Authorization: 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    if (!data.access_token) throw new UpstreamError('PlayStation: no token');
    token = data.access_token;
    expires = now() + (data.expires_in || 3600) * 1000;
    return token;
  }

  async function api(pathAndQuery) {
    const t = await auth();
    try {
      return await getJson(fetchFn, apiBase + pathAndQuery, { headers: { Authorization: 'Bearer ' + t, 'Accept-Language': 'fr-FR' } });
    } catch (e) {
      token = null;
      throw e;
    }
  }

  /** Every game of your trophy list (cached for 10 minutes). */
  async function listTitles() {
    if (titles && now() - titlesAt < 10 * 60 * 1000) return titles;
    const all = [];
    for (let offset = 0; offset < 2000; offset += 800) {
      const page = await api('/api/trophy/v1/users/me/trophyTitles?limit=800&offset=' + offset);
      const items = page.trophyTitles || [];
      items.forEach(function (t) {
        all.push({
          ref: t.npCommunicationId + '|' + (t.npServiceName || 'trophy'), name: t.trophyTitleName || '',
          platform: t.trophyTitlePlatform || '', icon: t.trophyTitleIconUrl || null, progress: t.progress
        });
      });
      if (items.length < 800) break;
    }
    titles = all;
    titlesAt = now();
    return all;
  }

  /** The trophy list of `title` in your account, or null when you never started it. */
  async function findByTitle(title, wantedPlatform) {
    const list = await listTitles();
    let best = null, bestScore = 0;
    list.forEach(function (t) {
      let s = similarity(title, t.name);
      if (wantedPlatform && t.platform && t.platform.toUpperCase().indexOf(wantedPlatform.toUpperCase()) >= 0) s += 0.05;
      if (s > bestScore) { best = t; bestScore = s; }
    });
    return best && bestScore >= 0.8 ? best : null;
  }

  async function achievements(ref) {
    const parts = String(ref).split('|');
    const id = parts[0], svc = parts[1] || 'trophy';
    if (!/^NPWR\d+_00$/.test(id) || !/^trophy2?$/.test(svc)) throw new UpstreamError('PlayStation: bad reference', 400);
    const q = '/trophyGroups/all/trophies?npServiceName=' + svc;
    const defs = await api('/api/trophy/v1/npCommunicationIds/' + id + q);
    let earned = {};
    try {
      const mine = await api('/api/trophy/v1/users/me/npCommunicationIds/' + id + q);
      (mine.trophies || []).forEach(function (t) { earned[t.trophyId] = t; });
    } catch (e) { earned = {}; }
    return (defs.trophies || []).map(function (t) {
      const e = earned[t.trophyId];
      const rate = parseFloat(t.trophyEarnedRate);
      return {
        id: 'psn:' + t.trophyId, name: String(t.trophyName || ('Trophée ' + t.trophyId)), description: String(t.trophyDetail || ''),
        icon: t.trophyIconUrl || null, hidden: !!t.trophyHidden, rarity: Number.isFinite(rate) ? rate : null,
        type: String(t.trophyType || '').toLowerCase() || undefined,
        done: !!(e && e.earned), doneAt: e && e.earned && e.earnedDateTime ? e.earnedDateTime : null
      };
    });
  }

  return { id: 'psn', listTitles: listTitles, findByTitle: findByTitle, achievements: achievements };
}

module.exports = { createPsn };
