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

## Auto-Detection

On first launch (if no LLM is configured), quikleaf probes:

1. `http://localhost:11434/v1/models` (Ollama)
2. `http://localhost:1234/v1/models` (LM Studio)
3. `http://localhost:12434/engines/v1/models` (Docker Model Runner)

If models are found, the first one is auto-configured.

## Tool Calling

QD has access to 26 tools (23 outside project mode):

### Document Tools

| Tool | Description |
|------|-------------|
| `document_read` | Read the full markdown source |
| `document_write` | Replace the entire document |
| `document_replace` | Find and replace text in the document |
| `document_insert` | Insert text at the cursor position |
| `document_undo` | Undo the last editor change |
| `document_redo` | Redo the last undone change |
| `document_get_selection` | Get the currently selected text |
| `document_outline` | List headings with level and line number |

### Tab Tools

| Tool | Description |
|------|-------------|
| `tabs_list` | List open tabs; document tools act on the active one |
| `tab_switch` | Activate an open tab by id or path |
| `tab_open` | Open a project file in a tab (project mode) |

### Plan Tools

| Tool | Description |
|------|-------------|
| `plan_set` | Set a step list; shown as a plan card in the chat |
| `plan_update` | Mark a step pending, active, done or skipped |

### Memory Tools

A persistent scratchpad for QD to store notes and context:

| Tool | Description |
|------|-------------|
| `memory_read` | Read scratchpad contents |
| `memory_write` | Overwrite scratchpad |
| `memory_append` | Append to scratchpad |
| `memory_clear` | Clear scratchpad |

### Key-Value Store

Persistent named storage:

| Tool | Description |
|------|-------------|
| `kv_get` | Get value by key |
| `kv_set` | Set key-value pair |
| `kv_delete` | Delete a key |
| `kv_list` | List all keys |

### File Tools (Project Mode Only)

Available when quikleaf is launched with `--project ./dir`:

| Tool | Description |
|------|-------------|
| `file_read` | Read a file relative to project root |
| `file_write` | Write a file relative to project root |
| `file_list` | List directory contents |
| `file_stat` | Get file metadata (size, modified date) |
| `project_search` | Search text files under the project root (substring or regex, case-insensitive) |

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
| `/clear` | Clear chat history |
| `/model` | Show current LLM model and endpoint |
| `/memory` | Display scratchpad contents |
| `/tools` | List all available tools |
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

- **Timeout**: 60-second timeout per LLM API call
- **Max iterations**: Tool-calling loop limited to 10 rounds
- **Stop button**: Send button becomes a red "Stop" button during execution
- **Backend proxy**: API keys never exposed to the webview
- **Markdown only**: LLM operates on raw markdown, never HTML
