import { describe, expect, it } from 'vitest';
import { ach, game } from '../test/fixtures';
import { countByType, filterGames, guessPlatform, hueOf, isPlayStation, platformFamily, progress, rarityOf, sortGames, stars, totals } from './games';

describe('progress', () => {
  it('counts ticked achievements and rounds the percentage', () => {
    expect(progress(game())).toEqual({ done: 0, total: 0, pct: 0 });
    const g = game({ achievements: [ach('1', { done: true }), ach('2'), ach('3')] });
    expect(progress(g)).toEqual({ done: 1, total: 3, pct: 33 });
  });
});

describe('rarity', () => {
  it('maps a percentage of players to a tier', () => {
    expect(rarityOf(null)).toBeNull();
    expect([0.5, 3, 12, 30, 80].map((p) => rarityOf(p)!.tier)).toEqual(['legendary', 'epic', 'rare', 'uncommon', 'common']);
  });
});

describe('platforms', () => {
  it('groups consoles into families', () => {
    expect(['steam', 'pc', 'ps5', 'vita', 'xbox-360', 'switch', 'mobile', 'other'].map((p) => platformFamily(p as never)))
      .toEqual(['steam', 'pc', 'playstation', 'playstation', 'xbox', 'nintendo', 'mobile', 'other']);
    expect(isPlayStation('ps4')).toBe(true);
    expect(isPlayStation('switch')).toBe(false);
  });
  it('guesses the platform from database slugs, Steam first', () => {
    expect(guessPlatform(['ps5', 'ps4--1', 'win'])).toBe('ps5');
    expect(guessPlatform(['playstation4', 'pc'])).toBe('ps4');
    expect(guessPlatform(['nintendo-switch'])).toBe('switch');
    expect(guessPlatform(['xboxseriesx', 'win'])).toBe('xbox-series');
    expect(guessPlatform(['win'])).toBe('pc');
    expect(guessPlatform(['steam', 'ps5'])).toBe('steam');
    expect(guessPlatform([])).toBe('steam');
  });
});

describe('trophy counts and stars', () => {
  it('counts per trophy type', () => {
    const c = countByType([ach('1', { type: 'platinum', done: true }), ach('2', { type: 'bronze' }), ach('3', { type: 'bronze', done: true }), ach('4')]);
    expect(c.platinum).toEqual({ done: 1, total: 1 });
    expect(c.bronze).toEqual({ done: 1, total: 2 });
    expect(c.gold.total).toBe(0);
  });
  it('shows a /10 rating as stars out of 5', () => {
    expect([null, 1, 7, 10].map(stars)).toEqual(['', '0,5', '3,5', '5']);
  });
});

describe('filter and sort', () => {
  const a = game({ id: 'game-0000000a', title: 'Zelda', status: 'playing', rating: 9, platform: 'switch', addedAt: '2026-01-03', year: 2017, achievements: [ach('1', { done: true })] });
  const b = game({ id: 'game-0000000b', title: 'Alan Wake', status: 'backlog', rating: null, platform: 'steam', addedAt: '2026-01-01', year: 2010 });
  const c = game({ id: 'game-0000000c', title: 'élan', status: 'completed', rating: 6, platform: 'steam', addedAt: '2026-01-02', year: 2022 });
  const all = [a, b, c];
  it('filters by status, platform and text', () => {
    expect(filterGames(all, { status: 'all', platform: 'all', query: '' })).toHaveLength(3);
    expect(filterGames(all, { status: 'playing', platform: 'all', query: '' })).toEqual([a]);
    expect(filterGames(all, { status: 'all', platform: 'steam', query: 'WAKE' })).toEqual([b]);
  });
  it('sorts', () => {
    const ids = (s: Parameters<typeof sortGames>[1]) => sortGames(all, s).map((g) => g.title);
    expect(ids('recent')).toEqual(['Zelda', 'élan', 'Alan Wake']);
    expect(ids('title')).toEqual(['Alan Wake', 'élan', 'Zelda']);
    expect(ids('rating')).toEqual(['Zelda', 'élan', 'Alan Wake']);
    expect(ids('progress')[0]).toBe('Zelda');
    expect(ids('year')).toEqual(['élan', 'Zelda', 'Alan Wake']);
  });
  it('totals', () => {
    expect(totals(all)).toEqual({ games: 3, completed: 1, playing: 1, achievements: 1, done: 1, avgRating: 7.5 });
    expect(totals([]).avgRating).toBeNull();
  });
});

describe('hueOf', () => {
  it('is stable and within the colour wheel', () => {
    expect(hueOf('Hades')).toBe(hueOf('Hades'));
    expect(hueOf('Hades')).toBeGreaterThanOrEqual(0);
    expect(hueOf('Hades')).toBeLessThan(360);
  });
});
