import { describe, expect, it } from 'vitest';
import {
  buildExportRows,
  exportFileName,
  slugify,
} from './excel-export';
import type { Category } from '@/lib/types/category';
import type { Product } from '@/lib/types/product';

const CATEGORIES: Category[] = [
  { id: 'cat-1', tenant_id: 't1', name: 'Bebidas' },
  { id: 'cat-2', tenant_id: 't1', name: 'Snacks' },
];

const PRODUCTS: Product[] = [
  {
    id: 'p1',
    category_id: 'cat-1',
    name: 'Coca Cola 1.5L',
    sku: 'REF-COCA-1.5',
    barcode: '7791234567890',
    description: '<p>Gaseosa sabor <strong>cola</strong></p>',
    cost: 800,
    price: 1500,
    stock: 50,
    min_stock: 10,
    image_url: 'https://cdn.example.com/coca.jpg',
    is_active: true,
  },
  {
    id: 'p2',
    category_id: 'cat-2',
    name: 'Papas Fritas',
    sku: '',
    barcode: '',
    price: 900,
    stock: 20,
    images: ['https://cdn.example.com/papas-1.jpg', 'https://cdn.example.com/papas-2.jpg'],
    is_active: false,
  },
];

describe('slugify', () => {
  it('convierte el nombre en un identificador de URL', () => {
    expect(slugify('Coca Cola 1.5L')).toBe('coca-cola-1-5l');
  });

  it('quita acentos y colapsa todo lo que no sea alfanumerico', () => {
    expect(slugify('  ¡Alfajor Ñandú, edición especial!! ')).toBe('alfajor-nandu-edicion-especial');
  });
});

describe('buildExportRows: Genérico', () => {
  const rows = buildExportRows(PRODUCTS, CATEGORIES, 'generico');

  it('usa todos los campos internos del producto', () => {
    expect(Object.keys(rows[0])).toEqual([
      'Nombre',
      'Categoría',
      'SKU',
      'Código de Barras',
      'Descripción',
      'Costo',
      'Precio Venta',
      'Stock',
      'Stock Mínimo',
      'Stock Máximo',
      'Depósito',
      'Pasillo',
      'Estantería',
    ]);
  });

  it('mapea producto y categoria', () => {
    expect(rows[0]).toMatchObject({
      'Nombre': 'Coca Cola 1.5L',
      'Categoría': 'Bebidas',
      'SKU': 'REF-COCA-1.5',
      'Código de Barras': '7791234567890',
      'Costo': 800,
      'Precio Venta': 1500,
      'Stock': 50,
      'Stock Mínimo': 10,
    });
  });
});

describe('buildExportRows: Tiendanube', () => {
  const rows = buildExportRows(PRODUCTS, CATEGORIES, 'tiendanube');

  it('usa los encabezados que espera el import de Tiendanube', () => {
    expect(Object.keys(rows[0])).toEqual([
      'Nombre',
      'Identificador de URL',
      'Categorías',
      'SKU',
      'Código de barras',
      'Precio',
      'Costo',
      'Stock',
      'Stock mínimo',
      'Descripción',
      'Imágenes',
      'Activo',
    ]);
  });

  it('mapea producto, categoria y slug', () => {
    expect(rows[0]).toMatchObject({
      'Nombre': 'Coca Cola 1.5L',
      'Identificador de URL': 'coca-cola-1-5l',
      'Categorías': 'Bebidas',
      'SKU': 'REF-COCA-1.5',
      'Código de barras': '7791234567890',
      'Precio': 1500,
      'Costo': 800,
      'Stock': 50,
      'Stock mínimo': 10,
      'Activo': 'SÍ',
    });
  });

  it('quita el HTML de la descripcion y une imagenes con coma', () => {
    expect(rows[0]['Descripción']).toBe('Gaseosa sabor cola');
    expect(rows[0]['Imágenes']).toBe('https://cdn.example.com/coca.jpg');
    expect(rows[1]['Imágenes']).toBe(
      'https://cdn.example.com/papas-1.jpg, https://cdn.example.com/papas-2.jpg',
    );
    expect(rows[1]['Activo']).toBe('NO');
  });

  it('deja vacios los campos opcionales sin informar', () => {
    expect(rows[1]).toMatchObject({
      'SKU': '',
      'Código de barras': '',
      'Costo': '',
      'Stock mínimo': '',
      'Categorías': 'Snacks',
    });
  });
});

describe('buildExportRows: MercadoLibre', () => {
  const rows = buildExportRows(PRODUCTS, CATEGORIES, 'mercadolibre');

  it('usa los encabezados de la plantilla de publicacion masiva', () => {
    expect(Object.keys(rows[0])).toEqual([
      'Título',
      'Precio',
      'Cantidad',
      'Código',
      'GTIN',
      'Categoría',
      'Descripción',
      'Imágenes',
    ]);
  });

  it('mapea titulo, cantidad (stock), codigo (SKU) y GTIN (barcode)', () => {
    expect(rows[0]).toMatchObject({
      'Título': 'Coca Cola 1.5L',
      'Precio': 1500,
      'Cantidad': 50,
      'Código': 'REF-COCA-1.5',
      'GTIN': '7791234567890',
      'Categoría': 'Bebidas',
    });
  });

  it('une las imagenes con espacio, como espera MercadoLibre', () => {
    expect(rows[1]['Imágenes']).toBe(
      'https://cdn.example.com/papas-1.jpg https://cdn.example.com/papas-2.jpg',
    );
  });
});

describe('round-trip con el import', () => {
  it('los encabezados exportados son alias conocidos por excel-import-parse', async () => {
    const { mapImportColumns } = await import('./excel-import-parse');
      for (const platform of ['generico', 'tiendanube', 'mercadolibre'] as const) {
      const rows = buildExportRows(PRODUCTS, CATEGORIES, platform);
      const mapped = mapImportColumns(rows[0]);
      // "Identificador de URL", "Activo", etc. pasan sin mapear a proposito.
      expect(mapped.name).toBeTruthy();
      expect(mapped.price).toBeTruthy();
      expect(mapped.stock).toBeTruthy();
      expect(mapped.sku).toBeTruthy();
      expect(mapped.barcode).toBeTruthy();
      expect(mapped.description).toBeTruthy();
      expect(mapped.category_name).toBeTruthy();
    }
  });
});

describe('exportFileName', () => {
  it('arma el nombre con plataforma, fecha y extension', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    expect(exportFileName('generico', 'xls', now)).toBe('productos_2026-10-15.xls');
    expect(exportFileName('tiendanube', 'xls', now)).toBe('productos_tiendanube_2026-10-15.xls');
    expect(exportFileName('mercadolibre', 'csv', now)).toBe('productos_mercadolibre_2026-10-15.csv');
  });
});
