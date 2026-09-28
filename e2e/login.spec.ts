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

  // La API responde deliberadamente un mensaje generico: revelar si el email
  // existe permitiria enumerar cuentas. Ver src/app/api/auth/login/route.ts
  await expect(page.getByText('Credenciales inválidas')).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/login$/);
});

test('login exitoso redirige al dashboard', async ({ page }) => {
  test.skip(!E2E_USER_EMAIL || !E2E_USER_PASSWORD, 'Faltan E2E_USER_EMAIL / E2E_USER_PASSWORD en .env.local');

  await page.getByPlaceholder('tu@email.com').fill(E2E_USER_EMAIL);
  await page.getByPlaceholder('••••••••').fill(E2E_USER_PASSWORD);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
});

test('campos obligatorios - error cuando están vacíos', async ({ page }) => {
  // Intentar enviar formulario sin llenar campos
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  // Debe mostrar error de validación
  await expect(page.getByText(/Completá ambos campos/i)).toBeVisible({ timeout: 5_000 });
  
  // Debe seguir en la página de login
  await expect(page).toHaveURL(/\/login$/);
});

test('logout redirige al login', async ({ page }) => {
  test.skip(!E2E_USER_EMAIL || !E2E_USER_PASSWORD, 'Faltan E2E_USER_EMAIL / E2E_USER_PASSWORD en .env.local');

  // Login exitoso
  await page.getByPlaceholder('tu@email.com').fill(E2E_USER_EMAIL);
  await page.getByPlaceholder('••••••••').fill(E2E_USER_PASSWORD);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  // Esperar a estar en dashboard
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  // "Cerrar sesión" vive dentro del dropdown "Menú de usuario", así que hay
  // que abrir el menú antes de poder pulsarlo. Sin este paso el locator no lo
  // encuentra y el test falla por un motivo que no es un bug de la app.
  const userMenu = page.getByRole('button', { name: 'Menú de usuario' });
  await userMenu.click();

  const logoutButton = page.getByRole('button', { name: /cerrar sesión|salir|logout/i });
  await logoutButton.click();

  // Debe redirigir a login
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });

  // Verificar que la sesión fue limpiada (no hay tokens de Supabase)
  const storage = await page.evaluate(() => ({
    localStorage: Object.keys(localStorage),
    sessionStorage: Object.keys(sessionStorage),
  }));
  
  // No debe haber claves de sesión de Supabase activas
  const authToken = storage.localStorage.some(key => key.includes('auth.token'));
  expect(authToken).toBe(false);
});

test('usuario no autenticado redirige a login', async ({ page }) => {
  // Limpiar cualquier sesión previa
  await page.context().clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // Intenta navegar directamente a una ruta protegida
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

  // Debe redirigir a login
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
});

test('sesión persiste al recargar página', async ({ page }) => {
  test.skip(!E2E_USER_EMAIL || !E2E_USER_PASSWORD, 'Faltan E2E_USER_EMAIL / E2E_USER_PASSWORD en .env.local');

  // Login exitoso
  await page.getByPlaceholder('tu@email.com').fill(E2E_USER_EMAIL);
  await page.getByPlaceholder('••••••••').fill(E2E_USER_PASSWORD);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  // Esperar a estar en dashboard
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  // Recargar página
  await page.reload();

  // No debe redirigir a login, debe permanecer autenticado
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  // Verificar que la sesión está activa (página carga correctamente)
  const heading = page.getByRole('heading').first();
  await expect(heading).toBeVisible({ timeout: 10_000 });
});
