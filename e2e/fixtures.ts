import { test as base, expect, Page, Locator } from '@playwright/test';

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
/**
 * El banner de consentimiento se muestra en cada contexto nuevo y se superpone
 * al contenido, interceptando los clics: los tests agotaban el timeout sin
 * llegar a interactuar con la app. Se acepta por defecto en E2E.
 */
export async function acceptCookies(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'vynko_cookie_consent',
      JSON.stringify({ accepted: true, date: new Date().toISOString() }),
    );
  });
}

export const test = base.extend<AuthFixture>({
  page: async ({ page }, use) => {
    await acceptCookies(page);
    await use(page);
  },

  authenticatedPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await acceptCookies(page);

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
    await acceptCookies(page);

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

  // Esperar a que se cierre el modal (max 25s). Si no se cierra, capturar el estado para debug.
  try {
    await modalHeading.waitFor({ state: 'hidden', timeout: 25_000 });
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

  // Click en el botón de eliminar de la fila. IconAction expone el nombre
  // accesible "Eliminar <producto>", más estable que `title="Eliminar"`.
  const deleteButton = productRow.getByRole('button', { name: `Eliminar ${productName}` });
  await deleteButton.click({ timeout: 10_000 });

  // Si aparece modal de confirmación, hay que confirmar DENTRO del dialog: el
  // botón de la fila también matchea /Eliminar producto/i y queda detrás del
  // overlay, así que el click expiraba interceptado.
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: /Eliminar producto/i }).click({ timeout: 10_000 });
  }

  // Toast de éxito
  await page.locator('[role="status"]').filter({ hasText: 'Producto eliminado' }).first().waitFor({ timeout: 10_000 }).catch(() => {});
}

/**
 * Helper para buscar un producto en la tabla
 */
export async function searchProduct(page: Page, searchTerm: string) {
  const searchInput = page.getByPlaceholder('Buscar por nombre, SKU o barras...');
  await searchInput.waitFor({ state: 'visible', timeout: 10_000 });
  // Esperar a que la tabla esté "asentada": con filas o con el estado vacío.
  // Esperar solo por filas no sirve cuando el tenant se queda sin productos
  // (limpieza de E2E), porque ahí la espera se come el timeout completo. Y sin
  // hidratación, `fill` no dispara el onChange de React y el filtro no se aplica.
  await page
    .locator('tbody tr, p:has-text("No se encontraron productos")')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {});
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
    // Filtrar por nombre para traer el producto a la vista (hay paginación).
    // `searchProduct` espera a que la tabla esté hidratada y a que pase el
    // debounce, así que la fila ya está o no está de inmediato.
    await searchProduct(page, productName);
    const productRow = page.locator('tbody tr').filter({ hasText: productName }).first();
    await productRow.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    return await productRow.isVisible();
  } catch (e) {
    // Antes esto devolvía `false` en silencio para cualquier motivo (placeholder
    // que no matchea, tabla que aún no cargó, etc.) y el fallo real se perdía.
    const filas = await page.locator('tbody tr').count().catch(() => -1);
    console.warn(
      `[isProductVisibleInTable] "${productName}" no visible (filas en tabla: ${filas}):`,
      e instanceof Error ? e.message.split('\n')[0] : e
    );
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
 * Elige una opción en el `<Select>` custom de la app.
 *
 * `Select` NO renderiza `<select>`/`<option>` nativos: expone un
 * `<button aria-haspopup="listbox">` que abre un panel `role="listbox"`, así
 * que `locator('select').selectOption(...)` se queda esperando un elemento que
 * no existe. Si el `Select` es `searchable`, hay que filtrar antes de elegir.
 */
export async function chooseCustomSelectOption(
  page: Page,
  trigger: Locator,
  optionText: string,
  search?: string
) {
  await trigger.click();
  if (search) {
    await page.getByTestId('select-search').fill(search);
  }
  await page.getByRole('option').filter({ hasText: optionText }).first().click();
}

// Etiquetas de `reasonOptions` en /loss-prevention. El <Select> custom elige
// por TEXTO visible, no por value, asi que hay que traducir el valor.
const LOSS_PREVENTION_REASON_LABELS: Record<string, string> = {
  damaged: 'Dañado',
  lost: 'Perdido',
  stolen: 'Robado',
  expired: 'Vencido',
  found: 'Encontrado',
  correction: 'Corrección',
};

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

  // El <Select> de la app NO es un <select> nativo: es un listbox custom
  // (button[aria-haspopup="listbox"] + panel role="listbox"). El de producto
  // además es "searchable", así que hay que filtrar antes de elegir.
  const productTrigger = form.getByRole('button', { name: 'Producto' });
  await productTrigger.click();
  await form.getByTestId('select-search').fill(productName);
  await form
    .getByRole('option')
    .filter({ hasText: productName })
    .first()
    .click();

  const reasonLabel = LOSS_PREVENTION_REASON_LABELS[reason] ?? reason;
  const reasonTrigger = form.getByRole('button', { name: 'Tipo de ajuste' });
  await reasonTrigger.click();
  await form
    .getByRole('option')
    .filter({ hasText: reasonLabel })
    .first()
    .click();

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

// El selector de sucursales se localiza por `data-testid`: el harness antes
// dependía de clases de Tailwind (`aside ... p.truncate.flex-1`) que quedaron
// obsoletas cuando el switcher se movió del sidebar al header, y los tests
// agotaban el timeout sin poder interactuar.
const TENANT_SWITCHER = '[data-testid="tenant-switcher"]';
const TENANT_SWITCHER_NAME = '[data-testid="tenant-switcher-name"]';
const TENANT_SWITCHER_DROPDOWN = '[data-testid="tenant-switcher-dropdown"]';
const TENANT_SWITCHER_OPTION = '[data-testid="tenant-switcher-option"]';
const TENANT_SWITCHER_ALL = '[data-testid="tenant-switcher-all"]';

async function toggleTenantSwitcher(page: Page) {
  await page.locator(TENANT_SWITCHER).first().click();
}

/**
 * Abre el desplegable del selector de sucursales y espera a que las opciones
 * estén montadas.
 */
export async function openTenantSwitcher(page: Page) {
  if (!(await page.locator(TENANT_SWITCHER_DROPDOWN).isVisible().catch(() => false))) {
    await toggleTenantSwitcher(page);
  }
  await page.locator(TENANT_SWITCHER_DROPDOWN).waitFor({ state: 'visible', timeout: 10_000 });
}

/**
 * Cierra el desplegable pulsando su overlay, si está abierto.
 *
 * El overlay es `fixed inset-0` y queda por encima del trigger, así que sin
 * esto el clic siguiente sobre el switcher lo intercepta y el test expira.
 */
export async function closeTenantSwitcher(page: Page) {
  const overlay = page.locator('.fixed.inset-0.z-10');
  if (await overlay.first().isVisible().catch(() => false)) {
    await overlay.first().click({ position: { x: 4, y: 4 }, force: true });
    await page.locator(TENANT_SWITCHER_DROPDOWN).waitFor({ state: 'hidden', timeout: 10_000 });
  }
}

/**
 * Nombre de la sucursal activa (label del selector de sucursales del header).
 */
export async function getCurrentTenantName(page: Page): Promise<string> {
  return ((await page.locator(TENANT_SWITCHER_NAME).first().textContent()) ?? '').trim();
}

/**
 * Lista los nombres de todas las sucursales del usuario.
 *
 * Se lee el `span[title]` de cada opción y no el texto de la fila: la fila
 * incluye el avatar con la inicial y el check de la activa, y el nombre
 * quedaba pegado a la letra ("KKioscucho Ramos").
 */
export async function getTenantNames(page: Page): Promise<string[]> {
  await openTenantSwitcher(page);
  const names = await page.locator(`${TENANT_SWITCHER_OPTION} span[title]`).allTextContents();
  await closeTenantSwitcher(page);
  return names.map((n) => n.trim()).filter(Boolean);
}

/**
 * Cambia de sucursal desde el selector del header y espera a que se aplique.
 */
export async function switchTenantByName(page: Page, tenantName: string) {
  const current = await getCurrentTenantName(page);
  if (current === tenantName) return;

  await openTenantSwitcher(page);

  // El nombre vive en el <span title> de la opción, no en el texto de la fila:
  // la fila incluye el avatar con la inicial y el check de la activa.
  const option = page
    .locator(TENANT_SWITCHER_OPTION)
    .filter({ has: page.locator(`span[title="${tenantName}"]`) })
    .first();
  await option.waitFor({ state: 'visible', timeout: 10_000 });
  await option.click();

  // Tras cambiar de sucursal el desplegable se cierra solo.
  await expect(page.locator(TENANT_SWITCHER_NAME).first()).toHaveText(tenantName, { timeout: 15_000 });
}

/**
 * Si el desplegable ofrece la opción "Todas las sucursales".
 *
 * El componente la oculta cuando el usuario tiene una sola sucursal, porque no
 * se puede seleccionar (no hay nada que agregar).
 */
export async function hasAllTenantsOption(page: Page): Promise<boolean> {
  await openTenantSwitcher(page);
  const visible = await page.locator(TENANT_SWITCHER_ALL).isVisible().catch(() => false);
  await closeTenantSwitcher(page);
  return visible;
}

/**
 * Selecciona la vista agregada "Todas las sucursales".
 */
export async function selectAllTenants(page: Page) {
  await openTenantSwitcher(page);
  await page.locator(TENANT_SWITCHER_ALL).click();
  await expect(page.locator(TENANT_SWITCHER_NAME).first()).toHaveText('Todas las sucursales', { timeout: 15_000 });
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
  await acceptCookies(page);
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
 * Aplica un estado de billing a TODAS las sucursales del usuario E2E vía
 * service role (bypass RLS).
 *
 * Un usuario puede ser owner/admin de varias sucursales y la suscripción se
 * consolida por owner (`consolidateOwnerSubscription`), por lo que el plan
 * efectivo es el mejor entre todas. Para que el estado sea determinista hay
 * que setear TODAS las sucursales a la vez.
 */
export async function setTenantBilling(
  plan: 'starter' | 'business',
  status: 'free' | 'active',
  resetTrial = false
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const e2eEmail = process.env.E2E_USER_EMAIL ?? '';
  if (!url || !key || !e2eEmail) return;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(url, key, { auth: { persistSession: false } });

    const { data: profile } = await admin
      .from('profiles')
      .select('id')
      .eq('email', e2eEmail)
      .single();
    if (!profile) return;

    const { data: tu } = await admin
      .from('tenant_users')
      .select('tenant_id, role')
      .eq('user_id', profile.id)
      .in('role', ['owner', 'admin']);
    const tenantIds = (tu ?? []).map((t) => t.tenant_id);
    if (tenantIds.length === 0) return;

    await admin
      .from('tenants')
      .update({
        subscription_status: status,
        subscription_plan: plan,
        mercadopago_preapproval_id: null,
        subscription_current_period_end: null,
        ...(resetTrial ? { created_at: new Date().toISOString() } : {}),
      })
      .in('id', tenantIds);
  } catch (e) {
    console.log('setTenantBilling: error aplicando estado de billing:', e);
  }
}

/**
 * Restaura el estado base del entorno E2E: las sucursales en Business activo.
 *
 * El resto de la suite (dashboard/sales/productos/stock) requiere una
 * sucursal Business activa: límite de productos ilimitado y acceso a 2+
 * sucursales. Al terminar billing devolvemos las sucursales a ese estado,
 * que es el esperado por los specs que corren después.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- page kept for API consistency with callers
export function cleanupBillingData(_page?: Page) {
  return setTenantBilling('business', 'active');
}

/**
 * Elimina de la base de pruebas los productos creados por los tests E2E.
 *
 * Busca por el patrón " E2E " en el nombre (usado por los specs como sufijo)
 * y borra el producto y su stock asociado. Se invoca SIEMPRE, incluso cuando
 * un test de la serie falla en medio, para evitar acumular residuales.
 */
export async function cleanupE2EProducts() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) return 0;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(url, key, { auth: { persistSession: false } });

    const { data: products } = await admin
      .from('products')
      .select('id')
      .ilike('name', '%E2E%');
    const ids = (products ?? []).map((p) => p.id);
    if (ids.length === 0) return 0;

    const { data: items } = await admin
      .from('sale_items')
      .select('sale_id')
      .in('product_id', ids);
    const saleIds = [...new Set((items ?? []).map((i: { sale_id: string }) => i.sale_id))];
    if (saleIds.length > 0) {
      await admin.from('sales').delete().in('id', saleIds);
    }
    await admin.from('product_stock').delete().in('product_id', ids);
    for (const id of ids) {
      await admin.from('products').delete().eq('id', id);
    }
    return ids.length;
  } catch (e) {
    console.log('cleanupE2EProducts: error limpiando productos E2E:', e);
    return 0;
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
 *
 * Se ancla en `data-testid` y no en clases de Tailwind: `bg-gray-100` y el
 * ancho del badge de cantidad cambiaron antes y dejaron el E2E apuntando a
 * nodos inexistentes.
 */
export function getCartItem(page: Page, productName: string) {
  return page.getByTestId('cart-item').filter({ hasText: productName }).first();
}

/**
 * Igual que `expectedSaleTotalCents` pero devuelve el texto ya formateado
 * para comparar contra el historial de ventas.
 *
 * Ojo: el total del CARRITO no lleva ajuste (se muestra antes de elegir el
 * medio de pago), asi que ese se compara contra `formatARSTest` directo.
 * Solo el importe que queda REGISTRADO en la venta lleva el ajuste.
 */
export async function expectedSaleTotalText(
  page: Page,
  cartTotal: number,
  method: 'cash' | 'transfer' | 'debit' | 'credit' | 'mercadopago' = 'cash'
): Promise<string> {
  const cents = await expectedSaleTotalCents(page, cartTotal * 100, method);
  return formatARSTest(cents / 100);
}

/**
 * Texto del VALOR de una tarjeta KPI del dashboard, buscada por su titulo.
 *
 * Se ancla en `data-testid` y en el texto exacto del titulo en vez de clases
 * de Tailwind o de etiquetas `<p>`: el valor de una StatCard es un <div>, y
 * "Ventas hoy" como substring tambien matchea el valor "Sin ventas hoy" de la
 * tarjeta "Estado".
 */
export async function getKpiCardValue(page: Page, title: string): Promise<string> {
  const value = page
    .getByTestId('stat-card')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first()
    .getByTestId('stat-value');
  await value.waitFor({ state: 'visible', timeout: 10_000 });
  return (await value.textContent())?.trim() ?? '';
}

/** Botón "+" de un ítem del carrito. */
export function cartItemPlus(page: Page, productName: string) {
  return page.getByRole('button', { name: `Agregar una unidad de ${productName}` });
}

/** Botón "−" de un ítem del carrito. */
export function cartItemMinus(page: Page, productName: string) {
  return page.getByRole('button', { name: `Quitar una unidad de ${productName}` });
}

/** Botón de tachera de un ítem del carrito. */
export function cartItemRemove(page: Page, productName: string) {
  return page.getByRole('button', { name: `Eliminar ${productName} del carrito` });
}

/**
 * Completa el flujo de cobro del modal de /sales: selecciona el medio de pago
 * y confirma. En efectivo el "Monto abonado" ya viene precargado con el total,
 * así que alcanza con confirmar.
 */
export async function completeCheckout(
  page: Page,
  method: 'cash' | 'transfer' | 'debit' | 'credit' | 'mercadopago' = 'cash'
) {
  const modal = page.getByRole('dialog', { name: 'Cobrar venta' });
  await modal.waitFor({ state: 'visible', timeout: 10_000 });

  const labels: Record<string, string> = {
    transfer: 'Transferencia',
    debit: 'Débito',
    credit: 'Crédito',
    mercadopago: 'Mercado Pago',
  };

  if (method !== 'cash') {
    await modal.getByRole('button', { name: new RegExp(labels[method]) }).click();
  }

  await modal.getByRole('button', { name: /Confirmar pago/i }).click();
}

/**
 * Devuelve el total que se cobra, en centavos, aplicando el ajuste que el
 * tenant tenga configurado para ese medio de pago.
 *
 * El tenant puede tener un descuento o recargo por medio (ej. `cash: -10`),
 * asi que el importe que queda registrado NO es el del carrito. Leer la
 * configuracion evita que el test hardcodee un total que depende de un
 * ajuste configurado a mano en Settings.
 */
export async function expectedSaleTotalCents(
  page: Page,
  cartTotalCents: number,
  method: 'cash' | 'transfer' | 'debit' | 'credit' | 'mercadopago' = 'cash'
): Promise<number> {
  const response = await page.request.get('/api/settings/checkout');
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    checkout?: { payment_adjustments?: Record<string, number> };
  };
  const pct = body.checkout?.payment_adjustments?.[method] ?? 0;
  return Math.round((cartTotalCents * (100 + pct)) / 100);
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

// ===== Ciclo completo de suscripcion (checkout -> webhook -> plan) =====

/**
 * Encola el preapproval y devuelve el id a usar en el webhook, junto con la
 * referencia externa que el webhook va a recibir.
 *
 * La referencia externa real la arma el backend al crear la suscripción en MP
 * (`${tenantId}:${plan}`), asi que acá se replica ese formato para que el
 * webhook encuentre la sucursal.
 */
export async function seedSubscriptionForWebhook(
  plan: 'starter' | 'business' = 'business'
): Promise<{ preapprovalId: string; externalReference: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const e2eEmail = process.env.E2E_USER_EMAIL ?? '';
  if (!url || !key || !e2eEmail) return null;

  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', e2eEmail)
    .single();
  if (!profile) return null;

  const { data: tu } = await admin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', profile.id)
    .in('role', ['owner', 'admin']);
  const tenantIds = (tu ?? []).map((t) => t.tenant_id);
  if (tenantIds.length === 0) return null;

  const preapprovalId = `e2e-pa-${Date.now()}`;
  const primaryTenant = tenantIds[0];

  // Estado previo: pagado y dado de baja, con el preapproval ya registrado.
  // Asi el webhook tiene una transicion real que aplicar.
  await admin
    .from('tenants')
    .update({
      mercadopago_preapproval_id: preapprovalId,
      subscription_status: 'canceled',
      subscription_plan: 'free',
    })
    .in('id', tenantIds);

  return { preapprovalId, externalReference: `${primaryTenant}:${plan}` };
}

/**
 * Envia un webhook de MercadoPago con la firma HMAC valida.
 *
 * Reproduce el formato real del header `x-signature`
 * (`ts=<unix>;v1=<hmac sha256 hex>`) sobre el manifest
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, que es lo que valida el
 * backend. Mandar el webhook sin firma wouldn't probar nada: el route la
 * rechaza con 401 antes de tocar la base.
 */
export async function postSignedWebhook(
  page: Page,
  body: { id: string; topic: string; mpStatus?: string; externalReference?: string }
): Promise<{ status: number; json: unknown }> {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET ?? '';
  const crypto = await import('node:crypto');

  const requestId = `e2e-req-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const ts = String(Math.floor(Date.now() / 1000));

  const manifest = `id:${body.id};request-id:${requestId};ts:${ts};`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(manifest);
  const v1 = hmac.digest('hex');

  const response = await page.request.post('/api/webhooks/mercadopago', {
    headers: {
      'content-type': 'application/json',
      'x-signature': `ts=${ts},v1=${v1}`,
      'x-request-id': requestId,
    },
    data: {
      type: body.topic,
      action: body.mpStatus ?? 'authorized',
      data: {
        id: body.id,
        status: body.mpStatus ?? 'authorized',
        external_reference: body.externalReference ?? '',
      },
    },
  });

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  return { status: response.status(), json };
}

/**
 * Estado de suscripcion de las sucursales del usuario E2E, para verificar de
 * punta a punta que el webhook efectivamente cambio algo en la base.
 */
export async function getTenantBillingState() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const e2eEmail = process.env.E2E_USER_EMAIL ?? '';
  if (!url || !key || !e2eEmail) return [];

  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', e2eEmail)
    .single();
  if (!profile) return [];

  const { data: tu } = await admin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', profile.id);
  const tenantIds = (tu ?? []).map((t) => t.tenant_id);
  if (tenantIds.length === 0) return [];

  const { data } = await admin
    .from('tenants')
    .select('id, subscription_status, subscription_plan, mercadopago_preapproval_id')
    .in('id', tenantIds);
  return data ?? [];
}


