import { useRef, useState } from 'react';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { applyTheme, getTheme, type Theme } from '../lib/theme';
import { useLibrary } from '../state/library';

export function Settings({ onClose }: { onClose: () => void }) {
  const { config, toast, reload } = useLibrary();
  const [theme, setTheme] = useState<Theme>(getTheme());
  const file = useRef<HTMLInputElement>(null);

  async function importFile(f: File) {
    try {
      const r = await api.importFile(JSON.parse(await f.text()));
      toast(`${r.added} jeu(x) importé(s), ${r.skipped} déjà présent(s).`, 'success');
      await reload();
    } catch (e) { toast(e instanceof SyntaxError ? 'Ce fichier n’est pas un export valide.' : (e as Error).message, 'error'); }
  }

  const on = (b: boolean) => <span className={'dot ' + (b ? 'dot--on' : 'dot--off')}>{b ? 'activé' : 'désactivé'}</span>;
  return (
    <Modal title="Réglages" onClose={onClose}>
      <section className="settings">
        <h3>Apparence</h3>
        <div className="seg" role="radiogroup" aria-label="Thème">
          {(['auto', 'dark', 'light'] as Theme[]).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} className={theme === t ? 'on' : ''} onClick={() => { setTheme(t); applyTheme(t); }}>
              {t === 'auto' ? 'Automatique' : t === 'dark' ? 'Sombre' : 'Clair'}
            </button>
          ))}
        </div>

        <h3>Sources de données</h3>
        {config ? (
          <ul className="sources">
            <li><strong>Steam</strong> — recherche, descriptions, jaquettes {on(true)}</li>
            <li><strong>IGDB</strong> — meilleure base de jaquettes {on(config.search.includes('igdb'))}{!config.search.includes('igdb') && <small>Renseigne <code>IGDB_CLIENT_ID</code> et <code>IGDB_CLIENT_SECRET</code>.</small>}</li>
            <li><strong>RAWG</strong> — grande base multi-plateformes {on(config.search.includes('rawg'))}{!config.search.includes('rawg') && <small>Renseigne <code>RAWG_KEY</code>.</small>}</li>
            <li><strong>Succès Steam</strong> — {config.steamAchievements === 'key' ? 'API officielle' : 'page publique de Steam'} {on(true)}</li>
            <li><strong>Trophées PlayStation</strong> — depuis ton compte PSN {on(config.psn)}{!config.psn && <small>Renseigne <code>PSN_NPSSO</code> (voir le README).</small>}</li>
            <li><strong>Guides PSTHC</strong> {on(config.guides)}</li>
          </ul>
        ) : <p className="muted">Chargement…</p>}

        <h3>Mes données</h3>
        <p className="hint">Tout est enregistré sur ton serveur, dans le dossier de données. Exporte une copie JSON, ou importes-en une (rien n’est écrasé).</p>
        <div className="actions actions--start">
          <a className="btn" href="api/export" download>Exporter (JSON)</a>
          <button type="button" className="btn" onClick={() => file.current?.click()}>Importer…</button>
          <input ref={file} type="file" accept="application/json,.json" hidden aria-label="Fichier à importer" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
        </div>
        {config && <p className="muted version">Game Tracker {config.version}</p>}
      </section>
    </Modal>
  );
}
