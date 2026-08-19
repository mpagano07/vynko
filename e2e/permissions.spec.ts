import { test, expect, getSidebarNavItems } from './fixtures';

test.describe('Permisos y roles — Owner', () => {
  test('owner - sidebar muestra todos los nav items', async ({ authenticatedPage: page }) => {
    await page.goto('/dashboard');
    const items = await getSidebarNavItems(page);

    expect(items.some((i) => i.includes('Dashboard'))).toBeTruthy();
    expect(items.some((i) => i.includes('Ventas'))).toBeTruthy();
    expect(items.some((i) => i.includes('Productos'))).toBeTruthy();
    expect(items.some((i) => i.includes('Proveedores'))).toBeTruthy();
    expect(items.some((i) => i.includes('Clientes'))).toBeTruthy();
    expect(items.some((i) => i.includes('Documentos'))).toBeTruthy();
    expect(items.some((i) => i.includes('Pronóstico'))).toBeTruthy();
    expect(items.some((i) => i.includes('Historial'))).toBeTruthy();
    expect(items.some((i) => i.includes('Planes'))).toBeTruthy();
    expect(items.some((i) => i.includes('Configuración'))).toBeTruthy();
  });

  test('owner - puede acceder a /billing', async ({ authenticatedPage: page }) => {
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/billing');
    await expect(page.getByRole('heading', { name: /plan/i })).toBeVisible({ timeout: 10_000 });
  });

  test('owner - puede acceder a /settings', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/settings');
    await expect(page.locator('h1', { hasText: 'Configuración' })).toBeVisible({ timeout: 10_000 });
  });

  test('owner - puede acceder a /activity-logs', async ({ authenticatedPage: page }) => {
    await page.goto('/activity-logs');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/activity-logs');
    await expect(page.getByRole('heading', { name: /historial de actividad/i })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Permisos y roles — Member', () => {
  test('member - sidebar NO muestra items restringidos', async ({ memberPage: page }) => {
    await page.goto('/dashboard');
    const items = await getSidebarNavItems(page);
    const joined = items.join(' ').toLowerCase();

    expect(joined).not.toContain('pronóstico');
    expect(joined).not.toContain('historial');
    expect(joined).not.toContain('plan');
    expect(joined).not.toContain('configuración');
  });

  test('member - sidebar SÍ muestra items permitidos', async ({ memberPage: page }) => {
    await page.goto('/dashboard');
    const items = await getSidebarNavItems(page);
    const joined = items.join(' ').toLowerCase();

    expect(joined).toContain('dashboard');
    expect(joined).toContain('ventas');
    expect(joined).toContain('productos');
    expect(joined).toContain('proveedores');
    expect(joined).toContain('clientes');
    expect(joined).toContain('documentos');
  });

  test('member - /billing redirige a /dashboard', async ({ memberPage: page }) => {
    await page.goto('/billing');
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
    expect(page.url()).toContain('/dashboard');
  });

  test('member - /settings redirige a /dashboard', async ({ memberPage: page }) => {
    await page.goto('/settings');
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
    expect(page.url()).toContain('/dashboard');
  });

  test('member - /activity-logs muestra "sin permisos"', async ({ memberPage: page }) => {
    await page.goto('/activity-logs');
    await expect(page.getByText('No tienes permisos para ver esta página')).toBeVisible({ timeout: 15_000 });
  });

  test('member - /forecast redirige a /dashboard', async ({ memberPage: page }) => {
    await page.goto('/forecast');
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
    expect(page.url()).toContain('/dashboard');
  });
});

test.describe('Permisos y roles — Member API 403', () => {
  test('member - GET /api/activity-logs retorna 403', async ({ memberPage: page }) => {
    const res = await page.request.get('http://localhost:3000/api/activity-logs');
    expect(res.status()).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('No tienes permisos');
  });

  test('member - GET /api/settings/collaborators retorna 403', async ({ memberPage: page }) => {
    const res = await page.request.get('http://localhost:3000/api/settings/collaborators');
    expect(res.status()).toBe(403);
  });

  test('member - PATCH /api/settings/tenant retorna 403', async ({ memberPage: page }) => {
    const res = await page.request.patch('http://localhost:3000/api/settings/tenant', {
      data: { name: 'test' },
    });
    expect(res.status()).toBe(403);
  });
});
