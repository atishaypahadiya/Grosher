import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// `vite preview` over HTTPS for a PWA install / offline check from a phone:
//   mkcert -install && mkcert localhost 192.168.1.20   (once)
//   HTTPS_KEY=localhost+1-key.pem HTTPS_CERT=localhost+1.pem npm run preview -w @grosher/web
const https = process.env.HTTPS_KEY && process.env.HTTPS_CERT ? { key: readFileSync(process.env.HTTPS_KEY), cert: readFileSync(process.env.HTTPS_CERT) } : undefined;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Grosher",
        short_name: "Grosher",
        description: "Your list, not their layout. The shortest walk through the store.",
        theme_color: "#F9D7A8",
        background_color: "#184D2E",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Everything the build emits, textures included, is precached on first load.
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,webp,woff2}"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024, // the full catalog chunk is ~7 MB
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  preview: { host: true, https },
  server: {
    host: true,
    // dev: the resolver worker runs under `wrangler dev` on 8787; the app calls /api/resolve
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  test: {
    environment: "jsdom",
    // the full catalog is a 7 MB chunk and its index takes a second to build: give the app tests room
    testTimeout: 20_000,
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
  },
});
