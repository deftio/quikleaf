# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

quikleaf is a standalone, cross-platform local markdown editor built on **Tauri v2** (Rust backend + webview frontend) with **quikdown** as the rendering engine and **bitwrench.js** for the UI shell (the maintainer dogfoods bitwrench here — keep UI work in bitwrench idiom). It provides rich markdown editing with live preview, LLM chat integration with tool calling, and project/folder awareness.

The full specification is in `dev/quikleaf-spec.md`.

## Architecture

- **`src-tauri/`** — Rust backend (Tauri v2). Handles file I/O, CLI arg parsing, LLM API proxying, the performance log and CLI shim (`commands/diag.rs`), and plugin initialization. Commands are in `src-tauri/src/commands/`.
- **`src/`** — TypeScript frontend built with Vite. Runs in Tauri's webview.
  - `src/diag/perf.ts` — timing math + `logEvent()` (JSON lines via `log_append`; off when Settings → perfLog is false)
  - `src/ui/` — bitwrench shell: `theme.ts` (two `bw.loadStyles()` themes + app CSS via `bw.css()`), `shell.ts` (title bar, menus, status bar TACO), `about.ts`, `taco.ts` (helpers: `withAttrs`, typed `makeModal`)
  - `src/editor/` — quikdown_edit_standalone integration (`editor.ts`), the pure tab model (`tabs.ts`, notifies via `bw.pub("tabs:changed")`) and the session controller that binds tabs to the single editor instance, file I/O and shortcuts (`documents.ts`). Open/save/new/close go through `documents.ts`, never the editor directly.
  - `src/chat/` — chat panel TACO + tool-calling loop (`chat-ui.ts`), provider adapters (`providers.ts`), tool schemas + system prompt (`chat-utils.ts`), line diff (`diff.ts`), review cards with Accept/Reject (`review.ts`), plan card (`plan.ts`), heading parser (`outline.ts`). Adding a tool: schema in `chat-utils.ts` (OpenAI shape, Anthropic is mapped), dispatch in `chat-ui.ts` `dispatchTool`, update the tool-count assertions in `chat-utils.test.ts`, the `/tools` text, and docs.
  - `src/settings/` — LLM settings dialog (bitwrench modal + form) and localStorage persistence
  - `src/project/` — File tree sidebar and project mode
- **`index.html`** — Empty `<div id="app">`; `src/main.ts` mounts everything with `bw.mount()`

### Key Dependencies

- **quikdown** (npm: `quikdown@1.2.21`) — Standalone editor with all fence libraries bundled (~8.4 MB). Supports: syntax highlighting, mermaid, math/LaTeX, geojson maps, STL 3D, CSV/PSV/TSV, SVG, ABC music notation, Vega/Vega-Lite charts, sanitized HTML. Imported via Vite alias `quikdown-standalone` (see `vite.config.ts`). The standalone bundle fetches its offline Natural Earth basemap (`basemap_*.topojson`) from its own directory at runtime, so `vite.config.ts` copies those files into `dist/assets/` alongside the chunk.
- **bitwrench** (npm: `bitwrench@^2.1.11`) — UI library: TACO objects → DOM, `make*()` components, palette-based theming. Known 2.1.11 gaps we work around: `bw.append()` needs an element (not a bare id), factories take no `id` (use `withAttrs()`), `ModalConfig`/`InputConfig` types lag the implementation (see `src/ui/taco.ts`).
- **Tauri v2 plugins**: `tauri-plugin-dialog` (file open/save dialogs), `tauri-plugin-fs` (filesystem access), `tauri-plugin-shell` (open links in the system browser)
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
- Performance log: `commands/diag.rs` appends JSON lines to `app_log_dir()/quikleaf-perf.jsonl`; the frontend decides whether to log. `cli_install` writes a `#!/bin/sh exec <binary>` shim to the first writable of `/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin`.
- Tauri v2 uses a plugin system for dialogs/fs — not built-in APIs. Plugins are initialized in the builder chain and permissions are declared in `src-tauri/capabilities/default.json`
- CLI file argument is parsed from `std::env::args()` in main.rs and shared to the webview via managed state
- LLM API calls go through `llm_chat` command in `commands/llm.rs`, supporting both OpenAI-compatible and Anthropic formats
- `project_search` in `commands/project.rs` walks the project root (skips `.git`, `node_modules`, `target`, `dist`, dotdirs, > 2 MB, non-UTF-8); uses the `regex` crate
- The native Window menu deliberately has no `close_window` item: its Cmd+W would race the webview's Close Tab shortcut

## Frontend Conventions

- UI is bitwrench TACO, not HTML strings: handlers go in `a:`, state changes use `bw.toggleClass`/`bw.patch`/`bw.clear`, never `innerHTML`. Ids that tests rely on (`#chat-send`, `#settings-overlay`, …) are merged onto factory output with `withAttrs()`.
- Styles live in `src/ui/theme.ts` as `bw.css()` rules over CSS custom properties; the dark theme is `bw.loadStyles(cfg, ".dark")` and `setDarkMode()` toggles `.dark` on `#app`.
- Modals are `bw.makeModal()`; open/close through the element handle (`modalHandle(el).open()`), and tests assert the `bw_bccl_modal_show` class.
- Keyboard shortcuts are dispatched in `main.ts` as a chain: documents (`Cmd+N/O/S/W`, tab cycling) → find bar (`Cmd+F/H`, Enter/Esc) → outline (`Cmd+Shift+O`) → focus mode (`Cmd+Shift+D`, Esc) → print (`Cmd+P`). Add new shortcuts to that chain, not as separate listeners.
- The About dialog's version comes from `__APP_VERSION__` (Vite `define` from package.json). About has three `bw.makeTabs` panes: About, How it works, Diagnostics.
- Chat bubbles are `{root, body, meta}` element refs returned by `bw.append`; stream updates patch `body`, timings patch `meta`. Visibility of meta/tool entries is two classes on `#chat-panel` (`show-timestamps`, `show-tools`) set by `setChatDisplay()` so Settings toggles apply live.
- Slot setters in bitwrench 2.1.11 stringify `bw.raw()`/arrays; pass elements to `bw.patch` instead (see memory/issue list).
- quikdown editor is initialized via `initEditor(container)` in `src/editor/editor.ts`
- The standalone bundle is imported via Vite alias `quikdown-standalone` → `node_modules/quikdown/dist/quikdown_edit_standalone.esm.js`
- File open/save uses `@tauri-apps/plugin-dialog` (JS) + `@tauri-apps/plugin-fs` (JS), not custom Rust commands for dialogs
- Custom Rust commands (`invoke("cmd_name", {params})`) are used for things that need backend processing (e.g., `llm_chat`, `get_cli_file`)
- The quikdown standalone bundle uses eval internally (Mermaid) — the Vite build warning is expected and harmless
- `allowExternalFetch: true` is set on the editor so map tiles load from OSM and Vega specs can use external data URLs

## Testing

```bash
npm test                    # Unit tests (vitest, happy-dom; bitwrench renders fine there)
npm run test:e2e            # E2E tests (Playwright against vite.config.e2e.ts with Tauri mocks in e2e/mocks)
npm run test:all            # Both unit + E2E
npm run test:coverage       # Unit tests with coverage; thresholds in vitest.config.ts (90/90/90 lines/stmts/funcs, 85 branches) fail the run
```

Coverage expectations: every `src/**/*.ts` module including `main.ts` is measured. UI modules are tested by mounting TACO into `#app` under happy-dom (see `src/ui/*.test.ts`, `src/settings/settings.ui.test.ts`, `src/chat/chat-ui.loop.test.ts`). Tear down with `bw.clear(el)`, not `innerHTML = ""`, because bitwrench 2.1.11 caches ids in `bw._nodeMap`. Do not edit `src/test-setup.ts` for one test's DOM; build it in the test file.

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
npm run release:dry                                # every gate, nothing pushed or committed
npm run release                                    # full test suite, then push + PR + auto-merge
npm run release:no-playwright                      # skip E2E tests

# 4. After PR merges, tag and push to trigger release workflow
git checkout main && git pull
git tag v<VERSION> && git push origin v<VERSION>
```

The release workflow (`.github/workflows/release.yml`) builds platform binaries, creates a GitHub Release, and publishes npm packages. CI's `tag` job pushes the tag with `GITHUB_TOKEN` (which cannot trigger other workflows) and then dispatches `release.yml` explicitly with `gh workflow run`; release.yml therefore accepts both `push: tags` and `workflow_dispatch`. Requires the `NPM_TOKEN` repo secret.

## Updating quikdown

```bash
npm update quikdown
```

## Project Phases (from spec)

All four spec phases are implemented (core editor, chat + tool loop, memory/KV/screenshot, project mode). v1.1.0 rebuilt the UI on bitwrench and fixed the release pipeline. Remaining ideas live in `dev/quikleaf-spec.md`.
