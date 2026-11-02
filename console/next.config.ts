import type { NextConfig } from 'next';

// Static files only: the VISION app serves them from app://console/ (no server at runtime).
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
};

export default nextConfig;
