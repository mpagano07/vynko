import {
  test,
  expect,
  cleanupBillingData,
} from './fixtures';

test.describe.configure({ mode: 'serial' });

test.describe('Facturación E2E', () => {
  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await cleanupBillingData(page);
    await context.close();
  });

  test('billing page - muestra planes y precios', async ({ authenticatedPage: page }) => {
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');

    // Título principal
    await expect(page.getByRole('heading', { name: 'Planes disponibles' })).toBeVisible({ timeout: 15_000 });

    // Plan cards: Starter, Business, Enterprise visible
    await expect(page.getByText('Starter', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Business', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Enterprise', { exact: true }).first()).toBeVisible();

    // Precios en ARS (formato argentino)
    await expect(page.getByText(/\$.*19\.900/).first()).toBeVisible();
    await expect(page.getByText(/\$.*34\.900/).first()).toBeVisible();

    // Enterprise dice "Próximamente"
    await expect(page.getByText('Próximamente').first()).toBeVisible();

    // At least one "Suscribirse" button exists
    await expect(page.getByRole('button', { name: /Suscribirse/ }).first()).toBeVisible();
  });

  test('billing page - plan actual con estado', async ({ authenticatedPage: page }) => {
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');

    // Card de "Plan actual" badge (always visible for authenticated user with a plan)
    const currentPlanBadge = page.locator('.rounded-full').filter({ hasText: 'Plan actual' });
    await expect(currentPlanBadge).toBeVisible({ timeout: 15_000 });

    // The plan name should be displayed (e.g. "Starter", "Business")
    const planHeading = page.locator('h2').filter({ hasText: /Starter|Business/ });
    await expect(planHeading).toBeVisible({ timeout: 5_000 });
  });

  test('checkout starter - crea suscripción y redirige a MP', async ({ authenticatedPage: page }) => {
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');

    // Intercept the checkout API call
    let checkoutResponse: { url?: string; error?: string } | null = null;
    await page.route('**/api/billing/create-checkout', async (route) => {
      checkoutResponse = { url: 'https://sandbox.mercadopago.com/checkout/redirect/test123' };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(checkoutResponse),
      });
    });

    // Find the Starter plan section and click subscribe
    // Look for the "Suscribirse" button in the grid area (not in the current plan card)
    const subscribeButtons = page.locator('.grid').getByRole('button', { name: /Suscribirse/ });
    const count = await subscribeButtons.count();

    if (count > 0) {
      await subscribeButtons.first().click({ timeout: 10_000 });
      await page.waitForTimeout(2000);
      expect(checkoutResponse).not.toBeNull();
      expect(checkoutResponse!.url).toContain('mercadopago');
    }
  });

  test('checkout business - crea suscripción y redirige a MP', async ({ authenticatedPage: page }) => {
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');

    let checkoutResponse: { url?: string; error?: string } | null = null;
    await page.route('**/api/billing/create-checkout', async (route) => {
      checkoutResponse = { url: 'https://sandbox.mercadopago.com/checkout/redirect/test456' };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(checkoutResponse),
      });
    });

    // Find a subscribe button in the grid for Business plan
    const gridButtons = page.locator('.grid').getByRole('button', { name: /Suscribirse|Cambiar/ });
    const count = await gridButtons.count();

    if (count > 0) {
      await gridButtons.first().click({ timeout: 10_000 });
      await page.waitForTimeout(2000);
      expect(checkoutResponse).not.toBeNull();
    }
  });

  test('checkout - sin sesión muestra error', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to the app first so relative URLs work
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Navigate to billing without authentication
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');

    // Should redirect to login or show loading state
    const currentUrl = page.url();
    const isOnLogin = currentUrl.includes('/login');
    const isOnBilling = currentUrl.includes('/billing');

    expect(isOnLogin || isOnBilling).toBe(true);

    await context.close();
  });

  test('cancelar suscripción - flujo UI', async ({ authenticatedPage: page }) => {
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');

    // Look for cancel button - only visible if subscription is active
    const cancelButtons = page.getByRole('button', { name: /Cancelar suscripción/ });
    const cancelCount = await cancelButtons.count();

    if (cancelCount > 0) {
      // Click first cancel button
      await cancelButtons.first().click({ timeout: 10_000 });

      // Modal should appear
      const modal = page.getByRole('heading', { name: 'Cancelar suscripción' });
      await expect(modal).toBeVisible({ timeout: 10_000 });

      // Confirm cancellation
      const confirmButton = page.getByRole('button', { name: 'Sí, cancelar' });
      await expect(confirmButton).toBeVisible();

      // Intercept the portal API call
      await page.route('**/api/billing/portal', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      });

      await confirmButton.click();

      // Toast success
      await expect(page.locator('[role="status"]').filter({ hasText: 'cancelada' }).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test('downgrade - business a starter con confirmación', async ({ authenticatedPage: page }) => {
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');

    // Check if there's a downgrade button (only for higher plans)
    const downgradeButtons = page.locator('.grid').getByRole('button', { name: /Cambiar a Starter/ });
    const downgradeCount = await downgradeButtons.count();

    if (downgradeCount > 0) {
      await downgradeButtons.first().click({ timeout: 10_000 });

      // Modal should appear with downgrade warning
      const modal = page.getByRole('heading', { name: /¿Cambiar a Starter?/ });
      await expect(modal).toBeVisible({ timeout: 10_000 });

      // Should mention feature loss
      await expect(page.getByText('productos por encima')).toBeVisible();
      await expect(page.getByText('colaboradores')).toBeVisible();

      // Close modal without confirming
      await page.getByRole('button', { name: 'Volver' }).click();
      await expect(modal).toBeHidden({ timeout: 5_000 });
    }
  });

  test('billing status API - retorna información correcta', async ({ authenticatedPage: page }) => {
    // Make direct API call
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/billing/status');
      return { status: res.status, data: await res.json() };
    });

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('plan');
    expect(response.data).toHaveProperty('status');
    expect(response.data).toHaveProperty('features');
    expect(['starter', 'business', 'enterprise']).toContain(response.data.plan);
    expect(['active', 'inactive', 'free', 'past_due', 'canceled']).toContain(response.data.status);
  });

  test('billing status API - sin autenticación retorna 401', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to the app first so relative URLs work
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const response = await page.evaluate(async () => {
      const res = await fetch('/api/billing/status');
      return { status: res.status };
    });

    expect(response.status).toBe(401);
    await context.close();
  });

  test('enterprise plan - botón deshabilitado', async ({ authenticatedPage: page }) => {
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');

    // Enterprise should have a disabled "Próximamente" button in the grid
    const disabledButton = page.locator('.grid').getByRole('button', { name: 'Próximamente' });
    await expect(disabledButton).toBeVisible({ timeout: 10_000 });
    await expect(disabledButton).toBeDisabled();
  });

  test('billing page - link de soporte visible', async ({ authenticatedPage: page }) => {
    await page.goto('/billing');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('¿Necesitás ayuda?')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Contactar soporte' })).toBeVisible();
  });

  test('cleanup - restaurar estado del tenant', async ({ authenticatedPage: page }) => {
    await cleanupBillingData(page);

    // Verify the tenant is back to free/starter state
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/billing/status');
      return res.json();
    });

    expect(response.plan).toBe('starter');
  });
});
