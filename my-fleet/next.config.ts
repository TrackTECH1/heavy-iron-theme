import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "www.mwedealers.com" },
      { protocol: "https", hostname: "newrubbertrack.com" },
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "tcykyktvdlsbscrsbjyt.supabase.co" },
      { protocol: "https", hostname: "zhdqdxtwipcowbtdyviq.supabase.co" },
    ],
  },
};

export default nextConfig;
