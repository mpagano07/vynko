'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from 'recharts';

const chartData = [
  { name: 'Lun', ventas: 4200 },
  { name: 'Mar', ventas: 3800 },
  { name: 'Mié', ventas: 5100 },
  { name: 'Jue', ventas: 4700 },
  { name: 'Vie', ventas: 6300 },
  { name: 'Sáb', ventas: 5500 },
  { name: 'Dom', ventas: 4800 },
];

export default function DashboardPreviewChart() {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={128}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} />
        <YAxis hide />
        <Bar dataKey="ventas" fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}
