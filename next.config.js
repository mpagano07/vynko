/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  // output: 'standalone',
  turbopack: {
    // Disable prerendering of error pages in Turbopack
  },
};

module.exports = nextConfig;

// module.exports = nextConfig;