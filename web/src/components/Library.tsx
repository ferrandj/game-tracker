import { useMemo, useState } from 'react';
import { GameCard } from './GameCard';
import { filterGames, PLATFORM_GROUPS, PLATFORM_LABELS, sortGames, STATUS_LABELS, STATUS_ORDER, totals, type Filter, type Sort } from '../lib/games';
import type { PlatformId } from '../types';
import { useLibrary } from '../state/library';

const SORTS: { id: Sort; label: string }[] = [
  { id: 'recent', label: 'Ajoutés récemment' },
  { id: 'title', label: 'Titre (A→Z)' },
  { id: 'rating', label: 'Meilleure note' },
  { id: 'progress', label: 'Progression' },
  { id: 'year', label: 'Année de sortie' }
];

export function Library({ onAdd }: { onAdd: () => void }) {
  const { games } = useLibrary();
  const [status, setStatus] = useState<Filter>('all');
  const [platform, setPlatform] = useState<PlatformId | 'all'>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [query, setQuery] = useState('');

  const t = useMemo(() => totals(games), [games]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: games.length };
    games.forEach((g) => { c[g.status] = (c[g.status] ?? 0) + 1; });
    return c;
  }, [games]);
  const shown = useMemo(() => sortGames(filterGames(games, { status, platform, query }), sort), [games, status, platform, query, sort]);
  const pct = t.achievements ? Math.round((t.done / t.achievements) * 100) : 0;

  if (!games.length) {
    return (
      <section className="empty">
        <div className="empty__art" aria-hidden="true">🎮</div>
        <h1>Ta bibliothèque est vide</h1>
        <p>Ajoute un jeu : recherche-le dans les bases de données, choisis ta plateforme et récupère ses succès ou trophées.</p>
        <button type="button" className="btn btn--primary btn--lg" onClick={onAdd}>＋ Ajouter mon premier jeu</button>
      </section>
    );
  }

  return (
    <section>
      <h1 className="sr-only">Ma bibliothèque</h1>
      <ul className="stats" aria-label="Statistiques">
        <li><strong>{t.games}</strong><span>jeux</span></li>
        <li><strong>{t.playing}</strong><span>en cours</span></li>
        <li><strong>{t.completed}</strong><span>terminés</span></li>
        <li><strong>{t.done}<small>/{t.achievements}</small></strong><span>succès ({pct} %)</span></li>
        <li><strong>{t.avgRating === null ? '–' : t.avgRating}<small>/10</small></strong><span>note moyenne</span></li>
      </ul>

      <div className="toolbar">
        <div className="chips" role="group" aria-label="Filtrer par statut">
          {(['all', ...STATUS_ORDER] as Filter[]).filter((s) => s === 'all' || counts[s]).map((s) => (
            <button key={s} type="button" className={'chip' + (status === s ? ' chip--on' : '')} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s === 'all' ? 'Tous' : STATUS_LABELS[s]} <span className="chip__n">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="toolbar__right">
          <label className="field field--inline">
            <span className="sr-only">Chercher dans ma bibliothèque</span>
            <input type="search" placeholder="Chercher dans ma bibliothèque" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="field field--inline">
            <span className="sr-only">Plateforme</span>
            <select value={platform} onChange={(e) => setPlatform(e.target.value as PlatformId | 'all')}>
              <option value="all">Toutes les plateformes</option>
              {PLATFORM_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>{g.items.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}</optgroup>
              ))}
            </select>
          </label>
          <label className="field field--inline">
            <span className="sr-only">Trier par</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {shown.length ? (
        <ul className="grid">
          {shown.map((g) => <li key={g.id}><GameCard game={g} /></li>)}
        </ul>
      ) : <p className="muted center">Aucun jeu ne correspond à ces filtres.</p>}
    </section>
  );
}
