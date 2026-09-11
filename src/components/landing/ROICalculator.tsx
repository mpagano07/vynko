'use client';

import { useState, useMemo } from 'react';
import { Calculator, Clock, AlertTriangle, TrendingUp } from 'lucide-react';

export default function ROICalculator() {
  const [products, setProducts] = useState(200);
  const [salesPerDay, setSalesPerDay] = useState(30);
  const [hoursPerDay, setHoursPerDay] = useState(2);

  const results = useMemo(() => {
    const monthlyHours = hoursPerDay * 26;
    const laborSavings = monthlyHours * 2500;
    const monthlyLostFromStockouts = Math.round(products * 0.03 * 2500 * (salesPerDay / 30));
    const monthlySaved = laborSavings + monthlyLostFromStockouts;
    const annualSaved = monthlySaved * 12;
    return { monthlyHours, monthlyLostFromStockouts, monthlySaved, annualSaved };
  }, [products, salesPerDay, hoursPerDay]);

  return (
    <div className="bg-gray-900/80 backdrop-blur-xl border border-gray-800 rounded-2xl p-8 shadow-2xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
          <Calculator className="h-5 w-5 text-cyan-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Calculá tu ahorro</h3>
          <p className="text-xs text-gray-500">Estimá cuánto podés ganar con Vynko</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Productos en catálogo</label>
          <input
            type="number"
            value={products}
            onChange={(e) => setProducts(Math.max(1, Number(e.target.value)))}
            className="w-full px-3 py-2.5 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500/50 tabular-nums"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Ventas por día</label>
          <input
            type="number"
            value={salesPerDay}
            onChange={(e) => setSalesPerDay(Math.max(0, Number(e.target.value)))}
            className="w-full px-3 py-2.5 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500/50 tabular-nums"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Horas/día en control de stock</label>
          <input
            type="number"
            step="0.5"
            value={hoursPerDay}
            onChange={(e) => setHoursPerDay(Math.max(0, Number(e.target.value)))}
            className="w-full px-3 py-2.5 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500/50 tabular-nums"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-950/60 border border-gray-800/50 rounded-xl p-4 text-center">
          <Clock className="h-5 w-5 text-cyan-400 mx-auto mb-2" />
          <p className="text-2xl font-extrabold text-cyan-400">{results.monthlyHours}h</p>
          <p className="text-[11px] text-gray-500 mt-1">Ahorrás al mes</p>
        </div>
        <div className="bg-gray-950/60 border border-gray-800/50 rounded-xl p-4 text-center">
          <AlertTriangle className="h-5 w-5 text-amber-400 mx-auto mb-2" />
          <p className="text-2xl font-extrabold text-amber-400">${results.monthlyLostFromStockouts.toLocaleString('es-AR')}</p>
          <p className="text-[11px] text-gray-500 mt-1">Pérdidas por quiebres/mes</p>
        </div>
        <div className="bg-gray-950/60 border border-gray-800/50 rounded-xl p-4 text-center">
          <TrendingUp className="h-5 w-5 text-green-400 mx-auto mb-2" />
          <p className="text-2xl font-extrabold text-green-400">${results.monthlySaved.toLocaleString('es-AR')}</p>
          <p className="text-[11px] text-gray-500 mt-1">Ahorro mensual total</p>
        </div>
        <div className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-xl p-4 text-center">
          <TrendingUp className="h-5 w-5 text-cyan-300 mx-auto mb-2" />
          <p className="text-2xl font-extrabold text-white">${results.annualSaved.toLocaleString('es-AR')}</p>
          <p className="text-[11px] text-gray-400 mt-1">Proyección anual</p>
        </div>
      </div>
    </div>
  );
}
