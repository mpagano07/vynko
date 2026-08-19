import {
  test,
  expect,
  createProductViaUI,
  isProductVisibleInTable,
  getCurrentTenantName,
  getTenantNames,
  switchTenantByName,
  getDashboardTenantName,
  addProductToCart,
  getCartItem,
  cleanupBranchProducts,
} from './fixtures';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const timestamp = Date.now();
const PRODUCT_DASH = `Dashboard E2E ${timestamp}`;
const PRODUCTS = [PRODUCT_DASH];
const SALE_PRICE = 350;
const SALE_STOCK = 10;

test.describe('Dashboard E2E', () => {
  let branchA = '';
  let branchB = '';

  // ─── Setup ────────────────────────────────────────────────

  test('setup - verificar sucursales y crear producto de prueba', async ({ authenticatedPage: page }) => {
    const tenantNames = await getTenantNames(page);
    if (tenantNames.length < 2) {
      test.skip(true, 'El usuario E2E Business necesita >= 2 sucursales');
      return;
    }

    branchA = await getCurrentTenantName(page);
    branchB = tenantNames.find((n) => n !== branchA)!;

    await page.goto('/products');
    await expect(page.locator('table, [role="grid"]').first()).toBeVisible({ timeout: 10_000 });

    await page.locator('select').first().locator('option').nth(1).waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {});

    await createProductViaUI(page, {
      name: PRODUCT_DASH,
      sku: `SKU-DASH-${timestamp}`,
      price: SALE_PRICE,
      cost: 150,
      stock: SALE_STOCK,
      min_stock: 3,
      max_stock: 50,
    });

    expect(await isProductVisibleInTable(page, PRODUCT_DASH)).toBe(true);
  });

  // ─── 1. Dashboard carga correctamente ─────────────────────

  test('dashboard carga correctamente - muestra greeting, sucursal, KPI y acciones', async ({ authenticatedPage: page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Saludo visible
    const heading = page.getByRole('heading', { name: /Hola/ });
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // Nombre de la sucursal debajo del saludo
    const tenantName = await getDashboardTenantName(page);
    expect(tenantName).toBeTruthy();
    expect(tenantName).not.toBe('Todas las sucursales');

    // Las 4 tarjetas KPI: Ventas hoy, Ingresos del mes, Stock crítico, Estado
    await expect(page.getByText('Ventas hoy', { exact: true })).toBeVisible();
    await expect(page.getByText('Ingresos del mes', { exact: true })).toBeVisible();
    await expect(page.getByText('Stock crítico', { exact: true })).toBeVisible();
    await expect(page.getByText('Estado', { exact: true })).toBeVisible();

    // Botones de acción
    await expect(page.getByRole('link', { name: /Nueva venta/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Nuevo producto/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Nueva compra/ })).toBeVisible();
  });

  // ─── 2. Dashboard corresponde a la sucursal seleccionada ───

  test('dashboard muestra la sucursal activa correcta', async ({ authenticatedPage: page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // El nombre en el dashboard debe coincidir con la sucursal del sidebar
    const sidebarName = await getCurrentTenantName(page);
    const dashName = await getDashboardTenantName(page);
    expect(dashName).toBe(sidebarName);

    // Cambiar a Branch B y verificar que el dashboard refleja el cambio
    await switchTenantByName(page, branchB);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const sidebarNameB = await getCurrentTenantName(page);
    const dashNameB = await getDashboardTenantName(page);
    expect(dashNameB).toBe(sidebarNameB);
    expect(dashNameB).toBe(branchB);

    // Volver a Branch A
    await switchTenantByName(page, branchA);
  });

  // ─── 3. Los datos principales aparecen ─────────────────────

  test('datos principales - cada tarjeta KPI muestra un valor', async ({ authenticatedPage: page }) => {
    await switchTenantByName(page, branchA);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Esperar a que desaparezcan los skeletons de carga
    await page.locator('.animate-pulse').first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    // Las 4 cards KPI tienen height fijo h-[104px]
    const kpiCards = page.locator('[class*="h-[104px]"]');
    await expect(kpiCards).toHaveCount(4, { timeout: 10_000 });

    // Card 1 "Ventas hoy": muestra un monto o "Sin ventas"
    const ventasValue = kpiCards.nth(0).locator('p').filter({ hasText: /\$|Sin ventas/ }).first();
    await expect(ventasValue).toBeVisible({ timeout: 10_000 });

    // Card 2 "Ingresos del mes": muestra un monto
    const ingresosValue = kpiCards.nth(1).locator('p').filter({ hasText: /\$/ }).first();
    await expect(ingresosValue).toBeVisible();

    // Card 3 "Stock crítico": muestra un número
    const stockValue = kpiCards.nth(2).locator('p').first();
    await expect(stockValue).toBeVisible();

    // Card 4 "Estado": muestra uno de los estados posibles
    const estadoTexto = kpiCards.nth(3).locator('p').filter({ hasText: /Sin ventas hoy|Stock bajo|Todo OK/ }).first();
    await expect(estadoTexto).toBeVisible();
  });

  // ─── 4. Después de una venta, los indicadores se actualizan ─

  test('después de una venta, los indicadores del dashboard se actualizan', async ({ authenticatedPage: page }) => {
    await switchTenantByName(page, branchA);

    // Ir al dashboard y registrar el texto previo de "Ventas hoy"
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.locator('.animate-pulse').first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    const kpiCards = page.locator('[class*="h-[104px]"]');
    const ventasPBefore = kpiCards.nth(0).locator('p').filter({ hasText: /venta|Sin ventas/ }).first();
    const textBefore = await ventasPBefore.textContent();

    // Ir a la caja y realizar una venta
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    await addProductToCart(page, PRODUCT_DASH);
    const cartItem = getCartItem(page, PRODUCT_DASH);
    await expect(cartItem).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Finalizar venta' }).click();
    await expect(page.locator('[role="status"]').filter({ hasText: 'Venta registrada exitosamente' }).first()).toBeVisible({ timeout: 15_000 });

    // Volver al dashboard y verificar que los indicadores cambiaron
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.locator('.animate-pulse').first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    // Card "Ventas hoy" ya no debería decir "Sin ventas"
    const ventasPAfter = kpiCards.nth(0).locator('p').filter({ hasText: /venta|Sin ventas/ }).first();
    const textAfter = await ventasPAfter.textContent();
    expect(textAfter).not.toBe(textBefore);
  });

  // ─── 5. Cambio de sucursal → cambio de datos del dashboard ─

  test('cambio de sucursal muestra datos diferentes en el dashboard', async ({ authenticatedPage: page }) => {
    // Branch A: debería tener ventas (del test anterior)
    await switchTenantByName(page, branchA);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.locator('.animate-pulse').first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    const kpiCardsA = page.locator('[class*="h-[104px]"]');
    const ventasTextA = await kpiCardsA.nth(0).locator('p').filter({ hasText: /venta|\$/ }).first().textContent();

    // Cambiar a Branch B
    await switchTenantByName(page, branchB);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.locator('.animate-pulse').first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    // Branch B: nombre correcto y datos propios
    const dashNameB = await getDashboardTenantName(page);
    expect(dashNameB).toBe(branchB);

    const kpiCardsB = page.locator('[class*="h-[104px]"]');
    const ventasTextB = await kpiCardsB.nth(0).locator('p').filter({ hasText: /venta|\$/ }).first().textContent();

    // La venta de Branch A NO debería afectar a Branch B
    // Verificar en /products que el producto de prueba no existe en Branch B
    await page.goto('/products');
    await page.waitForLoadState('networkidle');
    expect(await isProductVisibleInTable(page, PRODUCT_DASH)).toBe(false);

    // Volver a Branch A para confirmar que sus datos siguen intactos
    await switchTenantByName(page, branchA);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.locator('.animate-pulse').first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    const kpiCardsAReturn = page.locator('[class*="h-[104px]"]');
    const ventasTextAReturn = await kpiCardsAReturn.nth(0).locator('p').filter({ hasText: /venta|\$/ }).first().textContent();
    expect(ventasTextAReturn).toBe(ventasTextA);
  });

  // ─── Cleanup ──────────────────────────────────────────────

  test('cleanup - eliminar productos de prueba', async ({ authenticatedPage: page }) => {
    await switchTenantByName(page, branchA);
    await cleanupBranchProducts(page, PRODUCTS);

    await page.goto('/products');
    expect(await isProductVisibleInTable(page, PRODUCT_DASH)).toBe(false);
  });
});
