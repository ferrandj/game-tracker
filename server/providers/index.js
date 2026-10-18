'use strict';
/* Builds the enabled data sources from environment variables. Every base URL can be overridden (tests, mirrors). */
const { createSteam } = require('./steam');
const { createRawg } = require('./rawg');
const { createIgdb } = require('./igdb');
const { createPsn } = require('./psn');
const { createPsthc } = require('./psthc');

function createProviders(env, fetchFn) {
  env = env || process.env;
  const f = fetchFn || globalThis.fetch;
  const p = { steam: createSteam({ fetch: f, key: env.STEAM_API_KEY, storeBase: env.STEAM_STORE_BASE, apiBase: env.STEAM_API_BASE, communityBase: env.STEAM_COMMUNITY_BASE, cdn: env.STEAM_CDN_BASE }) };
  if (env.RAWG_KEY) p.rawg = createRawg({ fetch: f, key: env.RAWG_KEY, base: env.RAWG_BASE });
  if (env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET) {
    p.igdb = createIgdb({ fetch: f, clientId: env.IGDB_CLIENT_ID, clientSecret: env.IGDB_CLIENT_SECRET, base: env.IGDB_BASE, tokenUrl: env.IGDB_TOKEN_URL, imgBase: env.IGDB_IMG_BASE });
  }
  if (env.PSN_NPSSO) p.psn = createPsn({ fetch: f, npsso: env.PSN_NPSSO, authBase: env.PSN_AUTH_BASE, apiBase: env.PSN_API_BASE });
  p.psthc = createPsthc({ fetch: f, base: env.PSTHC_BASE });
  return p;
}

module.exports = { createProviders };
