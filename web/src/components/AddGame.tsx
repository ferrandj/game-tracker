import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { GameCase } from './GameCase';
import { api } from '../lib/api';
import { guessPlatform, PLATFORM_GROUPS, PLATFORM_LABELS, STATUS_LABELS, STATUS_ORDER } from '../lib/games';
import { useLibrary } from '../state/library';
import type { PlatformId, SearchResult, Status } from '../types';

const SOURCE_NAMES: Record<string, string> = { steam: 'Steam', igdb: 'IGDB', rawg: 'RAWG' };

export function AddGame({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const { add, toast } = useLibrary();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [platform, setPlatform] = useState<PlatformId>('steam');
  const [status, setStatus] = useState<Status>('backlog');
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); setErrors({}); setSearching(false); return; }
    setSearching(true);
    const mine = ++seq.current;
    const t = window.setTimeout(() => {
      api.search(term).then(
        (r) => { if (mine === seq.current) { setResults(r.results); setErrors(r.errors); setSearching(false); } },
        (e: Error) => { if (mine === seq.current) { setResults([]); setErrors({ serveur: e.message }); setSearching(false); } }
      );
    }, 350);
    return () => window.clearTimeout(t);
  }, [q]);

  function pick(r: SearchResult) {
    setPicked(r);
    setManual(false);
    setPlatform(guessPlatform(r.platforms.concat(r.sources.some((s) => s.provider === 'steam') ? ['steam'] : [])));
  }

  async function submit() {
    const title = (picked ? picked.title : q).trim();
    if (!title) return;
    setBusy(true);
    try {
      const g = await add({ title, platform, status, sources: picked?.sources, cover: picked?.cover, art: picked?.art, year: picked?.year });
      toast(`« ${g.title} » ajouté à ta bibliothèque.`, 'success');
      onAdded(g.id);
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  const step2 = picked || manual;
  const errorList = Object.entries(errors);

  return (
    <Modal title={step2 ? 'Ajouter à ma bibliothèque' : 'Ajouter un jeu'} onClose={onClose} wide>
      {!step2 && (
        <>
          <label className="field">
            <span>Nom du jeu</span>
            <input data-autofocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. Elden Ring, Hades, Zelda…" autoComplete="off" />
          </label>
          <div aria-live="polite" className="search-state">
            {searching && <p className="muted">Recherche en cours…</p>}
            {!searching && results && results.length === 0 && <p className="muted">Aucun résultat pour « {q.trim()} ».</p>}
            {errorList.map(([k, v]) => <p key={k} className="warn">{SOURCE_NAMES[k] ?? k} indisponible : {v}</p>)}
          </div>
          {results && results.length > 0 && (
            <ul className="results">
              {results.map((r) => (
                <li key={r.key}>
                  <button type="button" className="result" onClick={() => pick(r)}>
                    <GameCase game={r} size="sm" still />
                    <span className="result__text">
                      <strong>{r.title}</strong>
                      <span className="muted">{r.year ? r.year + ' · ' : ''}{r.sources.map((s) => SOURCE_NAMES[s.provider]).join(' + ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            Introuvable ? <button type="button" className="link-btn" disabled={q.trim().length < 1} onClick={() => setManual(true)}>Ajouter « {q.trim() || '…'} » à la main</button>
          </p>
        </>
      )}

      {step2 && (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="add-form">
          <div className="add-form__preview">
            <GameCase game={{ title: picked?.title ?? q.trim(), cover: picked?.cover ?? null, art: picked?.art ?? null, platform }} size="md" />
            <div>
              <h3>{picked?.title ?? q.trim()}</h3>
              {picked?.year && <p className="muted">{picked.year}</p>}
            </div>
          </div>
          <label className="field">
            <span>Plateforme</span>
            <select data-autofocus value={platform} onChange={(e) => setPlatform(e.target.value as PlatformId)}>
              {PLATFORM_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}</optgroup>)}
            </select>
          </label>
          <p className="hint">Les succès / trophées sont récupérés selon la plateforme choisie (Steam, PlayStation). Tu pourras la changer ensuite.</p>
          <label className="field">
            <span>Statut</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <div className="actions">
            <button type="button" className="btn" onClick={() => { setPicked(null); setManual(false); }} disabled={busy}>← Retour</button>
            <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Ajout…' : 'Ajouter'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
