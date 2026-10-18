import { useMemo, useState } from 'react';
import { ProgressRing } from './ProgressRing';
import { Modal } from './Modal';
import { Confirm } from './Confirm';
import { imgUrl } from '../lib/api';
import { achievementWord, countByType, isPlayStation, progress, rarityOf } from '../lib/games';
import { useLibrary } from '../state/library';
import type { Achievement, Game, TrophyType } from '../types';

type Show = 'all' | 'todo' | 'done';
type Order = 'source' | 'rarity';

const TROPHY: Record<TrophyType, { label: string; icon: string }> = {
  platinum: { label: 'Platine', icon: '🏆' },
  gold: { label: 'Or', icon: '🥇' },
  silver: { label: 'Argent', icon: '🥈' },
  bronze: { label: 'Bronze', icon: '🥉' }
};
const SOURCE_LABEL = { steam: 'Steam', psn: 'compte PlayStation Network', manual: 'ajoutés à la main' } as const;
const canAutoFetch = (g: Game) => g.platform === 'steam' || g.platform === 'pc' || isPlayStation(g.platform);

export function Achievements({ game }: { game: Game }) {
  const { tick, tickAll, fetchAchievements, addAchievements, removeAchievement, toast } = useLibrary();
  const word = achievementWord(game.platform);
  const p = progress(game);
  const types = useMemo(() => countByType(game.achievements), [game.achievements]);
  const [show, setShow] = useState<Show>('all');
  const [order, setOrder] = useState<Order>('source');
  const [query, setQuery] = useState('');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [confirmAll, setConfirmAll] = useState<null | boolean>(null);
  const [fetching, setFetching] = useState(false);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = game.achievements.filter((a) =>
      (show === 'all' || (show === 'done') === a.done) && (!q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)));
    if (order === 'rarity') out.sort((a, b) => (a.rarity ?? 101) - (b.rarity ?? 101));
    return out;
  }, [game.achievements, show, order, query]);

  async function refresh() {
    setFetching(true);
    await fetchAchievements(game.id);
    setFetching(false);
  }

  const src = game.achievementsSource;
  const hasTypes = game.achievements.some((a) => a.type);

  return (
    <section className="panel" aria-labelledby="ach-title">
      <header className="panel__head">
        <div className="ach-summary">
          {p.total > 0 && <ProgressRing pct={p.pct} label={`${p.done} ${word.toLowerCase()} sur ${p.total}, ${p.pct} %`} />}
          <div>
            <h2 id="ach-title">{word}</h2>
            <p className="muted">
              {p.total > 0 ? <><strong>{p.done}</strong> sur {p.total} obtenus</> : 'Aucun pour le moment'}
              {src && src.provider !== 'manual' && <> · source : {SOURCE_LABEL[src.provider]}</>}
              {src && src.provider === 'manual' && <> · {SOURCE_LABEL.manual}</>}
            </p>
            {hasTypes && (
              <p className="trophy-counts" aria-label="Répartition par type">
                {(Object.keys(TROPHY) as TrophyType[]).filter((t) => types[t].total).map((t) => (
                  <span key={t} className={'trophy trophy--' + t} title={TROPHY[t].label}>{TROPHY[t].icon} {types[t].done}/{types[t].total}</span>
                ))}
              </p>
            )}
          </div>
        </div>
        <div className="panel__actions">
          {canAutoFetch(game) && <button type="button" className="btn" onClick={refresh} disabled={fetching}>{fetching ? 'Mise à jour…' : p.total ? '↻ Actualiser' : `↻ Récupérer les ${word.toLowerCase()}`}</button>}
          <button type="button" className="btn" onClick={() => setAdding(true)}>＋ Ajouter</button>
        </div>
      </header>

      {p.total === 0 ? (
        <p className="empty-note">
          {canAutoFetch(game)
            ? <>Pas encore de liste. Utilise « Récupérer » ou ajoute les {word.toLowerCase()} à la main (tu peux coller une liste).</>
            : <>Il n’y a pas de source automatique pour cette plateforme : ajoute les {word.toLowerCase()} à la main (tu peux coller une liste).</>}
        </p>
      ) : (
        <>
          <div className="toolbar toolbar--tight">
            <div className="chips" role="group" aria-label={`Filtrer les ${word.toLowerCase()}`}>
              {([['all', 'Tous'], ['todo', 'À obtenir'], ['done', 'Obtenus']] as [Show, string][]).map(([k, label]) => (
                <button key={k} type="button" className={'chip' + (show === k ? ' chip--on' : '')} aria-pressed={show === k} onClick={() => setShow(k)}>{label}</button>
              ))}
            </div>
            <div className="toolbar__right">
              <label className="field field--inline"><span className="sr-only">Chercher</span>
                <input type="search" placeholder={`Chercher parmi les ${word.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <label className="field field--inline"><span className="sr-only">Ordre</span>
                <select value={order} onChange={(e) => setOrder(e.target.value as Order)}>
                  <option value="source">Ordre du jeu</option>
                  <option value="rarity">Les plus rares d’abord</option>
                </select>
              </label>
              <button type="button" className="btn btn--ghost" onClick={() => setConfirmAll(p.done !== p.total)}>{p.done === p.total ? 'Tout décocher' : 'Tout cocher'}</button>
            </div>
          </div>

          <ul className="ach-list">
            {list.map((a) => (
              <AchievementRow
                key={a.id} a={a} revealed={revealed.has(a.id)}
                onReveal={() => setRevealed((s) => new Set(s).add(a.id))}
                onTick={(done) => void tick(game.id, a.id, done)}
                onRemove={() => void removeAchievement(game.id, a.id)}
              />
            ))}
          </ul>
          {!list.length && <p className="muted center">Rien ne correspond.</p>}
        </>
      )}

      {adding && (
        <AddAchievements word={word} onClose={() => setAdding(false)} onSave={async (text) => {
          try { const n = await addAchievements(game.id, { text }); toast(`${n} ajouté${n > 1 ? 's' : ''}.`, 'success'); setAdding(false); } catch (e) { toast((e as Error).message, 'error'); }
        }} />
      )}
      {confirmAll !== null && (
        <Confirm
          title={confirmAll ? 'Tout cocher ?' : 'Tout décocher ?'} confirmLabel={confirmAll ? 'Tout cocher' : 'Tout décocher'} danger={!confirmAll}
          onCancel={() => setConfirmAll(null)} onConfirm={() => { void tickAll(game.id, confirmAll); setConfirmAll(null); }}
        >
          <p>{confirmAll ? `Marquer les ${p.total} ${word.toLowerCase()} comme obtenus ?` : `Retirer la coche des ${p.total} ${word.toLowerCase()} ?`}</p>
        </Confirm>
      )}
    </section>
  );
}

function AchievementRow({ a, revealed, onReveal, onTick, onRemove }: { a: Achievement; revealed: boolean; onReveal: () => void; onTick: (done: boolean) => void; onRemove: () => void }) {
  const rarity = rarityOf(a.rarity);
  const secret = a.hidden && !a.done && !revealed;
  return (
    <li className={'ach' + (a.done ? ' ach--done' : '')}>
      <label className="ach__main">
        <input type="checkbox" checked={a.done} onChange={(e) => onTick(e.target.checked)} />
        <span className="ach__box" aria-hidden="true" />
        {a.icon ? <img className="ach__icon" src={imgUrl(a.icon)} alt="" loading="lazy" width={48} height={48} /> : <span className="ach__icon ach__icon--blank" aria-hidden="true">{a.type ? TROPHY[a.type].icon : '★'}</span>}
        <span className="ach__text">
          <strong>{a.name}</strong>
          {secret
            ? <span className="muted">Succès caché</span>
            : a.description && <span className="muted">{a.description}</span>}
          {a.done && a.doneAt && <span className="ach__date">Obtenu le {new Date(a.doneAt).toLocaleDateString('fr-FR')}</span>}
        </span>
      </label>
      <span className="ach__side">
        {a.type && <span className={'trophy trophy--' + a.type} title={TROPHY[a.type].label}>{TROPHY[a.type].icon}</span>}
        {rarity && <span className={'rarity rarity--' + rarity.tier} title={`${a.rarity} % des joueurs`}>{rarity.label} · {String(a.rarity).replace('.', ',')} %</span>}
        {secret && <button type="button" className="link-btn" onClick={onReveal} aria-label={`Révéler la description de ${a.name}`}>Révéler</button>}
        {a.id.startsWith('m:') && <button type="button" className="icon-btn" aria-label={`Supprimer ${a.name}`} onClick={onRemove}>✕</button>}
      </span>
    </li>
  );
}

function AddAchievements({ word, onClose, onSave }: { word: string; onClose: () => void; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Ajouter des ${word.toLowerCase()}`} onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSave(text); setBusy(false); }}>
        <label className="field">
          <span>Un par ligne</span>
          <textarea data-autofocus rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Premier sang - Vaincre le premier boss\nCollectionneur : trouver les 10 objets\nFinir le jeu'} />
        </label>
        <p className="hint">Après le nom, une description est possible avec « - », « : » ou « | ». Idéal pour copier-coller une liste depuis un guide.</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn--primary" disabled={busy || !text.trim()}>Ajouter</button>
        </div>
      </form>
    </Modal>
  );
}
