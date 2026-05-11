import path from "path";
import { fileURLToPath } from "url";
import type { NextConfig } from "next";

const root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Avoid picking a parent lockfile when multiple exist under ~/stripe.
  outputFileTracingRoot: root,
  // Keep native / odd packages external. Bundling gif-encoder-2 breaks its internal `./NNN.js` requires and
  // contributes to flaky dev HMR (missing chunk errors like `Cannot find module './611.js'`).
  serverExternalPackages: ["gif-encoder-2", "sharp"],
  // Ensure Sharp's platform binaries ship with the serverless bundle (fixes intermittent Vercel 500s).
  outputFileTracingIncludes: {
    "/api/render": [
      "./node_modules/sharp/**/*",
      "./node_modules/@img/**/*",
      "./node_modules/gif-encoder-2/**/*",
    ],
  },
};

export default nextConfig;
