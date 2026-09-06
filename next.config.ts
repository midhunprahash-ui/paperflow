import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.RPAPER_LOCAL_DOCLING === "1" ? ".next-docling" : ".next",
};

export default nextConfig;
