import React from 'react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="relative inline-block">
          <span className="text-8xl font-extrabold bg-gradient-to-r from-blue-500 via-cyan-400 to-indigo-500 bg-clip-text text-transparent">
            404
          </span>
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-24 h-1 bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full blur-sm" />
        </div>

        <h1 className="text-2xl font-bold text-gray-100">
          Página no encontrada
        </h1>

        <p className="text-gray-400 text-sm leading-relaxed">
          La página o recurso que buscas no existe o ha sido movido. Verifica la URL o regresa al panel principal.
        </p>

        <div className="pt-4">
          <Link
            href="/dashboard"
            className="inline-flex px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-all shadow-lg shadow-blue-500/20"
          >
            Volver al Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
