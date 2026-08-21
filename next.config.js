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
    const isDev = process.env.NODE_ENV !== 'production';
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data: https://*.supabase.co https://*.supabase.in https://*.mercadopago.com https://http2.mlstatic.com https://*.gravatar.com https://images.unsplash.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-src https://*.mercadopago.com",
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      'upgrade-insecure-requests',
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=(), browsing-topics=()',
          },
          ...(isDev
            ? []
            : [
                {
                  key: 'Content-Security-Policy',
                  value: csp,
                },
              ]),
        ],
      },
    ];
  },
};

module.exports = nextConfig;