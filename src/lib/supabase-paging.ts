import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Tope de filas por SELECT que PostgREST aplica en Supabase (`db-max-rows`).
 *
 * No es un error: la query resuelve 200 y devuelve hasta 1000 filas, sin
 * warning ni metadato de truncado. Por eso un catálogo más grande quedaba
 * silenciosamente incompleto en el cliente — el caso de /products tras
 * importar 1000 artículos sobre un catálogo que ya tenía productos: la
 * página decía "1000" pero el resto nunca llegó al navegador y el filtro
 * no podía encontrar lo que no recibió.
 */
export const SUPABASE_MAX_ROWS = 1000;

export interface SelectAllPage<Row> {
  data: Row[] | null;
  error: PostgrestError | null;
}

/**
 * Lee TODAS las filas de una consulta en páginas de `SUPABASE_MAX_ROWS`.
 *
 * `buildPage(from, to)` debe construir de cero la MISMA consulta (mismos
 * filtros y mismo orden) con `.range(from, to)` aplicado. El orden tiene
 * que ser determinístico — con una clave única como tiebreak — o las
 * páginas pueden solaparse o dejar filas afuera.
 *
 * Una página corta (menos de `SUPABASE_MAX_ROWS` filas) corta el loop:
 * es la señal de que no queda nada más para leer.
 */
export async function selectAllRows<Row>(
  buildPage: (from: number, to: number) => PromiseLike<SelectAllPage<Row>>
): Promise<{ data: Row[]; error: PostgrestError | null }> {
  const rows: Row[] = [];
  for (let from = 0; ; from += SUPABASE_MAX_ROWS) {
    const page = await buildPage(from, from + SUPABASE_MAX_ROWS - 1);
    if (page.error) return { data: [], error: page.error };
    const chunk = page.data ?? [];
    rows.push(...chunk);
    if (chunk.length < SUPABASE_MAX_ROWS) return { data: rows, error: null };
  }
}
