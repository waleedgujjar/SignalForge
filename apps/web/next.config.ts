import type { NextConfig } from 'next';
import bundleAnalyzer from '@next/bundle-analyzer';
// API_URL is set via Vercel env vars — rewrites proxy /api/* to the VPS backend

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
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
