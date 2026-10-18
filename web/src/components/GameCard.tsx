import { GameCase } from './GameCase';
import { StarRating } from './StarRating';
import { PLATFORM_LABELS, progress, STATUS_LABELS } from '../lib/games';
import type { Game } from '../types';

export function GameCard({ game }: { game: Game }) {
  const p = progress(game);
  return (
    <a className="card" href={`#/game/${game.id}`} aria-label={`${game.title}, ${STATUS_LABELS[game.status]}`}>
      <GameCase game={game} />
      <div className="card__body">
        <h3 className="card__title">{game.title}</h3>
        <p className="card__meta">
          <span>{PLATFORM_LABELS[game.platform]}</span>
          {game.year && <span>{game.year}</span>}
        </p>
        <p className="card__status"><span className={'pill pill--' + game.status}>{STATUS_LABELS[game.status]}</span></p>
        {p.total > 0 && (
          <div className="card__progress" title={`${p.done} / ${p.total}`}>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done} aria-label="Progression des succès"><span style={{ width: p.pct + '%' }} /></div>
            <span className="card__count">{p.done}/{p.total}</span>
          </div>
        )}
        {game.rating !== null && <StarRating value={game.rating} size="sm" />}
      </div>
    </a>
  );
}
