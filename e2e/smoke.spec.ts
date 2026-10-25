import { expect, test } from '@playwright/test';

const SCREENS = [
  { path: '/', name: 'Synthèse' },
  { path: '/patrimoine', name: 'Patrimoine' },
  { path: '/budget', name: 'Budget' },
  { path: '/epargne', name: 'Épargne' },
  { path: '/metaux', name: 'Métaux' },
];

test('sans session, « / » redirige vers /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Mot de passe')).toBeVisible();
});

test('un mauvais mot de passe affiche une erreur', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Mot de passe').fill('mauvais');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test.describe('connecté', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Mot de passe').fill('test');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByText('Patrimoine net').first()).toBeVisible();
  });

  test('la connexion affiche la Synthèse', async ({ page }) => {
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Patrimoine net').first()).toBeVisible();
  });

  test('« Budget » dans le menu du bas affiche le taux d’épargne', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Budget' }).click();
    await expect(page).toHaveURL(/\/budget$/);
    await expect(page.getByText("Taux d'épargne").first()).toBeVisible();
  });

  for (const { path, name } of SCREENS) {
    test(`aucun défilement horizontal sur ${name} (${path})`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(390);
    });
  }
});
