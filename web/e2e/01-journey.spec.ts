import { expect, test } from '@playwright/test';
import { addGame } from './helpers';

test.describe.configure({ mode: 'serial' });

test('empty library -> find a Steam game -> its achievements -> tick, rate, note -> everything survives a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ta bibliothèque est vide' })).toBeVisible();

  await addGame(page, 'hades', 'Hades', 'steam');
  await expect(page.getByText('Défiez le dieu des morts')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Succès' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(8);
  await expect(page.getByText(/source : Steam/)).toBeVisible();

  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(2).check();
  await expect(page.getByText('2 sur 8 obtenus')).toBeVisible();

  await page.getByRole('radio', { name: '4 étoiles sur 5' }).click();
  await expect(page.getByText('8/10', { exact: true })).toBeVisible();
  await page.getByLabel('Statut').selectOption('playing');
  await page.getByLabel('Heures jouées').fill('12,5');
  await page.getByLabel('Heures jouées').blur();
  await page.getByPlaceholder(/Ton avis/).fill('Excellent, la fin est géniale.');
  await expect(page.getByText('Enregistré ✓')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Hades' })).toBeVisible();
  await expect(page.getByText('2 sur 8 obtenus')).toBeVisible();
  await expect(page.getByRole('checkbox').nth(0)).toBeChecked();
  await expect(page.getByRole('checkbox').nth(1)).not.toBeChecked();
  await expect(page.getByRole('radio', { name: '4 étoiles sur 5' })).toBeChecked();
  await expect(page.getByLabel('Statut')).toHaveValue('playing');
  await expect(page.getByLabel('Heures jouées')).toHaveValue('12.5');
  await expect(page.getByPlaceholder(/Ton avis/)).toHaveValue('Excellent, la fin est géniale.');

  await page.getByRole('link', { name: /Bibliothèque/ }).click();
  const card = page.getByRole('link', { name: /Hades/ });
  await expect(card).toBeVisible();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
  await expect(page.getByRole('list', { name: 'Statistiques' })).toContainText('2/8');
});

test('the cover is served through the server and drawn as a 3D case', async ({ page }) => {
  await page.goto('/');
  const img = page.locator('.case__front img').first();
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute('src', /^api\/img\?u=/);
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  const transform = await page.locator('.case__box').first().evaluate((el) => getComputedStyle(el).transform);
  expect(transform).not.toBe('none');
  expect(await page.locator('.case__box').first().evaluate((el) => getComputedStyle(el).transformStyle)).toBe('preserve-3d');
});

test('PlayStation game: direct link to the psthc guide, trophies added by hand', async ({ page }) => {
  await page.goto('/');
  await addGame(page, 'elden ring', 'ELDEN RING', 'ps5');
  const guide = page.getByRole('link', { name: /Guide des trophées sur PSTHC/ });
  await expect(guide).toHaveAttribute('href', /\/guide-trophees-elden-ring\/$/);
  await expect(guide).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('heading', { level: 2, name: 'Trophées' })).toBeVisible();
  await expect(page.getByText(/PSN_NPSSO/)).toBeVisible(); // toast: why there is no automatic list

  await page.getByRole('button', { name: /＋ Ajouter/ }).click();
  await page.getByLabel('Un par ligne').fill('Platine - Obtenir tous les trophées\nLe seigneur d’Elden\nFinir le jeu : fin 1');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await page.getByRole('checkbox').nth(1).check();
  await page.reload();
  await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
  await expect(page.getByText('Obtenir tous les trophées')).toBeVisible();
});

test('a game without a cover still gets a box, and a game can be added by hand', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajouter un jeu' }).click();
  await page.getByLabel('Nom du jeu').fill('Un jeu introuvable');
  await page.getByRole('button', { name: /à la main/ }).click();
  await page.getByRole('dialog').getByLabel('Plateforme').selectOption('switch');
  await page.getByRole('dialog').getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Un jeu introuvable' })).toBeVisible();
  await expect(page.locator('.case__placeholder')).toBeVisible();
  await expect(page.getByText(/pas de source automatique/)).toBeVisible();
});

test('filters, search and sort in the library; delete asks for confirmation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.grid li')).toHaveCount(3);
  await page.getByRole('button', { name: /^En cours/ }).click();
  await expect(page.locator('.grid li')).toHaveCount(1);
  await page.getByRole('button', { name: /^Tous/ }).click();
  await page.getByLabel('Chercher dans ma bibliothèque').fill('elden');
  await expect(page.locator('.grid li')).toHaveCount(1);
  await page.getByLabel('Chercher dans ma bibliothèque').fill('');
  await page.getByLabel('Plateforme').selectOption('switch');
  await expect(page.locator('.grid li')).toHaveCount(1);
  await page.getByLabel('Plateforme').selectOption('all');

  await page.getByRole('link', { name: /Un jeu introuvable/ }).click();
  await page.getByRole('button', { name: /Supprimer ce jeu/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Un jeu introuvable' })).toBeVisible();
  await page.getByRole('button', { name: /Supprimer ce jeu/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(page.locator('.grid li')).toHaveCount(2);
});

test('export, then import into the same library adds nothing twice', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Réglages' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Exporter (JSON)' }).click()]);
  const path = await download.path();
  await page.getByLabel('Fichier à importer').setInputFiles(path);
  await expect(page.getByText(/0 jeu\(x\) importé\(s\), 2 déjà présent\(s\)/)).toBeVisible();
});
