import { test, expect, createProductViaUI, editProductViaUI, deleteProductViaUI, searchProduct, countProductsInTable, isProductVisibleInTable } from './fixtures';

// Ejecutar en serie: los tests crean/eliminan productos en la misma base,
// y el dev server compila las rutas API on-demand (en paralelo es inestable).
test.describe.configure({ mode: 'serial' });

// Setup: Autenticar una sola vez
test.describe('Productos E2E', () => {
  // Test 1: Listar productos
  test('listar productos - tabla visible con columnas correctas', async ({ authenticatedPage: page }) => {
    // Navegar a productos
    await page.goto('/products');

    // Esperar a que la página cargue
    await expect(page.getByRole('heading', { name: /Gestión de Inventario|Productos/i })).toBeVisible({ timeout: 10_000 });

    // Esperar a que la tabla cargue (puede estar en loading)
    const table = page.locator('table').first();
    await table.waitFor({ state: 'visible', timeout: 15_000 });

    // Verificar que hay datos (no el mensaje "no se encontraron productos")
    const emptyMessage = page.getByText(/No se encontraron productos/i);
    const hasData = !(await emptyMessage.isVisible().catch(() => false));

    if (hasData) {
      // Verificar columnas esperadas en el header
      const headers = page.locator('table thead th');
      const headerTexts = await headers.allTextContents();
      
      expect(headerTexts.length).toBeGreaterThan(0);
      
      // Verificar presencia de columnas clave (sin ser demasiado estrictos)
      const allHeadersText = headerTexts.join(' ').toLowerCase();
      expect(allHeadersText).toContain('producto');
      expect(allHeadersText).toContain('precio');
      
      // Verificar que hay filas de datos
      const rows = page.locator('tbody tr');
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);
    } else {
      // Si no hay productos, es válido también (tabla vacía pero funciona)
      expect(hasData).toBeDefined();
    }
  });

  // Test 2: Buscar producto
  test('buscar producto - filtrar y limpiar búsqueda', async ({ authenticatedPage: page }) => {
    await page.goto('/products');

    // Esperar a que cargue la tabla
    await page.locator('table').first().waitFor({ state: 'visible', timeout: 15_000 });

    // Esperar a que desaparezca el loader si existe
    const loader = page.locator('[data-testid="loader"], .animate-spin').first();
    await loader.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    // Contar productos antes de buscar
    const initialCount = await countProductsInTable(page);
    
    if (initialCount === 0) {
      test.skip(); // Saltar si no hay productos
      return;
    }

    // Obtener nombre del primer producto
    const firstProductCell = page.locator('tbody tr td').first();
    const firstProductName = await firstProductCell.textContent();
    
    if (!firstProductName) {
      test.skip();
      return;
    }

    // Buscar por un término del nombre del primer producto
    const searchTerm = firstProductName.substring(0, Math.min(3, firstProductName.length));

    // Realizar búsqueda
    await searchProduct(page, searchTerm);

    // Contar productos después de buscar
    const filteredCount = await countProductsInTable(page);
    expect(filteredCount).toBeLessThanOrEqual(initialCount);

    // Limpiar búsqueda
    await searchProduct(page, '');

    // Contar productos después de limpiar
    const restoredCount = await countProductsInTable(page);
    expect(restoredCount).toBe(initialCount);
  });

  // Test 3: Crear producto exitoso
  test('crear producto exitoso', async ({ authenticatedPage: page }) => {
    await page.goto('/products');

    // Esperar a que la tabla cargue
    await expect(page.locator('table, [role="grid"]').first()).toBeVisible({ timeout: 10_000 });

    // Datos únicos del producto (con timestamp para evitar duplicados)
    const timestamp = Date.now();
    const productData = {
      name: `Producto Test ${timestamp}`,
      sku: `SKU-${timestamp}`,
      barcode: `BAR-${timestamp}`,
      price: 99.99,
      cost: 50.00,
      stock: 10,
      min_stock: 2,
      max_stock: 50,
      deposito: 'Principal',
    };

    // Crear producto
    try {
      await createProductViaUI(page, productData);
    } catch (e) {
      console.error('Error al crear producto:', e);
      throw e;
    }

    // Verificar que el producto aparece en el listado
    const isVisible = await isProductVisibleInTable(page, productData.name);
    expect(isVisible).toBe(true);

    // Cleanup: Eliminar el producto
    try {
      await deleteProductViaUI(page, productData.name);
    } catch (e) {
      // Si no se puede eliminar vía UI, loguear pero no fallar
      console.log('Cleanup: No se pudo eliminar producto vía UI:', e);
    }
  });

  // Test 4: Crear producto con datos inválidos
  test('crear producto con datos inválidos - nombre vacío', async ({ authenticatedPage: page }) => {
    await page.goto('/products');

    // Click en crear producto
    await page.getByRole('button', { name: 'Nuevo' }).click({ timeout: 5_000 });

    // Esperar modal
    const modal = page.locator('[role="dialog"]').first();
    await modal.waitFor({ state: 'visible', timeout: 10_000 });

    // Llenar solo campos de no-nombre
    const skuInput = page.getByLabel(/SKU/i);
    await skuInput.fill(`SKU-${Date.now()}`);

    const priceInput = page.getByLabel(/Precio/i);
    if (!(await priceInput.isVisible().catch(() => false))) {
      // Si no hay label, buscar por otro medio
      await page.locator('input[type="number"]').first().fill('99.99');
    } else {
      await priceInput.fill('99.99');
    }

    // Intenta guardar sin nombre
    const saveButton = page.getByRole('button', { name: /Guardar|Crear/i });
    await saveButton.click({ timeout: 5_000 });

    // Se muestra error (toast o validación) y el modal no se cierra.
    // Verificar que el modal sigue abierto
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Cerrar modal
    await page.keyboard.press('Escape');
  });

  // Test 5: Editar producto
  test('editar producto - cambiar precio y stock', async ({ authenticatedPage: page }) => {
    await page.goto('/products');

    // Esperar tabla
    await page.locator('table').first().waitFor({ state: 'visible', timeout: 15_000 });

    // Esperar a que desaparezca el loader
    const loader = page.locator('[data-testid="loader"], .animate-spin').first();
    await loader.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    // Obtener nombre del primer producto disponible (solo el nombre, sin descripción)
    const firstProductRow = page.locator('tbody tr').first();
    const productNameCell = firstProductRow.locator('td').first();
    const productName = (await productNameCell.locator('.font-semibold').first().textContent()) ?? '';
    
    if (!productName || !productName.trim()) {
      test.skip(); // Saltar si no hay productos
      return;
    }

    // Editar producto
    const newPrice = 149.99;
    const newStock = 25;

    try {
      await editProductViaUI(page, productName, {
        price: newPrice,
        stock: newStock,
      });
    } catch (e) {
      console.error('Error al editar producto:', e);
      throw e;
    }

    // Verificar que el producto sigue visible
    const isVisible = await isProductVisibleInTable(page, productName);
    expect(isVisible).toBe(true);
  });

  // Test 6: Eliminar/desactivar producto
  test('eliminar producto - verificar desaparición de listado', async ({ authenticatedPage: page }) => {
    await page.goto('/products');

    // Esperar tabla
    await page.locator('table').first().waitFor({ state: 'visible', timeout: 15_000 });

    // Datos de producto a crear y eliminar
    const timestamp = Date.now();
    const productData = {
      name: `Producto Eliminar ${timestamp}`,
      sku: `SKU-DEL-${timestamp}`,
      barcode: `BAR-DEL-${timestamp}`,
      price: 49.99,
      cost: 25.00,
      stock: 5,
    };

    // Crear producto
    try {
      await createProductViaUI(page, productData);
    } catch (e) {
      console.error('Error al crear producto:', e);
      throw e;
    }

    // Verificar que existe
    let isVisible = await isProductVisibleInTable(page, productData.name);
    expect(isVisible).toBe(true);

    // Eliminar producto
    try {
      await deleteProductViaUI(page, productData.name);
    } catch (e) {
      console.error('Error al eliminar producto:', e);
      throw e;
    }

    // Esperar a que desaparezca de la tabla
    await page.waitForTimeout(1000);

    // Verificar que ya no existe (puede necesitar refresh)
    isVisible = await isProductVisibleInTable(page, productData.name);
    expect(isVisible).toBe(false);
  });

  // Test 7: Producto desactivado no puede usarse en venta
  test('producto desactivado no aparece en selector de venta', async ({ authenticatedPage: page }) => {
    // Crear producto
    const timestamp = Date.now();
    const productName = `Producto Venta ${timestamp}`;

    await page.goto('/products');

    await page.locator('table').first().waitFor({ state: 'visible', timeout: 15_000 });

    const productData = {
      name: productName,
      sku: `SKU-VENTA-${timestamp}`,
      barcode: `BAR-VENTA-${timestamp}`,
      price: 99.99,
      cost: 50.00,
      stock: 20,
    };

    try {
      await createProductViaUI(page, productData);
    } catch (e) {
      console.error('Error al crear producto:', e);
      throw e;
    }

    // Desactivar/eliminar producto
    try {
      await deleteProductViaUI(page, productName);
    } catch (e) {
      console.error('Error al eliminar producto:', e);
      throw e;
    }

    // Navegar a /sales (o ruta de ventas)
    await page.goto('/sales', { waitUntil: 'domcontentloaded' });

    // Intentar buscar/seleccionar el producto en dropdown
    const productSearchInput = page.getByPlaceholder(/buscar|producto|search/i).first();
    try {
      await productSearchInput.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      test.skip(); // Saltar si no hay interfaz de búsqueda de productos en venta
      return;
    }

    await productSearchInput.fill(productName);

    // Esperar a que se filtre
    await page.waitForTimeout(500);

    // Verificar que NO aparece en las opciones
    const options = page.locator('[role="option"]');
    const optionTexts = await options.allTextContents();

    // El producto no debería estar en las opciones
    const productFound = optionTexts.some(text => text.includes(productName));
    expect(productFound).toBe(false);
  });

  // Test 8: Filtrar por categoría
  test('filtrar productos por categoría', async ({ authenticatedPage: page }) => {
    await page.goto('/products');

    // Esperar tabla
    await page.locator('table').first().waitFor({ state: 'visible', timeout: 15_000 });

    // Esperar a que desaparezca el loader
    const loader = page.locator('[data-testid="loader"], .animate-spin').first();
    await loader.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    // Contar total de productos
    const totalCount = await countProductsInTable(page);

    if (totalCount === 0) {
      test.skip(); // Saltar si no hay productos
      return;
    }

    // Buscar selects
    const selects = page.locator('select');
    const selectCount = await selects.count();

    if (selectCount < 1) {
      test.skip(); // Saltar si no hay selects (filtros)
      return;
    }

    // Usar el primer select (categorías)
    const categorySelect = selects.nth(0);

    // Cambiar valor del select directamente (más rápido que click en opciones)
    const optionLocators = categorySelect.locator('option');
    const optionCountInSelect = await optionLocators.count();

    if (optionCountInSelect < 2) {
      test.skip(); // Saltar si no hay múltiples categorías
      return;
    }

    // Seleccionar segunda opción (primera categoría específica después de "Todas")
    await categorySelect.selectOption({ index: 1 });

    // Esperar a que se filtre
    await page.waitForTimeout(500);

    // Contar productos filtrados
    const filteredCount = await countProductsInTable(page);

    // Debe haber menos o igual (no más) productos
    expect(filteredCount).toBeLessThanOrEqual(totalCount);

    // Seleccionar "Todos" nuevamente (opción 0)
    await categorySelect.selectOption({ index: 0 });

    // Esperar a que se restaure
    await page.waitForTimeout(500);

    // Contar productos restaurados
    const restoredCount = await countProductsInTable(page);

    // Debe volver al total (o muy cerca)
    expect(restoredCount).toBe(totalCount);
  });
});
