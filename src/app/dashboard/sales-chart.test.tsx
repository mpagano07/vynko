import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { authFetch } from '@/lib/fetchWithTenant';
import SalesChart from './sales-chart';

vi.mock('@/lib/fetchWithTenant', () => ({
  authFetch: vi.fn(),
}));

const { xAxisProps, tooltipProps } = vi.hoisted(() => ({
  xAxisProps: [] as Record<string, unknown>[],
  tooltipProps: [] as Record<string, unknown>[],
}));

// Se espía el XAxis pero se renderiza el real: así el mecanismo del tooltip
// sigue siendo el de recharts y a la vez podemos afirmar la categoria que usa.
// El ResponsiveContainer tambien se envuelve porque en jsdom mide 0px y nunca
// monta los hijos; se le pasan width/height explícitos al BarChart real.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('recharts');
  const React = (await import('react')).default;
  return {
    ...actual,
    ResponsiveContainer: ({ children, height }: { children?: React.ReactNode; height?: number }) =>
      React.createElement(
        'div',
        null,
        React.cloneElement(children as React.ReactElement<Record<string, unknown>>, { width: 600, height })
      ),
    XAxis: (props: Record<string, unknown>) => {
      xAxisProps.push(props);
      const Real = actual.XAxis as React.ComponentType<Record<string, unknown>>;
      return React.createElement(Real, props);
    },
    Tooltip: (props: Record<string, unknown>) => {
      tooltipProps.push(props);
      const Real = actual.Tooltip as React.ComponentType<Record<string, unknown>>;
      return React.createElement(Real, props);
    },
  };
});

function okWith(rows: Record<string, unknown>[]) {
  return { ok: true, json: async () => rows } as Response;
}

function lastQuery(): string {
  const calls = vi.mocked(authFetch).mock.calls;
  return String(calls[calls.length - 1][0]);
}

// `ChartFrame` (sales-chart.tsx) solo monta sus hijos cuando el contenedor mide
// mas de 0, y para enterarse se sirve del ResizeObserver. jsdom no lo implementa,
// y su `getBoundingClientRect()` siempre devuelve 0, asi que sin este stub el
// grafico no se monta nunca. Antes solo lo stubbeaba el test del dataKey, y el
// test del tooltip se arreglaba leyendo los Tooltip que ese test habia dejado
// en el array: por eso pasaba (o fallaba) segun el orden de los renders.
class FakeResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    cb([{ contentRect: { width: 600, height: 96 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('SalesChart', () => {
  beforeEach(() => {
    // `xAxisProps` y `tooltipProps` son append-only a proposito: el mock los
    // empuja en cada render para poder afirmar sobre el props real de recharts.
    // Sin limpiarlos, un test hereda los renders del anterior y leer el "ultimo"
    // deja de significar "el de mi render".
    xAxisProps.length = 0;
    tooltipProps.length = 0;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.mocked(authFetch).mockReset();
    vi.mocked(authFetch).mockResolvedValue(okWith([{ date: '2026-10-01', day: 'Oct', total: 100 }]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('expone solo 7d, 30d y 12m', () => {
    render(<SalesChart />);
    expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30d' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '12m' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '90d' })).toBeNull();
  });

  it('arranca pidiendo los ultimos 7 dias', async () => {
    render(<SalesChart />);
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    expect(lastQuery()).toBe('/api/sales/summary?days=7');
  });

  it('pide por dia en 30d', async () => {
    render(<SalesChart />);
    fireEvent.click(screen.getByRole('button', { name: '30d' }));
    await waitFor(() => expect(lastQuery()).toBe('/api/sales/summary?days=30'));
  });

  it('pide por mes en 12m', async () => {
    render(<SalesChart />);
    fireEvent.click(screen.getByRole('button', { name: '12m' }));
    await waitFor(() => expect(lastQuery()).toBe('/api/sales/summary?months=12'));
  });

  it('no vuelve a pedir datos al pulsar el periodo ya seleccionado', async () => {
    render(<SalesChart />);
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it('usa la clave unica como categoria del eje X en 7d, 30d y 12m', async () => {
    const { unmount } = render(<SalesChart />);
    for (const label of ['7d', '30d', '12m']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      await waitFor(() => expect(xAxisProps.length).toBeGreaterThan(0));
      const last = xAxisProps[xAxisProps.length - 1];
      expect(last.dataKey).toBe('date');
      expect(typeof last.tickFormatter).toBe('function');
    }
    unmount();
  });

  it('aclara en el tooltip que el total es venta y no utilidad', async () => {
    render(<SalesChart />);
    // Hay que esperar al Tooltip, no al boton de periodo: los botones se renderizan
    // siempre, tambien mientras `loading` es true y el grafico es un skeleton sin
    // Tooltip. Esperando el boton, el filtro de abajo corria antes del primer
    // render del grafico y solo encontraba los props que habia dejado el test
    // anterior.
    await waitFor(() =>
      expect(tooltipProps.some((p) => typeof p.labelFormatter === 'function')).toBe(true)
    );
    // El unico Tooltip con labelFormatter propio es el del componente: el
    // harness de la regresion de abajo usa uno propio.
    const withLabel = tooltipProps.filter((p) => typeof p.labelFormatter === 'function');
    const tooltip = withLabel[withLabel.length - 1];
    expect(tooltip).toBeDefined();

    const formatted = (tooltip.formatter as (v: unknown) => [string, string])(1234.56);
    expect(formatted[1]).toBe('Total vendido');
    expect(formatted[0]).toContain('1.234');

    // labelFormatter devuelve un ReactNode: se renderiza para assertar el texto
    // que el usuario ve de verdad.
    const node = (
      tooltip.labelFormatter as (l: unknown, p: unknown) => React.ReactNode
    )('', [{ payload: { date: '2026-10-01', day: 'Jue', total: 100 } }]);
    // Se renderiza dentro de un <p> porque es exactamente donde recharts lo
    // monta: un <div> adentro dispara el error de hidratacion de React.
    const { container } = render(<p>{node}</p>);
    expect(container.querySelector('p div')).toBeNull();
    expect(container.textContent).toContain('Jue 1/10');
    expect(container.textContent).toContain(
      'Ingresos cobrados; no se descuenta el costo de los productos.'
    );

    expect(screen.getByRole('heading', { name: 'Ventas' })).toHaveAttribute(
      'title',
      'Ingresos cobrados por venta. No se descuenta el costo de los productos.'
    );
  });

  it('muestra el estado vacio cuando el periodo no tiene ventas', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      okWith(Array.from({ length: 12 }, (_, i) => ({ date: `2026-0${i + 1}-01`, day: 'Ene', total: 0 })))
    );
    render(<SalesChart />);
    fireEvent.click(screen.getByRole('button', { name: '12m' }));
    expect(await screen.findByText('Sin ventas en este período.')).toBeInTheDocument();
  });
});

/**
 * Regresion: el eje categorico de recharts deduplica su dominio y despues
 * resuelve cada fila con `scaleBand.map(valor)`. Con la etiqueta como categoria
 * ("Mar", "Jue", ... repetidos en 7d/30d) todas las filas con la misma etiqueta
 * comparten coordenada con indices distintos, y el tooltip termina mostrando
 * otro dia --casi siempre uno sin ventas, o sea "Total $ 0,00"--> mientras la
 * barra dibujada es la de un millón.
 *
 * Estos tests fijan el mecanismo con el dataset real de 30 dias: sin el
 * dataKey único fallan, y con el dataKey único pasan indice por indice.
 */
describe('mapeo categoria -> tooltip', () => {
  const WEEKS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const TOTALS = [
    0, 0, 1568.60, 15336.75, 0, 0, 0, 912711.49, 0, 0, 105351.90, 0,
    0, 0, 0, 0, 0, 0, 670508.65, 0,
  ];
  const rows = TOTALS.map((total, i) => {
    const d = new Date(Date.UTC(2026, 8, 25 + i));
    return {
      date: d.toISOString().slice(0, 10),
      day: WEEKS[d.getUTCDay()],
      total,
    };
  });

  async function tooltipAt(dataKey: 'date' | 'day', index: number): Promise<string> {
    const captured: unknown[] = [];
    const { unmount } = render(
      <ResponsiveContainer width={600} height={96}>
        <BarChart data={rows}>
          <XAxis dataKey={dataKey} />
          <YAxis />
          <Tooltip
            defaultIndex={index}
            formatter={(v: unknown) => {
              captured.push(v);
              return [String(v), 'Total'];
            }}
          />
          <Bar dataKey="total" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    );
    // Hay que esperar a que recharts llame al formatter. Antes se hacia
    // unmount() en el mismo tick y se leia captured[0]: si el tooltip todavia no
    // se habia pintado, captured venia vacio y la funcion devolvia 'sin tooltip'.
    // En aislamiento nunca pasaba; con los 89 archivos corriendo en paralelo
    // recharts no llegaba a renderizar a tiempo y el test fallaba.
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    const primero = captured[0];
    unmount();
    return String(primero ?? 'sin tooltip');
  }

  it('con la etiqueta repetida como categoria el tooltip se equivoca', async () => {
    // Documenta el bug: el indice 7 vale $912.711,49 pero el tooltip responde $0.
    expect(await tooltipAt('day', 7)).not.toBe(String(TOTALS[7]));
    expect(await tooltipAt('day', 18)).not.toBe(String(TOTALS[18]));
  });

  it('con la clave unica cada indice devuelve su propio valor', async () => {
    for (const [index, total] of TOTALS.entries()) {
      expect(await tooltipAt('date', index)).toBe(String(total));
    }
  });
});