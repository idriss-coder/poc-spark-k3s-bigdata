import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Allow large binary chunks through API routes used as upload proxy
    serverActions: {
      bodySizeLimit: "55mb",
    },
  },
};

export default nextConfig;
