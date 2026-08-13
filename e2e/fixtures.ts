import { test as base, Page } from '@playwright/test';

const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL ?? '';
const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD ?? '';

interface AuthFixture {
  authenticatedPage: Page;
}

/**
 * Fixture que proporciona una página autenticada reutilizable.
 * Se ejecuta una sola vez al inicio de la batería de tests.
 */
export const test = base.extend<AuthFixture>({
  authenticatedPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navegar a login
    await page.goto('/login');

    // Autenticarse
    await page.getByPlaceholder('tu@email.com').fill(E2E_USER_EMAIL);
    await page.getByPlaceholder('••••••••').fill(E2E_USER_PASSWORD);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();

    // Esperar a estar en dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

    // Pasar la página autenticada al test
    await use(page);

    // Cleanup
    await context.close();
  },
});

export { expect } from '@playwright/test';

/**
 * Helper para crear un producto vía UI
 */
export async function createProductViaUI(
  page: Page,
  productData: {
    name: string;
    sku: string;
    barcode?: string;
    category?: string;
    price: number;
    cost: number;
    stock: number;
    min_stock?: number;
    max_stock?: number;
    deposito?: string;
  }
) {
  // Click en botón de crear producto (buscar por texto "Nuevo")
  await page.getByRole('button', { name: 'Nuevo' }).click({ timeout: 5_000 });

  // Esperar a que el modal se abra (buscar por heading "Agregar Nuevo Producto")
  const modal = page.getByRole('dialog', { name: 'Producto' });
  const modalHeading = page.getByRole('heading', { name: /Agregar Nuevo Producto|Nuevo Producto/i });
  await modalHeading.waitFor({ state: 'visible', timeout: 10_000 });

  // Llenar campos del formulario usando los ids del modal
  await modal.locator('#product-name').fill(productData.name);
  await modal.locator('#product-sku').fill(productData.sku);

  if (productData.barcode) {
    await modal.locator('#product-barcode').fill(productData.barcode);
  }

  if (productData.category) {
    await modal.locator('#product-category').selectOption({ label: productData.category });
  }

  await modal.locator('#product-price').fill(String(productData.price));
  await modal.locator('#product-cost').fill(String(productData.cost));
  await modal.locator('#product-stock').fill(String(productData.stock));

  if (productData.min_stock !== undefined) {
    await modal.locator('#product-min-stock').fill(String(productData.min_stock));
  }

  if (productData.max_stock !== undefined) {
    await modal.locator('#product-max-stock').fill(String(productData.max_stock));
  }

  if (productData.deposito) {
    await modal.locator('#product-deposito').fill(productData.deposito);
  }

  // Submit formulario - buscar botón con texto Guardar
  const saveButton = page.getByRole('button', { name: /Guardar|Crear/i });
  await saveButton.click({ timeout: 5_000 });

  // Esperar a que se cierre el modal
  await modalHeading.waitFor({ state: 'hidden', timeout: 15_000 });

  // Esperar a toast de éxito
  await page.locator('[role="status"]').filter({ hasText: 'Producto creado' }).first().waitFor({ timeout: 10_000 });
}

/**
 * Helper para editar un producto
 */
export async function editProductViaUI(
  page: Page,
  productName: string,
  updates: {
    name?: string;
    price?: number;
    stock?: number;
  }
) {
  // Buscar fila del producto - buscar en texto de la tabla
  await searchProduct(page, productName);
  const productRow = page.locator('tbody tr').filter({ hasText: productName }).first();
  await productRow.waitFor({ state: 'visible', timeout: 5_000 });

  // Click en botón edit (tiene title="Editar")
  const editButton = productRow.locator('button[title="Editar"]');
  await editButton.click({ timeout: 5_000 });
  await page.waitForLoadState('networkidle');

  // Modal de edición (buscar por heading "Editar Producto")
  const modalHeading = page.getByRole('heading', { name: /Editar Producto/i });
  await modalHeading.waitFor({ state: 'visible', timeout: 10_000 });

  // Actualizar campos
  if (updates.name) {
    const nameInput = page.locator('#product-name');
    await nameInput.waitFor({ state: 'visible', timeout: 5_000 });
    await nameInput.clear();
    await nameInput.fill(updates.name);
  }

  if (updates.price !== undefined) {
    const priceInput = page.locator('#product-price');
    if (await priceInput.isVisible()) {
      await priceInput.clear();
      await priceInput.fill(String(updates.price));
    }
  }

  if (updates.stock !== undefined) {
    const stockInput = page.locator('#product-stock');
    if (await stockInput.isVisible()) {
      await stockInput.clear();
      await stockInput.fill(String(updates.stock));
    }
  }

  // Guardar
  const saveButton = page.getByRole('button', { name: /Guardar|Actualizar|Guardar Cambios/i });
  await saveButton.click({ timeout: 5_000 });
  await page.waitForLoadState('networkidle');

  // Esperar a que se cierre modal
  await modalHeading.waitFor({ state: 'hidden', timeout: 15_000 });

  // Toast de éxito (dice "Producto actualizado")
  await page.locator('[role="status"]').filter({ hasText: 'Producto actualizado' }).first().waitFor({ timeout: 10_000 });
}

/**
 * Helper para eliminar un producto
 */
export async function deleteProductViaUI(page: Page, productName: string) {
  // Buscar fila del producto (filtrando por nombre para que quede en la página actual)
  await searchProduct(page, productName);
  const productRow = page.locator('tbody tr').filter({ hasText: productName }).first();
  await productRow.waitFor({ state: 'visible', timeout: 5_000 });

  // Click en botón delete/trash (tiene title="Eliminar")
  const deleteButton = productRow.locator('button[title="Eliminar"]');
  await deleteButton.click({ timeout: 5_000 });

  // Esperar a modal de confirmación y hacer clic en el botón de confirmar
  // (el confirm del modal usa el label "Eliminar producto", distinto del botón
  // de la fila cuyo title es "Eliminar")
  const confirmButton = page.getByRole('button', { name: /Eliminar producto/i }).first();
  if (await confirmButton.isVisible().catch(() => false)) {
    await confirmButton.click({ timeout: 5_000 });
  }

  // Toast de éxito
  await page.locator('[role="status"]').filter({ hasText: 'Producto eliminado' }).first().waitFor({ timeout: 10_000 }).catch(() => {});
}

/**
 * Helper para buscar un producto en la tabla
 */
export async function searchProduct(page: Page, searchTerm: string) {
  const searchInput = page.getByPlaceholder(/Buscar por nombre/i);
  await searchInput.fill(searchTerm);

  // Esperar a que se actualice la tabla (debounce de búsqueda)
  await page.waitForTimeout(500);
}

/**
 * Helper para contar productos en la tabla
 */
export async function countProductsInTable(page: Page): Promise<number> {
  // Contar filas en tbody (excluyendo thead)
  const rows = page.locator('tbody tr');
  return rows.count();
}

/**
 * Helper para verificar que un producto está visible en la tabla
 */
export async function isProductVisibleInTable(page: Page, productName: string): Promise<boolean> {
  try {
    // Filtrar por nombre para traer el producto a la vista (hay paginación)
    const searchInput = page.getByPlaceholder(/Buscar por nombre/i);
    await searchInput.fill(productName);
    await page.waitForTimeout(500);
    const productRow = page.locator('tbody tr').filter({ hasText: productName }).first();
    await productRow.waitFor({ state: 'visible', timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper para filtrar por categoría
 */
export async function filterByCategory(page: Page, categoryName: string) {
  // Buscar el select de categorías (primer select en la página de productos)
  const selects = page.locator('select');
  const categorySelect = selects.nth(0); // Primera opción es categoría
  
  await categorySelect.click();
  
  // Seleccionar la opción por nombre
  await page.getByRole('option', { name: categoryName }).click();

  // Esperar a que se filtre
  await page.waitForTimeout(500);
}

/**
 * Helper para obtener precios de un producto en la tabla
 */
export async function getProductPriceFromTable(page: Page, productName: string): Promise<string> {
  const productRow = page.locator(`tr, div[class*="row"]`).filter({ hasText: productName }).first();
  // Buscar celda de precio (típicamente la segunda o tercera columna)
  const priceCell = productRow.locator('td').nth(3);
  return (await priceCell.textContent()) ?? '';
}
