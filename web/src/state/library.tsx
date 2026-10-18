import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type NewGame } from '../lib/api';
import type { Config, Game, GamePatch } from '../types';

export interface Toast { id: number; kind: 'info' | 'error' | 'success'; text: string }

interface Ctx {
  games: Game[];
  loaded: boolean;
  loadError: string | null;
  config: Config | null;
  toasts: Toast[];
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  reload: () => Promise<void>;
  add: (g: NewGame) => Promise<Game>;
  patch: (id: string, p: GamePatch) => Promise<void>;
  tick: (id: string, aid: string, done: boolean) => Promise<void>;
  tickAll: (id: string, done: boolean) => Promise<void>;
  fetchAchievements: (id: string) => Promise<void>;
  addAchievements: (id: string, body: { name?: string; description?: string; text?: string }) => Promise<number>;
  removeAchievement: (id: string, aid: string) => Promise<void>;
  findGuide: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const LibraryContext = createContext<Ctx | null>(null);

export function useLibrary(): Ctx {
  const c = useContext(LibraryContext);
  if (!c) throw new Error('useLibrary outside LibraryProvider');
  return c;
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Une erreur est survenue.');

/** Applies a patch to a game locally, the same way the server will (so the screen answers instantly). */
function applyPatch(g: Game, p: GamePatch): Game {
  const next = { ...g };
  if (p.title !== undefined) next.title = p.title;
  if (p.platform !== undefined) next.platform = p.platform;
  if (p.status !== undefined) next.status = p.status;
  if (p.rating !== undefined) next.rating = p.rating;
  if (p.review !== undefined) next.review = p.review;
  if (p.hours !== undefined) next.hours = p.hours;
  if (p.description !== undefined) next.description = p.description;
  if (p.cover !== undefined) next.cover = p.cover;
  return next;
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [games, setGames] = useState<Game[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextToast = useRef(1);
  // Changes to one game are sent one after the other, so a late answer can never hide a newer click.
  const queues = useRef(new Map<string, Promise<unknown>>());
  const pending = useRef(new Map<string, number>());

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = nextToast.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => dismissToast(id), kind === 'error' ? 8000 : 5000);
  }, [dismissToast]);

  const replace = useCallback((g: Game) => setGames((list) => list.map((x) => (x.id === g.id ? g : x))), []);

  const reload = useCallback(async () => {
    try {
      const r = await api.games();
      setGames(r.games);
      setLoadError(null);
    } catch (e) { setLoadError(message(e)); }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload();
    api.config().then(setConfig, () => undefined);
  }, [reload]);

  const enqueue = useCallback(<T,>(id: string, job: () => Promise<T>): Promise<T> => {
    pending.current.set(id, (pending.current.get(id) ?? 0) + 1);
    const prev = queues.current.get(id) ?? Promise.resolve();
    const run = prev.then(job).finally(() => pending.current.set(id, (pending.current.get(id) ?? 1) - 1));
    queues.current.set(id, run.catch(() => undefined));
    return run;
  }, []);

  /** Optimistic change: show it now, undo it (with a message) when the server refuses. */
  const optimistic = useCallback(async (id: string, change: (g: Game) => Game, send: () => Promise<{ game: Game }>) => {
    let before: Game | undefined;
    setGames((list) => list.map((g) => { if (g.id !== id) return g; before = g; return change(g); }));
    try {
      const r = await enqueue(id, send);
      // while more changes are waiting, keep the screen as is; the last answer settles everything
      if ((pending.current.get(id) ?? 0) === 0) replace(r.game);
    } catch (e) {
      if (before) replace(before);
      toast(message(e), 'error');
    }
  }, [enqueue, replace, toast]);

  const value = useMemo<Ctx>(() => ({
    games, loaded, loadError, config, toasts, toast, dismissToast, reload,
    add: async (g) => {
      const r = await api.add(g);
      setGames((list) => [r.game, ...list]);
      r.warnings.forEach((w) => toast(w, 'info'));
      return r.game;
    },
    patch: (id, p) => optimistic(id, (g) => applyPatch(g, p), () => api.patch(id, p)),
    tick: (id, aid, done) => optimistic(id,
      (g) => ({ ...g, achievements: g.achievements.map((a) => (a.id === aid ? { ...a, done, doneAt: done ? new Date().toISOString() : null } : a)) }),
      () => api.tick(id, aid, done)),
    tickAll: (id, done) => optimistic(id,
      (g) => ({ ...g, achievements: g.achievements.map((a) => ({ ...a, done, doneAt: done ? a.doneAt ?? new Date().toISOString() : null })) }),
      () => api.tickAll(id, done)),
    fetchAchievements: async (id) => {
      try { replace((await enqueue(id, () => api.fetchAchievements(id))).game); toast('Liste mise à jour.', 'success'); } catch (e) { toast(message(e), 'error'); }
    },
    addAchievements: async (id, body) => {
      const r = await enqueue(id, () => api.addAchievements(id, body));
      replace(r.game);
      return r.added;
    },
    removeAchievement: async (id, aid) => {
      try { replace((await enqueue(id, () => api.removeAchievement(id, aid))).game); } catch (e) { toast(message(e), 'error'); }
    },
    findGuide: async (id) => {
      try { replace((await enqueue(id, () => api.findGuide(id))).game); } catch (e) { toast(message(e), 'error'); }
    },
    remove: async (id) => {
      await enqueue(id, () => api.remove(id));
      setGames((list) => list.filter((g) => g.id !== id));
    }
  }), [games, loaded, loadError, config, toasts, toast, dismissToast, reload, optimistic, replace, enqueue]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}
