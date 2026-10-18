'use strict';
/*
 * Finds the trophy guide of a game on https://www.psthc.fr and returns a direct link to its page.
 * Tries the site's search API first (WordPress), then the HTML search page. When no guide matches clearly,
 * the link is the site's own search page for the title, so the button always leads somewhere useful.
 */
const { getJson, getText } = require('./http');
const { similarity, stripTags, decodeEntities } = require('../text');

const GUIDE_WORDS = /guide|trophee|trophées|platine|solution|soluce|astuce/i;
const SKIP_PATH = /^\/(?:$|category|tag|page|author|wp-|feed|contact|a-propos|mentions|forum|classement|membres|\?s=)/i;

function createPsthc(opts) {
  const fetchFn = opts.fetch;
  const base = (opts.base || 'https://www.psthc.fr').replace(/\/$/, '');
  const host = new URL(base).host.replace(/^www\./, '');

  function searchUrl(title) { return base + '/?s=' + encodeURIComponent(title); }

  function sameSite(u) {
    try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.host.replace(/^www\./, '') === host; } catch (e) { return false; }
  }

  function clean(u) {
    const x = new URL(u);
    x.hash = '';
    return x.toString();
  }

  function pick(title, candidates) {
    let best = null, bestScore = 0;
    candidates.forEach(function (c) {
      if (!sameSite(c.url)) return;
      const p = new URL(c.url).pathname + new URL(c.url).search;
      if (SKIP_PATH.test(p)) return;
      let s = similarity(title, c.title);
      // a guide titled "Guide des trophées de Elden Ring" shares the game's words but adds some: compare without the guide words too
      s = Math.max(s, similarity(title, String(c.title).replace(/\b(guide|trophees?|troph[ée]es?|platine|solution|soluce|astuces?|pour|des?|du|la|le|les)\b/gi, ' ')));
      if (GUIDE_WORDS.test(c.title) || GUIDE_WORDS.test(p)) s += 0.05;
      if (s > bestScore) { best = c; bestScore = s; }
    });
    return best && bestScore >= 0.6 ? { url: clean(best.url), title: best.title } : null;
  }

  async function viaApi(title) {
    const rows = await getJson(fetchFn, base + '/wp-json/wp/v2/search?per_page=10&search=' + encodeURIComponent(title));
    if (!Array.isArray(rows)) return null;
    return pick(title, rows.map(function (r) { return { url: r.url, title: stripTags(r.title && r.title.rendered || r.title || '') }; }));
  }

  async function viaHtml(title) {
    const html = await getText(fetchFn, searchUrl(title));
    const found = [];
    const re = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      let url;
      try { url = new URL(decodeEntities(m[1]), base + '/').toString(); } catch (e) { continue; }
      const text = stripTags(m[2]);
      if (text) found.push({ url: url, title: text });
    }
    return pick(title, found);
  }

  /** { url, title, matched } — never throws: a site problem only means "no direct page found". */
  async function guideFor(title) {
    for (const way of [viaApi, viaHtml]) {
      try {
        const hit = await way(title);
        if (hit) return { url: hit.url, title: hit.title, matched: true };
      } catch (e) { /* try the next way */ }
    }
    return { url: searchUrl(title), title: '', matched: false };
  }

  return { id: 'psthc', guideFor: guideFor, searchUrl: searchUrl };
}

module.exports = { createPsthc };
