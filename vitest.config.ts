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
        exclude: ["src/**/*.test.ts", "src/test-setup.ts", "src/vite-env.d.ts"],
        // Release gate (tools/release.sh runs `npm run test:coverage`).
        // Lines/statements/functions must stay at or above 90%; branches 85%.
        thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
      },
    },
  })
);
