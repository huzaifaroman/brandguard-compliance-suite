import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "a0cf92cb-e69d-4d20-8b93-949cb308799e-00-2mf0yt7yg0kiu.riker.replit.dev",
    "*.riker.replit.dev",
    "*.replit.dev",
  ],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
      {
        source: "/health",
        destination: "http://localhost:8000/health",
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.blob.core.windows.net",
      },
    ],
  },
};

export default nextConfig;
