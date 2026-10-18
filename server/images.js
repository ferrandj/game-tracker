'use strict';
/*
 * Cover / screenshot proxy with a disk cache (data/covers). Why: the browser never talks to third-party image hosts
 * (strict CSP, no tracking, works behind a reverse proxy), and the library keeps its pictures even if a host changes
 * its URLs later. Only HTTPS and a short list of well-known image hosts are fetched, so this is not an open proxy.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { request } = require('./providers/http');
const { writeFileAtomic } = require('./store');

const ALLOWED = [
  /(^|\.)steamstatic\.com$/, /(^|\.)steamcdn-a\.akamaihd\.net$/, /(^|\.)akamaihd\.net$/, /^images\.igdb\.com$/, /^media\.rawg\.io$/,
  /(^|\.)playstation\.(com|net)$/, /^(www\.)?psthc\.fr$/, /(^|\.)xboxlive\.com$/, /^upload\.wikimedia\.org$/
];
const MAX_BYTES = 8 * 1024 * 1024;

function allowed(u) {
  let x;
  try { x = new URL(u); } catch (e) { return false; }
  return x.protocol === 'https:' && !x.username && !x.password && (!x.port || x.port === '443') && ALLOWED.some(function (re) { return re.test(x.hostname); });
}

/** `extraPrefixes`: exact URL prefixes that are also allowed (IMAGE_ALLOW_PREFIXES: a self-hosted mirror, or the fake sources used by the end-to-end tests). */
function createImages(dir, fetchFn, extraPrefixes) {
  fs.mkdirSync(dir, { recursive: true });
  const extra = extraPrefixes || [];
  const inflight = new Map();

  function names(url) {
    const h = crypto.createHash('sha256').update(url).digest('hex');
    return { file: path.join(dir, h), meta: path.join(dir, h + '.json'), hash: h };
  }

  function cached(url) {
    const n = names(url);
    try {
      const meta = JSON.parse(fs.readFileSync(n.meta, 'utf8'));
      const st = fs.statSync(n.file);
      return { path: n.file, type: meta.type, size: st.size };
    } catch (e) { return null; }
  }

  async function download(url) {
    const res = await request(fetchFn, url, { redirect: 'error', timeoutMs: 15000 });
    if (!res.ok) return null;
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    const n = names(url);
    writeFileAtomic(n.file, buf);
    writeFileAtomic(n.meta, JSON.stringify({ url: url, type: type, at: new Date().toISOString() }));
    return { path: n.file, type: type, size: buf.length };
  }

  /** { path, type, size } or null (not allowed / not found / not an image). */
  async function get(url) {
    if (!allowed(url) && !extra.some(function (prefix) { return url.indexOf(prefix) === 0; })) return null;
    const hit = cached(url);
    if (hit) return hit;
    if (!inflight.has(url)) inflight.set(url, download(url).catch(function () { return null; }).finally(function () { inflight.delete(url); }));
    return inflight.get(url);
  }

  return { get: get, allowed: allowed };
}

module.exports = { createImages, allowed };
