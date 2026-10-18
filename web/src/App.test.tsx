import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeServer } from './test/fakeServer';
import { ach, game } from './test/fixtures';
import { renderApp } from './test/render';
import { parseRoute } from './App';
import type { SearchResult } from './types';

afterEach(() => { vi.unstubAllGlobals(); location.hash = ''; });

const hadesResult: SearchResult = { key: 'steam:1', title: 'Hades', year: 2020, cover: null, art: null, platforms: ['steam'], sources: [{ provider: 'steam', id: '1' }] };

describe('routing', () => {
  it('reads the game id from the hash', () => {
    expect(parseRoute('#/game/abcd-1234')).toEqual({ name: 'game', id: 'abcd-1234' });
    expect(parseRoute('#/game/../../x')).toEqual({ name: 'library' });
    expect(parseRoute('')).toEqual({ name: 'library' });
  });
});

describe('first use', () => {
  it('shows the empty state, finds a game, adds it and opens its page with the achievements', async () => {
    const srv = installFakeServer({ search: [hadesResult] });
    const { user } = renderApp();
    expect(await screen.findByRole('heading', { name: 'Ta bibliothèque est vide' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Ajouter mon premier jeu/ }));
    await user.type(screen.getByLabelText('Nom du jeu'), 'hades');
    await user.click(await screen.findByRole('button', { name: /Hades/ }));
    expect(screen.getByLabelText('Plateforme')).toHaveValue('steam');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Hades' })).toBeInTheDocument();
    expect(srv.calls.find((c) => c.method === 'POST' && c.path === 'games')?.body).toMatchObject({ title: 'Hades', platform: 'steam', status: 'backlog', sources: [{ provider: 'steam', id: '1' }] });
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByText(/0/, { selector: 'p.muted strong' })).toBeInTheDocument();
  });

  it('adds a game by hand when nothing is found', async () => {
    const srv = installFakeServer({ search: [] });
    const { user } = renderApp();
    await user.click(await screen.findByRole('button', { name: /Ajouter mon premier jeu/ }));
    await user.type(screen.getByLabelText('Nom du jeu'), 'Mon jeu indé');
    expect(await screen.findByText(/Aucun résultat/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /à la main/ }));
    await user.selectOptions(screen.getByLabelText('Plateforme'), 'switch');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Mon jeu indé' })).toBeInTheDocument();
    expect(srv.calls.find((c) => c.method === 'POST')?.body).toMatchObject({ title: 'Mon jeu indé', platform: 'switch' });
    expect(screen.getByText(/pas de source automatique/i)).toBeInTheDocument();
  });

  it('shows the warnings of the server (e.g. PSN not configured)', async () => {
    installFakeServer({ search: [hadesResult], warnings: ['Renseigne PSN_NPSSO'] });
    const { user } = renderApp();
    await user.click(await screen.findByRole('button', { name: /Ajouter mon premier jeu/ }));
    await user.type(screen.getByLabelText('Nom du jeu'), 'hades');
    await user.click(await screen.findByRole('button', { name: /Hades/ }));
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByText('Renseigne PSN_NPSSO')).toBeInTheDocument();
  });
});

describe('library', () => {
  const games = [
    game({ id: 'game-0000000a', title: 'Zelda', status: 'playing', platform: 'switch', rating: 9, addedAt: '2026-02-01' }),
    game({ id: 'game-0000000b', title: 'Alan Wake', status: 'completed', achievements: [ach('1', { done: true }), ach('2')], addedAt: '2026-01-01' })
  ];

  it('lists games with status, progress and stats, and filters them', async () => {
    installFakeServer({ games });
    const { user } = renderApp();
    expect(await screen.findByRole('link', { name: /Zelda/ })).toHaveAttribute('href', '#/game/game-0000000a');
    expect(screen.getByRole('list', { name: 'Statistiques' })).toHaveTextContent('1/2');
    expect(screen.getByRole('progressbar', { name: 'Progression des succès' })).toHaveAttribute('aria-valuenow', '1');

    await user.click(screen.getByRole('button', { name: /^En cours/ }));
    expect(screen.getByRole('link', { name: /Zelda/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Alan Wake/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Tous/ }));
    await user.type(screen.getByLabelText('Chercher dans ma bibliothèque'), 'wake');
    expect(screen.queryByRole('link', { name: /Zelda/ })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Chercher dans ma bibliothèque'));
    await user.type(screen.getByLabelText('Chercher dans ma bibliothèque'), 'zzz');
    expect(screen.getByText('Aucun jeu ne correspond à ces filtres.')).toBeInTheDocument();
  });

  it('opens a game from the library and goes back', async () => {
    installFakeServer({ games });
    const { user } = renderApp();
    await user.click(await screen.findByRole('link', { name: /Zelda/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Zelda' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Bibliothèque/ }));
    expect(await screen.findByRole('link', { name: /Alan Wake/ })).toBeInTheDocument();
  });

  it('says so when the server cannot be reached and retries', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('offline'); });
    const { user } = renderApp();
    expect(await screen.findByRole('heading', { name: 'Serveur injoignable' })).toBeInTheDocument();
    installFakeServer({ games });
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('link', { name: /Zelda/ })).toBeInTheDocument();
  });

  it('shows "game not found" for an unknown id', async () => {
    installFakeServer({ games });
    renderApp('#/game/unknown-1234');
    expect(await screen.findByRole('heading', { name: 'Jeu introuvable' })).toBeInTheDocument();
  });
});

describe('game page', () => {
  const g = () => game({ id: 'game-0000000a', title: 'Hades', achievements: [ach('a1'), ach('a2', { hidden: true, description: 'Spoiler' }), ach('a3', { rarity: 1.2, type: 'platinum' })] });

  it('ticks achievements (progress follows), rates, changes status and writes notes — all saved to the server', async () => {
    const srv = installFakeServer({ games: [g()] });
    const { user } = renderApp('#/game/game-0000000a');
    const boxes = await screen.findAllByRole('checkbox');
    await user.click(boxes[0]);
    await waitFor(() => expect(srv.games.get('game-0000000a')!.achievements[0].done).toBe(true));
    expect(screen.getByRole('img', { name: /1 succès sur 3, 33 %/ })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '3,5 étoiles sur 5' }));
    expect(await screen.findByText('7/10')).toBeInTheDocument();
    expect(srv.calls.find((c) => c.method === 'PATCH' && (c.body as { rating?: number }).rating === 7)).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Statut'), 'playing');
    await waitFor(() => expect(srv.games.get('game-0000000a')!.status).toBe('playing'));

    await user.type(screen.getByPlaceholderText(/Ton avis/), 'Génial');
    fireEvent.blur(screen.getByPlaceholderText(/Ton avis/));
    await waitFor(() => expect(srv.games.get('game-0000000a')!.review).toBe('Génial'));
  });

  it('hides the description of a secret achievement until revealed', async () => {
    installFakeServer({ games: [g()] });
    const { user } = renderApp('#/game/game-0000000a');
    await screen.findAllByRole('checkbox');
    expect(screen.queryByText('Spoiler')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Révéler la description de Succès a2/ }));
    expect(screen.getByText('Spoiler')).toBeInTheDocument();
  });

  it('filters and searches the list', async () => {
    const srv = installFakeServer({ games: [g()] });
    srv.games.get('game-0000000a')!.achievements[0].done = true;
    const { user } = renderApp('#/game/game-0000000a');
    await screen.findAllByRole('checkbox');
    await user.click(screen.getByRole('button', { name: 'Obtenus' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'À obtenir' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Tous' }));
    await user.type(screen.getByPlaceholderText(/Chercher parmi/), 'a3');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('undoes a tick and tells why when the server refuses it', async () => {
    installFakeServer({ games: [g()], failing: ['PUT games/game-0000000a/achievements'] });
    const { user } = renderApp('#/game/game-0000000a');
    const box = (await screen.findAllByRole('checkbox'))[0];
    await user.click(box);
    expect(await screen.findByText('Panne simulée')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked());
  });

  it('ticks everything after a confirmation', async () => {
    const srv = installFakeServer({ games: [g()] });
    const { user } = renderApp('#/game/game-0000000a');
    await screen.findAllByRole('checkbox');
    await user.click(screen.getByRole('button', { name: 'Tout cocher' }));
    const dialog = screen.getByRole('dialog', { name: 'Tout cocher ?' });
    await user.click(within(dialog).getByRole('button', { name: 'Tout cocher' }));
    await waitFor(() => expect(srv.games.get('game-0000000a')!.achievements.every((a) => a.done)).toBe(true));
    expect(await screen.findByRole('button', { name: 'Tout décocher' })).toBeInTheDocument();
  });

  it('pastes a list of achievements by hand and removes one', async () => {
    const srv = installFakeServer({ games: [game({ id: 'game-0000000a', title: 'Indé', platform: 'switch' })] });
    const { user } = renderApp('#/game/game-0000000a');
    await user.click(await screen.findByRole('button', { name: /＋ Ajouter/ }));
    await user.type(screen.getByLabelText('Un par ligne'), 'Premier sang{enter}Finir le jeu');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByText('Premier sang')).toBeInTheDocument();
    expect(screen.getByText('Finir le jeu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Supprimer Premier sang' }));
    await waitFor(() => expect(srv.games.get('game-0000000a')!.achievements).toHaveLength(1));
  });

  it('uses the right word and the guide button for PlayStation games', async () => {
    installFakeServer({ games: [game({ id: 'game-0000000a', title: 'Bloodborne', platform: 'ps4', achievements: [ach('p1', { type: 'platinum' })] })] });
    const { user } = renderApp('#/game/game-0000000a');
    expect(await screen.findByRole('heading', { level: 2, name: 'Trophées' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Trouver le guide PSTHC/ }));
    const link = await screen.findByRole('link', { name: /Guide des trophées sur PSTHC/ });
    expect(link).toHaveAttribute('href', 'https://www.psthc.fr/guide/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('lets you fix the guide link by hand', async () => {
    const srv = installFakeServer({ games: [game({ id: 'game-0000000a', platform: 'ps5' })] });
    const { user } = renderApp('#/game/game-0000000a');
    await user.click(await screen.findByRole('button', { name: 'Modifier le lien' }));
    await user.type(screen.getByLabelText('Adresse du guide'), 'https://www.psthc.fr/mon-guide/');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(srv.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ guideUrl: 'https://www.psthc.fr/mon-guide/' }));
  });

  it('refreshes the list from the source', async () => {
    const srv = installFakeServer({ games: [game({ id: 'game-0000000a' })] });
    const { user } = renderApp('#/game/game-0000000a');
    await user.click(await screen.findByRole('button', { name: /Récupérer les succès/ }));
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
    expect(srv.calls.some((c) => c.path.endsWith('/achievements/fetch'))).toBe(true);
  });

  it('deletes a game after a confirmation and returns to the library', async () => {
    const srv = installFakeServer({ games: [game({ id: 'game-0000000a', title: 'Hades' }), game({ id: 'game-0000000b', title: 'Celeste' })] });
    const { user } = renderApp('#/game/game-0000000a');
    await user.click(await screen.findByRole('button', { name: /Supprimer ce jeu/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Supprimer' }));
    expect(await screen.findByRole('link', { name: /Celeste/ })).toBeInTheDocument();
    expect(srv.games.has('game-0000000a')).toBe(false);
    expect(screen.queryByRole('link', { name: /Hades/ })).not.toBeInTheDocument();
  });

  it('keeps the screen consistent when ticking quickly several achievements', async () => {
    const srv = installFakeServer({ games: [g()] });
    const { user } = renderApp('#/game/game-0000000a');
    const boxes = await screen.findAllByRole('checkbox');
    await user.click(boxes[0]);
    await user.click(boxes[1]);
    await user.click(boxes[2]);
    await waitFor(() => expect(srv.games.get('game-0000000a')!.achievements.every((a) => a.done)).toBe(true));
    await waitFor(() => screen.getAllByRole('checkbox').forEach((b) => expect(b).toBeChecked()));
  });
});

describe('settings', () => {
  it('shows which sources are on and how to turn the others on', async () => {
    installFakeServer({ games: [game()] });
    const { user } = renderApp();
    await user.click(await screen.findByRole('button', { name: 'Réglages' }));
    const dialog = screen.getByRole('dialog', { name: 'Réglages' });
    expect(within(dialog).getByText('PSN_NPSSO')).toBeInTheDocument();
    expect(within(dialog).getByText('IGDB_CLIENT_ID')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Exporter (JSON)' })).toHaveAttribute('href', 'api/export');
    await user.click(within(dialog).getByRole('radio', { name: 'Clair' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    document.documentElement.removeAttribute('data-theme');
  });
});
