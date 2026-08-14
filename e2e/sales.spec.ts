import {
  test,
  expect,
  createProductViaUI,
  isProductVisibleInTable,
  getStockInfo,
  getCurrentTenantName,
  formatARSTest,
  addProductToCart,
  getCartItem,
  getNewestSaleRowText,
  openSalesHistory,
  cleanupSalesData,
} from './fixtures';

// Los tests corren en serie: comparten los mismos productos y venden stock de
// ellos, así que cada paso depende del valor dejado por el anterior.
test.describe.configure({ mode: 'serial' });

const timestamp = Date.now();
const PRODUCT_UNICO = `Venta E2E Unico ${timestamp}`;
const PRODUCT_MULTI = `Venta E2E Multi ${timestamp}`;
const PRODUCT_ESCASO = `Venta E2E Escaso ${timestamp}`;
const PRODUCT_AGOTADO = `Venta E2E Agotado ${timestamp}`;
const PRODUCTS = [PRODUCT_UNICO, PRODUCT_MULTI, PRODUCT_ESCASO, PRODUCT_AGOTADO];

const PRICE_UNICO = 100;
const PRICE_MULTI = 50;
const PRICE_ESCASO = 200;
const PRICE_AGOTADO = 300;

const STOCK_UNICO = 15;
const STOCK_MULTI = 10;
const STOCK_ESCASO = 1;
const STOCK_AGOTADO = 0;

// Nota: la caja /sales hace fetch sin el header x-active-tenant-id, por lo que
// opera sobre la primera sucursal del usuario (tenantIds[0]). En un contexto
// nuevo sin sucursal elegida, /products usa la misma sucursal por defecto, así
// que los tests son consistentes sin cambiar de sucursal.

test.describe('Ventas E2E', () => {
  // Setup: productos con precios y stock conocidos para todas las pruebas
  test('setup - crear productos de prueba', async ({ authenticatedPage: page }) => {
    await page.goto('/products');
    await expect(page.locator('table, [role="grid"]').first()).toBeVisible({ timeout: 10_000 });

    // Esperar a que carguen las categorías: si el modal se abre antes, el
    // campo category_id se envía vacío y la API responde 400.
    await page.locator('select').first().locator('option').nth(1).waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {});

    await createProductViaUI(page, {
      name: PRODUCT_UNICO,
      sku: `SKU-VENTA-UNICO-${timestamp}`,
      price: PRICE_UNICO,
      cost: 50,
      stock: STOCK_UNICO,
      min_stock: 2,
      max_stock: 50,
    });
    await createProductViaUI(page, {
      name: PRODUCT_MULTI,
      sku: `SKU-VENTA-MULTI-${timestamp}`,
      price: PRICE_MULTI,
      cost: 25,
      stock: STOCK_MULTI,
      min_stock: 2,
      max_stock: 50,
    });
    await createProductViaUI(page, {
      name: PRODUCT_ESCASO,
      sku: `SKU-VENTA-ESCASO-${timestamp}`,
      price: PRICE_ESCASO,
      cost: 100,
      stock: STOCK_ESCASO,
      min_stock: 1,
      max_stock: 10,
    });
    await createProductViaUI(page, {
      name: PRODUCT_AGOTADO,
      sku: `SKU-VENTA-AGOTADO-${timestamp}`,
      price: PRICE_AGOTADO,
      cost: 150,
      stock: STOCK_AGOTADO,
      min_stock: 0,
      max_stock: 10,
    });

    expect(await isProductVisibleInTable(page, PRODUCT_UNICO)).toBe(true);
  });

  // Flujo completo: login (fixture) -> sucursal -> buscar -> agregar ->
  // modificar cantidad -> subtotal/total -> confirmar -> éxito -> stock
  test('flujo completo de una venta - cantidad, total, éxito y stock', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    // Sucursal activa (la caja opera sobre la primera sucursal del usuario)
    expect(await getCurrentTenantName(page)).toBeTruthy();

    // Buscar y agregar producto
    await addProductToCart(page, PRODUCT_UNICO);
    const cartItem = getCartItem(page, PRODUCT_UNICO);
    await expect(cartItem).toBeVisible({ timeout: 10_000 });
    await expect(cartItem.locator('span.w-6')).toHaveText('1');

    // Modificar cantidad: 1 -> 2
    await cartItem.locator('svg.lucide-plus').click();
    await expect(cartItem.locator('span.w-6')).toHaveText('2');
    await expect(cartItem).toContainText(`x 2`);

    // Total = 2 x $100
    await expect(page.locator('span.text-2xl.text-indigo-600')).toHaveText(formatARSTest(2 * PRICE_UNICO));

    // Confirmar venta
    await page.getByRole('button', { name: 'Finalizar venta' }).click();
    await expect(page.locator('[role="status"]').filter({ hasText: 'Venta registrada exitosamente' }).first()).toBeVisible({ timeout: 15_000 });

    // El carrito queda vacío
    await expect(page.getByText('Buscá un producto').first()).toBeVisible({ timeout: 10_000 });

    // Stock actualizado: 15 - 2 = 13
    await page.goto('/products');
    const info = await getStockInfo(page, PRODUCT_UNICO);
    expect(info.stock).toBe(STOCK_UNICO - 2);

    // La venta aparece en el historial con su detalle
    await page.goto('/sales');
    const rowText = await getNewestSaleRowText(page);
    expect(rowText).toContain(formatARSTest(2 * PRICE_UNICO));
    expect(rowText).toContain('1 item(s)');

    await page.locator('table tbody tr').first().click();
    const panel = page.locator('div.border-l-4').first();
    await expect(panel).toContainText('Completada');
    await expect(panel).toContainText(PRODUCT_UNICO);
    await expect(panel).toContainText(formatARSTest(2 * PRICE_UNICO));
  });

  // Venta de varios productos y cálculo del total
  test('venta de varios productos - total sumado y stock de ambos', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    await addProductToCart(page, PRODUCT_UNICO);
    await addProductToCart(page, PRODUCT_MULTI);

    // 100 + 50 = 150
    await expect(page.locator('span.text-2xl.text-indigo-600')).toHaveText(formatARSTest(PRICE_UNICO + PRICE_MULTI));

    await page.getByRole('button', { name: 'Finalizar venta' }).click();
    await expect(page.locator('[role="status"]').filter({ hasText: 'Venta registrada exitosamente' }).first()).toBeVisible({ timeout: 15_000 });

    // Stock: Unico 13 - 1 = 12, Multi 10 - 1 = 9
    await page.goto('/products');
    expect((await getStockInfo(page, PRODUCT_UNICO)).stock).toBe(STOCK_UNICO - 2 - 1);
    expect((await getStockInfo(page, PRODUCT_MULTI)).stock).toBe(STOCK_MULTI - 1);

    // Historial: 2 items, total 150, expandido muestra ambos productos
    await page.goto('/sales');
    const rowText = await getNewestSaleRowText(page);
    expect(rowText).toContain(formatARSTest(PRICE_UNICO + PRICE_MULTI));
    expect(rowText).toContain('2 item(s)');

    await page.locator('table tbody tr').first().click();
    const panel = page.locator('div.border-l-4').first();
    await expect(panel).toContainText(PRODUCT_UNICO);
    await expect(panel).toContainText(PRODUCT_MULTI);
  });

  // Modificar cantidad, eliminar del carrito y cancelar sin confirmar
  test('modificar cantidad, eliminar del carrito y cancelar - no registra venta', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    const firstSaleBefore = await getNewestSaleRowText(page);

    // Agregar Multi y subirlo a 3 (50 x 3 = 150)
    await addProductToCart(page, PRODUCT_MULTI);
    const cartItem = getCartItem(page, PRODUCT_MULTI);
    await expect(cartItem).toBeVisible({ timeout: 10_000 });
    await cartItem.locator('svg.lucide-plus').click();
    await cartItem.locator('svg.lucide-plus').click();
    await expect(cartItem.locator('span.w-6')).toHaveText('3');
    await expect(page.locator('span.text-2xl.text-indigo-600')).toHaveText(formatARSTest(3 * PRICE_MULTI));

    // Bajarlo a 2 (50 x 2 = 100)
    await cartItem.locator('svg.lucide-minus').click();
    await expect(cartItem.locator('span.w-6')).toHaveText('2');
    await expect(page.locator('span.text-2xl.text-indigo-600')).toHaveText(formatARSTest(2 * PRICE_MULTI));

    // Eliminar el producto del carrito
    await cartItem.locator('svg.lucide-trash-2').click();
    await expect(page.getByText('Buscá un producto').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Finalizar venta' })).toHaveCount(0);

    // Salir sin confirmar: no se registra ninguna venta (misma última venta)
    await page.goto('/products');
    await page.goto('/sales');
    const firstSaleAfter = await getNewestSaleRowText(page);
    expect(firstSaleAfter).toBe(firstSaleBefore);
  });

  // Intentar vender sin stock suficiente
  test('intentar vender sin stock suficiente - error y stock sin cambios', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    // Producto con stock 1: entra 1 unidad pero no se puede subir a 2
    await addProductToCart(page, PRODUCT_ESCASO);
    const cartItem = getCartItem(page, PRODUCT_ESCASO);
    await expect(cartItem).toBeVisible({ timeout: 10_000 });
    await expect(cartItem.locator('span.w-6')).toHaveText('1');

    await cartItem.locator('svg.lucide-plus').click();
    await expect(page.locator('[role="status"]').filter({ hasText: `Stock insuficiente para "${PRODUCT_ESCASO}"` }).first()).toBeVisible({ timeout: 10_000 });
    await expect(cartItem.locator('span.w-6')).toHaveText('1');
    await expect(page.locator('span.text-2xl.text-indigo-600')).toHaveText(formatARSTest(PRICE_ESCASO));

    // Producto con stock 0: la tarjeta está deshabilitada (no se puede vender)
    await page.getByPlaceholder('Buscar producto por nombre, SKU o código de barras...').fill(PRODUCT_AGOTADO);
    const cardAgotado = page.locator('button').filter({ hasText: PRODUCT_AGOTADO }).first();
    await expect(cardAgotado).toBeVisible({ timeout: 10_000 });
    await expect(cardAgotado).toContainText('Stock: 0');
    await expect(cardAgotado).toBeDisabled();

    // Limpiar el carrito sin vender
    await page.getByPlaceholder('Buscar producto por nombre, SKU o código de barras...').fill(PRODUCT_ESCASO);
    await getCartItem(page, PRODUCT_ESCASO).locator('svg.lucide-trash-2').click();
    await expect(page.getByText('Buscá un producto').first()).toBeVisible({ timeout: 10_000 });
  });

  // Vender hasta agotar el stock disponible
  test('vender hasta agotar stock - stock 0 y tarjeta deshabilitada', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    await addProductToCart(page, PRODUCT_ESCASO);
    await expect(page.locator('span.text-2xl.text-indigo-600')).toHaveText(formatARSTest(PRICE_ESCASO));

    await page.getByRole('button', { name: 'Finalizar venta' }).click();
    await expect(page.locator('[role="status"]').filter({ hasText: 'Venta registrada exitosamente' }).first()).toBeVisible({ timeout: 15_000 });

    // Stock 1 -> 0, badge crítico
    await page.goto('/products');
    const info = await getStockInfo(page, PRODUCT_ESCASO);
    expect(info.stock).toBe(0);
    expect(info.badgeClass).toContain('bg-red-100');

    // En la caja la tarjeta muestra stock 0 y queda deshabilitada
    await page.goto('/sales');
    await page.getByPlaceholder('Buscar producto por nombre, SKU o código de barras...').fill(PRODUCT_ESCASO);
    const card = page.locator('button').filter({ hasText: PRODUCT_ESCASO }).first();
    await expect(card).toContainText('Stock: 0');
    await expect(card).toBeDisabled();
  });

  // Historial: las ventas de la batería quedan registradas con su detalle
  test('historial - las ventas aparecen con detalle', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Registrar Venta' })).toBeVisible({ timeout: 15_000 });

    await openSalesHistory(page);

    // La fila más reciente es la venta que agotó el stock (Escaso, $200)
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toContainText(formatARSTest(PRICE_ESCASO));
    await expect(rows.first()).toContainText('1 item(s)');

    await rows.first().click();
    const firstPanel = page.locator('div.border-l-4').first();
    await expect(firstPanel).toContainText(PRODUCT_ESCASO);
    await expect(firstPanel).toContainText('Cantidad de productos: 1');

    // La venta de varios productos también está en el listado
    const multiRow = rows.filter({ hasText: formatARSTest(PRICE_UNICO + PRICE_MULTI) }).first();
    await expect(multiRow).toContainText('2 item(s)');
    await multiRow.click();
    const multiPanel = page.locator('div.border-l-4').nth(1);
    await expect(multiPanel).toContainText(PRODUCT_UNICO);
    await expect(multiPanel).toContainText(PRODUCT_MULTI);
  });

  // Cleanup: borra las ventas de prueba (service role, por la FK de sale_items)
  // y luego verifica que los productos desaparecieron del listado
  test('cleanup - eliminar ventas y productos de prueba', async ({ authenticatedPage: page }) => {
    await cleanupSalesData(page, PRODUCTS);
  });
});
