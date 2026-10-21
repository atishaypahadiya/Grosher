// The project page's "Try it" demo (src/project-demo/demo.ts) as its own small bundle in dist/project/demo/,
// beside the app's build: the page imports /project/demo/demo.js on the first interaction with the block. The
// service worker neither precaches nor shells /project/, so none of this reaches the app's precache.
import { defineConfig } from "vite";

export default defineConfig({
  base: "/project/demo/",
  publicDir: false,
  build: {
    outDir: "dist/project/demo",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: "src/project-demo/demo.ts",
      preserveEntrySignatures: "exports-only",
      output: { entryFileNames: "demo.js", chunkFileNames: "chunks/[name]-[hash].js", assetFileNames: "assets/[name]-[hash][extname]", format: "es" },
    },
  },
  worker: { format: "es" },
});
