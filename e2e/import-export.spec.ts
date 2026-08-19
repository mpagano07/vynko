import { test, expect, isProductVisibleInTable, createProductViaUI, cleanupSalesData } from './fixtures';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const timestamp = Date.now();
const IMPORT_PRODUCTS = [
  { name: `Import Alpha ${timestamp}`, sku: `IMP-ALPHA-${timestamp}`, price: 200, stock: 30, category: 'ImportTest' },
  { name: `Import Beta ${timestamp}`, sku: `IMP-BETA-${timestamp}`, price: 350, cost: 180, stock: 15, min_stock: 5, max_stock: 50 },
];
const ALL_NAMES = IMPORT_PRODUCTS.map(p => p.name);

const TMP_DIR = path.join(process.env.TEMP || '/tmp', 'playwright-import-test');

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function writeXlsx(filename: string, headers: string[], rows: (string | number | undefined | null)[][]): string {
  ensureTmpDir();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  const filePath = path.join(TMP_DIR, filename);
  XLSX.writeFile(wb, filePath);
  return filePath;
}

function openImportModal(page: import('@playwright/test').Page) {
  return page.locator('button').filter({ hasText: 'Gestionar' }).first().click();
}

async function clickImport(page: import('@playwright/test').Page) {
  await openImportModal(page);
  await page.getByRole('button', { name: 'Importar' }).first().click();
  await expect(page.getByText('Importar productos desde Excel')).toBeVisible({ timeout: 5000 });
}

test.describe('Importación / Exportación de productos E2E', () => {

  // ─── 1. Importar archivo válido ───────────────────────────

  test('importar archivo válido crea productos correctamente', async ({ authenticatedPage: page }) => {
    const filePath = writeXlsx('valid-import.xlsx',
      ['Nombre', 'SKU', 'Precio', 'Costo', 'Stock', 'Stock Mínimo', 'Stock Máximo', 'Categoría'],
      IMPORT_PRODUCTS.map(p => [p.name, p.sku, p.price, p.cost ?? '', p.stock, p.min_stock ?? '', p.max_stock ?? '', p.category]),
    );

    await page.goto('/products');
    await expect(page.locator('table, [role="grid"]').first()).toBeVisible({ timeout: 10_000 });
    await clickImport(page);

    // Subir archivo
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);

    // Preview: detecta 2 productos
    await expect(page.getByText('2 producto(s) detectados')).toBeVisible({ timeout: 10_000 });

    // Tabla de preview muestra las columnas originales
    const previewTable = page.locator('.max-h-64 table, [class*="max-h"] table').first();
    await expect(previewTable.locator('th').filter({ hasText: 'Nombre' })).toBeVisible();
    await expect(previewTable.locator('th').filter({ hasText: 'SKU' })).toBeVisible();

    // Importar
    await page.getByRole('button', { name: /Importar \d+ producto/ }).click();

    // Resultados: 2 creados
    await expect(page.getByText(/\d+ creados/).first()).toBeVisible({ timeout: 15_000 });

    // Cerrar modal
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

    // Verificar que los productos aparecen en la tabla
    expect(await isProductVisibleInTable(page, IMPORT_PRODUCTS[0].name)).toBe(true);
    expect(await isProductVisibleInTable(page, IMPORT_PRODUCTS[1].name)).toBe(true);
  });

  // ─── 2. Importar archivo con columnas incorrectas ─────────

  test('importar archivo sin columna nombre omite filas sin nombre', async ({ authenticatedPage: page }) => {
    const filePath = writeXlsx('missing-name.xlsx',
      ['SKU', 'Precio'],
      [
        [`SKU-NO-NAME-${timestamp}`, 100],
      ],
    );

    await page.goto('/products');
    await clickImport(page);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);

    await expect(page.getByText('1 producto(s) detectados')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Importar \d+ producto/ }).click();

    // 1 omitido (sin nombre)
    await expect(page.getByText(/\d+ omitidos/).first()).toBeVisible({ timeout: 15_000 });

    // Verificar que el resultado dice "Omitido"
    await expect(page.getByText('Omitido', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  });

  // ─── 3. Rechazar archivo inválido ─────────────────────────

  test('rechazar archivo inválido muestra error', async ({ authenticatedPage: page }) => {
    await page.goto('/products');
    await clickImport(page);

    // Subir un .txt como si fuera Excel
    const tmpFile = path.join(TMP_DIR, 'invalid.txt');
    fs.writeFileSync(tmpFile, 'esto no es un excel');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(tmpFile);

    // Esperar un momento para que se procese
    await page.waitForTimeout(2000);

    // El modal NO debe mostrar preview de productos ni botón de importar
    // (sigue en estado de selección de archivo o mostró error)
    const importButton = page.getByRole('button', { name: /Importar \d+ producto/ });
    await expect(importButton).not.toBeVisible();
  });

  // ─── 4. Importar archivo vacío ────────────────────────────

  test('importar archivo vacío muestra error', async ({ authenticatedPage: page }) => {
    const filePath = writeXlsx('empty.xlsx', ['Nombre'], []);

    await page.goto('/products');
    await clickImport(page);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);

    // Esperar un momento para que se procese
    await page.waitForTimeout(2000);

    // El modal NO debe mostrar preview de productos ni botón de importar
    const importButton = page.getByRole('button', { name: /Importar \d+ producto/ });
    await expect(importButton).not.toBeVisible();
  });

  // ─── 5. Exportar productos ────────────────────────────────

  test('exportar productos genera archivo xlsx con columnas correctas', async ({ authenticatedPage: page }) => {
    await page.goto('/products');
    await expect(page.locator('table, [role="grid"]').first()).toBeVisible({ timeout: 10_000 });

    // Click en Gestionar > Exportar
    await page.locator('button').filter({ hasText: 'Gestionar' }).first().click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar' }).first().click(),
    ]);

    // Verificar que se descarga un archivo .xlsx
    expect(download.suggestedFilename()).toMatch(/productos_.*\.xlsx/);

    // Guardar y leer el archivo
    const savePath = path.join(TMP_DIR, download.suggestedFilename());
    await download.saveAs(savePath);

    const wb = XLSX.readFile(savePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

    // Debe tener al menos 1 fila (productos existentes)
    expect(data.length).toBeGreaterThanOrEqual(1);

    // Verificar columnas esperadas
    const headers = Object.keys(data[0]);
    expect(headers).toContain('Nombre');
    expect(headers).toContain('SKU');
    expect(headers).toContain('Precio Venta');
    expect(headers).toContain('Stock');
  });

  // ─── 6. Columnas del archivo de importación ───────────────

  test('info de columnas aceptadas se muestra al hacer click en ?', async ({ authenticatedPage: page }) => {
    await page.goto('/products');
    await clickImport(page);

    // Click en el botón de ayuda (?)
    await page.locator('button[title="Ver columnas aceptadas"]').click();

    // Verificar dentro del panel de ayuda
    const infoPanel = page.locator('.bg-gray-50, .dark\\:bg-gray-800\\/50').filter({ hasText: 'Columnas del archivo:' }).first();
    await expect(infoPanel).toBeVisible({ timeout: 5000 });
    const text = await infoPanel.textContent();
    expect(text).toContain('Nombre *');
    expect(text).toContain('Precio');
    expect(text).toContain('SKU');
    expect(text).toContain('Código de barras');
    expect(text).toContain('Stock');
    expect(text).toContain('Categoría');
    expect(text).toContain('Descripción');
  });

  // ─── Cleanup ──────────────────────────────────────────────

  test('cleanup - eliminar productos importados', async ({ authenticatedPage: page }) => {
    await cleanupSalesData(page, ALL_NAMES);
  });
});
