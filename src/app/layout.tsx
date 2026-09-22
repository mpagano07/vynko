import './globals.css';
import React from 'react';
import { Inter } from 'next/font/google';
import { ThemeInit } from '@/components/ThemeInit';
import { ClientLayoutWrapper } from '@/components/layout/ClientLayoutWrapper';
import { AuthProvider } from '@/lib/contexts/auth-context';
import { TenantHeaderProvider } from '@/components/TenantHeaderProvider';
import { AppProviders } from '@/components/AppProviders';
import type { Metadata, Viewport } from 'next';

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://vynko.dev'),
  title: {
    default: 'Vynko | Gestión de Stock y Ventas',
    template: '%s | Vynko',
  },
  description: 'Plataforma SaaS B2B de gestión de stock en tiempo real, ventas en punto de venta, transferencia multi-sucursal y control comercial para tu negocio.',
  generator: 'Next.js',
  applicationName: 'Vynko',
  referrer: 'origin-when-cross-origin',
  manifest: '/manifest.json',
  icons: {
    icon: '/icons/favicon.png',
    apple: '/icons/icon-512.png',
  },
  openGraph: {
    title: 'Vynko | Gestión de Stock y Ventas',
    description: 'Plataforma SaaS B2B de gestión de stock en tiempo real, ventas en punto de venta y control comercial para tu negocio.',
    url: 'https://vynko.dev',
    siteName: 'Vynko',
    locale: 'es_AR',
    type: 'website',
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: 'Vynko' }],
  },
  twitter: {
    card: 'summary',
    title: 'Vynko | Gestión de Stock y Ventas',
    description: 'Plataforma SaaS B2B de gestión de stock y ventas para negocios.',
    images: ['/icons/icon-512.png'],
  },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: '#3b82f6',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
      </head>
      <body className={`${inter.variable} min-h-screen bg-gray-50 antialiased dark:bg-gray-950 font-sans`}>
        <ThemeInit />
        <AppProviders>
          <AuthProvider>
            <TenantHeaderProvider>
              <ClientLayoutWrapper>
                {children}
              </ClientLayoutWrapper>
            </TenantHeaderProvider>
          </AuthProvider>
        </AppProviders>
      </body>
    </html>
  );
}
