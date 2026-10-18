import { vi } from 'vitest';
import type { Config, Game, SearchResult } from '../types';
import { ach, game } from './fixtures';

export interface FakeOptions {
  games?: Game[];
  config?: Partial<Config>;
  search?: SearchResult[];
  /** requests whose "METHOD path" contains one of these fail with a 500 */
  failing?: string[];
  warnings?: string[];
}

/** An in-memory stand-in for the server API (same routes and answers), installed as the global fetch. */
export function installFakeServer(opts: FakeOptions = {}) {
  const games = new Map<string, Game>((opts.games ?? []).map((g) => [g.id, structuredClone(g)]));
  const calls: { method: string; path: string; body: unknown }[] = [];
  let seq = 1;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = url.replace(/^api\//, '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    if (opts.failing?.some((f) => (method + ' ' + path).includes(f))) return json({ error: 'Panne simulée' }, 500);
    let m: RegExpExecArray | null;
    if (method === 'GET' && path === 'config') return json({ version: 'test', search: ['steam'], steamAchievements: 'page', psn: false, guides: true, ...opts.config });
    if (method === 'GET' && path === 'games') return json({ rev: 1, games: [...games.values()] });
    if (method === 'GET' && path.startsWith('search?')) return json({ results: opts.search ?? [], errors: {} });
    if (method === 'POST' && path === 'games') {
      const b = body as { title: string; platform: Game['platform']; status?: Game['status']; sources?: Game['sources']; cover?: string | null };
      const g = game({ id: 'game-1000000' + seq++, title: b.title, platform: b.platform, status: b.status ?? 'backlog', sources: b.sources ?? [], cover: b.cover ?? null,
        achievements: b.sources?.length && (b.platform === 'steam') ? [ach('a1'), ach('a2', { hidden: true }), ach('a3', { rarity: 1.2 })] : [] });
      games.set(g.id, g);
      return json({ game: g, warnings: opts.warnings ?? [] }, 201);
    }
    if ((m = /^games\/([\w-]+)$/.exec(path))) {
      const g = games.get(m[1]);
      if (!g) return json({ error: 'game not found' }, 404);
      if (method === 'PATCH') { Object.assign(g, body); return json({ game: g }); }
      if (method === 'DELETE') { games.delete(g.id); return json({ ok: true }); }
    }
    if ((m = /^games\/([\w-]+)\/achievements(?:\/([^/]+))?$/.exec(path))) {
      const g = games.get(m[1])!;
      const arg = m[2] && decodeURIComponent(m[2]);
      if (method === 'PUT' && arg) { g.achievements.forEach((a) => { if (a.id === arg) { a.done = (body as { done: boolean }).done; a.doneAt = a.done ? new Date().toISOString() : null; } }); return json({ game: g }); }
      if (method === 'POST' && arg === 'all') { g.achievements.forEach((a) => { a.done = (body as { done: boolean }).done; }); return json({ game: g }); }
      if (method === 'POST' && arg === 'fetch') { g.achievements = [ach('f1'), ach('f2')]; return json({ game: g }); }
      if (method === 'POST' && !arg) {
        const lines = String((body as { text?: string }).text ?? '').split('\n').filter((l) => l.trim());
        lines.forEach((l, i) => g.achievements.push(ach('m:' + i + g.achievements.length, { name: l.trim() })));
        return json({ game: g, added: lines.length });
      }
      if (method === 'DELETE' && arg) { g.achievements = g.achievements.filter((a) => a.id !== arg); return json({ game: g }); }
    }
    if ((m = /^games\/([\w-]+)\/guide$/.exec(path)) && method === 'POST') {
      const g = games.get(m[1])!;
      g.guide = { url: 'https://www.psthc.fr/guide/', title: 'Guide des trophées', matched: true, checkedAt: '2026-01-01' };
      return json({ game: g });
    }
    return json({ error: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fn);
  return { games, calls, fetch: fn };
}
