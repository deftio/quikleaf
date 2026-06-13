import { defineConfig, mergeConfig } from "vite";
import path from "path";
import baseConfig from "./vite.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    server: {
      port: 1421,
      strictPort: true,
    },
    resolve: {
      alias: {
        "@tauri-apps/api/core": path.resolve(__dirname, "e2e/mocks/tauri-core.ts"),
        "@tauri-apps/api/event": path.resolve(__dirname, "e2e/mocks/tauri-event.ts"),
        "@tauri-apps/plugin-dialog": path.resolve(__dirname, "e2e/mocks/tauri-dialog.ts"),
        "@tauri-apps/plugin-fs": path.resolve(__dirname, "e2e/mocks/tauri-fs.ts"),
        "@tauri-apps/plugin-shell": path.resolve(__dirname, "e2e/mocks/tauri-shell.ts"),
      },
    },
  })
);
