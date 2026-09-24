import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // Netlify sets NETLIFY=true during its builds; bake the storage choice into the server bundle.
  env: { STORAGE_DRIVER: process.env.NETLIFY === "true" ? "netlify-blobs" : process.env.STORAGE_DRIVER || "file" },
};

export default nextConfig;
