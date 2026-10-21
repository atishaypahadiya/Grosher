import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// `vite preview` over HTTPS for a PWA install / offline check from a phone:
//   mkcert -install && mkcert localhost 192.168.1.20   (once)
//   HTTPS_KEY=localhost+1-key.pem HTTPS_CERT=localhost+1.pem npm run preview -w @grosher/web
const https = process.env.HTTPS_KEY && process.env.HTTPS_CERT ? { key: readFileSync(process.env.HTTPS_KEY), cert: readFileSync(process.env.HTTPS_CERT) } : undefined;

// The build's id: in the console on boot, on the error plate, and in the HTML (index.html's %VITE_BUILD_ID%).
const sha = () => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};
process.env.VITE_BUILD_ID ||= process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) || sha() || String(Date.now());
// /version.json: the commit this build is, for CI's deploy check (.github/workflows/deploy-check.yml waits for the
// live app to report main's commit). Full sha from Pages, else the checkout's; never precached, never cached.
const fullSha = () => {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};
const versionFile = {
  name: "version-json",
  generateBundle(this: { emitFile(f: { type: "asset"; fileName: string; source: string }): void }) {
    const commit = process.env.CF_PAGES_COMMIT_SHA || fullSha();
    const version = { commit, build: process.env.VITE_BUILD_ID, branch: process.env.CF_PAGES_BRANCH ?? null, builtAt: new Date().toISOString() };
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify(version) + "\n" });
  },
};

// The service worker devices installed until 18 Oct 2026 (generateSW: navigations answered cache-first from
// the precache). Only scripts/boot-resilience.mjs builds it, to test that a device on it gets out.
const LEGACY_SW = process.env.GROSHER_LEGACY_SW === "1";
const precache = {
  // Everything the build emits, textures included, is precached on first load.
  // ktx2 + wasm: the hero close-ups' textures and the Basis transcoder (src/hero), so a close-up opens offline in
  // the store; they download in the background after the first visit and reach the GPU only when one opens
  globPatterns: ["**/*.{js,css,html,svg,png,jpg,webp,woff2,ktx2,wasm}"],
  // the project write-up (public/project/) is a separate static page: not precached with the app,
  // and never answered with the app shell
  globIgnores: ["project/**"],
  maximumFileSizeToCacheInBytes: 12 * 1024 * 1024, // the full catalog chunk is ~7 MB
};

export default defineConfig({
  plugins: [
    react(),
    versionFile,
    // the legacy shell had no boot guard either
    LEGACY_SW && { name: "legacy-shell", transformIndexHtml: (html: string) => html.replace(/<!-- boot-guard -->[\s\S]*?<!-- \/boot-guard -->/, "") },
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Grosher",
        short_name: "Grosher",
        description: "Your list, not their layout. The shortest walk through the store.",
        theme_color: "#F2703A",
        background_color: "#FF9E6B",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      ...(LEGACY_SW
        ? { workbox: { ...precache, navigateFallbackDenylist: [/^\/project(\/|$)/], navigateFallback: "index.html", cleanupOutdatedCaches: true } }
        : { strategies: "injectManifest" as const, srcDir: "src", filename: "sw.ts", injectManifest: precache }),
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
