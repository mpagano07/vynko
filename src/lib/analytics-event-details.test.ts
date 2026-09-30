import { describe, it, expect } from 'vitest';
import { formatEventDetails } from './analytics-event-details';

// Los casos salen de los metadata que escribe el codigo real: los mismos
// que se leen de analytics_events en produccion.
describe('formatEventDetails', () => {
  it('no inventa detalles cuando no hay metadata', () => {
    expect(formatEventDetails(null).details).toEqual([]);
    expect(formatEventDetails(undefined).details).toEqual([]);
    expect(formatEventDetails({}).details).toEqual([]);
  });

  it('traduce el plan y oculta las claves de depuracion', () => {
    // Fila real del backfill: {"from":"tenants.created_at","plan":"business","backfilled":true}
    const result = formatEventDetails({
      from: 'tenants.created_at',
      plan: 'business',
      backfilled: true,
    });

    expect(result.details).toEqual([{ label: 'Plan', value: 'Business' }]);
    expect(result.reconstructed).toBe(true);
  });

  it('marca los eventos reconstruidos y los de fecha ajustada por separado', () => {
    expect(formatEventDetails({ backfilled: true }).reconstructed).toBe(true);
    expect(formatEventDetails({ backfilled: true }).clamped).toBe(false);

    const clamped = formatEventDetails({ backfilled: true, clamped: true });
    expect(clamped.reconstructed).toBe(true);
    expect(clamped.clamped).toBe(true);
  });

  it('no confunde el primer app_return con una vuelta corta', () => {
    // hoursSinceLast en null es el primer registro de esa persona, no una
    // vuelta. Mostrar "tras 0 h" seria mentira.
    // Sin etiqueta: la columna de evento ya dice "Volvió".
    const primera = formatEventDetails({ hoursSinceLast: null });
    expect(primera.details).toEqual([{ value: 'primera visita registrada' }]);

    const aLas48 = formatEventDetails({ hoursSinceLast: 50 });
    expect(aLas48.details).toEqual([{ value: 'tras 2 días' }]);

    const aLas5 = formatEventDetails({ hoursSinceLast: 5 });
    expect(aLas5.details).toEqual([{ value: 'tras 5 h' }]);
  });

  it('ignora el timestamp de la visita anterior', () => {
    // previousVisitAt es el timestamp crudo, no se muestra.
    const result = formatEventDetails({
      hoursSinceLast: 30,
      previousVisitAt: '2026-09-29T10:00:00.000Z',
    });
    expect(result.details).toEqual([{ value: 'tras 30 h' }]);
  });

  it('resume la importacion de Excel en una linea', () => {
    // Fila real: {"created":12,"updated":3,"skipped":0,"total":15}
    const result = formatEventDetails({ created: 12, updated: 3, skipped: 0, total: 15 });
    expect(result.details).toEqual([
      { label: 'Importación', value: '12 creados · 3 actualizados · de 15' },
    ]);
  });

  it('menciona los omitidos solo cuando hubo', () => {
    const result = formatEventDetails({ created: 1, updated: 0, skipped: 4, total: 5 });
    expect(result.details[0].value).toBe('1 creados · 0 actualizados · 4 omitidos · de 5');
  });

  it('formatea los montos en pesos y no en centavos', () => {
    const result = formatEventDetails({ totalCents: 125000 });
    expect(result.details[0].label).toBe('Total');
    expect(result.details[0].value).toContain('1.250');
    expect(result.details[0].value).not.toContain('125000');
  });

  it('traduce los ids a algo legible y descarta los ids sueltos', () => {
    const venta = formatEventDetails({
      saleId: '3f89a50e-85b3-4ec4-99a8-6777f0b31b10',
      totalCents: 50000,
      itemCount: 1,
    });
    expect(venta.details).toEqual([
      { label: 'Total', value: expect.stringContaining('500') },
      { label: 'Ítems', value: '1 artículo' },
    ]);

    const producto = formatEventDetails({
      productId: 'abc',
      name: 'Gaseosa 2L',
      sku: 'GAS-2L',
    });
    expect(producto.details).toEqual([{ label: 'Producto', value: 'Gaseosa 2L · GAS-2L' }]);
  });

  it('distingue la recepcion parcial de la completa', () => {
    expect(formatEventDetails({ partial: true }).details).toEqual([
      { label: 'Recepción', value: 'parcial' },
    ]);
    expect(formatEventDetails({ partial: false }).details).toEqual([
      { label: 'Recepción', value: 'completa' },
    ]);
  });

  it('muestra las claves desconocidas en vez de perderlas', () => {
    // Si mañana se agrega un evento con una clave nueva, tiene que verse algo
    // en vez de una fila muda.
    const result = formatEventDetails({ algoNuevo: 'valor' });
    expect(result.details).toEqual([{ label: 'algoNuevo', value: 'valor' }]);
  });

  it('no rompe con tipos raros', () => {
    expect(() =>
      formatEventDetails({ plan: 42, totalCents: 'mucho', itemCount: NaN, anidado: { a: 1 } })
    ).not.toThrow();
    expect(formatEventDetails({ plan: 42 }).details).toEqual([]);
  });
});
