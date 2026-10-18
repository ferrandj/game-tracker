import type { Achievement, Game, PlatformId, Status, TrophyType } from '../types';

export const STATUS_LABELS: Record<Status, string> = {
  backlog: 'À faire',
  playing: 'En cours',
  finished: 'Terminé',
  completed: 'Complété à 100 %',
  dropped: 'Abandonné'
};
export const STATUS_ORDER: Status[] = ['playing', 'backlog', 'finished', 'completed', 'dropped'];

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  steam: 'Steam',
  pc: 'PC (autre)',
  ps5: 'PlayStation 5',
  ps4: 'PlayStation 4',
  ps3: 'PlayStation 3',
  vita: 'PS Vita',
  'xbox-series': 'Xbox Series X|S',
  'xbox-one': 'Xbox One',
  'xbox-360': 'Xbox 360',
  switch: 'Nintendo Switch',
  mobile: 'Mobile',
  other: 'Autre'
};
export const PLATFORM_GROUPS: { label: string; items: PlatformId[] }[] = [
  { label: 'PC', items: ['steam', 'pc'] },
  { label: 'PlayStation', items: ['ps5', 'ps4', 'ps3', 'vita'] },
  { label: 'Xbox', items: ['xbox-series', 'xbox-one', 'xbox-360'] },
  { label: 'Autres', items: ['switch', 'mobile', 'other'] }
];

export type Family = 'steam' | 'pc' | 'playstation' | 'xbox' | 'nintendo' | 'mobile' | 'other';
export function platformFamily(p: PlatformId): Family {
  if (p === 'steam') return 'steam';
  if (p === 'pc') return 'pc';
  if (p === 'ps5' || p === 'ps4' || p === 'ps3' || p === 'vita') return 'playstation';
  if (p.startsWith('xbox')) return 'xbox';
  if (p === 'switch') return 'nintendo';
  return p === 'mobile' ? 'mobile' : 'other';
}
export const isPlayStation = (p: PlatformId) => platformFamily(p) === 'playstation';
/** What the achievements are called on this platform. */
export const achievementWord = (p: PlatformId) => (isPlayStation(p) ? 'Trophées' : 'Succès');

/** Database platform slugs (IGDB / RAWG / Steam) -> the platform a person would pick. */
export function guessPlatform(slugs: string[]): PlatformId {
  const has = (re: RegExp) => slugs.some((s) => re.test(s));
  if (has(/^steam$/)) return 'steam';
  if (has(/^(ps5|playstation5)$/)) return 'ps5';
  if (has(/^(ps4|playstation4)/)) return 'ps4';
  if (has(/^(xboxseriesx|xbox-series-x)/)) return 'xbox-series';
  if (has(/^(switch|nintendo-switch)$/)) return 'switch';
  if (has(/^(win|pc|linux|mac)$/)) return 'pc';
  if (has(/^xboxone|^xbox-one/)) return 'xbox-one';
  if (has(/^(ps3|playstation3)$/)) return 'ps3';
  return 'steam';
}

export interface Progress { done: number; total: number; pct: number }
export function progress(g: Pick<Game, 'achievements'>): Progress {
  const total = g.achievements.length;
  const done = g.achievements.reduce((n, a) => n + (a.done ? 1 : 0), 0);
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function countByType(list: Achievement[]): Record<TrophyType, { done: number; total: number }> {
  const out: Record<TrophyType, { done: number; total: number }> = { platinum: { done: 0, total: 0 }, gold: { done: 0, total: 0 }, silver: { done: 0, total: 0 }, bronze: { done: 0, total: 0 } };
  list.forEach((a) => { if (a.type) { out[a.type].total++; if (a.done) out[a.type].done++; } });
  return out;
}

export interface Rarity { label: string; tier: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' }
export function rarityOf(pct: number | null): Rarity | null {
  if (pct === null) return null;
  if (pct < 2) return { label: 'Légendaire', tier: 'legendary' };
  if (pct < 5) return { label: 'Épique', tier: 'epic' };
  if (pct < 20) return { label: 'Rare', tier: 'rare' };
  if (pct < 50) return { label: 'Peu commun', tier: 'uncommon' };
  return { label: 'Commun', tier: 'common' };
}

/** 7 -> "3,5" (stars out of 5) */
export const stars = (rating: number | null) => (rating === null ? '' : String(rating / 2).replace('.', ','));

export type Filter = 'all' | Status;
export type Sort = 'recent' | 'title' | 'rating' | 'progress' | 'year';

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

export function filterGames(games: Game[], opts: { status: Filter; platform: PlatformId | 'all'; query: string }): Game[] {
  const q = opts.query.trim().toLowerCase();
  return games.filter((g) =>
    (opts.status === 'all' || g.status === opts.status) &&
    (opts.platform === 'all' || g.platform === opts.platform) &&
    (!q || g.title.toLowerCase().includes(q)));
}

export function sortGames(games: Game[], sort: Sort): Game[] {
  const out = games.slice();
  const byTitle = (a: Game, b: Game) => collator.compare(a.title, b.title);
  switch (sort) {
    case 'title': return out.sort(byTitle);
    case 'rating': return out.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byTitle(a, b));
    case 'progress': return out.sort((a, b) => progress(b).pct - progress(a).pct || byTitle(a, b));
    case 'year': return out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || byTitle(a, b));
    default: return out.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
}

export interface Totals { games: number; completed: number; playing: number; achievements: number; done: number; avgRating: number | null }
export function totals(games: Game[]): Totals {
  let achievements = 0, done = 0, rated = 0, sum = 0;
  games.forEach((g) => {
    const p = progress(g);
    achievements += p.total; done += p.done;
    if (g.rating !== null) { rated++; sum += g.rating; }
  });
  return {
    games: games.length,
    completed: games.filter((g) => g.status === 'finished' || g.status === 'completed').length,
    playing: games.filter((g) => g.status === 'playing').length,
    achievements, done,
    avgRating: rated ? Math.round((sum / rated) * 10) / 10 : null
  };
}

/** A stable hue (0-359) from a title, for the cover placeholder. */
export function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
