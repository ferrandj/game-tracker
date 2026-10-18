import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function audit(page: Page, what: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')})`), what).toEqual([]);
}

for (const scheme of ['dark', 'light'] as const) {
  test(`no accessibility violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await expect(page.locator('.grid li').first()).toBeVisible();
    await audit(page, 'library');

    await page.getByRole('link', { name: /ELDEN RING/ }).click();
    await expect(page.getByRole('checkbox').first()).toBeVisible();
    await audit(page, 'game page (trophies)');

    await page.getByRole('link', { name: /Bibliothèque/ }).click();
    await page.getByRole('link', { name: /Hades/ }).click();
    await expect(page.getByRole('checkbox').first()).toBeVisible();
    await audit(page, 'game page (achievements)');

    await page.getByRole('button', { name: 'Ajouter un jeu' }).click();
    await page.getByLabel('Nom du jeu').fill('celeste');
    await expect(page.getByRole('button', { name: /Celeste/ })).toBeVisible();
    await audit(page, 'add dialog');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Réglages' }).click();
    await audit(page, 'settings');
  });
}

test('the dialog traps focus and gives it back on close', async ({ page }) => {
  await page.goto('/');
  const opener = page.getByRole('button', { name: 'Ajouter un jeu' });
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Nom du jeu')).toBeFocused();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});
