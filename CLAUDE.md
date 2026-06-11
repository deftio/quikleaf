# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

qdedit is a standalone, cross-platform local markdown editor built on **Tauri v2** (Rust backend + webview frontend) with **quikdown** as the rendering engine. It provides rich markdown editing with live preview, LLM chat integration with tool calling, and project/folder awareness.

The full specification is in `dev/qdedit-spec.md`.

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

## Updating quikdown

```bash
npm update quikdown
```

## Project Phases (from spec)

1. **Phase 1** — Core editor: Tauri shell, quikdown editor, file open/save, CLI args
2. **Phase 2 (current)** — Chat panel + LLM integration: tool-calling loop, provider adapters, document tools
3. **Phase 3** — Memory/KV/screenshots: scratchpad, key-value store with timestamps, viewport capture
4. **Phase 4** — Project mode: folder opening, file tree, qdedit.prj persistence
