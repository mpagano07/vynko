/**
 * Circuito principal de productos con variantes creadas manualmente:
 * alta del padre → atributos/valores → variantes con precio/costo/stock
 * propios → venta en el POS por código de variante.
 *
 * GUARDIA: este spec crea y vende datos reales y al final los borra. Solo se
 * ejecuta con `E2E_ALLOW_VARIANTS_RUN=1` contra un Supabase local o un proyecto
 * de test DEDICADO. Nunca correrlo contra producción ni una base compartida;
 * el teardown global ya limpia los productos `* E2E *` de las sucursales E2E.
 */
import {
  test,
  expect,
  completeCheckout,
  getCartItem,
  cleanupBranchProducts,
} from './fixtures';

test.describe.configure({ mode: 'serial' });

const ALLOWED = process.env.E2E_ALLOW_VARIANTS_RUN === '1';
const SUFFIX = Date.now().toString(36);
const PARENT = `Remera Variantes * E2E * ${SUFFIX}`;
const RED = `Rojo E2E ${SUFFIX}`;
const BLUE = `Azul E2E ${SUFFIX}`;
const RED_SKU = `VAR-ROJO-${SUFFIX}`.toUpperCase();
const BLUE_BARCODE = `779${SUFFIX}`;

test.describe('Productos con variantes', () => {
  test.skip(!ALLOWED, 'Requiere E2E_ALLOW_VARIANTS_RUN=1 y una base E2E descartable');

  test('crea el padre, dos variantes manuales y vende una por su código', async ({ authenticatedPage: page }) => {
    await page.goto('/products');
    await expect(page.getByRole('heading', { name: /Gestión de Inventario|Productos/i })).toBeVisible({ timeout: 15_000 });

    // 1. Alta del producto principal (sin stock propio: se mueve por variante).
    await page.getByRole('button', { name: 'Con variantes' }).click();
    const parentModal = page.getByRole('dialog');
    await parentModal.getByPlaceholder('Ej: Remera').fill(PARENT);
    await parentModal.getByRole('button', { name: 'Crear y configurar variantes' }).click();
    await parentModal.waitFor({ state: 'hidden', timeout: 25_000 });

    // 2. Abrir la fila desplegable y el administrador de variantes.
    await page.getByPlaceholder('Buscar por nombre, SKU o barras...').fill(PARENT);
    await page.waitForTimeout(500);
    const row = page.locator('tbody tr').filter({ hasText: PARENT }).first();
    await row.getByRole('button', { name: `Ver variantes de ${PARENT}` }).click();
    await page.getByRole('button', { name: 'Administrar variantes' }).click();

    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('heading', { name: `Variantes de ${PARENT}` })).toBeVisible();

    // 3. Atributo relacional con dos valores; NO hay generación automática.
    await modal.getByPlaceholder('Ej: Color').fill('Color E2E');
    await modal.getByPlaceholder('Rojo, Azul, Negro').fill(`${RED}, ${BLUE}`);
    await modal.getByRole('button', { name: 'Crear atributo' }).click();
    await expect(modal.getByText(RED, { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    const field = (label: string) =>
      modal.getByText(label, { exact: true }).locator('..').locator('input').first();

    // 4. Variante roja: precio/costo/stock propios, distintos del padre.
    await modal.getByLabel(RED).check();
    await field('Etiqueta').fill(RED);
    await field('SKU').fill(RED_SKU);
    await field('Código de barras').fill('');
    await field('Costo').fill('8');
    await field('Precio').fill('15.5');
    await field('Stock inicial').fill('2');
    await modal.getByRole('button', { name: 'Crear variante' }).click();
    await expect(modal.getByText(RED, { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    // 5. Variante azul: barcode propio, otro precio y otro stock.
    await modal.getByLabel(RED).uncheck();
    await modal.getByLabel(BLUE).check();
    await field('Etiqueta').fill(BLUE);
    await field('SKU').fill('');
    await field('Código de barras').fill(BLUE_BARCODE);
    await field('Costo').fill('3');
    await field('Precio').fill('7');
    await field('Stock inicial').fill('4');
    await modal.getByRole('button', { name: 'Crear variante' }).click();
    await expect(modal.getByText(BLUE, { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    // 6. Ajuste de stock de la variante, sin tocar el stock del padre.
    const redRow = modal.locator('tr').filter({ hasText: RED }).first();
    await redRow.getByPlaceholder('±').fill('3');
    await redRow.getByRole('button', { name: 'Aplicar' }).click();
    await expect(redRow).toContainText('5', { timeout: 10_000 });

    await modal.getByRole('button', { name: 'Cerrar' }).click();
    await modal.waitFor({ state: 'hidden', timeout: 10_000 });

    // 7. El POS ofrece la variante como unidad vendible, no el padre.
    await page.goto('/sales');
    await page.getByPlaceholder('Buscar producto por nombre, SKU o código de barras...').fill(RED_SKU);
    const card = page.locator('button').filter({ hasText: `${PARENT} · ${RED}` }).first();
    await card.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(card).toContainText('$15,50');
    await card.click();

    const item = getCartItem(page, `${PARENT} · ${RED}`);
    await expect(item).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Cobrar' }).click();
    await completeCheckout(page, 'cash');
    await expect(page.getByRole('dialog', { name: 'Cobrar venta' })).toBeHidden({ timeout: 20_000 });

    // 8. El historial guarda la descripción completa de la variante vendida.
    await page.getByRole('heading', { name: 'Últimas Ventas' }).click();
    await expect(page.locator('table tbody tr').first()).toContainText(`${PARENT} · ${RED}`, { timeout: 15_000 });

    // Limpieza: borra primero ventas/sale_items y después el padre en cascada.
    await cleanupBranchProducts(page, [PARENT]);
  });
});
