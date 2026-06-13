# agents.md — AI Agent Integration Guide for qudown

This file describes how AI agents can interact with qudown, both as the built-in QD assistant and as external tooling.

## Built-in Agent: QD

qudown includes a built-in LLM-powered assistant called QD. QD communicates via a tool-calling loop and operates exclusively on raw markdown (never HTML).

### System Prompt

QD is told:
- It is a document assistant named QD
- It should help users write, edit, and format markdown
- It operates on the raw markdown source, not HTML
- It has access to tools for reading/writing the document, managing memory, and (in project mode) working with files

### Tool-Calling Protocol

QD uses the standard OpenAI function-calling format or Anthropic tool_use format, depending on the configured provider. The loop:

1. User sends a message
2. Message + conversation history + system prompt + tool definitions sent to LLM
3. If LLM returns tool_calls, each is dispatched locally
4. Tool results are appended and sent back to the LLM
5. Loop continues until LLM returns a text response (no tool calls) or max iterations (10) reached
6. 60-second timeout per LLM call; user can abort via stop button

### Tool Definitions

#### Document Tools (always available)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `document_read` | none | Returns the full markdown source |
| `document_write` | `content: string` | Replaces the entire document |
| `document_replace` | `old_text: string, new_text: string` | Find and replace text |
| `document_insert` | `text: string` | Insert text at cursor position |
| `document_undo` | none | Undo last editor change |
| `document_redo` | none | Redo last undone change |
| `document_get_selection` | none | Get currently selected text |

#### Memory Tools (always available)

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
| `kv_list` | none | List all keys |

#### File Tools (project mode only)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `file_read` | `path: string` | Read file relative to project root |
| `file_write` | `path: string, content: string` | Write file relative to project root |
| `file_list` | `path?: string` | List directory contents |
| `file_stat` | `path: string` | Get file metadata |

### Slash Commands

Users can type these in the chat input:

| Command | Effect |
|---------|--------|
| `/help` | Show available commands |
| `/clear` | Clear conversation history |
| `/model` | Display current LLM model info |
| `/memory` | Show scratchpad contents |
| `/tools` | List all available tools |

## Provider Configuration

qudown supports two provider types:

### OpenAI-compatible
- Any API that follows the OpenAI chat completions format
- Includes: Ollama, LM Studio, OpenRouter, Groq, Together, vLLM
- Endpoint: `{host}/v1/chat/completions`
- Auto-detected: Ollama (localhost:11434), LM Studio (localhost:1234)

### Anthropic
- Claude models via Anthropic's Messages API
- Endpoint: `{host}/v1/messages`
- Requires API key with `x-api-key` header

## External Agent Integration

External agents (CI/CD, scripts, other tools) can interact with qudown's project files:

### Project File Format

When qudown runs in project mode (`--project ./dir`), it creates a `qudown.prj` JSON file containing:
- `project_root`: absolute path to the project directory
- `open_file`: currently open file path (relative)
- `memory`: scratchpad contents
- `kv`: key-value store (object)

### Memory and KV as Agent Communication

Agents can read/write the `qudown.prj` file to communicate with the user through QD:
- Write to `memory` to pass context to QD
- Write to `kv` to store structured data QD can access
- QD will see these values when it uses `memory_read` or `kv_get`

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
