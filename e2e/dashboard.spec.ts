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
  completeCheckout,
  getKpiCardValue,
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

    // Las 4 tarjetas KPI del grid principal
    await expect(page.getByTestId('stat-card')).toHaveCount(4, { timeout: 10_000 });

    // Se localizan por su titulo, no por posicion: el valor de una StatCard
    // es un <div>, no un <p>, asi que buscarlo por etiqueta/tag no funcionaba.
    expect(await getKpiCardValue(page, 'Ventas hoy')).toMatch(/\$|Sin ventas/);
    expect(await getKpiCardValue(page, 'Ingresos del mes')).toMatch(/\$/);
    expect(await getKpiCardValue(page, 'Stock crítico')).toMatch(/\d/);
    expect(await getKpiCardValue(page, 'Estado')).toMatch(
      /Sin ventas hoy|Stock bajo|Todo OK/
    );
  });

  // ─── 4. Después de una venta, los indicadores se actualizan ─

  test('después de una venta, los indicadores del dashboard se actualizan', async ({ authenticatedPage: page }) => {
    await switchTenantByName(page, branchA);

    // Ir al dashboard y registrar el texto previo de "Ventas hoy"
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.locator('.animate-pulse').first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    const textBefore = await getKpiCardValue(page, 'Ventas hoy');

    // Ir a la caja y realizar una venta
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    await addProductToCart(page, PRODUCT_DASH);
    const cartItem = getCartItem(page, PRODUCT_DASH);
    await expect(cartItem).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Finalizar venta' }).click();
    // "Finalizar venta" solo ABRE el modal de cobro; hay que confirmar el pago
    // para que la venta quede registrada.
    await completeCheckout(page);
    await expect(page.locator('[role="status"]').filter({ hasText: 'Venta registrada exitosamente' }).first()).toBeVisible({ timeout: 15_000 });

    // Volver al dashboard y verificar que los indicadores cambiaron
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.locator('.animate-pulse').first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    // Card "Ventas hoy" ya no debería decir "Sin ventas"
    const textAfter = await getKpiCardValue(page, 'Ventas hoy');
    expect(textAfter).not.toBe(textBefore);
  });

  // ─── 5. Cambio de sucursal → cambio de datos del dashboard ─

  test('cambio de sucursal muestra datos diferentes en el dashboard', async ({ authenticatedPage: page }) => {
    // Branch A: debería tener ventas (del test anterior)
    await switchTenantByName(page, branchA);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.locator('.animate-pulse').first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    const ventasTextA = await getKpiCardValue(page, 'Ventas hoy');

    // Cambiar a Branch B
    await switchTenantByName(page, branchB);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.locator('.animate-pulse').first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    // Branch B: nombre correcto y datos propios
    const dashNameB = await getDashboardTenantName(page);
    expect(dashNameB).toBe(branchB);
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

    const ventasTextAReturn = await getKpiCardValue(page, 'Ventas hoy');
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
