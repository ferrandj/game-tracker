import type { Achievement, Game } from '../types';

export const ach = (id: string, over: Partial<Achievement> = {}): Achievement => ({
  id, name: 'Succès ' + id, description: 'Description ' + id, icon: null, hidden: false, rarity: null, done: false, doneAt: null, ...over
});

export const game = (over: Partial<Game> = {}): Game => ({
  id: 'game-00000001', kind: 'game', title: 'Hades', platform: 'steam', sources: [], cover: null, art: null, description: 'Un jeu.', year: 2020,
  genres: ['Roguelike'], developers: ['Supergiant'], status: 'backlog', rating: null, review: '', hours: null,
  achievements: [], achievementsSource: null, guide: null, addedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over
});
