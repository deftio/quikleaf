# agents.md — AI Agent Integration Guide for quikleaf

This file describes how AI agents can interact with quikleaf, both as the built-in QD assistant and as external tooling.

## Built-in Agent: QD

quikleaf includes a built-in LLM-powered assistant called QD. QD communicates via a tool-calling loop and operates exclusively on raw markdown (never HTML).

### Chat scopes

Every editor tab has its own chat, and each chat is sealed to a scope. The scope decides the system prompt and the tool set, and the dispatcher enforces it: a tool outside the scope returns an error, it is not merely left out of the schema.

| Scope | Belongs to | Sees | Tools |
|-------|-----------|------|-------|
| **Document chat** | One document tab | That document and the conversation. Nothing about other tabs or files reaches the model. | `document_*`, `plan_*`; plus `memory_*` / `kv_*` when the document is a file under the project root |
| **Project chat** | The project tab (View → Project Chat, project mode only) | Files under the project root, by path; the project files open in tabs | `file_*`, `project_search`, `tabs_list`, `tab_open`, `plan_*`, `memory_*`, `kv_*` |

Why: files from unrelated projects may be open side by side, and one project's content must never reach a model call made for another. A document chat therefore has no way to read, list or search anything but its own document, and the project chat never sees tabs opened from outside the root. The scratchpad and key-value store are project state, so a document outside the project (or any document in simple mode) is not offered them.

Each chat may use its own model (`/model <name>`, or the info pane picker) on the host and provider from Settings. A chat whose tab is in the background keeps working on that tab's document.

### System Prompt

A document chat is told:
- It is a document assistant named QD, bound to one named document (title, and whether it is a project file, a file on disk or unsaved)
- It can read and change only that document; other documents are not visible to it and it cannot open or read other files
- Which tools it has (document, plan, and memory/KV when offered)

The project chat is told:
- It works on one project's files under the root folder, every file named by its project-relative path
- There is no "current document"; to change a file it writes it by path
- Which tools it has (file, search, tabs, plan, memory/KV)

### Tool-Calling Protocol

QD uses the standard OpenAI function-calling format or Anthropic tool_use format, depending on the configured provider. The loop:

1. User sends a message
2. Message + conversation history + system prompt + tool definitions sent to LLM
3. If LLM returns tool_calls, each is dispatched locally
4. Tool results are appended and sent back to the LLM
5. Loop continues until LLM returns a text response (no tool calls) or max iterations (10) reached; edits may pause for user review (see Edit Review)
6. No per-call timeout; the user can abort at any point with the Stop button, which also rejects pending edit reviews

### Tool Definitions

#### Document Tools (document chats; always the chat's own document)

Results carry `document: "<title>"` so the model can see which file it touched.

| Tool | Parameters | Description |
|------|-----------|-------------|
| `document_read` | none | `{document, content}` — the full markdown source (the editor's text when the tab is on screen, the parked text otherwise) |
| `document_write` | `content: string` | Replaces the entire document (also works for a background tab) |
| `document_replace` | `search: string, replace: string, all?: boolean` | Find and replace text (first match, or every match with `all`); returns `{count, document}` |
| `document_insert` | `text: string` | Insert text at cursor position (needs the tab on screen) |
| `document_undo` | none | Undo last editor change (needs the tab on screen) |
| `document_redo` | none | Redo last undone change (needs the tab on screen) |
| `document_get_selection` | none | Get currently selected text (needs the tab on screen) |
| `document_outline` | none | Headings as `[{level, text, line}]` (fences ignored) |

#### Tab Tools (project chat)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `tabs_list` | none | Project files open in tabs as `[{title, path, dirty, active}]`; files outside the root are not listed |
| `tab_open` | `path: string` | Open a project file in a tab and make it active |

#### Plan Tools (every chat; the plan belongs to the chat)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `plan_set` | `title?: string, steps: string[]` | Replace the plan; renders a plan card in the chat |
| `plan_update` | `index: number, status: pending / active / done / skipped, note?: string` | Update one step in place |

#### Memory Tools (project files and the project chat)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `memory_read` | none | Read the scratchpad contents |
| `memory_write` | `content: string` | Overwrite scratchpad |
| `memory_append` | `content: string` | Append to scratchpad |
| `memory_clear` | none | Clear scratchpad |

#### Key-Value Tools (always available)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `kv_get` | `key: string` | Get value for key |
| `kv_set` | `key: string, value: string` | Set key-value pair |
| `kv_delete` | `key: string` | Delete key |
| `kv_list` | none | List keys with their last-modified timestamps (`{entries: [{key, modified}]}`) |

#### File Tools (project mode only)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `file_read` | `path: string` | Read file relative to project root |
| `file_write` | `path: string, content: string` | Write file relative to project root |
| `file_list` | `path?: string, recursive?: boolean` | List directory contents |
| `file_stat` | `path: string` | Get file metadata |
| `project_search` | `query: string, path?: string, regex?: boolean, max_results?: number` | Case-insensitive search across project text files; returns `{matches: [{path, line, text}], truncated, files_scanned}`; skips `.git`, `node_modules`, `target`, `dist`, `.venv`, `__pycache__`, dotdirs, files > 2 MB |

### Edit Review

`document_write`, `document_replace` and `file_write` may be held for user review depending on Settings > Agent > Edit approval (`always`, `files` = default, `never`). A reviewed edit renders as a diff card with Accept/Reject; the tool call does not return until the user decides. A rejected edit returns `{"success": false, "rejected": true, "message": "User rejected the change"}` and the system prompt tells QD to ask what to change rather than retry. Pressing Stop rejects all pending reviews. Edits that are not reviewed still render a diff card so the user can see what changed.

### Slash Commands

Users can type these in the chat input:

| Command | Effect |
|---------|--------|
| `/help` | Show available commands |
| `/clear` | Clear this chat |
| `/model` | Show the model this chat uses |
| `/model <name>` | Use `<name>` for this chat only; `/model default` returns to Settings |
| `/memory` | Show the project scratchpad (where the chat has it) |
| `/tools` | List the tools this chat has |
| `/log` | Show performance-log path, state and recent timings |

## Provider Configuration

quikleaf supports two provider types:

### OpenAI-compatible
- Any API that follows the OpenAI chat completions format
- Includes: Ollama, LM Studio, Docker Model Runner, OpenRouter, Groq, Together, vLLM
- Endpoint: `{host}/v1/chat/completions`
- Auto-detected: Ollama (localhost:11434), LM Studio (localhost:1234/v1), Docker Model Runner (localhost:12434/engines/v1)

### Anthropic
- Claude models via Anthropic's Messages API
- Endpoint: `{host}/v1/messages`
- Requires API key with `x-api-key` header

## External Agent Integration

External agents (CI/CD, scripts, other tools) can interact with quikleaf's project files:

### Project File Format

When quikleaf runs in project mode (`--project ./dir`, or `--project ./dir/quikleaf.prj`), it creates `quikleaf.prj` on first launch and rewrites it (debounced, a few hundred ms) after every change to the open tabs, the active file, a chat, the scratchpad or the key-value store. Keys are camelCase (the Rust `ProjectData` struct is serialised with `rename_all = "camelCase"`):

```json
{
  "version": 1,
  "projectRoot": "/absolute/path/to/dir",
  "openFile": "docs/readme.md",
  "openTabs": ["readme.md", "docs/readme.md"],
  "chatHistory": {
    "version": 1,
    "tabs": {
      "docs/readme.md": {
        "transcript": [{ "role": "user", "text": "tighten the intro" }, { "role": "assistant", "text": "Done — QD" }],
        "model": null,
        "view": { "chat": true, "info": false, "mode": "split" }
      }
    },
    "project": { "transcript": [], "model": "qwen3" }
  },
  "memory": "User prefers concise responses.",
  "kv": {
    "project_name": { "value": "My Project", "created": "2026-11-01T18:00:00Z", "modified": "2026-11-01T18:00:00Z" }
  },
  "log": [],
  "preferences": {}
}
```

`chatHistory.tabs` is keyed by project-relative path and holds, for each open project file, the visible conversation (`transcript`: user and assistant text only, no tool traffic), that chat's model override (`model`, null for the Settings model) and the tab's pane layout (`view`). `chatHistory.project` is the project chat. Untitled documents and files from outside the root are never written. On launch the transcripts are restored onto the tabs that are reopened; a path with no tab is dropped. `log` and `preferences` are reserved and written empty.

### Memory and KV as Agent Communication

An external agent can seed `memory` or `kv` in `quikleaf.prj` **while quikleaf is not running**; the values are loaded at the next launch and QD sees them through `memory_read` / `kv_get`. While quikleaf is running it owns the file and overwrites it on each save, so edits made underneath it are lost. For live communication use the project folder instead: write a markdown file and let QD read it with `file_read` or find it with `project_search`.

## Performance Log

quikleaf writes one JSON object per line to a performance log (unless the user turns it off in Settings → Diagnostics):

| `kind` | Fields |
|--------|--------|
| `llm` | `provider`, `model`, `host`, `ttft_ms`, `total_ms`, `chars`, `est_tokens`, `tok_per_s`, `tool_calls`, `error?` |
| `tool` | `name`, `ms`, `ok` |
| `turn` | `total_ms`, `llm_calls`, `tool_calls`, `aborted` |
| `app` | `event` (`start`), `version` |

Location: macOS `~/Library/Logs/com.deftio.quikleaf/quikleaf-perf.jsonl`, Linux `~/.local/share/com.deftio.quikleaf/logs/`, Windows `%LOCALAPPDATA%\com.deftio.quikleaf\logs\`. External agents can tail it to compare models or spot slow tools; the `/log` slash command and About → Diagnostics show the same data in-app.

## Data Flow

```
User Input → Chat UI → LLM Provider (via Rust proxy) → Tool Calls → Dispatch → Editor/Backend → Results → LLM → Response → Chat UI
```

The Rust backend proxies all LLM API calls to:
1. Avoid CORS issues in the webview
2. Keep API keys out of frontend code
3. Enable streaming responses via chunked transfer

## Security Model

- API keys are stored in localStorage (webview-local, not synced)
- LLM API calls never leave the backend proxy — the webview only talks to localhost
- File tools are scoped to the project root directory (no path traversal)
- The LLM never receives or produces HTML — only raw markdown
- quikdown's HTML sanitizer handles XSS protection in rendered output
