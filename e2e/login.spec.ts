import { test, expect } from '@playwright/test';

const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL ?? '';
const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD ?? '';

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
});

test('muestra el formulario de login', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByPlaceholder('tu@email.com')).toBeVisible();
  await expect(page.getByPlaceholder('••••••••')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
});

test('login con credenciales inválidas muestra error', async ({ page }) => {
  await page.getByPlaceholder('tu@email.com').fill('invalid@test.com');
  await page.getByPlaceholder('••••••••').fill('wrong-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.getByText('Email o contraseña incorrectos')).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/login$/);
});

test('login exitoso redirige al dashboard', async ({ page }) => {
  test.skip(!E2E_USER_EMAIL || !E2E_USER_PASSWORD, 'Faltan E2E_USER_EMAIL / E2E_USER_PASSWORD en .env.local');

  await page.getByPlaceholder('tu@email.com').fill(E2E_USER_EMAIL);
  await page.getByPlaceholder('••••••••').fill(E2E_USER_PASSWORD);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
});
