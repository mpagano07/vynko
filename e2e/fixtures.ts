import { test as base, expect, Page } from '@playwright/test';

const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL ?? '';
const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD ?? '';

interface AuthFixture {
  authenticatedPage: Page;
  memberPage: Page;
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

  memberPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/login');
    await page.getByPlaceholder('tu@email.com').fill(E2E_MEMBER_USER_EMAIL);
    await page.getByPlaceholder('••••••••').fill(E2E_MEMBER_USER_PASSWORD);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

    await use(page);

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

  // Esperar a que se cierre el modal (max 20s). Si no se cierra, capturar el estado para debug.
  try {
    await modalHeading.waitFor({ state: 'hidden', timeout: 20_000 });
  } catch {
    const toastText = await page.locator('[role="status"]').first().textContent().catch(() => null);
    const pageUrl = page.url();
    throw new Error(
      `createProductViaUI: el modal no se cerró tras guardar. ` +
      `Toast: ${toastText ?? '(ninguno)'}. URL: ${pageUrl}`
    );
  }
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

// ===== Helpers de Stock =====

/**
 * Lee el stock actual y la clase del badge de un producto en la tabla de
 * productos. El badge puede ser emerald (saludable), amber (bajo) o
 * red (crítico).
 */
export async function getStockInfo(page: Page, productName: string): Promise<{ stock: number; badgeClass: string }> {
  await page.locator('table').first().waitFor({ state: 'visible', timeout: 15_000 });
  const loader = page.locator('[data-testid="loader"], .animate-spin').first();
  await loader.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  await searchProduct(page, productName);

  const row = page.locator('tbody tr').filter({ hasText: productName }).first();
  await row.waitFor({ state: 'visible', timeout: 5_000 });

  const badge = row.locator('td').nth(5).locator('span.rounded-full').first();
  const stockText = (await badge.textContent()) ?? '';
  const badgeClass = (await badge.getAttribute('class')) ?? '';
  return { stock: parseInt(stockText, 10) || 0, badgeClass };
}

/**
 * Ajusta el stock de un producto usando el formulario de Antipérdidas
 * ("Reportar ajuste"). Los motivos 'found' y 'correction' suman stock; el
 * resto ('damaged', 'lost', 'stolen', 'expired') restan.
 *
 * Con expectSuccess=false, verifica que la operación falle (p.ej. retirar
 * más stock del disponible) y que el modal siga abierto.
 */
export async function adjustStockViaLossPrevention(
  page: Page,
  productName: string,
  quantity: number,
  reason: string,
  expectSuccess = true
) {
  await page.goto('/loss-prevention');
  await page.getByRole('button', { name: 'Reportar ajuste' }).click();

  const form = page.getByRole('button', { name: 'Guardar ajuste' }).locator('xpath=ancestor::form[1]');
  await form.waitFor({ state: 'visible', timeout: 10_000 });

  const productSelect = form.locator('select').nth(0);
  await productSelect.locator('option', { hasText: productName }).first().waitFor({ state: 'attached', timeout: 15_000 });
  const optionValue = await productSelect.locator('option', { hasText: productName }).first().getAttribute('value');
  await productSelect.selectOption(String(optionValue));

  await form.locator('select').nth(1).selectOption(reason);

  await form.locator('input[type="number"]').fill(String(quantity));
  await form.getByRole('button', { name: 'Guardar ajuste' }).click();

  if (!expectSuccess) {
    const errorToast = page.locator('[role="status"]').filter({ hasText: 'El stock no puede ser negativo' }).first();
    await expect(errorToast).toBeVisible({ timeout: 10_000 });
    await expect(form).toBeVisible();
    return;
  }

  const signedQuantity = reason === 'found' || reason === 'correction' ? `+${quantity}` : `-${quantity}`;
  await expect(page.locator('[role="status"]').first()).toContainText(`Stock ajustado: ${signedQuantity} unidades`, { timeout: 10_000 });
  await expect(form).toBeHidden({ timeout: 10_000 });
}

// ===== Helpers de Sucursales (multi-tenant) =====

const DESKTOP_SIDEBAR = 'aside.hidden.md\\:flex';

async function toggleTenantSwitcher(page: Page) {
  await page.locator(`${DESKTOP_SIDEBAR} p.truncate.flex-1`).first().click();
}

/**
 * Nombre de la sucursal activa (label del selector de sucursales del sidebar).
 */
export async function getCurrentTenantName(page: Page): Promise<string> {
  return ((await page.locator(`${DESKTOP_SIDEBAR} p.truncate.flex-1`).first().textContent()) ?? '').trim();
}

/**
 * Lista los nombres de todas las sucursales del usuario.
 */
export async function getTenantNames(page: Page): Promise<string[]> {
  await toggleTenantSwitcher(page);
  const names = await page.locator(`${DESKTOP_SIDEBAR} span.truncate.flex-1.text-left`).allTextContents();
  await page.locator(`${DESKTOP_SIDEBAR} .fixed.inset-0`).first().click({ position: { x: 30, y: 30 } }).catch(() => {});
  return names.map((n) => n.trim()).filter(Boolean);
}

/**
 * Cambia de sucursal desde el selector del sidebar y espera a que se aplique.
 */
export async function switchTenantByName(page: Page, tenantName: string) {
  const current = await getCurrentTenantName(page);
  if (current === tenantName) return;

  await toggleTenantSwitcher(page);
  const btn = page.locator(DESKTOP_SIDEBAR).getByRole('button', { name: tenantName });
  await btn.waitFor({ state: 'visible', timeout: 5_000 });
  await btn.click();

  await expect(
    page.locator(`${DESKTOP_SIDEBAR} p.truncate.flex-1`).first()
  ).toHaveText(tenantName, { timeout: 15_000 });
}

// ===== Helpers de Dashboard =====

/**
 * Lee el nombre de la sucursal activa que se muestra debajo del saludo
 * "Hola, {nombre}" en el dashboard.
 */
export async function getDashboardTenantName(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const heading = page.getByRole('heading', { name: /Hola/ });
  await heading.waitFor({ state: 'visible', timeout: 10_000 });
  const container = heading.locator('..');
  const el = container.locator('p').first();
  return ((await el.textContent()) ?? '').trim();
}

// ===== Helpers de Limpieza Genérica =====

/**
 * Elimina productos de prueba por nombre usando service role (bypass RLS).
 * También elimina las ventas asociadas (sale_items → sales) para evitar
 * errores de FK.
 */
export async function cleanupBranchProducts(page: Page, productNames: string[]) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key || productNames.length === 0) return;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(url, key, { auth: { persistSession: false } });
    const { data: products } = await admin.from('products').select('id').in('name', productNames);
    const ids = (products ?? []).map((p: { id: string }) => p.id);
    if (ids.length > 0) {
      const { data: items } = await admin.from('sale_items').select('sale_id').in('product_id', ids);
      const saleIds = [...new Set((items ?? []).map((i: { sale_id: string }) => i.sale_id))];
      if (saleIds.length > 0) {
        await admin.from('sales').delete().in('id', saleIds);
      }
      await admin.from('product_stock').delete().in('product_id', ids);
      for (const id of ids) {
        await admin.from('products').delete().eq('id', id);
      }
    }
  } catch (e) {
    console.log('cleanupBranchProducts: error al limpiar vía service role:', e);
  }
}

/**
 * Helper de login reutilizable para cualquier cuenta.
 * Navega al login, completa credenciales y espera redirección a /dashboard.
 */
export async function loginAsUser(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('tu@email.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
}

// ===== Helpers de Billing / MercadoPago =====

/**
 * Intercepta la redirección a MercadoPago checkout para evitar pagos reales.
 * Devuelve la URL de checkout que se intentó abrir.
 *
 * Uso:
 *   const url = await mockMercadoPagoCheckout(page);
 *   // ... interactuar con la UI ...
 *   expect(url).toContain('mercadopago');
 */
export async function mockMercadoPagoCheckout(page: Page): Promise<string> {
  let capturedUrl = '';

  await page.route('**/*', async (route) => {
    const url = route.request().url();

    // Intercept navigation to MercadoPago checkout
    if (url.includes('mercadopago') || url.includes('sandbox.mercadopago')) {
      capturedUrl = url;
      await route.abort();
      return;
    }

    await route.continue();
  });

  // Also capture window.location.assign calls via console
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      const navUrl = frame.url();
      if (navUrl.includes('mercadopago')) {
        capturedUrl = navUrl;
      }
    }
  });

  // Return a function that retrieves the captured URL
  return capturedUrl;
}

/**
 * Restaura el estado de billing del tenant de prueba vía service role.
 * Asegura que no queden suscripciones activas de MP tras los tests.
 */
export async function cleanupBillingData(page: Page) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) return;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(url, key, { auth: { persistSession: false } });

    // Get the tenant for the E2E user
    const e2eEmail = process.env.E2E_USER_EMAIL ?? '';
    if (!e2eEmail) return;

    const { data: profile } = await admin
      .from('profiles')
      .select('id')
      .eq('email', e2eEmail)
      .single();

    if (!profile) return;

    const { data: tu } = await admin
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', profile.id)
      .limit(1)
      .single();

    if (!tu) return;

    // Reset billing fields to safe defaults (trial state)
    await admin
      .from('tenants')
      .update({
        subscription_status: 'free',
        subscription_plan: 'starter',
        mercadopago_preapproval_id: null,
        subscription_current_period_end: null,
      })
      .eq('id', tu.tenant_id);
  } catch (e) {
    console.log('cleanupBillingData: error al limpiar billing vía service role:', e);
  }
}

// ===== Helpers de Permisos / Roles =====

const E2E_MEMBER_USER_EMAIL = process.env.E2E_MEMBER_USER_EMAIL ?? '';
const E2E_MEMBER_USER_PASSWORD = process.env.E2E_MEMBER_USER_PASSWORD ?? '';

/**
 * Lee los nombres de todos los items de navegación visibles en el sidebar desktop.
 */
export async function getSidebarNavItems(page: Page): Promise<string[]> {
  const sidebar = page.locator('aside.hidden.md\\:flex');
  const links = sidebar.locator('nav a');
  await links.first().waitFor({ timeout: 15_000 });
  return links.allTextContents();
}

// ===== Helpers de Ventas (caja /sales) =====

/**
 * Formatea un valor en pesos (es-AR) igual que el frontend (formatARS).
 * Se usa para comparar los totales del checkout con los valores esperados.
 */
export function formatARSTest(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Agrega un producto al carrito de la caja: busca por nombre en el input de
 * la página /sales y hace clic en la tarjeta del producto.
 */
export async function addProductToCart(page: Page, productName: string) {
  const searchInput = page.getByPlaceholder('Buscar producto por nombre, SKU o código de barras...');
  await searchInput.fill(productName);
  const card = page.locator('button').filter({ hasText: productName }).first();
  await card.waitFor({ state: 'visible', timeout: 10_000 });
  await card.click();
}

/**
 * Devuelve el contenedor del ítem de un producto dentro del carrito de /sales.
 */
export function getCartItem(page: Page, productName: string) {
  return page.locator('div.bg-gray-100').filter({ hasText: productName }).first();
}

/**
 * Abre la sección colapsable "Últimas Ventas" de /sales y espera a que cargue
 * la primera fila del historial.
 */
export async function openSalesHistory(page: Page) {
  await page.getByRole('heading', { name: 'Últimas Ventas' }).click();
  await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 15_000 });
}

/**
 * Texto de la primera fila del historial de /sales (la venta más reciente).
 */
export async function getNewestSaleRowText(page: Page): Promise<string> {
  await openSalesHistory(page);
  return (await page.locator('table tbody tr').first().textContent()) ?? '';
}

/**
 * Limpia las ventas y productos de prueba de la batería de ventas.
 *
 * Los productos que ya fueron vendidos no se pueden eliminar por la UI: la FK
 * de `sale_items.product_id` (sin ON DELETE CASCADE) los bloquea y el DELETE
 * responde 403. Por eso primero se borran las ventas de prueba vía service
 * role (borrado en cascada de sale_items) y después los productos.
 */
export async function cleanupSalesData(page: Page, productNames: string[]) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (url && key) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const admin = createClient(url, key, { auth: { persistSession: false } });
      const { data: products } = await admin.from('products').select('id').in('name', productNames);
      const ids = (products ?? []).map((p) => p.id);
      if (ids.length > 0) {
        const { data: items } = await admin.from('sale_items').select('sale_id').in('product_id', ids);
        const saleIds = [...new Set((items ?? []).map((i) => i.sale_id))];
        if (saleIds.length > 0) {
          await admin.from('sales').delete().in('id', saleIds);
        }
        for (const id of ids) {
          await admin.from('products').delete().eq('id', id);
        }
      }
    } catch (e) {
      console.log('cleanupSalesData: error al limpiar vía service role:', e);
    }
  }

  await page.goto('/products');
  for (const name of productNames) {
    expect(await isProductVisibleInTable(page, name)).toBe(false);
  }
}
