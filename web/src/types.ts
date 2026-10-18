export type Status = 'backlog' | 'playing' | 'finished' | 'completed' | 'dropped';
export type PlatformId = 'steam' | 'pc' | 'ps5' | 'ps4' | 'ps3' | 'vita' | 'xbox-series' | 'xbox-one' | 'xbox-360' | 'switch' | 'mobile' | 'other';
export type TrophyType = 'platinum' | 'gold' | 'silver' | 'bronze';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  hidden: boolean;
  rarity: number | null;
  type?: TrophyType;
  done: boolean;
  doneAt: string | null;
}

export interface Guide { url: string; title: string; matched: boolean; manual?: boolean; checkedAt: string }
export interface SourceRef { provider: 'steam' | 'rawg' | 'igdb'; id: string }

export interface Game {
  id: string;
  kind: 'game';
  title: string;
  platform: PlatformId;
  sources: SourceRef[];
  cover: string | null;
  art: string | null;
  description: string;
  year: number | null;
  genres: string[];
  developers: string[];
  status: Status;
  /** 1..10 (each step is half a star), null = not rated */
  rating: number | null;
  review: string;
  hours: number | null;
  achievements: Achievement[];
  achievementsSource: { provider: 'steam' | 'psn' | 'manual'; ref: string; fetchedAt: string } | null;
  guide: Guide | null;
  addedAt: string;
  updatedAt: string;
}

export interface SearchResult {
  key: string;
  title: string;
  year: number | null;
  cover: string | null;
  art: string | null;
  platforms: string[];
  sources: SourceRef[];
}

export interface Config {
  version: string;
  search: string[];
  steamAchievements: 'key' | 'page' | null;
  psn: boolean;
  guides: boolean;
}

export interface GamePatch {
  title?: string;
  platform?: PlatformId;
  status?: Status;
  rating?: number | null;
  review?: string;
  hours?: number | null;
  description?: string;
  cover?: string | null;
  guideUrl?: string | null;
}
