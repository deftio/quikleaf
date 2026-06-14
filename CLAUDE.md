# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

quikleaf is a standalone, cross-platform local markdown editor built on **Tauri v2** (Rust backend + webview frontend) with **quikdown** as the rendering engine. It provides rich markdown editing with live preview, LLM chat integration with tool calling, and project/folder awareness.

The full specification is in `dev/quikleaf-spec.md`.

## Architecture

- **`src-tauri/`** — Rust backend (Tauri v2). Handles file I/O, CLI arg parsing, LLM API proxying, and plugin initialization. Commands are in `src-tauri/src/commands/`.
- **`src/`** — TypeScript frontend built with Vite. Runs in Tauri's webview.
  - `src/editor/` — quikdown_edit_standalone integration
  - `src/chat/` — LLM chat panel UI (`chat-ui.ts`), provider adapters (`providers.ts`), and tool-calling loop
  - `src/settings/` — LLM provider configuration (host, API key, model)
  - `src/project/` — File tree and project mode (Phase 4)
- **`index.html`** — Main window entry point

### Key Dependencies

- **quikdown** (npm: `quikdown@1.2.17`) — Standalone editor with all fence libraries bundled (~7.7 MB). Supports: syntax highlighting, mermaid, math/LaTeX, geojson maps, STL 3D, CSV/PSV/TSV, SVG, ABC music notation, Vega/Vega-Lite charts, sanitized HTML. Imported via Vite alias `quikdown-standalone` (see `vite.config.ts`).
- **Tauri v2 plugins**: `tauri-plugin-dialog` (file open/save dialogs), `tauri-plugin-fs` (filesystem access)
- **reqwest** (Rust) — HTTP client for proxying LLM API calls through the backend
- **@tauri-apps/api** — JS-side IPC to invoke Rust commands

### Data Flow

The LLM operates on raw markdown only — it never sees or produces HTML. The user sees rendered preview via quikdown. Both user and LLM can edit the markdown source. The LLM uses a tool-calling loop: message → LLM → tool_calls → dispatch via Tauri IPC → tool results → loop until done.

LLM API calls are proxied through the Rust backend (`commands/llm.rs`) to avoid CORS issues and keep API keys out of the webview.

## Build & Dev Commands

```bash
npm install                 # Install frontend deps (includes quikdown)
npm run dev                 # Start Vite dev server (frontend only, port 1420)
npx tauri dev               # Full dev mode: Vite + Rust rebuild + native window
npx tauri build             # Production build (platform-specific installer)
cargo check                 # Check Rust compilation (from src-tauri/)
cargo build                 # Build Rust backend (from src-tauri/)
npx vite build              # Build frontend only (output to dist/)
npx tsc                     # TypeScript type checking
```

Note: first `cargo build` or `tauri dev` compiles all Rust dependencies (~2 min). Subsequent builds are incremental (~8 sec).

## Rust Backend Conventions

- Commands live in `src-tauri/src/commands/` as separate modules (fs.rs, llm.rs, etc.)
- Each command module is registered in `commands/mod.rs`
- Commands are registered in both `main.rs` (binary) and `lib.rs` (library)
- Tauri v2 uses a plugin system for dialogs/fs — not built-in APIs. Plugins are initialized in the builder chain and permissions are declared in `src-tauri/capabilities/default.json`
- CLI file argument is parsed from `std::env::args()` in main.rs and shared to the webview via managed state
- LLM API calls go through `llm_chat` command in `commands/llm.rs`, supporting both OpenAI-compatible and Anthropic formats

## Frontend Conventions

- quikdown editor is initialized via `initEditor(container)` in `src/editor/editor.ts`
- The standalone bundle is imported via Vite alias `quikdown-standalone` → `node_modules/quikdown/dist/quikdown_edit_standalone.esm.js`
- File open/save uses `@tauri-apps/plugin-dialog` (JS) + `@tauri-apps/plugin-fs` (JS), not custom Rust commands for dialogs
- Custom Rust commands (`invoke("cmd_name", {params})`) are used for things that need backend processing (e.g., `llm_chat`, `get_cli_file`)
- The quikdown standalone bundle uses eval internally (Mermaid) — the Vite build warning is expected and harmless
- `allowExternalFetch: true` is set on the editor so map tiles load from OSM and Vega specs can use external data URLs

## Testing

```bash
npm test                    # Unit tests (vitest)
npm run test:e2e            # E2E tests (Playwright)
npm run test:all            # Both unit + E2E
npm run test:coverage       # Unit tests with coverage
```

## Release Workflow

Versioned releases are authored only by the maintainer. Claude Code should never run `npm run release` or `npm run feature` autonomously.

The version is tracked in three files that must stay in sync: `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`. The `feature` script handles this automatically.

```bash
# 1. Start a feature branch (from main) — auto-bumps version in all 3 files
npm run feature -- "short-description"            # patch bump (default)
npm run feature -- "short-description" minor       # minor bump
npm run feature -- "short-description" major       # major bump

# 2. Work on the feature branch, commit changes

# 3. Release: runs all tests, creates PR with squash auto-merge
npm run release                                    # full test suite
npm run release:no-playwright                      # skip E2E tests

# 4. After PR merges, tag and push to trigger release workflow
git checkout main && git pull
git tag v<VERSION> && git push origin v<VERSION>
```

The release workflow (`.github/workflows/release.yml`) triggers on tag push and builds platform binaries, creates a GitHub Release, and publishes npm packages.

## Updating quikdown

```bash
npm update quikdown
```

## Project Phases (from spec)

1. **Phase 1** — Core editor: Tauri shell, quikdown editor, file open/save, CLI args
2. **Phase 2 (current)** — Chat panel + LLM integration: tool-calling loop, provider adapters, document tools
3. **Phase 3** — Memory/KV/screenshots: scratchpad, key-value store with timestamps, viewport capture
4. **Phase 4** — Project mode: folder opening, file tree, quikleaf.prj persistence
