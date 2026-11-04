# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

quikleaf is a standalone, cross-platform local markdown editor built on **Tauri v2** (Rust backend + webview frontend) with **quikdown** as the rendering engine and **bitwrench.js** for the UI shell (the maintainer dogfoods bitwrench here — keep UI work in bitwrench idiom). It provides rich markdown editing with live preview, LLM chat integration with tool calling, and project/folder awareness.

The full specification is in `dev/quikleaf-spec.md`.

## Architecture

- **`src-tauri/`** — Rust backend (Tauri v2). Handles file I/O, CLI arg parsing, LLM API proxying, the performance log and CLI shim (`commands/diag.rs`), and plugin initialization. Commands are in `src-tauri/src/commands/`.
- **`src/`** — TypeScript frontend built with Vite. Runs in Tauri's webview.
  - `src/diag/perf.ts` — timing math + `logEvent()` (JSON lines via `log_append`; off when Settings → perfLog is false)
  - `src/ui/` — bitwrench shell: `theme.ts` (two `bw.loadStyles()` themes + app CSS via `bw.css()`), `shell.ts` (title bar: File/View menus, Settings, Help menu, About; toggle buttons; status bar; `makeMain` with `#tab-body`), `tabbar.ts` (tabs only), `editor-toolbar.ts` (the tab's control row: Files/Outline/Chat toggles, the headless quikdown editor's controls, Info toggle), `appearance.ts` (font sizes, preview style class, user CSS), `about.ts` (About dialog; exports the project URLs), `panes.ts` (per-tab `[chat | quikdown view | info]` layout: applies the active tab's `view`, toggles, Cmd+Shift+C / I), `infopane.ts` (document and chat facts, per-chat model picker), `about.ts`, `taco.ts` (helpers: `withAttrs`, typed `makeModal`)
  - `src/editor/` — quikdown_edit_standalone integration (`editor.ts`), the pure tab model (`tabs.ts`, notifies via `bw.pub("tabs:changed")`) and the session controller that binds tabs to the single editor instance, file I/O and shortcuts (`documents.ts`; also `activeDocumentPath()`, the active document's absolute path). Open/save/new/close go through `documents.ts`, never the editor directly. `paths.ts` (pure path helpers), `images.ts` (relative `img` sources in the preview are rewritten to `convertFileSrc(abs, "asset")` after every render via a MutationObserver, the original kept in `data-quikleaf-src`; paste → `image_save` → `images/<doc>-<stamp>.<ext>` beside the document and `![name](relative)` at the caret), `dropzone.ts` (`getCurrentWebview().onDragDropEvent`: `#app.drag-over` while hovering; text files → `openPath`, images → link, else a toast), `watch.ts` (the Watch toggle `#tool-watch`, off by default: `watch_start`/`watch_stop` on the tab's absolute path, `file-changed` events debounced 150 ms → `reloadDocument()`; a dirty tab asks first; a removed file is reported once; closed tabs stop; `--watch` sets it for the command-line file via `get_launch_flags`).
  - `src/chat/` — one chat session per tab (`session.ts`: scope, transcript, model override, stats, the chat's own `.chat-log` element; `exportChatHistory`/`importChatHistory` for `quikleaf.prj`), chat pane TACO + tool-calling loop (`chat-ui.ts`), provider adapters (`providers.ts`), tool schemas + system prompt per scope (`chat-utils.ts`: `getTools(provider, {scope, memory})`, `buildSystemPrompt(ctx)`), line diff (`diff.ts`), review cards with Accept/Reject (`review.ts`, takes the target log), plan card (`plan.ts`, takes a `PlanHost` = the session), heading parser (`outline.ts`). **Scope is a trust boundary**: a document chat may touch only its own tab's document (`readDoc`/`writeDoc` work on background tabs too); file/search/tab tools belong to the project chat only; memory/KV only to project files and the project chat. Enforce new tools in `dispatchTool`, not just in the schema. Adding a tool: schema in `chat-utils.ts` (OpenAI shape, Anthropic is mapped), dispatch in `chat-ui.ts` `dispatchTool`, update the tool-count assertions in `chat-utils.test.ts` (document 10 / 18 with memory, project 17), the `/tools` text, and docs.
  - `src/settings/` — LLM settings dialog (bitwrench modal + form) and localStorage persistence
  - `src/project/` — File tree sidebar (`file-tree.ts`) and `persist.ts`, the debounced `project_save` writer (open file, open tabs, `chatHistory` from `exportChatHistory()`); `main.ts` enables it in project mode, `documents.ts`, the chat loop and the memory/KV tools call `scheduleProjectSave()`
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
- CLI file argument is parsed from `std::env::args()` in main.rs and shared to the webview via managed state. For `--project <dir>`, `locate_project_file` picks `.quikleaf/quikleaf.prj` if it exists, else `quikleaf.prj` in the root if that exists, else proposes the `.quikleaf` one (`exists: false`, `explicit: false`); the frontend may move a new file to the root per Settings → Project (`projectFileLocation`), never an `explicit` one (`--project ./x.prj`). `project_save` creates the parent folder.
- `commands/watch.rs`: `WatchHub` (managed in `setup()`, built with a sink that emits `file-changed`), commands `watch_start`/`watch_stop`; it watches parent folders non-recursively and `classify()` maps notify events to `{ path, kind: "changed" | "removed" }` for watched files only. `LaunchFlags` carries `--log` and `--watch`.
- `commands/fs.rs` also has `allow_path` (fs-scope widening for dropped files) and `image_save` (base64 → `images/<stem>-<stamp>.<ext>` beside the document, never overwriting; `image_mime` is the extension gate shared with the `asset://` handler)
- LLM API calls go through `llm_chat` command in `commands/llm.rs`, supporting both OpenAI-compatible and Anthropic formats
- `project_search` in `commands/project.rs` walks the project root (skips `.git`, `node_modules`, `target`, `dist`, `.venv`, `__pycache__`, dotdirs, > 2 MB, non-UTF-8); uses the `regex` crate
- The native Window menu deliberately has no `close_window` item: its Cmd+W would race the webview's Close Tab shortcut

## Frontend Conventions

- UI is bitwrench TACO, not HTML strings: handlers go in `a:`, state changes use `bw.toggleClass`/`bw.patch`/`bw.clear`, never `innerHTML`. Ids that tests rely on (`#chat-send`, `#settings-overlay`, …) are merged onto factory output with `withAttrs()`.
- Styles live in `src/ui/theme.ts` as `bw.css()` rules over CSS custom properties; the dark theme is `bw.loadStyles(cfg, ".dark")` and `setDarkMode()` toggles `.dark` on `#app`.
- Modals are `bw.makeModal()`; open/close through the element handle (`modalHandle(el).open()`), and tests assert the `bw_bccl_modal_show` class.
- Keyboard shortcuts are dispatched in `main.ts` as a chain: documents (`Cmd+N/O/S/W`, tab cycling) → find bar (`Cmd+F/H`, Enter/Esc) → outline (`Cmd+Shift+O`) → panes (`Cmd+Shift+C` chat, `Cmd+Shift+I` info) → focus mode (`Cmd+Shift+D`, Esc) → print (`Cmd+P`). Add new shortcuts to that chain, not as separate listeners.
- The tab is the unit: `Tab.view` (`chat`, `info`, `mode`) is the layout, `ui/panes.ts` applies it on `tabs:changed`, and the chat/info panes are inside `#editor-column > #tab-body`, not beside the window. The chat is a drawer with no slide animation (it appears in place like the other panels): markup order is fixed `[chat | pull | editor | info]`; `setChatSide()` in `shell.ts` toggles `chat-right` on `#tab-body` (CSS `order` does the rest, including the info pane crossing over and the resize handle flipping), and `setChatPanelVisible()` toggles `chat-closed`, which shows the pull (`makeChatDrawerPull`). The side is `LLMSettings.chatSide` (`chatSideOf()`, default left), applied by `applyChatSettings()`. The rows are `[menus … Settings Help About ☾]` / `[tabs +]` / `[Files Outline Chat | editor controls … Watch | Info]` (`makeEditorToolbar` handlers; CSS `order`, and `setChatSide` puts `chat-right` on `#editor-column` so the Chat toggle moves to the right end with its drawer) / the body `[files | outline | chat | editor | info]`. Every panel, the file tree and the outline included, opens inside `#tab-body` (orders 1, 2, 3, 5, 7; `makeMain`'s `panels` go there), so toggling one never moves the rows above. The drawer pull sits beside `#editor-container` in `#editor-frame` (`makeMain`'s `inEditor`; quikdown empties the container on mount), and the frame is `position: relative`. The title bar and tab bar hold no toggles. The theme toggle (`makeThemeToggle`, `#btn-theme`) and Settings → Appearance → Theme both go through `applyTheme()` in `appearance.ts` (`system` keeps a media-query listener). A pressed toggle inverts (`--text-primary` on `--bg-primary`), no dots or accent fills. Chrome font sizes derive from `--ui-font-size` on `#app` (`calc(var(--ui-font-size) - 1px)` and so on), the editor from `--editor-font-size`; both are set by `applyAppearance()` from Settings → Appearance, as is the `preview-<style>` class that the preview stylesheets in `theme.ts` key on. Use the variables, not fixed px, for anything in a bar or menu. The project chat is a tab (`PROJECT_TAB_ID`, `kind: "project"`) with no document: `documents.ts` empties and hides the editor for it. The log viewer is a tab too (`LOG_TAB_ID`, `kind: "log"`, `openLogTab()` in `documents.ts`): no document, no chat (`setView` pins `chat: false`), `#editor-column.log-tab` shows `#log-panel` (`src/diag/log-pane.ts`) in the editor's place and hides the editor controls. It follows the log in-process through `onLogEvent()` in `perf.ts` (every `logEvent` reaches listeners before the write, writing on or off) and reads the file's tail once on first show. About, Settings and `--log` (`get_launch_flags`) ask for it by publishing `LOG_OPEN`; `main.ts` subscribes. `tabs.test.ts` asserts full `Tab` objects, so a new `Tab` field means updating those `toEqual`s.
- The About dialog's version comes from `__APP_VERSION__` (Vite `define` from package.json); the library versions it lists come from `__QUIKDOWN_VERSION__`, `__BITWRENCH_VERSION__`, `__TAURI_API_VERSION__` (same `define`, read from node_modules). About is a masthead (`.about-head`: logo, name, version pill, tagline) above three `bw.makeTabs` panes styled as underline tabs: About (one paragraph, a facts grid of external links), How it works (bold-lead bullets), Diagnostics. About is its own title bar button; Help holds Documentation, Report an Issue and Install Command Line Tool. External links go through `externalLink()` (plugin-shell), never the webview.
- Chat bubbles are `{root, body, meta}` element refs returned by `bw.append`; stream updates patch `body`, timings patch `meta`. Visibility of meta/tool entries is two classes on `#chat-panel` (`show-timestamps`, `show-tools`) set by `setChatDisplay()` so Settings toggles apply live.
- Slot setters in bitwrench 2.1.11 stringify `bw.raw()`/arrays; pass elements to `bw.patch` instead (see memory/issue list).
- quikdown editor is initialized via `initEditor(container)` in `src/editor/editor.ts`, headless (`showToolbar: false`). `src/ui/editor-toolbar.ts` draws the controls (Source/Split/Rendered radios `#tool-mode-*`, `#tool-undo`/`#tool-redo`, `#tool-copy-*`) over the editor API (`setMode`, `undo`/`redo`/`canUndo`/`canRedo`, `copyRendered`); `initEditorToolbar()` keeps them in step via `onEditorModeChange`/`onEditorChange`. Do not re-enable quikdown's toolbar; add new editor controls there.
- The standalone bundle is imported via Vite alias `quikdown-standalone` → `node_modules/quikdown/dist/quikdown_edit_standalone.esm.js`
- File open/save uses `@tauri-apps/plugin-dialog` (JS) + `@tauri-apps/plugin-fs` (JS), not custom Rust commands for dialogs. The fs plugin's default scope is the app's own directories only: a path picked in the dialog is allowed by the dialog plugin, and the file named on the command line is allowed in `setup()` with `app.fs_scope().allow_file(path)`. Any other path handed to `readTextFile`/`writeTextFile` fails with "forbidden path"; `openPath` first asks the `allow_path` command to widen the scope (so dropped files open) and logs a failure to the diagnostics log as an `open-failed` event. The `asset://` scheme (registered in `main.rs`/`lib.rs`) serves image files only: an absolute path (what `convertFileSrc` sends) as is, a relative one against the project root or the open file.
- Custom Rust commands (`invoke("cmd_name", {params})`) are used for things that need backend processing (e.g., `llm_chat_stream`, `get_launch_info`, `project_save`)
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

## Authorship and AI disclosure

Commits, tags, PRs and GitHub releases list the maintainer as the only author. Do not add `Co-Authored-By` or any AI attribution trailers to commit messages or PR bodies, even if a harness suggests one. AI assistance is disclosed instead in `CHANGELOG.md`: each version entry that used AI tooling carries an "AI assistance" line saying what was done with it (for example "UI rebuild, test suite and docs drafted with Claude Code; reviewed and released by the maintainer"). The maintainer is the accountable party for every release.

## Release Workflow

Versioned releases are authored only by the maintainer. Claude Code should never run `npm run release` or `npm run feature` autonomously.

The version is tracked in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `npm/quikleaf/package.json` (the launcher downloads the release archive of exactly its own version on first run; it has no postinstall script because npm 12 blocks install scripts for `-g`/`npx`) and the site badge. The `feature` script bumps them all.

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

# 4. Nothing to do by hand: after the PR squash-merges, CI's `tag` job pushes
#    v<VERSION> and dispatches the release workflow. Do not tag locally.
git checkout main && git pull                      # once the release has shipped
```

The release workflow (`.github/workflows/release.yml`) builds platform binaries, creates a GitHub Release with installers and the four portable archives, then dispatches `publish.yml`. CI's `tag` job pushes the tag with `GITHUB_TOKEN` (which cannot trigger other workflows) and then dispatches `release.yml` explicitly with `gh workflow run`; release.yml therefore accepts both `push: tags` and `workflow_dispatch`, and dispatches `publish.yml` the same way.

npm: only the `quikleaf` launcher is published (no platform packages). `publish.yml` uses npm trusted publishing (OIDC): `id-token: write`, no token, `npm publish --provenance`. The trusted-publisher config on npmjs.com is bound to the filename `publish.yml` in `deftio/quikleaf` and must have direct `npm publish` under "Allowed actions" (npm's form defaults new configs to stage-only, which refuses `npm publish` with "OIDC permission denied for this action"; that is what broke 1.2.1). Do not rename that workflow. The job checks that the launcher version equals the tag and that the four release archives exist (install.js downloads them), skips if the version is already on npm, then publishes. No human step: a push to main that passes CI ends on npm, same as bitwrench. Manual (re)publish for any existing release: `gh workflow run publish.yml --ref main -f tag=vX.Y.Z`. `docs/publishing.md` is the full account: trust points, npm-side setup, and the meaning of the 403/404 errors.

## GitHub Pages site

`docs/index.html` is an SEO head plus an empty `#app`; `docs/scripts/site.js` builds the whole page as bitwrench TACO (bitwrench loaded from jsDelivr, `bitwrench@2`) with `bw.loadStyles()` for the palette and `bw.css()` for page rules. The nav badge shows `SITE_VERSION`, which `tools/feature.sh` bumps along with the JSON-LD `softwareVersion`, and is replaced by the latest GitHub release tag at runtime. GoatCounter is the only analytics. Check it locally with `python3 -m http.server --directory docs`.

## Updating quikdown

```bash
npm update quikdown
```

## Project Phases (from spec)

All four spec phases are implemented (core editor, chat + tool loop, memory/KV, project mode); the screenshot tool from phase 3 exists only as a Rust stub. v1.1.0 rebuilt the UI on bitwrench and fixed the release pipeline; v1.1.1 wired `project_save` so project state actually persists, and made the tab the unit: a sealed chat per tab, a project chat for cross-file work, per-tab `[chat | quikdown view | info]` panes, chat history in `quikleaf.prj`. `ProjectData` is serialised camelCase, so the frontend reads `openFile`, not `open_file`. Remaining ideas live in `dev/quikleaf-spec.md`.
