# qdedit — Specification

## Overview

qdedit is a standalone, cross-platform, local markdown editor built on Tauri and quikdown. It provides rich markdown rendering (SVG, math, mermaid, maps, STL, CSV, and upcoming vega/abcjs fences), a split editor/preview pane, and an integrated LLM chat panel with tool-calling support. The LLM operates on the markdown source via tools — it has no special access beyond what the tools expose.

When used without LLM features, qdedit is simply a fast, capable local markdown editor with rich fence rendering and local image support.

## Principles

- **Local-first.** No server, no cloud dependency. LLM calls go directly to provider APIs or local models.
- **quikdown is the rendering engine.** The standalone build bundles all fence libraries. quikdown is owned by the author and can be extended (new fence types, executable fences in the future).
- **The LLM is a tool user.** It reads and writes markdown through explicit tool calls. It has no hidden context injection or RAG. It sees what it asks to see.
- **Transparency.** Chat history, memory, KV store, and document edit history are all inspectable by the user. Nothing is hidden.
- **Progressive complexity.** `qdedit myfile.md` is a simple editor. Opening a project adds folder awareness, LLM memory persistence, and KV storage. The user opts in to complexity.

## Architecture

```
qdedit/
├── src-tauri/                 # Rust backend (Tauri)
│   ├── src/
│   │   ├── main.rs            # App bootstrap, CLI arg parsing, window setup
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── fs.rs          # File I/O: read, write, list, stat
│   │   │   ├── llm.rs         # LLM API proxy (HTTP calls, key management)
│   │   │   ├── memory.rs      # Scratchpad read/write
│   │   │   ├── kv.rs          # Key-value store CRUD
│   │   │   ├── project.rs     # Project file load/save (qdedit.prj)
│   │   │   └── screenshot.rs  # Viewport/document screenshot capture
│   │   └── asset_protocol.rs  # Custom protocol for local image resolution
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                       # Frontend (JS/TS, built with Vite)
│   ├── index.html             # Main window
│   ├── main.ts                # App init, wire up editor + chat + IPC
│   ├── editor/
│   │   └── editor.ts          # quikdown_edit_standalone integration
│   ├── chat/
│   │   ├── chat-ui.ts         # Chat panel UI (message list, input, provider selector)
│   │   ├── tool-loop.ts       # Tool-calling loop: send → parse tool_calls → dispatch → repeat
│   │   ├── tools.ts           # Tool definitions and dispatch table
│   │   └── providers.ts       # LLM provider adapters (OpenAI-compatible, Anthropic)
│   ├── settings/
│   │   └── settings.ts        # Settings UI (providers, API keys, model selection, theme)
│   └── project/
│       └── file-tree.ts       # File tree sidebar (project mode)
├── dev/                       # Specs, design docs
│   └── qdedit-spec.md         # This file
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### Process Model

- **Tauri main process (Rust):** Handles file I/O, LLM HTTP requests (API keys stay in Rust, never sent to the webview), screenshot capture, memory/KV persistence, CLI argument parsing, and the custom `asset://` protocol for resolving local images in markdown.
- **Webview (JS):** Runs quikdown_edit_standalone for the editor, the chat panel UI, and the tool-calling loop. Communicates with Rust via Tauri IPC commands (`invoke`).

### Data Flow

```
User types markdown ──→ quikdown renders in preview pane
                         ↓
User asks LLM ─────────→ chat panel sends message + tool defs
                         ↓
                    LLM responds with tool_calls
                         ↓
                    tool-loop.ts dispatches each tool call:
                      ├── document tools → quikdown editor API (JS-side)
                      ├── file tools → invoke Rust IPC command
                      ├── memory/kv tools → invoke Rust IPC command
                      └── screenshot tool → invoke Rust IPC command
                         ↓
                    tool results appended to messages
                         ↓
                    loop back to LLM until no more tool_calls
                         ↓
                    final response displayed in chat
```

## Modes of Operation

### Simple Mode: `qdedit myfile.md`

Opens a single file in the editor. No project, no file tree, no persistence of LLM state. The chat panel is available but chat history is ephemeral (lost on close). Memory and KV tools are available in-session but not persisted.

### Project Mode: `qdedit --project mydir/`

Opens a folder. Shows file tree sidebar. LLM can read/write files within the project. If a `qdedit.prj` file exists, loads chat history, memory, KV, and preferences from it. If not, starts fresh. The user can optionally save state to `qdedit.prj` at any time.

### Project Mode: `qdedit --project mydir/qdedit.prj`

Opens an existing project file directly. Restores all state.

## Editor

The editor is quikdown_edit_standalone embedded in the Tauri webview. It provides:

- Split pane: source (raw markdown) / preview (rendered HTML), or either alone
- All quikdown fence types: syntax highlighting, mermaid, math/LaTeX, geojson maps, STL 3D, CSV/PSV/TSV tables, SVG, sanitized HTML, and future fences (vega, abcjs)
- Toolbar with mode switching, undo/redo, copy (markdown, HTML, rich rendered)
- Keyboard shortcuts (Ctrl/Cmd+1/2/3 for modes, Ctrl/Cmd+Z/Y for undo/redo)
- Theme support (light, dark, auto)
- The user edits raw markdown. The preview renders via quikdown.
- The LLM edits raw markdown via tools. It never sees or produces HTML.

### Local Image Resolution

Markdown images with relative paths (`![](./images/photo.png)`) are resolved via a custom Tauri asset protocol. The protocol maps requests to the directory of the currently open file (simple mode) or the project root (project mode).

## Chat Panel

A purpose-built chat UI — not quikchat. Minimal: message list, text input, send button, provider/model selector.

### Layout

Two-column layout: editor (right, ~65%) and chat panel (left, ~35%). The chat panel is collapsible/hideable. In simple mode without LLM usage, the editor fills the full width.

### Tool-Calling Loop

The chat panel implements a standard tool-calling loop:

1. User message is appended to `messages[]` array
2. `messages` + `tools` sent to LLM via Rust proxy
3. If response contains `tool_calls`:
   - Each tool call is dispatched to its handler
   - Tool results are appended to `messages[]`
   - Go to step 2
4. If response is a text message: display in chat, stop

The loop has a configurable iteration limit (default: 20) to prevent runaway tool calling.

### Chat History

The complete chat history (including tool calls and tool results) is preserved in memory during the session. In project mode, it can be persisted to `qdedit.prj`. The full history is always sent to the LLM on each turn (no summarization in v1; context window limits are the user's problem to manage via model selection).

## LLM Tool Definitions

All tools operate on plain text / markdown. The LLM never sees or produces HTML.

### Document Tools (executed in JS via quikdown editor API)

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `document_read` | `{}` | `{ content: string }` | Read the full markdown content of the current editor buffer |
| `document_write` | `{ content: string }` | `{ success: true }` | Replace the entire editor buffer with new markdown |
| `document_replace` | `{ search: string, replace: string, all?: boolean }` | `{ count: number }` | Find and replace text in the editor buffer. `all` defaults to false (first match only) |
| `document_insert` | `{ position: 'start' \| 'end' \| number, content: string }` | `{ success: true }` | Insert text at a position (line number or start/end) |
| `document_get_selection` | `{}` | `{ content: string, start: number, end: number }` | Get the currently selected text (if any) |
| `undo` | `{}` | `{ success: boolean }` | Undo the last edit |
| `redo` | `{}` | `{ success: boolean }` | Redo the last undone edit |

### File Tools (executed in Rust via IPC)

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `file_read` | `{ path: string }` | `{ content: string }` | Read a file's contents. Path is relative to project root. |
| `file_write` | `{ path: string, content: string }` | `{ success: true }` | Write content to a file. Creates if doesn't exist. |
| `file_list` | `{ path?: string, recursive?: boolean }` | `{ entries: [{name, type, size}] }` | List directory contents. Defaults to project root. |
| `file_stat` | `{ path: string }` | `{ size, modified, type }` | Get file metadata |

All file paths are sandboxed to the project root. Attempts to escape via `../` are rejected.

### Memory Tool (executed in Rust via IPC)

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `memory_read` | `{}` | `{ content: string }` | Read the entire scratchpad |
| `memory_write` | `{ content: string }` | `{ success: true }` | Overwrite the entire scratchpad |
| `memory_append` | `{ content: string }` | `{ success: true }` | Append to the scratchpad |
| `memory_clear` | `{}` | `{ success: true }` | Clear the scratchpad |

The memory is a freeform text buffer. The LLM uses it however it sees fit — notes, summaries, plans, intermediate results. It is not automatically included in the LLM's context; the LLM must call `memory_read` to see it.

### KV Store Tools (executed in Rust via IPC)

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `kv_get` | `{ key: string }` | `{ value: string \| null, created: string, modified: string }` | Get a value by key. Timestamps are ISO 8601. |
| `kv_set` | `{ key: string, value: string }` | `{ success: true, created: string, modified: string }` | Set a key-value pair. Sets `created` on first write, updates `modified` on every write. |
| `kv_delete` | `{ key: string }` | `{ success: boolean }` | Delete a key and its timestamps |
| `kv_list` | `{}` | `{ entries: [{ key, modified }] }` | List all keys with last-modified timestamps, sorted by most recently modified |

Values are strings. The LLM can store JSON or any other format as a string value. Each entry internally stores `{ value, created, modified }` where timestamps are ISO 8601 UTC strings. This allows the LLM to reason about recency — e.g., re-read a file if the cached summary is stale.

### Logging

All tool calls are logged with timestamps to an append-only log. The log captures:

```json
{ "ts": "2026-05-25T23:14:07Z", "tool": "kv_set", "params": { "key": "api_base", "value": "..." }, "result": { "success": true }, "source": "llm" }
```

The `source` field is `"llm"` for LLM-initiated tool calls or `"user"` for user-initiated actions (e.g., manual save). The log is stored in memory during the session and persisted to `qdedit.prj` in project mode. It provides a complete audit trail of all LLM actions for debugging and replay.

### Screenshot Tools (executed in Rust via IPC)

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `screenshot_viewport` | `{}` | `{ image: base64_png }` | Capture the current visible viewport of the rendered preview as PNG |
| `screenshot_document` | `{}` | `{ image: base64_png }` | Capture the full rendered document as PNG (may be large) |
| `screenshot_region` | `{ x, y, width, height }` | `{ image: base64_png }` | Capture a specific region of the rendered preview |

These enable the LLM to visually inspect rendered output. Use case: the LLM writes a mermaid diagram, takes a screenshot to verify it renders correctly, and iterates if needed. Images are returned as base64-encoded PNGs in the tool result, suitable for multimodal LLMs that accept image inputs.

### Chat History Tool

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `history_read` | `{ last_n?: number }` | `{ messages: [...] }` | Read chat history. Defaults to full history. `last_n` returns only the last N messages. |

Allows the LLM to re-scan conversation history, e.g., after memory compaction or to re-derive information.

## LLM Provider Support

### Provider Types

1. **OpenAI-compatible** — OpenAI, OpenRouter, Ollama, LM Studio, Groq, Mistral, any endpoint that accepts the OpenAI chat completions format with tool calling. One adapter handles all of these; only the base URL and auth differ.
2. **Anthropic** — Claude models via the Anthropic API. Different message format and tool-calling structure. Separate adapter.

### Provider Configuration

Stored in `qdedit.prj` (project mode) or `~/.qdedit/config.json` (global defaults).

```json
{
  "providers": {
    "openrouter": {
      "type": "openai-compatible",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "sk-or-...",
      "defaultModel": "anthropic/claude-sonnet-4"
    },
    "ollama": {
      "type": "openai-compatible",
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "",
      "defaultModel": "llama3"
    },
    "anthropic": {
      "type": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "sk-ant-...",
      "defaultModel": "claude-sonnet-4-20250514"
    }
  },
  "activeProvider": "openrouter"
}
```

### API Key Security

API keys are stored in the Rust backend (config file on disk) and never sent to the webview. The webview sends `{ provider, model, messages, tools }` to a Rust IPC command, which adds the appropriate auth headers and makes the HTTP request. This prevents key leakage through browser devtools or XSS.

## Project File: `qdedit.prj`

A JSON file that persists session state. Saved manually by the user (File > Save Project) or auto-saved on close if the user has opted in.

```json
{
  "version": 1,
  "projectRoot": ".",
  "openFile": "README.md",
  "chatHistory": [
    { "role": "user", "content": "Fix the typo in the introduction" },
    { "role": "assistant", "content": null, "tool_calls": [...] },
    { "role": "tool", "tool_call_id": "...", "content": "..." },
    { "role": "assistant", "content": "Done. I fixed..." }
  ],
  "memory": "The project uses MIT license. Main API is in src/api.ts...",
  "kv": {
    "api_base": { "value": "https://api.example.com", "created": "2026-05-25T20:00:00Z", "modified": "2026-05-25T20:00:00Z" },
    "deploy_branch": { "value": "main", "created": "2026-05-25T20:05:00Z", "modified": "2026-05-25T21:30:00Z" }
  },
  "log": [
    { "ts": "2026-05-25T20:00:00Z", "tool": "kv_set", "params": { "key": "api_base", "value": "https://api.example.com" }, "source": "llm" }
  ],
  "preferences": {
    "theme": "dark",
    "chatPanelVisible": true,
    "chatPanelWidth": 35,
    "editorMode": "split",
    "activeProvider": "openrouter",
    "activeModel": "anthropic/claude-sonnet-4"
  }
}
```

## CLI Interface

```
qdedit                          # Open empty editor
qdedit myfile.md                # Open a single file
qdedit --project ./mydir/       # Open a folder as a project
qdedit --project ./mydir/qdedit.prj  # Open an existing project file
qdedit --version                # Print version
qdedit --help                   # Print help
```

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  qdedit   [File ▾] [Settings ▾]          [provider ▾]  │
├──────────────┬──────────────────────────────────────────┤
│              │  ┌─────────┬────────────┐               │
│  Chat Panel  │  │  Source  │  Preview   │               │
│  (35%)       │  │  (raw    │  (rendered │               │
│              │  │   md)    │   html)    │               │
│  Messages    │  │         │            │               │
│  ...         │  │         │            │               │
│  ...         │  │         │            │               │
│              │  │         │            │               │
│  ┌────────┐  │  │         │            │               │
│  │ input  │  │  │         │            │               │
│  └────────┘  │  └─────────┴────────────┘               │
├──────────────┴──────────────────────────────────────────┤
│  status bar: file path | line:col | provider | model    │
└─────────────────────────────────────────────────────────┘
```

In project mode, a collapsible file tree appears as a narrow panel on the far left.

## Build & Development

### Prerequisites

- Node.js 18+
- Rust toolchain (rustup)
- Tauri CLI (`cargo install tauri-cli` or `npm install -g @tauri-apps/cli`)

### Commands

```bash
npm install              # Install frontend dependencies
npm run dev              # Tauri dev mode (hot reload frontend, Rust rebuilds on change)
npm run build            # Production build (creates platform-specific installer)
npm run lint             # Lint frontend code
npm run test             # Run frontend tests
cargo test               # Run Rust backend tests
```

### Development Workflow

1. `npm run dev` starts Tauri in dev mode
2. Frontend changes hot-reload via Vite
3. Rust changes trigger automatic rebuild
4. The app opens in a native window with devtools available

## Phase Plan

### Phase 1 — Core Editor

- Tauri project scaffolded with Vite + TypeScript frontend
- quikdown_edit_standalone embedded in the webview
- File open/save via system dialogs
- CLI: `qdedit myfile.md` opens the file
- Local image resolution via custom asset protocol
- Theme support (light/dark/auto)
- Status bar with file path

### Phase 2 — Chat Panel + LLM Integration

- Chat panel UI (message list, input, send)
- LLM provider configuration (settings UI + config file)
- Rust-side LLM HTTP proxy with two adapters (OpenAI-compatible, Anthropic)
- Tool-calling loop in JS
- Document tools (read, write, replace, insert, undo, redo)
- Provider/model selector in UI

### Phase 3 — Memory, KV, Screenshots

- Memory tool (scratchpad read/write/append/clear)
- KV store tools (get/set/delete/list)
- Screenshot tools (viewport, full document, region)
- History read tool
- In-memory state for all of the above

### Phase 4 — Project Mode

- Open folder as project
- File tree sidebar
- File tools (read/write/list/stat) with path sandboxing
- `qdedit.prj` load/save (chat history, memory, KV, preferences)
- CLI: `qdedit --project ./dir/`

### Future Considerations

- Executable fences (run code blocks, capture output — Jupyter-style)
- Additional fence types as quikdown adds them (vega, abcjs)
- Chat history compaction / summarization for long sessions
- Multiple open files / tabs
- Plugin system for custom tools
