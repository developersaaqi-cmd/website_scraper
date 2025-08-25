import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  eslint: {
    // ESLint errors ko build ke time ignore kare
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;