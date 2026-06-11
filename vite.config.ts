import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  resolve: {
    alias: {
      "quikdown-standalone": path.resolve(
        __dirname,
        "node_modules/quikdown/dist/quikdown_edit_standalone.esm.js"
      ),
    },
  },
  build: {
    target: "es2021",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          quikdown: ["quikdown-standalone"],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ["quikdown-standalone"],
  },
});
