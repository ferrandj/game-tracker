import { useEffect, useState } from 'react';
import { Library } from './components/Library';
import { GameView } from './components/GameView';
import { AddGame } from './components/AddGame';
import { Settings } from './components/Settings';
import { Toasts } from './components/Toasts';
import { useLibrary } from './state/library';

type Route = { name: 'library' } | { name: 'game'; id: string };

export function parseRoute(hash: string): Route {
  const m = /^#\/game\/([\w-]{8,64})$/.exec(hash);
  return m ? { name: 'game', id: m[1] } : { name: 'library' };
}

export function App() {
  const { loaded, loadError, reload, games } = useLibrary();
  const [route, setRoute] = useState<Route>(parseRoute(location.hash));
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    const on = () => { setRoute(parseRoute(location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const home = () => { location.hash = '#/'; };

  return (
    <>
      <a className="skip" href="#main">Aller au contenu</a>
      <header className="top">
        <a className="brand" href="#/" aria-label="Game Tracker, accueil">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="8" fill="url(#g)" /><path d="M9 20.5V12l7-4 7 4v8.5l-7 4z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /><circle cx="16" cy="16" r="2.4" fill="#fff" /><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#7c5cff" /><stop offset="1" stopColor="#22d3ee" /></linearGradient></defs></svg>
          <span>Game Tracker</span>
        </a>
        <div className="top__actions">
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}><span aria-hidden="true">＋</span> Ajouter un jeu</button>
          <button type="button" className="icon-btn icon-btn--lg" aria-label="Réglages" onClick={() => setSettings(true)}>⚙</button>
        </div>
      </header>

      <main id="main" className="wrap" tabIndex={-1}>
        {!loaded && <p className="muted center">Chargement de ta bibliothèque…</p>}
        {loaded && loadError && !games.length && (
          <section className="empty"><h1>Serveur injoignable</h1><p>{loadError}</p><button type="button" className="btn btn--primary" onClick={() => void reload()}>Réessayer</button></section>
        )}
        {loaded && !(loadError && !games.length) && (route.name === 'game' ? <GameView id={route.id} onBack={home} /> : <Library onAdd={() => setAdding(true)} />)}
      </main>

      {adding && <AddGame onClose={() => setAdding(false)} onAdded={(id) => { setAdding(false); location.hash = '#/game/' + id; }} />}
      {settings && <Settings onClose={() => setSettings(false)} />}
      <Toasts />
    </>
  );
}
