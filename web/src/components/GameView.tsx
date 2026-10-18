import { useEffect, useState } from 'react';
import { GameCase } from './GameCase';
import { StarRating } from './StarRating';
import { Achievements } from './Achievements';
import { Confirm } from './Confirm';
import { imgUrl } from '../lib/api';
import { isPlayStation, PLATFORM_GROUPS, PLATFORM_LABELS, STATUS_LABELS, STATUS_ORDER } from '../lib/games';
import { useLibrary } from '../state/library';
import type { Game, PlatformId, Status } from '../types';

export function GameView({ id, onBack }: { id: string; onBack: () => void }) {
  const { games, loaded } = useLibrary();
  const game = games.find((g) => g.id === id);

  useEffect(() => { if (game) document.title = game.title + ' · Game Tracker'; return () => { document.title = 'Game Tracker'; }; }, [game?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!game) {
    return loaded
      ? <section className="empty"><h1>Jeu introuvable</h1><p>Il a peut-être été supprimé.</p><button type="button" className="btn btn--primary" onClick={onBack}>← Retour à la bibliothèque</button></section>
      : <p className="muted center">Chargement…</p>;
  }
  return <Detail key={game.id} game={game} onBack={onBack} />;
}

function Detail({ game, onBack }: { game: Game; onBack: () => void }) {
  const { patch, remove, toast } = useLibrary();
  const [more, setMore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const long = game.description.length > 420;

  return (
    <article className="detail">
      <div className="hero">
        {game.art && <div className="hero__bg" style={{ backgroundImage: `url("${imgUrl(game.art)}")` }} aria-hidden="true" />}
        <div className="hero__content">
          <a className="back" href="#/" onClick={(e) => { e.preventDefault(); onBack(); }}>← Bibliothèque</a>
          <div className="hero__grid">
            <GameCase game={game} size="lg" />
            <div className="hero__info">
              <h1>{game.title}</h1>
              <p className="meta">
                <span className="tag">{PLATFORM_LABELS[game.platform]}</span>
                {game.year && <span className="tag">{game.year}</span>}
                {game.genres.slice(0, 3).map((g) => <span key={g} className="tag">{g}</span>)}
                {game.developers[0] && <span className="tag tag--plain">{game.developers[0]}</span>}
              </p>
              {game.description
                ? <p className={'desc' + (long && !more ? ' desc--clamp' : '')}>{game.description}</p>
                : <p className="muted">Pas de description pour ce jeu.</p>}
              {long && <button type="button" className="link-btn" onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Réduire' : 'Lire la suite'}</button>}

              <div className="controls">
                <label className="field">
                  <span>Statut</span>
                  <select value={game.status} onChange={(e) => void patch(game.id, { status: e.target.value as Status })}>
                    {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Plateforme</span>
                  <select value={game.platform} onChange={(e) => void patch(game.id, { platform: e.target.value as PlatformId })}>
                    {PLATFORM_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}</optgroup>)}
                  </select>
                </label>
                <HoursField game={game} />
              </div>
              <div className="rating-row">
                <span className="rating-row__label" id="rating-label">Ma note</span>
                <StarRating value={game.rating} onChange={(v) => void patch(game.id, { rating: v })} size="lg" label="Ma note" />
              </div>
              <Guide game={game} />
            </div>
          </div>
        </div>
      </div>

      <Achievements game={game} />
      <ReviewPanel game={game} />

      <div className="danger-zone">
        <button type="button" className="btn btn--danger-ghost" onClick={() => setConfirmDelete(true)}>Supprimer ce jeu de ma bibliothèque</button>
      </div>
      {confirmDelete && (
        <Confirm title="Supprimer ce jeu ?" confirmLabel="Supprimer" danger onCancel={() => setConfirmDelete(false)} onConfirm={async () => {
          try { await remove(game.id); toast(`« ${game.title} » supprimé.`); onBack(); } catch (e) { toast((e as Error).message, 'error'); setConfirmDelete(false); }
        }}>
          <p>« {game.title} », ses {game.achievements.length} succès cochés, ta note et tes notes seront supprimés. Une sauvegarde automatique de la bibliothèque est conservée sur le serveur.</p>
        </Confirm>
      )}
    </article>
  );
}

function HoursField({ game }: { game: Game }) {
  const { patch } = useLibrary();
  const [v, setV] = useState(game.hours === null ? '' : String(game.hours));
  useEffect(() => { setV(game.hours === null ? '' : String(game.hours)); }, [game.hours]);
  function commit() {
    const n = v.trim() === '' ? null : Number(v.replace(',', '.'));
    if (n !== null && (!Number.isFinite(n) || n < 0)) { setV(game.hours === null ? '' : String(game.hours)); return; }
    if (n !== game.hours) void patch(game.id, { hours: n });
  }
  return (
    <label className="field">
      <span>Heures jouées</span>
      <input type="text" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} placeholder="0" />
    </label>
  );
}

function Guide({ game }: { game: Game }) {
  const { findGuide, patch, config } = useLibrary();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(game.guide?.url ?? '');
  const ps = isPlayStation(game.platform);
  const g = game.guide;
  if (config && !config.guides) return null;

  async function search() {
    setBusy(true);
    await findGuide(game.id);
    setBusy(false);
  }

  return (
    <div className="guide">
      {g && g.matched && (
        <a className="btn btn--primary" href={g.url} target="_blank" rel="noopener noreferrer">📘 Guide des trophées sur PSTHC<span className="sr-only"> (nouvel onglet)</span></a>
      )}
      {g && !g.matched && (
        <a className="btn" href={g.url} target="_blank" rel="noopener noreferrer">🔎 Chercher « {game.title} » sur PSTHC<span className="sr-only"> (nouvel onglet)</span></a>
      )}
      {g && g.matched && g.title && <span className="muted guide__title">{g.title}</span>}
      {g && !g.matched && <span className="muted guide__title">Aucun guide exact trouvé.</span>}
      {!g && <button type="button" className="btn" onClick={search} disabled={busy}>{busy ? 'Recherche…' : ps ? '📘 Trouver le guide PSTHC' : '📘 Chercher un guide sur PSTHC'}</button>}
      {g && <button type="button" className="link-btn" onClick={search} disabled={busy}>{busy ? 'Recherche…' : 'Relancer la recherche'}</button>}
      <button type="button" className="link-btn" onClick={() => setEditing(!editing)} aria-expanded={editing}>Modifier le lien</button>
      {editing && (
        <form className="guide__edit" onSubmit={async (e) => {
          e.preventDefault();
          await patch(game.id, { guideUrl: url.trim() || null }); // an error is reported by patch itself
          setEditing(false);
        }}>
          <label className="field field--inline"><span className="sr-only">Adresse du guide</span>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.psthc.fr/…" />
          </label>
          <button type="submit" className="btn">Enregistrer</button>
        </form>
      )}
    </div>
  );
}

function ReviewPanel({ game }: { game: Game }) {
  const { patch } = useLibrary();
  const [text, setText] = useState(game.review);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setText(game.review); }, [game.review]);

  // saved shortly after typing stops, and when leaving the field
  useEffect(() => {
    if (text === game.review) return;
    const t = window.setTimeout(() => { void patch(game.id, { review: text }).then(() => setSaved(true)); }, 900);
    return () => window.clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="panel" aria-labelledby="notes-title">
      <header className="panel__head"><h2 id="notes-title">Mes notes</h2><span className="muted" aria-live="polite">{saved && text === game.review ? 'Enregistré ✓' : ''}</span></header>
      <label className="field">
        <span className="sr-only">Mon avis et mes notes sur ce jeu</span>
        <textarea rows={6} value={text} placeholder="Ton avis, ce qu’il reste à faire, des astuces à retenir…"
          onChange={(e) => { setText(e.target.value); setSaved(false); }}
          onBlur={() => { if (text !== game.review) void patch(game.id, { review: text }).then(() => setSaved(true)); }} />
      </label>
    </section>
  );
}
