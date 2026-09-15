import {
  test,
  expect,
  createProductViaUI,
  isProductVisibleInTable,
  addProductToCart,
  getCartItem,
  cleanupBranchProducts,
} from './fixtures';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const timestamp = Date.now();
const PRODUCT_F = `Forecast E2E ${timestamp}`;
const PRODUCTS = [PRODUCT_F];

test.describe('Forecast E2E', () => {
  test('setup - crear producto con stock mínimo bajo', async ({ authenticatedPage: page }) => {
    await page.goto('/products');
    await page.locator('table, [role="grid"]').first().waitFor({ state: 'visible', timeout: 10_000 });

    await createProductViaUI(page, {
      name: PRODUCT_F,
      sku: `SKU-FR-${timestamp}`,
      price: 350,
      cost: 150,
      stock: 1,
      min_stock: 5,
      max_stock: 50,
    });

    expect(await isProductVisibleInTable(page, PRODUCT_F)).toBe(true);
  });

  test('registrar una venta del producto de prueba', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    await addProductToCart(page, PRODUCT_F);
    await expect(getCartItem(page, PRODUCT_F)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Finalizar venta' }).click();
    await expect(
      page.locator('[role="status"]').filter({ hasText: 'Venta registrada exitosamente' }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('muestra KPIs orientados a la acción y el producto con sugerencia de compra', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/forecast');
    await expect(page.getByRole('heading', { name: 'Pronóstico de Demanda' })).toBeVisible({ timeout: 15_000 });

    for (const kpi of [
      'Sugerencia de compra',
      'Riesgo de quiebre',
      'Capital inmovilizado',
      'Efectividad del stock',
    ]) {
      await expect(page.getByText(kpi, { exact: true })).toBeVisible();
    }

    await expect(page.getByRole('heading', { name: 'Próximo a agotarse' })).toBeVisible();
    await expect(page.getByRole('button', { name: /En riesgo/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Todos/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sin movimiento/ })).toBeVisible();

    // El producto vendido con stock mínimo aparece en "En riesgo" (default) con botón Crear orden
    const table = page.locator('table').filter({ hasText: 'Cobertura' });
    const row = table.locator('tbody tr').filter({ hasText: PRODUCT_F }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const createLink = row.locator('a', { hasText: 'Crear orden' });
    await expect(createLink).toBeVisible();
    const href = await createLink.getAttribute('href');
    expect(href).toMatch(new RegExp(`^/providers\\?create_po=1&productId=.*&qty=\\d+`));

    // En "Sin movimiento" el producto no debe aparecer (tiene ventas)
    await page.getByRole('button', { name: /Sin movimiento/ }).click();
    await expect(table.locator('tbody tr').filter({ hasText: PRODUCT_F }).first()).toHaveCount(0);

    // Volver a "En riesgo" (único producto en riesgo → página 1) y verificar que reaparece
    await page.getByRole('button', { name: /En riesgo/ }).click();
    await expect(row).toBeVisible({ timeout: 10_000 });
  });

  test('crear orden navega a /providers y precarga el ítem en el modal', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/forecast');
    await expect(page.getByRole('heading', { name: 'Pronóstico de Demanda' })).toBeVisible({ timeout: 15_000 });

    const table = page.locator('table').filter({ hasText: 'Cobertura' });
    const row = table.locator('tbody tr').filter({ hasText: PRODUCT_F }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const href = await row.locator('a', { hasText: 'Crear orden' }).first().getAttribute('href');
    expect(href).toMatch(new RegExp(`^/providers\\?create_po=1&productId=.*&qty=\\d+`));

    await page.goto(href!);
    await expect(page.getByRole('heading', { name: 'Nueva Compra' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(PRODUCT_F, { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test('cleanup - eliminar producto y ventas de prueba', async ({ authenticatedPage: page }) => {
    await cleanupBranchProducts(page, PRODUCTS);
    await page.goto('/products');
    expect(await isProductVisibleInTable(page, PRODUCT_F)).toBe(false);
  });
});
