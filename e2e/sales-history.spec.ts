import {
  test,
  expect,
  createProductViaUI,
  isProductVisibleInTable,
  addProductToCart,
  getCartItem,
  openSalesHistory,
  cleanupSalesData,
  formatARSTest,
} from './fixtures';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const timestamp = Date.now();
const PRODUCT_HIST1 = `Historial E2E Alpha ${timestamp}`;
const PRODUCT_HIST2 = `Historial E2E Beta ${timestamp}`;
const PRODUCTS = [PRODUCT_HIST1, PRODUCT_HIST2];

const PRICE_HIST1 = 150;
const PRICE_HIST2 = 320;
const STOCK = 20;

test.describe('Historial de ventas E2E', () => {
  // ─── Setup ────────────────────────────────────────────────

  test('setup - crear productos de prueba', async ({ authenticatedPage: page }) => {
    await page.goto('/products');
    await expect(page.locator('table, [role="grid"]').first()).toBeVisible({ timeout: 10_000 });

    await page.locator('select').first().locator('option').nth(1).waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {});

    await createProductViaUI(page, {
      name: PRODUCT_HIST1,
      sku: `SKU-HIST-ALPHA-${timestamp}`,
      price: PRICE_HIST1,
      cost: 70,
      stock: STOCK,
      min_stock: 2,
      max_stock: 50,
    });

    await createProductViaUI(page, {
      name: PRODUCT_HIST2,
      sku: `SKU-HIST-BETA-${timestamp}`,
      price: PRICE_HIST2,
      cost: 150,
      stock: STOCK,
      min_stock: 2,
      max_stock: 50,
    });

    expect(await isProductVisibleInTable(page, PRODUCT_HIST1)).toBe(true);
    expect(await isProductVisibleInTable(page, PRODUCT_HIST2)).toBe(true);
  });

  // ─── 1. Ver historial ─────────────────────────────────────

  test('ver historial - sección "Últimas Ventas" se expande y muestra tabla', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    // La sección de historial está colapsada por defecto
    const historyHeading = page.getByRole('heading', { name: 'Últimas Ventas' });
    await expect(historyHeading).toBeVisible();

    // Expandir el historial
    await historyHeading.click();

    // La tabla debe tener headers: Folio, Cliente, Productos, Total, Fecha
    const table = page.locator('table').filter({ has: page.getByText('Folio') }).first();
    await expect(table).toBeVisible({ timeout: 10_000 });

    await expect(table.locator('th').filter({ hasText: 'Folio' })).toBeVisible();
    await expect(table.locator('th').filter({ hasText: 'Cliente' })).toBeVisible();
    await expect(table.locator('th').filter({ hasText: 'Productos' })).toBeVisible();
    await expect(table.locator('th').filter({ hasText: 'Total' })).toBeVisible();
    await expect(table.locator('th').filter({ hasText: 'Fecha' })).toBeVisible();
  });

  // ─── 2. Registrar ventas para tener datos ──────────────────

  test('registrar venta de prueba con 2 productos', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    await addProductToCart(page, PRODUCT_HIST1);
    const cartItem1 = getCartItem(page, PRODUCT_HIST1);
    await expect(cartItem1).toBeVisible({ timeout: 10_000 });

    await addProductToCart(page, PRODUCT_HIST2);
    const cartItem2 = getCartItem(page, PRODUCT_HIST2);
    await expect(cartItem2).toBeVisible({ timeout: 10_000 });

    const expectedTotal = PRICE_HIST1 + PRICE_HIST2;
    await expect(page.locator('span.text-2xl.text-indigo-600')).toHaveText(formatARSTest(expectedTotal));

    await page.getByRole('button', { name: 'Finalizar venta' }).click();
    await expect(page.locator('[role="status"]').filter({ hasText: 'Venta registrada exitosamente' }).first()).toBeVisible({ timeout: 15_000 });
  });

  // ─── 3. Verificar que una venta recién creada aparece ──────

  test('venta recién creada aparece en el historial', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    await openSalesHistory(page);

    // Debe haber al menos 2 filas de ventas
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);

    // Verificar que el historial contiene la venta recién creada: 2 ítems y el
    // total combinado. Los precios individuales solo aparecen en el detalle de la
    // venta (verificado en el test "ver productos vendidos en el detalle"), no en
    // el resumen de folios.
    const historyText = await page.locator('table').filter({ has: page.getByText('Folio') }).first().textContent();
    expect(historyText).toContain(formatARSTest(PRICE_HIST1 + PRICE_HIST2));
    expect(historyText).toContain('2 item(s)');
    expect(rows.filter({ hasText: '2 item(s)' }).first()).toBeVisible();
  });

  // ─── 4. Abrir detalle de venta ────────────────────────────

  test('abrir detalle de venta - muestra información completa', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    await openSalesHistory(page);

    // Buscar la fila con 2 items (nuestra venta de prueba)
    const saleRow = page.locator('table tbody tr').filter({ hasText: '2 item(s)' }).first();
    await expect(saleRow).toBeVisible({ timeout: 10_000 });
    await saleRow.click();

    const detailPanel = page.locator('.border-l-4.border-l-indigo-500').first();
    await expect(detailPanel).toBeVisible({ timeout: 10_000 });

    await expect(detailPanel.locator('h3')).toContainText('Venta #');
    await expect(detailPanel.getByText('Completada')).toBeVisible();
  });

  // ─── 5. Ver total de la venta ─────────────────────────────

  test('ver total de la venta en el detalle', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    await openSalesHistory(page);

    const saleRow = page.locator('table tbody tr').filter({ hasText: '2 item(s)' }).first();
    await expect(saleRow).toBeVisible({ timeout: 10_000 });
    await saleRow.click();

    const detailPanel = page.locator('.border-l-4.border-l-indigo-500').first();
    await expect(detailPanel).toBeVisible({ timeout: 10_000 });

    const totalText = formatARSTest(PRICE_HIST1 + PRICE_HIST2);
    await expect(detailPanel.locator('.text-green-600, .dark\\:text-green-400').first()).toContainText(totalText);
  });

  // ─── 6. Ver productos vendidos ────────────────────────────

  test('ver productos vendidos en el detalle', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    await openSalesHistory(page);

    const saleRow = page.locator('table tbody tr').filter({ hasText: '2 item(s)' }).first();
    await expect(saleRow).toBeVisible({ timeout: 10_000 });
    await saleRow.click();

    const detailPanel = page.locator('.border-l-4.border-l-indigo-500').first();
    await expect(detailPanel).toBeVisible({ timeout: 10_000 });

    await expect(detailPanel.getByText('Cantidad de productos:')).toBeVisible();

    const itemsTable = detailPanel.locator('table');
    await expect(itemsTable).toBeVisible();

    await expect(itemsTable.locator('th').filter({ hasText: 'Descripción' })).toBeVisible();
    await expect(itemsTable.locator('th').filter({ hasText: 'Cant.' })).toBeVisible();
    await expect(itemsTable.locator('th').filter({ hasText: 'P. Unit.' })).toBeVisible();
    await expect(itemsTable.locator('th').filter({ hasText: 'Subtotal' })).toBeVisible();

    const itemRows = itemsTable.locator('tbody tr');
    await expect(itemRows).toHaveCount(2);

    const tableText = await itemsTable.textContent();
    expect(tableText).toContain(PRODUCT_HIST1);
    expect(tableText).toContain(PRODUCT_HIST2);
    expect(tableText).toContain(formatARSTest(PRICE_HIST1));
    expect(tableText).toContain(formatARSTest(PRICE_HIST2));
  });

  // ─── 7. Ver fecha de la venta ─────────────────────────────

  test('ver fecha de la venta en el historial y en el detalle', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    await openSalesHistory(page);

    const saleRow = page.locator('table tbody tr').filter({ hasText: '2 item(s)' }).first();
    await expect(saleRow).toBeVisible({ timeout: 10_000 });

    const rowText = await saleRow.textContent();
    expect(rowText).toMatch(/\d{2}\/\d{2}\/\d{4}/);

    await saleRow.click();

    const detailPanel = page.locator('.border-l-4.border-l-indigo-500').first();
    await expect(detailPanel).toBeVisible({ timeout: 10_000 });

    const detailText = await detailPanel.textContent();
    expect(detailText).toMatch(/\d{1,2} de \w+ de \d{4}/);
  });

  // ─── 8. Verificar cliente en el historial ──────────────────

  test('ver cliente o "Mostrador" en el historial', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    await openSalesHistory(page);

    const saleRow = page.locator('table tbody tr').filter({ hasText: '2 item(s)' }).first();
    await expect(saleRow).toBeVisible({ timeout: 10_000 });
    await expect(saleRow).toContainText('Mostrador');

    await saleRow.click();

    const detailPanel = page.locator('.border-l-4.border-l-indigo-500').first();
    await expect(detailPanel).toBeVisible({ timeout: 10_000 });
    await expect(detailPanel.getByText('Mostrador').first()).toBeVisible();
  });

  // ─── Cleanup ──────────────────────────────────────────────

  test('cleanup - eliminar ventas y productos de prueba', async ({ authenticatedPage: page }) => {
    await cleanupSalesData(page, PRODUCTS);
  });
});
