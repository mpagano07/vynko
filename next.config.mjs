import bundleAnalyzer from '@next/bundle-analyzer';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.supabase.in' },
      { protocol: 'https', hostname: '*.mercadopago.com' },
      { protocol: 'https', hostname: 'http2.mlstatic.com' },
      { protocol: 'https', hostname: '*.gravatar.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
    localPatterns: [
      {
        pathname: '/icons/**',
        search: '',
      },
      {
        pathname: '/icons/**',
        search: '?v=2',
      },
      {
        pathname: '/icons/**',
        search: '?v=3',
      },
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';

    // La CSP NO va aca: necesita un nonce distinto por request, asi que se
    // arma en `src/proxy.ts` (ver `src/lib/security/csp.ts`). Si se dejara una
    // CSP estatica en este archivo, se pisaria con la del proxy y las paginas
    // quedarian sin nonce en los scripts de RSC.
    return [
      {
        source: '/:path*',
        has: [{ type: 'header', key: 'accept', value: 'text/html' }],
        headers: [
          {
            key: 'Cache-Control',
            value: 'private, no-store',
          },
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          // HSTS sólo en producción: en local sería imposible volver a
          // usar http:// sobre el dominio de desarrollo.
          ...(isProd
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]
            : []),
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=(), browsing-topics=(), payment=(), usb=()',
          },
        ],
      },
    ];
  },
};

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withBundleAnalyzer(nextConfig);
