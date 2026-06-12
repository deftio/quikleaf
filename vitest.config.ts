import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "happy-dom",
      setupFiles: ["./src/test-setup.ts"],
      include: ["src/**/*.test.ts"],
      coverage: {
        provider: "v8",
        include: ["src/**/*.ts"],
        exclude: [
          "src/**/*.test.ts",
          "src/test-setup.ts",
          "src/main.ts", // Heavy Tauri side effects at module load
        ],
      },
    },
  })
);
