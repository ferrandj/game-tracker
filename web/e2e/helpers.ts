import { expect, type Page } from '@playwright/test';

/** Search a game by name in the "Ajouter un jeu" dialog and add it on the given platform. Ends on the game page. */
export async function addGame(page: Page, query: string, title: string, platform: string) {
  await page.getByRole('button', { name: /Ajouter (un|mon premier) jeu/ }).first().click();
  await page.getByLabel('Nom du jeu').fill(query);
  await page.locator('button.result', { hasText: new RegExp(title, 'i') }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Plateforme').selectOption(platform);
  await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}
