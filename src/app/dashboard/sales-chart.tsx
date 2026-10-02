"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { formatARS } from '@/lib/utils/currency';
import { authFetch } from '@/lib/fetchWithTenant';
import { useTheme } from '@/lib/hooks/useTheme';

// Recharts' ResponsiveContainer warns with width/height -1 when it mounts in
// the same frame as its parent is being sized (typical on account remount).
// Mount it only after the container has a real width to keep the console clean.
// Usamos el contentRect del ResizeObserver (asíncrono) en vez de leer
// offsetWidth para no forzar un reflow síncrono en el render.
function ChartFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') {
      setWidth(el.getBoundingClientRect().width);
      return;
    }
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="h-24 w-full overflow-hidden">
      {width > 0 ? children : null}
    </div>
  );
}

const PERIODS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  // 12m agrupa por mes (una barra con la suma completa del mes): comparar 365
  // barras diarias no dice nada.
  { label: '12m', months: 12 },
] as const;

type Period = (typeof PERIODS)[number];

interface ChartRow {
  date: string;
  day: string;
  label?: string;
  partial?: boolean;
  total: number;
}

// Categoria del eje X. Tiene que ser UNICA por fila: recharts construye el
// scaleBand del eje con el dominio deduplicado y despues hace
// `scaleBand.map(valor)` por cada fila (combineTicksOfTooltipAxis). Con valores
// repetidos --"Mar", "Jue", etc. en 7d/30d-- todas las filas con la misma
// etiqueta caen en la MISMA coordenada con indices distintos, y despues
// calculateActiveTickIndex resuelve mal cual barra esta bajo el mouse: el
// tooltip terminaba mostrando otro dia, casi siempre uno sin ventas, o sea
// "Total $ 0,00" sobre una barra de un millon. La clave unica corrige el
// mapeo; la etiqueta linda se recupera con tickFormatter.
const CATEGORY_KEY = 'date';

function formatDayDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
}

export default function SalesChart() {
  const [data, setData] = useState<ChartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Period>(PERIODS[0]);
  const isDark = useTheme();

  const labelByDate = useMemo(
    () => new Map(data.map((row) => [row[CATEGORY_KEY], row.day])),
    [data]
  );

  // Recharts dibuja el tooltip en un div suelto dentro de <body>, fuera de donde
  // las clases `dark:` aplican, asi que hay que darle los colores a mano: con
  // fondo blanco fijo el texto del encabezado queda blanco sobre blanco en
  // modo oscuro.
  const gridStroke = isDark ? '#374151' : '#f3f4f6';
  const tickFill = isDark ? '#9ca3af' : '#6b7280';
  const tooltipBg = isDark ? '#1f2937' : '#ffffff';
  const tooltipBorder = isDark ? '#374151' : '#e5e7eb';
  const tooltipText = isDark ? '#f3f4f6' : '#1f2937';
  const barFill = isDark ? '#818cf8' : '#6366f1';
  const partialBarFill = isDark ? '#4f46e5' : '#a5b4fc';

  const query = 'days' in selected ? `days=${selected.days}` : `months=${selected.months}`;

  const fetchData = useCallback(async (qs: string) => {
    try {
      const res = await authFetch(`/api/sales/summary?${qs}`);
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData(query).then(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, fetchData]);

  const handlePeriodChange = (period: Period) => {
    if (period === selected) return;
    setLoading(true);
    setSelected(period);
  };

  const isMonthly = 'months' in selected;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2
          className="text-sm font-medium text-gray-900 dark:text-white"
          title="Ingresos cobrados por venta. No se descuenta el costo de los productos."
        >
          Ventas
        </h2>
        <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          {PERIODS.map((period) => (
            <button
              key={'days' in period ? `d${period.days}` : `m${period.months}`}
              onClick={() => handlePeriodChange(period)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                period === selected
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {period.label}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="h-24 bg-gray-100 dark:bg-gray-800 animate-pulse rounded" />
      ) : data.every(d => d.total === 0) ? (
        <div className="h-24 flex items-center justify-center text-sm text-gray-400">
          Sin ventas en este período.
        </div>
      ) : (
        <ChartFrame>
          <ResponsiveContainer width="100%" height={96} minWidth={100}>
            <BarChart data={data} margin={{ top: 4, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis
                dataKey={CATEGORY_KEY}
                tickFormatter={(value) => labelByDate.get(String(value)) ?? String(value)}
                tick={{ fontSize: 10, fill: tickFill }}
                stroke={tickFill}
                axisLine={false}
                tickLine={false}
                // Con 12 meses hay que forzar que se vean todas las etiquetas.
                interval={isMonthly ? 0 : 'preserveStartEnd'}
              />
              <YAxis
                tick={{ fontSize: 10, fill: tickFill }}
                stroke={tickFill}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value) => [formatARS(Number(value) || 0), 'Total vendido']}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as ChartRow | undefined;
                  if (!row) return '';
                  const heading = isMonthly
                    ? row.partial
                      ? `${row.label} · mes en curso`
                      : (row.label ?? row.day)
                    // En 7d/30d la etiqueta es el dia de la semana, que se repite:
                    // sumarle la fecha evita que "Mar" sea ambiguo.
                    : `${row.day} ${formatDayDate(row[CATEGORY_KEY])}`;
                  return (
                    <>
                      {/* Ojo: recharts mete el label dentro de un <p>, asi que aqui
                          solo van <span>. Un <div> adentro del <p> es HTML invalido
                          y React lo reporta como error de hidratacion. Para que la
                          aclaracion baje de linea el span lleva display:block. */}
                      <span>{heading}</span>
                      {/* Aclaracion: el total es plata que entro, no utilidad. El costo
                          de los productos nunca se resta --de hecho sale_items ni
                          guarda el costo del momento de la venta-- asi que hay que
                          decirlo para que "Ventas" no se lea como ganancia. */}
                      <span
                        style={{
                          display: 'block',
                          marginTop: 2,
                          fontSize: '10px',
                          fontWeight: 400,
                          color: tickFill,
                          whiteSpace: 'normal',
                          maxWidth: 200,
                        }}
                      >
                        Ingresos cobrados; no se descuenta el costo de los productos.
                      </span>
                    </>
                  );
                }}
                contentStyle={{
                  backgroundColor: tooltipBg,
                  border: `1px solid ${tooltipBorder}`,
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: tooltipText,
                }}
                labelStyle={{ color: tooltipText, fontWeight: 500 }}
                itemStyle={{ color: tooltipText }}
              />
              {/* El mes en curso va en un tono mas claro: esta incompleto y no es
                  comparable contra meses cerrados. */}
              <Bar dataKey="total" radius={[3, 3, 0, 0]} maxBarSize={32} isAnimationActive={false}>
                {data.map((row, i) => (
                  <Cell
                    key={row[CATEGORY_KEY] ?? `${row.day}-${i}`}
                    fill={isMonthly && row.partial ? partialBarFill : barFill}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      )}
    </div>
  );
}
