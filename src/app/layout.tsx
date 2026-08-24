import './globals.css';
import React from 'react';
import { ClientLayoutWrapper } from '@/components/layout/ClientLayoutWrapper';
import { AuthProvider } from '@/lib/contexts/auth-context';
import { TenantHeaderProvider } from '@/components/TenantHeaderProvider';

import type { Metadata, Viewport } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://vynko.app'),
  title: {
    default: 'Vynko | Gestión de Stock y Ventas con IA',
    template: '%s | Vynko',
  },
  description: 'Plataforma SaaS B2B de gestión inteligente de stock, ventas en punto de venta, transferencia multi-sucursal y control comercial para tu negocio.',
  generator: 'Next.js',
  applicationName: 'Vynko',
  referrer: 'origin-when-cross-origin',
  manifest: '/manifest.json',
  icons: {
    icon: '/icons/favicon.png',
    apple: '/icons/icon-512.png',
  },
  openGraph: {
    title: 'Vynko | Gestión de Stock y Ventas con IA',
    description: 'Plataforma SaaS B2B de gestión inteligente de stock, ventas en punto de venta y control comercial para tu negocio.',
    url: 'https://vynko.app',
    siteName: 'Vynko',
    locale: 'es_AR',
    type: 'website',
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: 'Vynko' }],
  },
  twitter: {
    card: 'summary',
    title: 'Vynko | Gestión de Stock y Ventas con IA',
    description: 'Plataforma SaaS B2B de gestión inteligente de stock y ventas para negocios.',
    images: ['/icons/icon-512.png'],
  },
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
      <body className="min-h-screen bg-gray-50 antialiased dark:bg-gray-950 font-sans">
        <AuthProvider>
          <TenantHeaderProvider>
            <ClientLayoutWrapper>
              {children}
            </ClientLayoutWrapper>
          </TenantHeaderProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
