import {
  test,
  expect,
  createProductViaUI,
  deleteProductViaUI,
  isProductVisibleInTable,
  getStockInfo,
  adjustStockViaLossPrevention,
  searchProduct,
  countProductsInTable,
  getTenantNames,
  getCurrentTenantName,
  switchTenantByName,
} from './fixtures';

// Los tests corren en serie: mutan el stock del mismo producto en la misma
// base, y cada paso depende del valor dejado por el anterior.
test.describe.configure({ mode: 'serial' });

const timestamp = Date.now();
const PRODUCT_NAME = `Producto Stock E2E ${timestamp}`;
const PRODUCT_SKU = `SKU-STOCK-${timestamp}`;
const PRODUCT_BARCODE = `BAR-STOCK-${timestamp}`;
const INITIAL_STOCK = 10;
const MIN_STOCK = 2;
const MAX_STOCK = 50;

test.describe('Stock E2E', () => {
  // Setup: producto con stock conocido para todas las pruebas de stock
  test('setup - crear producto para pruebas de stock', async ({ authenticatedPage: page }) => {
    await page.goto('/products');
    await expect(page.locator('table, [role="grid"]').first()).toBeVisible({ timeout: 10_000 });

    await createProductViaUI(page, {
      name: PRODUCT_NAME,
      sku: PRODUCT_SKU,
      barcode: PRODUCT_BARCODE,
      price: 99.99,
      cost: 50,
      stock: INITIAL_STOCK,
      min_stock: MIN_STOCK,
      max_stock: MAX_STOCK,
    });

    expect(await isProductVisibleInTable(page, PRODUCT_NAME)).toBe(true);
  });

  // Test 1: Visualizar stock actual
  test('visualizar stock actual - valor correcto y estado saludable', async ({ authenticatedPage: page }) => {
    await page.goto('/products');

    const info = await getStockInfo(page, PRODUCT_NAME);
    expect(info.stock).toBe(INITIAL_STOCK);
    expect(info.badgeClass).toContain('bg-emerald-100');

    const row = page.locator('tbody tr').filter({ hasText: PRODUCT_NAME }).first();
    await expect(row).toContainText(`Ideal: ${MIN_STOCK} - ${MAX_STOCK}`);
  });

  // Test 2: Aumentar stock
  test('aumentar stock - suma unidades correctamente', async ({ authenticatedPage: page }) => {
    await adjustStockViaLossPrevention(page, PRODUCT_NAME, 5, 'found');

    await page.goto('/products');
    const info = await getStockInfo(page, PRODUCT_NAME);
    expect(info.stock).toBe(INITIAL_STOCK + 5);
    expect(info.badgeClass).toContain('bg-emerald-100');
  });

  // Test 3: Disminuir stock
  test('disminuir stock - resta unidades correctamente', async ({ authenticatedPage: page }) => {
    await adjustStockViaLossPrevention(page, PRODUCT_NAME, 3, 'damaged');

    await page.goto('/products');
    const info = await getStockInfo(page, PRODUCT_NAME);
    expect(info.stock).toBe(INITIAL_STOCK + 5 - 3);
    expect(info.badgeClass).toContain('bg-emerald-100');
  });

  // Test 4: Verificar que el stock se actualizó correctamente (tabla + historial)
  test('verificar que el stock se actualizó correctamente - tabla y historial', async ({ authenticatedPage: page }) => {
    await page.goto('/products');
    const info = await getStockInfo(page, PRODUCT_NAME);
    expect(info.stock).toBe(12);

    await page.goto('/loss-prevention');
    const searchInput = page.getByPlaceholder('Buscar por producto...');
    await searchInput.fill(PRODUCT_NAME);
    await page.waitForTimeout(500);

    await expect(page.getByText('+5', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('-3', { exact: true }).first()).toBeVisible();
  });

  // Test 5: Intentar retirar más stock del disponible
  test('retirar más stock del disponible - error y stock sin cambios', async ({ authenticatedPage: page }) => {
    await adjustStockViaLossPrevention(page, PRODUCT_NAME, 100, 'lost', false);

    await page.goto('/products');
    const info = await getStockInfo(page, PRODUCT_NAME);
    expect(info.stock).toBe(12);
  });

  // Test 6: Comportamiento cuando el stock llega a 0
  test('cuando el stock llega a 0 - badge crítico y sin negativos', async ({ authenticatedPage: page }) => {
    await adjustStockViaLossPrevention(page, PRODUCT_NAME, 12, 'damaged');

    await page.goto('/products');
    const info = await getStockInfo(page, PRODUCT_NAME);
    expect(info.stock).toBe(0);
    expect(info.badgeClass).toContain('bg-red-100');
  });

  // Test 7: Stock crítico / bajo reflejado en filtros y badges
  test('stock crítico y bajo se reflejan en badges y filtros', async ({ authenticatedPage: page }) => {
    await page.goto('/products');
    await page.locator('table').first().waitFor({ state: 'visible', timeout: 15_000 });
    const loader = page.locator('[data-testid="loader"], .animate-spin').first();
    await loader.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
    await searchProduct(page, PRODUCT_NAME);
    const stockFilter = page.locator('select:has(option[value="critical"])');

    // stock 0 con mínimo 2 → crítico (0 <= 2)
    await stockFilter.selectOption('critical');
    await page.waitForTimeout(500);
    expect(await countProductsInTable(page)).toBe(1);

    await stockFilter.selectOption('normal');
    await page.waitForTimeout(500);
    expect(await countProductsInTable(page)).toBe(0);

    // Subir a 3 → bajo (2 < 3 <= 3)
    await adjustStockViaLossPrevention(page, PRODUCT_NAME, 3, 'correction');

    await page.goto('/products');
    const info = await getStockInfo(page, PRODUCT_NAME);
    expect(info.stock).toBe(3);
    expect(info.badgeClass).toContain('bg-amber-100');

    await stockFilter.selectOption('low');
    await page.waitForTimeout(500);
    expect(await countProductsInTable(page)).toBe(1);

    await stockFilter.selectOption('critical');
    await page.waitForTimeout(500);
    expect(await countProductsInTable(page)).toBe(0);
  });

  // Test 8: El stock pertenece a la sucursal correcta (aislamiento multi-sucursal)
  test('stock pertenece a la sucursal correcta - aislamiento entre sucursales', async ({ authenticatedPage: page }) => {
    const tenantNames = await getTenantNames(page);
    if (tenantNames.length < 2) {
      test.skip(true, 'El usuario E2E tiene una sola sucursal');
      return;
    }

    const currentTenant = await getCurrentTenantName(page);
    const otherTenant = tenantNames.find((n) => n !== currentTenant);
    expect(otherTenant).toBeTruthy();

    // El producto existe y tiene stock en la sucursal actual
    await page.goto('/products');
    expect(await isProductVisibleInTable(page, PRODUCT_NAME)).toBe(true);

    // En otra sucursal el producto no aparece (no tiene stock allí)
    await switchTenantByName(page, otherTenant as string);
    await page.goto('/products');
    expect(await isProductVisibleInTable(page, PRODUCT_NAME)).toBe(false);

    // Volver a la sucursal original y confirmar que el stock sigue
    await switchTenantByName(page, currentTenant);
    await page.goto('/products');
    expect(await isProductVisibleInTable(page, PRODUCT_NAME)).toBe(true);
  });

  // Cleanup: eliminar el producto de prueba
  test('cleanup - eliminar producto de prueba', async ({ authenticatedPage: page }) => {
    await page.goto('/products');
    try {
      await deleteProductViaUI(page, PRODUCT_NAME);
    } catch (e) {
      console.log('Cleanup: No se pudo eliminar producto vía UI:', e);
    }
    await page.reload();
    expect(await isProductVisibleInTable(page, PRODUCT_NAME)).toBe(false);
  });
});
