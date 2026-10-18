import { expect, test } from '@playwright/test';

const noSideScroll = () => document.documentElement.scrollWidth <= document.documentElement.clientWidth;

test('phone: library and game page fit the screen, the case is visible, tapping targets are big enough', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.grid li').first()).toBeVisible();
  expect(await page.evaluate(noSideScroll)).toBe(true);
  await page.getByRole('link', { name: /Hades/ }).click();
  await expect(page.getByRole('checkbox').first()).toBeVisible();
  expect(await page.evaluate(noSideScroll)).toBe(true);
  const box = await page.locator('.case--lg').boundingBox();
  expect(box!.width).toBeGreaterThan(150);
  const tick = await page.locator('.ach__box').first().boundingBox();
  expect(tick!.width).toBeGreaterThanOrEqual(24);
  const row = await page.locator('.ach').first().boundingBox();
  expect(row!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Ajouter un jeu' }).click();
  await expect(page.getByLabel('Nom du jeu')).toBeVisible();
  expect(await page.evaluate(noSideScroll)).toBe(true);
});
