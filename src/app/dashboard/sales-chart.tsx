"use client";

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const PERIODS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '12m', days: 365 },
];

interface ChartRow {
  day: string;
  total: number;
}

export default function SalesChart() {
  const [data, setData] = useState<ChartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDays, setSelectedDays] = useState(7);

  const fetchData = useCallback(async (days: number) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
      const res = await fetch(`/api/sales/summary?days=${days}`, { headers });
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchData(selectedDays).then(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDays, fetchData]);

  const handlePeriodChange = (days: number) => {
    if (days !== selectedDays) setSelectedDays(days);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-gray-900 dark:text-white">Ventas</h2>
        <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          {PERIODS.map((period) => (
            <button
              key={period.days}
              onClick={() => handlePeriodChange(period.days)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                period.days === selectedDays
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
        <div className="h-24 w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={96}>
            <BarChart data={data} margin={{ top: 4, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="#d1d5db" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="#d1d5db" axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Total']}
                contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '11px' }}
              />
              <Bar dataKey="total" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
