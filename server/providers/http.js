'use strict';
/* Outgoing HTTP for the data sources: timeout, size cap, readable errors. `fetchFn` is injectable for tests. */

const UA = 'Mozilla/5.0 (compatible; GameTracker/1.0; +https://github.com/ferrandj/game-tracker)';
const MAX_BYTES = 6 * 1024 * 1024;

class UpstreamError extends Error {
  constructor(message, status) { super(message); this.name = 'UpstreamError'; this.status = status || 502; }
}

async function request(fetchFn, url, opts) {
  opts = opts || {};
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, opts.timeoutMs || 12000);
  try {
    const res = await fetchFn(url, {
      method: opts.method || 'GET',
      headers: Object.assign({ 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5' }, opts.headers || {}),
      body: opts.body,
      redirect: opts.redirect || 'follow',
      signal: ctl.signal
    });
    return res;
  } catch (e) {
    throw new UpstreamError(e && e.name === 'AbortError' ? 'timeout' : 'network error (' + (e && e.cause && e.cause.code || e.message) + ')');
  } finally { clearTimeout(timer); }
}

async function readText(res, limit) {
  const text = await res.text();
  if (text.length > (limit || MAX_BYTES)) throw new UpstreamError('response too large');
  return text;
}

async function getJson(fetchFn, url, opts) {
  const res = await request(fetchFn, url, opts);
  const text = await readText(res);
  if (!res.ok) throw new UpstreamError('HTTP ' + res.status, res.status === 401 || res.status === 403 ? 502 : res.status === 404 ? 404 : 502);
  try { return JSON.parse(text); } catch (e) { throw new UpstreamError('invalid JSON from ' + new URL(url).host); }
}

async function getText(fetchFn, url, opts) {
  const res = await request(fetchFn, url, opts);
  const text = await readText(res);
  if (!res.ok) throw new UpstreamError('HTTP ' + res.status, res.status === 404 ? 404 : 502);
  return text;
}

module.exports = { request, getJson, getText, UpstreamError, UA };
