# LLM Integration

quikleaf includes a built-in AI assistant called QD that can read, edit, and manage your documents through a tool-calling interface.

## Supported Providers

### OpenAI-Compatible

Any API following the OpenAI chat completions format:

- **Ollama** — Auto-detected on `localhost:11434`. Run `ollama serve` and quikleaf configures itself.
- **LM Studio** — Auto-detected on `localhost:1234`.
- **Docker Model Runner** — Auto-detected on `localhost:12434/engines/v1` once host access is on: `docker desktop enable model-runner --tcp 12434`, then `docker model pull ai/<model>`.
- **OpenRouter** — `https://openrouter.ai/api/v1` with API key.
- **Groq** — `https://api.groq.com/openai/v1` with API key.
- **Together** — `https://api.together.xyz/v1` with API key.
- **vLLM / custom** — Any endpoint serving `/v1/chat/completions`.

### Anthropic

Claude models via the Anthropic Messages API:

- Endpoint: `https://api.anthropic.com`
- Requires an API key (starts with `sk-ant-`)
- Supports Claude Sonnet, Opus, and Haiku

## Configuration

Click **Settings** in the title bar to configure:

| Field | Description |
|-------|-------------|
| Preset | Fills provider and host for Ollama, LM Studio, Docker Model Runner, OpenRouter or Anthropic |
| Provider | `OpenAI-compatible` or `Anthropic` |
| Host | API endpoint URL |
| API Key | Authentication key (blank for local models) |
| Model | Model name (use "Fetch Models" to list available) |
| Chat drawer side | Which edge of the tab the chat slides out of: left (default) or right. Applies immediately. |
| Interface font size | Menus, tab bar, toolbars, status bar (12–18 px, default 14). Applies immediately. |
| Editor font size | The preview's base size (13–22 px, default 16); the source pane follows at 7/8. |
| Preview style | Default (quikdown's), Book (serif, reading measure), Plain (ruled headings), Mono. |
| Preview CSS | Your own rules, applied inside the preview on top of the style: `h1 { … }`, `p { … }`, or a bare declaration for the preview itself. |

## Auto-Detection

On first launch (if no LLM is configured), quikleaf probes:

1. `http://localhost:11434/v1/models` (Ollama)
2. `http://localhost:1234/v1/models` (LM Studio)
3. `http://localhost:12434/engines/v1/models` (Docker Model Runner)

If models are found, the first one is auto-configured.

## Chats and scope

Every editor tab has its own chat, and the chat is sealed to a scope. The chat is a drawer on one edge of the tab (left by default; Settings → Chat drawer side): open it with the pull on that edge, the Chat button, or Cmd/Ctrl+Shift+C. The header of the chat pane says which scope it has:

| Header | Belongs to | The model sees | Tools may change |
|--------|-----------|----------------|------------------|
| `Document chat · notes.md` | One document tab | That document and the conversation. Not other tabs, not other files, not even their names. | That document only |
| `Project chat` | The project tab (View → Project Chat, project mode) | Files under the project root, by path; which project files are open in tabs | Files under the project root, each named by path |

The seal is enforced in the tool dispatcher: a document chat that asks for `file_read` or `project_search` gets an error naming its document, and the project chat has no `document_*` tools. This is deliberate. Files from unrelated projects may be open side by side, and one project's content must never reach a model call made for another. A chat keeps working on its own document if you switch tabs while it is replying; closing a tab ends its chat (the project chat survives its tab and comes back with View → Project Chat).

Each chat can use its own model on the host and provider from Settings: `/model <name>` in the chat, or the Model picker in the info pane; `/model default` returns to the Settings model. In project mode the chats of project files, the project chat, each chat's model override and each tab's pane layout are saved in `quikleaf.prj` and restored on the next launch.

## Tool Calling

Tools are offered per scope. A document chat has 10 (18 when its document is a file under the project root, which adds memory and KV); the project chat has 17.

### Document Tools (document chats)

All act on the chat's own document, on screen or in a background tab, and tag results with `document: "<title>"`.

| Tool | Description |
|------|-------------|
| `document_read` | Read the full markdown source |
| `document_write` | Replace the entire document |
| `document_replace` | Find and replace text in the document |
| `document_insert` | Insert text at the cursor position (tab must be on screen) |
| `document_undo` | Undo the last editor change (tab must be on screen) |
| `document_redo` | Redo the last undone change (tab must be on screen) |
| `document_get_selection` | Get the currently selected text (tab must be on screen) |
| `document_outline` | List headings with level and line number |

### Plan Tools (every chat)

| Tool | Description |
|------|-------------|
| `plan_set` | Set a step list; shown as a plan card in the chat |
| `plan_update` | Mark a step pending, active, done or skipped |

### Memory Tools (project files and the project chat)

The project's scratchpad, saved to `quikleaf.prj`. Shared by the project chat and the chats of files under the root; a document outside the project, or any document in simple mode, is not offered it:

| Tool | Description |
|------|-------------|
| `memory_read` | Read scratchpad contents |
| `memory_write` | Overwrite scratchpad |
| `memory_append` | Append to scratchpad |
| `memory_clear` | Clear scratchpad |

### Key-Value Store (project files and the project chat)

Named storage, saved to `quikleaf.prj`, same scope as the scratchpad:

| Tool | Description |
|------|-------------|
| `kv_get` | Get value by key |
| `kv_set` | Set key-value pair |
| `kv_delete` | Delete a key |
| `kv_list` | List all keys |

### File and Tab Tools (project chat)

Available in the project chat when quikleaf was launched with `--project ./dir`:

| Tool | Description |
|------|-------------|
| `file_read` | Read a file relative to project root |
| `file_write` | Write a file relative to project root (the path is the explicit target of every edit) |
| `file_list` | List directory contents |
| `file_stat` | Get file metadata (size, modified date) |
| `project_search` | Search text files under the project root (substring or regex, case-insensitive) |
| `tabs_list` | Which project files are open in tabs (files from outside the root are not listed) |
| `tab_open` | Open a project file in a tab |

## Reviewing Edits

Settings > **Agent > Edit approval** decides which edits wait for you:

| Setting | Behaviour |
|---------|-----------|
| Always | Every `document_write`, `document_replace` and `file_write` shows a diff card with Accept / Reject before anything changes |
| Files only (default) | Project file writes are reviewed; document edits apply at once and show the diff |
| Never | Everything applies at once; diffs are still shown |

Rejecting tells QD the change was declined so it asks instead of retrying. Stop rejects any pending review.

## Slash Commands

Type these in the chat input:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/clear` | Clear this chat |
| `/model` | Show the model and endpoint this chat uses |
| `/model <name>` | Use `<name>` for this chat only; `/model default` returns to Settings |
| `/memory` | Display the project scratchpad (project files and the project chat) |
| `/tools` | List the tools this chat has |
| `/log` | Show the performance log path, whether it is on, and the last entries |

## Timestamps, timing and the performance log

Every chat message carries a timestamp. Assistant replies add a timing line: total time, time to first token, an approximate token count (characters ÷ 4; providers rarely report usage over SSE) and tokens per second. Tool calls show their duration. Settings → **Chat display** toggles timestamps and tool-call entries, and the change applies to messages already on screen.

With Settings → **Diagnostics → Write performance log** on (the default), the same numbers are appended as JSON lines:

```json
{"ts":"2026-10-31T21:11:24.512Z","kind":"llm","provider":"openai-compatible","model":"llama3.2","host":"http://localhost:11434","ttft_ms":180,"total_ms":1840,"chars":412,"est_tokens":103,"tok_per_s":62,"tool_calls":0}
{"ts":"2026-10-31T21:11:25.001Z","kind":"tool","name":"document_read","ms":3,"ok":true}
{"ts":"2026-10-31T21:11:26.900Z","kind":"turn","total_ms":4100,"llm_calls":2,"tool_calls":1,"aborted":false}
```

| Platform | File |
|----------|------|
| macOS | `~/Library/Logs/com.deftio.quikleaf/quikleaf-perf.jsonl` |
| Linux | `~/.local/share/com.deftio.quikleaf/logs/quikleaf-perf.jsonl` |
| Windows | `%LOCALAPPDATA%\com.deftio.quikleaf\logs\quikleaf-perf.jsonl` |

Turn the switch off and nothing is written. "Open Log Folder" and "Clear Log" are in the same Settings section; About → Diagnostics shows the path and the latest entries.

## Safety Features

- **Max iterations**: Tool-calling loop limited to 10 rounds
- **Stop button**: Send button becomes a red "Stop" button during execution
- **Backend proxy**: API keys never exposed to the webview
- **Markdown only**: LLM operates on raw markdown, never HTML
