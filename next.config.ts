import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let Cloudflare handle transport compression for streamed responses.
  compress: false,
};

initOpenNextCloudflareForDev();

export default nextConfig;
