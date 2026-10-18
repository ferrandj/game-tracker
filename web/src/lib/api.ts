import type { Config, Game, GamePatch, PlatformId, SearchResult, SourceRef, Status } from '../types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.name = 'ApiError'; this.status = status; }
}

/** Relative URLs: the app works behind a reverse proxy sub-path. Writes carry the header the server requires (CSRF guard). */
async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('api/' + path, {
      method,
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json', 'X-Tracker-Client': '1' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError(0, 'Serveur injoignable. Vérifie ta connexion.');
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : 'Erreur ' + res.status;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export interface NewGame {
  title: string;
  platform: PlatformId;
  status?: Status;
  sources?: SourceRef[];
  cover?: string | null;
  art?: string | null;
  year?: number | null;
  fetchAchievements?: boolean;
}

export interface SearchResponse { results: SearchResult[]; errors: Record<string, string> }

const enc = encodeURIComponent;

export const api = {
  config: () => req<Config>('GET', 'config'),
  games: () => req<{ rev: number; games: Game[] }>('GET', 'games'),
  search: (q: string) => req<SearchResponse>('GET', 'search?q=' + enc(q)),
  add: (g: NewGame) => req<{ game: Game; warnings: string[] }>('POST', 'games', g),
  patch: (id: string, p: GamePatch) => req<{ game: Game }>('PATCH', 'games/' + id, p),
  remove: (id: string) => req<{ ok: true }>('DELETE', 'games/' + id),
  tick: (id: string, aid: string, done: boolean) => req<{ game: Game }>('PUT', 'games/' + id + '/achievements/' + enc(aid), { done }),
  tickAll: (id: string, done: boolean) => req<{ game: Game }>('POST', 'games/' + id + '/achievements/all', { done }),
  fetchAchievements: (id: string) => req<{ game: Game }>('POST', 'games/' + id + '/achievements/fetch'),
  addAchievements: (id: string, body: { name?: string; description?: string; text?: string }) => req<{ game: Game; added: number }>('POST', 'games/' + id + '/achievements', body),
  removeAchievement: (id: string, aid: string) => req<{ game: Game }>('DELETE', 'games/' + id + '/achievements/' + enc(aid)),
  findGuide: (id: string) => req<{ game: Game }>('POST', 'games/' + id + '/guide'),
  importFile: (data: unknown) => req<{ received: number; valid: number; added: number; skipped: number }>('POST', 'import', data)
};

/** Covers and screenshots are fetched (and cached) by the server, never directly by the browser. */
export function imgUrl(url: string | null | undefined): string {
  return url ? 'api/img?u=' + enc(url) : '';
}
