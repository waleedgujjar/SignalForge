import type { NextConfig } from 'next';
import bundleAnalyzer from '@next/bundle-analyzer';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: [],
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
