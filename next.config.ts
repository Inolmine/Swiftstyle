import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  // Les fichiers de MediaPipe (scripts/prepare-mediapipe.mjs) sont lus en CORS, aussi depuis les sites des marques (widget).
  // Sur Cloudflare, les fichiers statiques ne passent pas par Next : public/_headers donne les mêmes en-têtes.
  async headers() {
    return [
      {
        source: "/mediapipe/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default config;
