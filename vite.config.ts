import { defineConfig, Plugin } from "vite";
import path from "path";
import fs from "fs";

const QUIKDOWN_DIST = path.resolve(__dirname, "node_modules/quikdown/dist");
const PKG_VERSION: string = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8")).version;
/** Installed version of a dependency, for the About dialog. */
function depVersion(name: string): string {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, "node_modules", name, "package.json"), "utf8")).version;
}

// quikdown's standalone bundle lazily fetches its offline Natural Earth basemap
// from `new URL('./', import.meta.url)` — i.e. the directory the chunk ships in.
// Rollup emits that chunk into `assets/`, so the topojson has to land there too
// or geojson map fences silently fall back to no basemap.
const BASEMAP_FILES = [
  "basemap_countries_110m.topojson",
  "basemap_admin1_lines.topojson",
];

function quikdownBasemap(): Plugin {
  return {
    name: "quikleaf-quikdown-basemap",
    generateBundle() {
      for (const name of BASEMAP_FILES) {
        const src = path.join(QUIKDOWN_DIST, name);
        if (!fs.existsSync(src)) {
          this.warn(`quikdown basemap asset missing: ${name}`);
          continue;
        }
        this.emitFile({
          type: "asset",
          fileName: `assets/${name}`,
          source: fs.readFileSync(src),
        });
      }
    },
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [quikdownBasemap()],
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  // Surfaced to the About dialog as __APP_VERSION__ etc. (see src/vite-env.d.ts)
  define: {
    __APP_VERSION__: JSON.stringify(PKG_VERSION),
    __QUIKDOWN_VERSION__: JSON.stringify(depVersion("quikdown")),
    __BITWRENCH_VERSION__: JSON.stringify(depVersion("bitwrench")),
    __TAURI_API_VERSION__: JSON.stringify(depVersion("@tauri-apps/api")),
  },
  resolve: {
    alias: {
      "quikdown-standalone": path.resolve(
        QUIKDOWN_DIST,
        "quikdown_edit_standalone.esm.js"
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
