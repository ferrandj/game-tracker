'use strict';
/*
 * DATA SCHEMA AND MIGRATIONS — read this before changing anything that is stored in state.json.
 *
 * The rule: an update of the application NEVER changes the user's data, except through a migration written here.
 *
 *  - Adding a field? Do NOT migrate: code must treat a missing field as its default when READING, and the file is
 *    left as it is. Fields written by newer versions that this code does not know are kept untouched.
 *  - Changing the meaning or the shape of something already stored? Then, and only then:
 *      1. bump CURRENT_SCHEMA,
 *      2. add MIGRATIONS[<old version>] = (doc) => <doc at the new version, with schema set>,
 *      3. add test/fixtures/data-v<old version>/ (a frozen state.json written by the old release) so the tests
 *         prove the migration on real old data. The tests fail until all three are done.
 *
 * What the store guarantees around a migration (server/store.js):
 *  - the untouched file is copied to backups/ (tag "pre-migration") BEFORE anything is written;
 *  - the migration runs in memory on a copy, its result is validated, and only then written atomically;
 *  - if anything fails, state.json is left exactly as it was and the server refuses to start with a clear message;
 *  - data written by a NEWER schema is never opened, moved or rewritten by an older release (no silent downgrade).
 */
const CURRENT_SCHEMA = 1;

/** MIGRATIONS[n] turns a document of schema n into a document of schema n + 1. */
const MIGRATIONS = {};

module.exports = { CURRENT_SCHEMA, MIGRATIONS };
