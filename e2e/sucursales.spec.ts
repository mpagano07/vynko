import {
  test,
  expect,
  createProductViaUI,
  isProductVisibleInTable,
  getStockInfo,
  getCurrentTenantName,
  getTenantNames,
  switchTenantByName,
  getDashboardTenantName,
  addProductToCart,
  getCartItem,
  getNewestSaleRowText,
  openSalesHistory,
  cleanupBranchProducts,
  loginAsUser,
  formatARSTest,
} from './fixtures';

// Tests en serie: comparten productos y datos de sucursal entre pasos.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const timestamp = Date.now();
const PRODUCT_STOCK = `Sucursal Test Stock ${timestamp}`;
const PRODUCT_VENTA = `Sucursal Test Venta ${timestamp}`;
const PRODUCTS = [PRODUCT_STOCK, PRODUCT_VENTA];

const STOCK_INITIAL = 10;
const VENTA_INITIAL = 5;
const VENTA_PRICE = 250;

const E2E_NEW_USER_EMAIL = process.env.E2E_NEW_USER_EMAIL ?? '';
const E2E_NEW_USER_PASSWORD = process.env.E2E_NEW_USER_PASSWORD ?? '';

test.describe('Sucursales E2E', () => {
  let branchA = '';
  let branchB = '';

  // ─── Setup ────────────────────────────────────────────────

  test('setup - verificar multiples sucursales y crear productos de prueba', async ({ authenticatedPage: page }) => {
    const tenantNames = await getTenantNames(page);
    if (tenantNames.length < 2) {
      test.skip(true, 'El usuario E2E Business necesita >= 2 sucursales');
      return;
    }

    branchA = await getCurrentTenantName(page);
    branchB = tenantNames.find((n) => n !== branchA)!;

    // Crear productos de prueba en Branch A
    await page.goto('/products');
    await expect(page.locator('table, [role="grid"]').first()).toBeVisible({ timeout: 10_000 });

    await createProductViaUI(page, {
      name: PRODUCT_STOCK,
      sku: `SKU-SUC-STOCK-${timestamp}`,
      price: 100,
      cost: 50,
      stock: STOCK_INITIAL,
      min_stock: 2,
      max_stock: 50,
    });

    await createProductViaUI(page, {
      name: PRODUCT_VENTA,
      sku: `SKU-SUC-VENTA-${timestamp}`,
      price: VENTA_PRICE,
      cost: 100,
      stock: VENTA_INITIAL,
      min_stock: 1,
      max_stock: 20,
    });

    expect(await isProductVisibleInTable(page, PRODUCT_STOCK)).toBe(true);
    expect(await isProductVisibleInTable(page, PRODUCT_VENTA)).toBe(true);
  });

  // ─── 1. Listar sucursales disponibles ─────────────────────

  test('listar sucursales - sidebar muestra las branches del usuario', async ({ authenticatedPage: page }) => {
    const tenantNames = await getTenantNames(page);
    expect(tenantNames.length).toBeGreaterThanOrEqual(2);
    expect(tenantNames).toContain(branchA);
    expect(tenantNames).toContain(branchB);
  });

  // ─── 2. Cambiar de sucursal ───────────────────────────────

  test('cambiar de sucursal - switch a Branch B', async ({ authenticatedPage: page }) => {
    await switchTenantByName(page, branchB);
    const current = await getCurrentTenantName(page);
    expect(current).toBe(branchB);
  });

  // ─── 3. Verificar contexto de la aplicacion ───────────────

  test('contexto de aplicacion - dashboard refleja la sucursal activa', async ({ authenticatedPage: page }) => {
    // Cada test arranca en la sucursal default (Branch A).
    // Verificar que el dashboard muestra Branch A.
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    const dashA = await getDashboardTenantName(page);
    expect(dashA).toBe(branchA);

    // Switch a Branch B y verificar
    await switchTenantByName(page, branchB);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    const dashB = await getDashboardTenantName(page);
    expect(dashB).toBe(branchB);

    // Volver a Branch A
    await switchTenantByName(page, branchA);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    const dashAReturn = await getDashboardTenantName(page);
    expect(dashAReturn).toBe(branchA);
  });

  // ─── 4. Stock corresponde a la sucursal ───────────────────

  test('stock - Branch A tiene stock, Branch B no', async ({ authenticatedPage: page }) => {
    // Branch A: producto existe con stock conocido
    await page.goto('/products');
    const infoA = await getStockInfo(page, PRODUCT_STOCK);
    expect(infoA.stock).toBe(STOCK_INITIAL);

    // Cambiar a Branch B
    await switchTenantByName(page, branchB);
    await page.goto('/products');

    // En Branch B el producto no deberia tener stock (no aparece en la tabla)
    expect(await isProductVisibleInTable(page, PRODUCT_STOCK)).toBe(false);

    // Volver a Branch A: stock sigue intacto
    await switchTenantByName(page, branchA);
    await page.goto('/products');
    const infoAAfter = await getStockInfo(page, PRODUCT_STOCK);
    expect(infoAAfter.stock).toBe(STOCK_INITIAL);
  });

  // ─── 5. Ventas corresponden a la sucursal ─────────────────

  test('ventas - venta en Branch A no aparece en Branch B', async ({ authenticatedPage: page }) => {
    // Asegurar que estamos en Branch A
    await switchTenantByName(page, branchA);

    // Registrar una venta en Branch A
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    await addProductToCart(page, PRODUCT_VENTA);
    const cartItem = getCartItem(page, PRODUCT_VENTA);
    await expect(cartItem).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Finalizar venta' }).click();
    await expect(page.locator('[role="status"]').filter({ hasText: 'Venta registrada exitosamente' }).first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    // Verificar que la venta aparece en historial de Branch A
    await openSalesHistory(page);
    await expect(page.locator('table tbody tr').first()).toContainText(formatARSTest(VENTA_PRICE), { timeout: 15_000 });

    // Cambiar a Branch B
    await switchTenantByName(page, branchB);
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    // En Branch B: la venta NO deberia existir en el historial
    const historyVisible = await page.getByRole('heading', { name: 'Ultimas Ventas' }).isVisible().catch(() => false);
    if (historyVisible) {
      const rows = page.locator('table tbody tr');
      const rowCount = await rows.count();
      if (rowCount > 0) {
        const allRowTexts = await rows.allTextContents();
        const hasLeaked = allRowTexts.some((t) => t.includes(formatARSTest(VENTA_PRICE)));
        expect(hasLeaked).toBe(false);
      }
    }

    // Volver a Branch A y verificar que la venta sigue ahi
    await switchTenantByName(page, branchA);
    await page.goto('/sales');
    const rowTextAAfter = await getNewestSaleRowText(page);
    expect(rowTextAAfter).toContain(formatARSTest(VENTA_PRICE));
  });

  // ─── 6. Aislamiento completo ──────────────────────────────

  test('aislamiento completo - stock, ventas y dashboard son independientes', async ({ authenticatedPage: page }) => {
    // === Branch A: verificar estado actual ===
    await switchTenantByName(page, branchA);

    // Stock: PRODUCT_STOCK
    await page.goto('/products');
    const stockInfoA = await getStockInfo(page, PRODUCT_STOCK);
    expect(stockInfoA.stock).toBe(STOCK_INITIAL);

    // Dashboard Branch A
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    const dashTenantA = await getDashboardTenantName(page);
    expect(dashTenantA).toBe(branchA);

    // === Cambiar a Branch B ===
    await switchTenantByName(page, branchB);

    // Stock Branch B: PRODUCT_STOCK no visible
    await page.goto('/products');
    expect(await isProductVisibleInTable(page, PRODUCT_STOCK)).toBe(false);
    expect(await isProductVisibleInTable(page, PRODUCT_VENTA)).toBe(false);

    // Dashboard Branch B: metricas independientes
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    const dashTenantB = await getDashboardTenantName(page);
    expect(dashTenantB).toBe(branchB);

    // === Volver a Branch A: todo intacto ===
    await switchTenantByName(page, branchA);

    await page.goto('/products');
    const stockInfoAReturn = await getStockInfo(page, PRODUCT_STOCK);
    expect(stockInfoAReturn.stock).toBe(STOCK_INITIAL);

    expect(await isProductVisibleInTable(page, PRODUCT_VENTA)).toBe(true);

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    const dashTenantAReturn = await getDashboardTenantName(page);
    expect(dashTenantAReturn).toBe(branchA);
  });

  // ─── 7. "Todas las sucursales" ────────────────────────────

  test('todas las sucursales - muestra desglose por branch', async ({ authenticatedPage: page }) => {
    // Seleccionar "Todas las sucursales" desde el sidebar
    const DESKTOP_SIDEBAR = 'aside.hidden.md\\:flex';
    await page.locator(`${DESKTOP_SIDEBAR} p.truncate.flex-1`).first().click();

    const allBtn = page.locator(DESKTOP_SIDEBAR).getByRole('button', { name: 'Todas las sucursales' });
    if (!(await allBtn.isVisible().catch(() => false))) {
      test.skip(true, 'Opcion "Todas las sucursales" no disponible');
      return;
    }
    await allBtn.click();

    // Esperar a que el sidebar muestre "Todas las sucursales"
    await expect(page.locator(`${DESKTOP_SIDEBAR} p.truncate.flex-1`).first()).toHaveText('Todas las sucursales', { timeout: 15_000 });

    // Dashboard: debe mostrar la tabla "Desglose por sucursal"
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const breakdownHeading = page.getByText('Desglose por sucursal');
    await expect(breakdownHeading).toBeVisible({ timeout: 15_000 });

    // La tabla debe contener ambas branches
    const table = page.locator('table').filter({ has: page.getByText('Sucursal') }).first();
    await expect(table).toBeVisible();

    const tableText = await table.textContent();
    expect(tableText).toContain(branchA);
    expect(tableText).toContain(branchB);
  });

  // ─── 8. Cuenta Starter: limitaciones de sucursal ──────────

  test('cuenta starter - una sola sucursal y sin opcion "todas"', async ({ browser }) => {
    if (!E2E_NEW_USER_EMAIL || !E2E_NEW_USER_PASSWORD) {
      test.skip(true, 'Credenciales de usuario Starter no configuradas en .env.local');
      return;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    await loginAsUser(page, E2E_NEW_USER_EMAIL, E2E_NEW_USER_PASSWORD);

    const DESKTOP_SIDEBAR = 'aside.hidden.md\\:flex';
    const sidebarVisible = await page.locator(`${DESKTOP_SIDEBAR} p.truncate.flex-1`).first().isVisible({ timeout: 10_000 }).catch(() => false);
    if (!sidebarVisible) {
      await context.close();
      test.skip(true, 'El sidebar del usuario Starter no cargo (posible redirect a onboarding)');
      return;
    }

    const tenantNames = await getTenantNames(page);
    expect(tenantNames.length).toBe(1);

    await page.locator(`${DESKTOP_SIDEBAR} p.truncate.flex-1`).first().click();
    const allBtn = page.locator(DESKTOP_SIDEBAR).getByRole('button', { name: 'Todas las sucursales' });
    await expect(allBtn).toHaveCount(0);

    await context.close();
  });

  // ─── Cleanup ──────────────────────────────────────────────

  test('cleanup - eliminar productos de prueba de Branch A', async ({ authenticatedPage: page }) => {
    await switchTenantByName(page, branchA);
    await cleanupBranchProducts(page, PRODUCTS);

    await page.goto('/products');
    for (const name of PRODUCTS) {
      expect(await isProductVisibleInTable(page, name)).toBe(false);
    }
  });
});
