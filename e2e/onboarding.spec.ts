import { test, expect } from '@playwright/test';

const NEW_USER_EMAIL = process.env.E2E_NEW_USER_EMAIL ?? '';
const NEW_USER_PASSWORD = process.env.E2E_NEW_USER_PASSWORD ?? '';

test('usuario nuevo sin empresa es redirigido a onboarding', async ({ page }) => {
  test.skip(!NEW_USER_EMAIL || !NEW_USER_PASSWORD, 'Faltan E2E_NEW_USER_EMAIL / E2E_NEW_USER_PASSWORD en .env.local');

  await page.goto('/login');
  await page.getByPlaceholder('tu@email.com').fill(NEW_USER_EMAIL);
  await page.getByPlaceholder('••••••••').fill(NEW_USER_PASSWORD);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 });
});
