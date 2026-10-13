import './globals.css';
import React from 'react';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import { ThemeInit } from '@/components/ThemeInit';
import { ClientLayoutWrapper } from '@/components/layout/ClientLayoutWrapper';
import { AuthProvider } from '@/lib/contexts/auth-context';
import { NoTenantAccessGuard } from '@/components/auth/no-tenant-access-guard';
import { TenantHeaderProvider } from '@/components/TenantHeaderProvider';
import { AppProviders } from '@/components/AppProviders';
import { AppReturnTracker } from '@/components/analytics/app-return-tracker';
import { buildSiteStructuredData, serializeJsonLd } from '@/lib/marketing/structured-data';
import type { Metadata, Viewport } from 'next';

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans',
  display: 'swap',
});

const BASE_METADATA: Metadata = {
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
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vynko | Gestión de Stock y Ventas',
    description: 'Plataforma SaaS B2B de gestión de stock y ventas para negocios.',
  },
};

/**
 * Canonical por pagina calculado desde la ruta normalizada que deja el proxy en
 * `x-pathname`. Asi la home, las legales y login/signup (que son Client
 * Components y no pueden exportar `metadata`) tambien declaran su canonical, sin
 * repetir el dato en cada archivo. Las landings lo override con el suyo (mismo
 * valor). Se usa ruta relativa: Next la resuelve contra `metadataBase`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const pathname = (await headers()).get('x-pathname') ?? '/';
  return { ...BASE_METADATA, alternates: { canonical: pathname } };
}

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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Nonce por request para firmar el JSON-LD. Sin nonce, `strict-dynamic` en
  // produccion bloquea el `<script type="application/ld+json">` y el schema
  // nunca llega al navegador.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const structuredData = serializeJsonLd(buildSiteStructuredData());

  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <ThemeInit />
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: structuredData }}
        />
      </head>
      <body className={`${inter.variable} min-h-screen bg-gray-50 antialiased dark:bg-gray-950 font-sans`}>
        <AppProviders>
          <AuthProvider>
            <NoTenantAccessGuard />
            <AppReturnTracker />
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
