'use strict';
/* Small text helpers shared by the data sources. */

function stripAccents(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }

/** "The Witcher® 3: Wild Hunt – Édition" -> "the witcher 3 wild hunt edition" */
function normalizeTitle(s) {
  return stripAccents(s).toLowerCase()
    .replace(/[™®©]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const NOISE = new Set(['the', 'a', 'an', 'le', 'la', 'les', 'de', 'du', 'des', 'of', 'and', 'et', 'edition', 'goty', 'game', 'year', 'remastered', 'definitive', 'complete', 'ultimate', 'deluxe', 'standard', 'digital']);

function tokens(s) {
  return normalizeTitle(s).split(' ').filter(function (t) { return t && !NOISE.has(t); });
}

/** 0..1: how much two titles look alike (Dice coefficient on significant words, 1 when equal once normalised). */
function similarity(a, b) {
  const na = normalizeTitle(a), nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const set = new Set(tb);
  let common = 0;
  ta.forEach(function (t) { if (set.has(t)) common++; });
  return (2 * common) / (ta.length + tb.length);
}

function slug(s) { return normalizeTitle(s).replace(/ /g, '-').slice(0, 80); }

function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|hellip|ndash|mdash|eacute|egrave|agrave|ccedil);/gi, function (m, e) {
    const low = e.toLowerCase();
    if (low[0] === '#') {
      const code = low[1] === 'x' ? parseInt(low.slice(2), 16) : parseInt(low.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', hellip: '…', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' })[low] || m;
  });
}

function stripTags(html) { return decodeEntities(String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }

/** Description text from provider HTML: keeps paragraph breaks, drops everything else. */
function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d)>/gi, '\n\n')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { stripAccents, normalizeTitle, similarity, slug, decodeEntities, stripTags, htmlToText };
