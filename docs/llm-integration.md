# LLM Integration

qdedit includes a built-in AI assistant called QD that can read, edit, and manage your documents through a tool-calling interface.

## Supported Providers

### OpenAI-Compatible

Any API following the OpenAI chat completions format:

- **Ollama** — Auto-detected on `localhost:11434`. Run `ollama serve` and qdedit configures itself.
- **LM Studio** — Auto-detected on `localhost:1234`.
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
| Provider | `OpenAI-compatible` or `Anthropic` |
| Host | API endpoint URL |
| API Key | Authentication key (blank for local models) |
| Model | Model name (use "Fetch Models" to list available) |

## Auto-Detection

On first launch (if no LLM is configured), qdedit probes:

1. `http://localhost:11434/v1/models` (Ollama)
2. `http://localhost:1234/v1/models` (LM Studio)

If models are found, the first one is auto-configured.

## Tool Calling

QD has access to 20+ tools organized in four categories:

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

Available when qdedit is launched with `--project ./dir`:

| Tool | Description |
|------|-------------|
| `file_read` | Read a file relative to project root |
| `file_write` | Write a file relative to project root |
| `file_list` | List directory contents |
| `file_stat` | Get file metadata (size, modified date) |

## Slash Commands

Type these in the chat input:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/clear` | Clear chat history |
| `/model` | Show current LLM model and endpoint |
| `/memory` | Display scratchpad contents |
| `/tools` | List all available tools |

## Safety Features

- **Timeout**: 60-second timeout per LLM API call
- **Max iterations**: Tool-calling loop limited to 10 rounds
- **Stop button**: Send button becomes a red "Stop" button during execution
- **Backend proxy**: API keys never exposed to the webview
- **Markdown only**: LLM operates on raw markdown, never HTML
