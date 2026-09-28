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

/**
 * La CSP usa un nonce por request (`src/proxy.ts`), y un nonce solo se puede
 * inyectar durante el render. Con pre-render estatico el HTML se genera en
 * build, cuando no existe request ni response: los scripts de RSC quedarían
 * sin nonce y la CSP los bloquearía, dejando la app sin hidratar.
 *
 * `force-dynamic` en el layout raiz se hereda por todos los segmentos, asi que
 * cubre toda la app con una sola linea en vez de editar pagina por pagina.
 *
 * Costo aceptable: el shell de las paginas se genera por request en lugar de
 * servirse desde el build. No agrega consultas a base de datos, porque los
 * datos igual se piden desde el cliente (con RLS) a traves de las API routes.
 */
export const dynamic = 'force-dynamic';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <ThemeInit />
      </head>
      <body className={`${inter.variable} min-h-screen bg-gray-50 antialiased dark:bg-gray-950 font-sans`}>
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
