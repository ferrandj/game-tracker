'use strict';
/* Test helpers: a temp data folder and a fake `fetch` driven by a list of [matcher, responder] routes. */
const fs = require('fs');
const os = require('os');
const path = require('path');

function tmpDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'gt-')); }

function json(body, status) { return new Response(JSON.stringify(body), { status: status || 200, headers: { 'content-type': 'application/json' } }); }
function html(body, status) { return new Response(body, { status: status || 200, headers: { 'content-type': 'text/html' } }); }

/** routes: array of [string | RegExp | (url, init) => bool, (url, init) => Response | object]. First match wins; calls are recorded. */
function fakeFetch(routes) {
  const calls = [];
  const f = async function (url, init) {
    url = String(url);
    calls.push({ url: url, init: init || {} });
    for (const r of routes) {
      const m = r[0];
      const hit = typeof m === 'string' ? url.indexOf(m) >= 0 : m instanceof RegExp ? m.test(url) : m(url, init || {});
      if (hit) {
        const out = typeof r[1] === 'function' ? r[1](url, init || {}) : r[1];
        // a canned Response may be served several times, so hand out a copy
        return out instanceof Response ? out.clone() : json(out);
      }
    }
    return new Response('not found: ' + url, { status: 404 });
  };
  f.calls = calls;
  return f;
}

module.exports = { tmpDir, fakeFetch, json, html };
