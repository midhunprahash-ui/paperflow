import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Retain visited pages in this browser's router cache. Private pages still
  // authorize every server request; mutations explicitly refresh this cache.
  experimental: { staleTimes: { dynamic: 120, static: 120 } },
  output: process.env.RPAPER_CONTAINER_BUILD === "1" ? "standalone" : undefined,
  distDir: process.env.RPAPER_LOCAL_DOCLING === "1" ? ".next-docling" : ".next",
};

export default nextConfig;
