# Architecture

qudown is a Tauri v2 desktop application with a Rust backend and TypeScript frontend.

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
| `commands/mod.rs` | Module declarations |

### State Management

- `LaunchInfo` — CLI-parsed file path, shared to webview via managed state
- `LaunchMode` — enum: `Simple { file_path }` or `Project { project_root, project_file, exists }`
- `ProjectState` — Mutex-wrapped project data (root, open file, memory, KV store)

### LLM Proxy

The `llm_chat` command accepts the full request body and proxies it to the configured LLM endpoint. This avoids CORS issues and keeps API keys server-side. Streaming is handled via chunked HTTP responses.

## Frontend (TypeScript)

Located in `src/`. Built with Vite, runs in Tauri's webview.

| Module | Purpose |
|--------|---------|
| `main.ts` | App initialization, file operations, project mode detection, about modal |
| `editor/editor.ts` | quikdown editor wrapper with undo/redo/insert/selection exports |
| `chat/chat-ui.ts` | Chat UI, tool definitions, dispatch loop, slash commands, QD identity |
| `chat/providers.ts` | Provider adapters — translates between internal format and OpenAI/Anthropic APIs |
| `settings/settings.ts` | LLM configuration UI, auto-detection of local Ollama/LM Studio |
| `project/file-tree.ts` | File tree sidebar for project mode |

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
