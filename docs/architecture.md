# Architecture

quikleaf is a Tauri v2 desktop application with a Rust backend and a TypeScript frontend whose UI is built from [bitwrench](https://github.com/deftio/bitwrench) TACO objects.

## Overview

```
┌─────────────────────────────────────────────────────┐
│                    Tauri Webview                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │   Editor      │  │   Chat UI    │  │ Settings  │  │
│  │  (quikdown)   │  │   (QD)       │  │           │  │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                 │                │        │
│         └────────┬────────┴────────┬───────┘        │
│                  │   invoke()      │                │
├──────────────────┼─────────────────┼────────────────┤
│                  │  Tauri IPC      │                │
│  ┌───────────────┴─────────────────┴──────────────┐ │
│  │              Rust Backend                       │ │
│  │  ┌─────────┐  ┌─────────┐  ┌────────────────┐  │ │
│  │  │  fs.rs  │  │ llm.rs  │  │  project.rs    │  │ │
│  │  │ File IO │  │ LLM API │  │ Memory/KV/File │  │ │
│  │  └─────────┘  └────┬────┘  └────────────────┘  │ │
│  └─────────────────────┼──────────────────────────┘ │
└────────────────────────┼────────────────────────────┘
                         │ HTTP (reqwest)
                    ┌────┴────┐
                    │ LLM API │
                    │ Server  │
                    └─────────┘
```

## Backend (Rust)

Located in `src-tauri/src/`. Commands are in `src-tauri/src/commands/`.

| Module | Purpose |
|--------|---------|
| `main.rs` | CLI argument parsing, app builder, state management, asset protocol |
| `lib.rs` | Library entry point, mirrors main.rs for Tauri mobile/test targets |
| `commands/fs.rs` | File read/write via Tauri commands |
| `commands/llm.rs` | LLM API proxy — streams responses from OpenAI/Anthropic endpoints via reqwest |
| `commands/project.rs` | Project state management, memory/KV store, file tools scoped to project root |
| `commands/project.rs` (`project_search`) | Case-insensitive substring/regex search over project text files, skipping VCS and build directories |
| `commands/diag.rs` | Performance log (JSON lines in the OS log dir: append/tail/clear/reveal) and the `quikleaf` CLI shim installer |
| `commands/mod.rs` | Module declarations |

### State Management

- `LaunchInfo` — CLI-parsed file path, shared to webview via managed state
- `LaunchMode` — enum: `Simple { file_path }` or `Project { project_root, project_file, exists }`
- `ProjectState` — Mutex-wrapped project data (root, open file, memory, KV store)

### LLM Proxy

The `llm_chat` command accepts the full request body and proxies it to the configured LLM endpoint. This avoids CORS issues and keeps API keys server-side. Streaming is handled via chunked HTTP responses.

## Frontend (TypeScript)

Located in `src/`. Built with Vite, runs in Tauri's webview. `index.html` is an empty `<div id="app">`; `main.ts` mounts the whole shell with `bw.mount()`.

| Module | Purpose |
|--------|---------|
| `main.ts` | Mounts the shell, file operations, project mode detection, keyboard shortcuts |
| `ui/theme.ts` | Two bitwrench themes (`bw.loadStyles()` light, and dark scoped under `.dark`) plus app CSS written with `bw.css()` over CSS custom properties |
| `ui/shell.ts` | Title bar, File/Help menus, main row, status bar as TACO |
| `ui/about.ts` | About dialog (`bw.makeModal`) with system-browser links |
| `ui/taco.ts` | Helpers: `withAttrs()` to add ids to factory output, typed `makeModal()`, element lookups |
| `ui/toast.ts` | Notifications via `bw.makeToast` in a lazily created container |
| `ui/tabbar.ts` | Editor tab bar (`bw.syncChildren` keyed by tab id) |
| `ui/outline.ts`, `ui/findbar.ts`, `ui/focus.ts`, `ui/stats.ts` | Outline panel, find & replace bar, focus mode, status-bar word count |
| `editor/tabs.ts` | Pure tab model; publishes `tabs:changed` |
| `editor/documents.ts` | Session controller: binds tabs to the single quikdown instance, open/save/close, unsaved prompts, shortcuts |
| `editor/find.ts`, `editor/outline.ts`, `editor/stats.ts`, `editor/export.ts` | Pure logic for find/replace, heading parsing, document stats, standalone HTML export and print |
| `chat/diff.ts`, `chat/review.ts`, `chat/plan.ts`, `chat/outline.ts` | Line diff, Accept/Reject review cards, plan card, heading tool |
| `diag/perf.ts` | Stopwatch, time-to-first-token / tok/s math, formatting, `logEvent()` client for the performance log |
| `editor/editor.ts` | quikdown editor wrapper with undo/redo/insert/selection exports |
| `chat/chat-ui.ts` | Chat panel TACO, streaming bubbles via `bw.append`/`bw.patch`, tool dispatch loop, slash commands |
| `chat/chat-utils.ts` | System prompt, tool schemas, provider-neutral message shaping |
| `chat/providers.ts` | Provider adapters — translates between internal format and OpenAI/Anthropic APIs |
| `settings/settings.ts` | LLM settings dialog (bitwrench modal + form controls), localStorage, auto-detect |
| `project/file-tree.ts` | File tree sidebar for project mode |

### UI rules

- Every element is a TACO `{t, a, c, o}`; event handlers live in `a:`.
- Updates use bitwrench verbs (`bw.patch`, `bw.toggleClass`, `bw.clear`, `bw.remove`), never `innerHTML`.
- Dark mode is a one-class toggle (`.dark` on `#app`); both themes derive from the same seed accent.
- Chat display toggles are classes on `#chat-panel` (`show-timestamps`, `show-tools`): bubbles always render their meta line and tool entries, so flipping a setting restyles history instantly.

### Performance log

Each LLM request logs `ttft_ms`, `total_ms`, `chars`, `est_tokens` (chars/4), `tok_per_s`, model/host; each tool call logs its duration; each chat turn logs totals. Entries are JSON lines in the platform log directory (macOS `~/Library/Logs/com.deftio.quikleaf/quikleaf-perf.jsonl`). Settings → Diagnostics turns it off; `/log` and About → Diagnostics show the tail.

### Tool-Calling Loop

1. User sends message
2. Build messages array with system prompt + history
3. Send to LLM via `invoke("llm_chat", ...)`
4. If response contains `tool_calls`:
   - Dispatch each tool call locally
   - Append tool results to messages
   - Send back to LLM (loop)
5. If response is plain text: display to user
6. Max 10 iterations, 60s timeout per call, abort button available

## Key Dependencies

| Dependency | Role |
|-----------|------|
| quikdown (npm) | Markdown parser and editor with all fence renderers |
| bitwrench (npm) | UI library: TACO → DOM, `make*()` components, generated theming |
| Tauri v2 | Desktop app framework (Rust + webview) |
| tauri-plugin-dialog | Native file open/save dialogs |
| tauri-plugin-fs | Filesystem access from frontend |
| tauri-plugin-shell | Open external URLs in system browser |
| reqwest (Rust) | HTTP client for LLM API proxying |
| serde (Rust) | JSON serialization for commands and state |

## Build Pipeline

```
npm install          → Install frontend deps (includes quikdown ~8MB)
vite build           → Bundle TypeScript → dist/
cargo build          → Compile Rust backend
tauri build          → Package: app + webview + bundled assets → installer
```

Vite config aliases `quikdown-standalone` to the standalone ESM bundle which includes all fence libraries (highlight.js, mermaid, mathjax, leaflet, three.js, etc.).
