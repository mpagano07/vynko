import './globals.css';
import React from 'react';
import { Sidebar } from '@/components/ui/sidebar';
import { Header } from '@/components/ui/header';

import { Toaster } from 'react-hot-toast';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'StockPilot',
  description: 'Plataforma SaaS B2B de gestión de stock y ventas con IA',
  generator: 'Next.js',
  applicationName: 'StockPilot',
  referrer: 'origin-when-cross-origin',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: '#3b82f6',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head />
      <body className="min-h-screen bg-gray-50 antialiased dark:bg-gray-950 flex flex-col md:flex-row font-sans">
        <Toaster position="top-right" />
        <React.Suspense fallback={<div />}> 
          <Sidebar />
        </React.Suspense>
        <div className="flex flex-col flex-1 w-full">
          <React.Suspense fallback={<div />}>
            <Header />
          </React.Suspense>
          <main className="flex-1 w-full overflow-auto">
            <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
