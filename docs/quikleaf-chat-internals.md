# Chat internals: tools, dispatch and the system prompt

How QD, the chat in quikleaf, actually works: what is sent to the model, how
tool calls come back and are run, where the scope boundary is enforced, and
what the Rust proxy does with the bytes. [llm-integration.md](llm-integration.md)
is the user's view (providers, settings, the tool list); this is the
implementer's. File references are to `src/chat/` unless another path is given.

## The pieces

| File | Holds |
|------|-------|
| `session.ts` | One `ChatSession` per tab: scope, provider-format history, visible transcript, plan, model override, stats, the chat's own log element. Export and import for `quikleaf.prj`. |
| `chat-ui.ts` | The chat pane, the turn (`send`, `streamTurn`, `runToolLoop`), the tool dispatcher (`dispatchTool`), slash commands, the status bar line. |
| `chat-utils.ts` | `buildSystemPrompt()`, the tool schemas, `getTools()`, and the helpers that shape tool calls and results for each provider. |
| `providers.ts` | URL building, request bodies, response parsing, `sendChatStream()` over Tauri events, model listing. |
| `review.ts`, `diff.ts` | Diff cards with Accept and Reject; the line diff behind them. |
| `plan.ts` | The plan card (`plan_set`, `plan_update`). |
| `outline.ts` | The heading parser behind `document_outline`. |
| `src/diag/perf.ts` | Stopwatch, time to first token, tokens per second, `logEvent()`, the status bar text. |
| `src-tauri/src/commands/llm.rs` | The HTTP proxy: headers, SSE parsing, `llm-chunk` and `llm-done` events. |
| `src-tauri/src/commands/project.rs` | The commands behind the file, search, memory and key-value tools, and the path guard. |

## Sessions

A chat belongs to a tab. `sessionFor(tabId)` creates a session on first use
and keeps it in a map; closing a tab drops its session on the next
`pruneSessions()`, except the project chat, which outlives its tab and comes
back with View → Project Chat.

A session's `scope` is `"document"` for any document tab and `"project"` for
the project tab. Two lists live side by side:

- `messages` is what the model gets: the provider-format history, including
  the assistant's tool-call messages and the tool results. It is not saved.
- `transcript` is what the user sees: user and assistant text only. This is
  what `quikleaf.prj` keeps for project files and the project chat. When a
  transcript is restored, `messages` is rebuilt from it as plain user and
  assistant turns, so the model gets the conversation back but not the old
  tool traffic.

Each session owns a `.chat-log` element. The pane re-parents the active
tab's log into `#chat-messages` on a tab switch, so a background chat keeps
its streaming bubble, review cards and plan card, and a turn that is still
running keeps writing into its own log and its own document.

`sessionHasMemory(s)` is true for the project chat and for a document tab
whose file is under the project root. It decides both whether the scratchpad
and key-value tools are offered and whether their calls are allowed.

## One turn

`send()` in `chat-ui.ts`, in order:

1. Read the input, refuse if empty, if this session is already sending, or
   if no provider is configured (a bubble says so).
2. Mark the session `sending`, clear the per-turn document-character count,
   push `{role: "user", content}` onto `messages`, draw the user bubble.
3. Pick the tools: `getTools(provider, {scope, memory})`. Build the system
   prompt: `buildSystemPrompt({scope, title, path, projectRelative, memory})`.
   Both are computed fresh on every turn, so a tab renamed by Save As, a
   setting changed in the dialog, or a model override takes effect on the
   next message.
4. `toSend = [system, ...messages]`. `streamTurn()` sends it and renders the
   reply as it streams (at most one re-render every 50 ms).
5. If the reply carries no tool calls, the text is the answer: it goes into
   `transcript` and `messages`, and the turn ends.
6. If it carries tool calls, any text that came with them is kept as an
   assistant bubble, then the assistant's tool-call message is appended in
   provider format, each call is run in order through `runTool()`, the
   results are appended in provider format, and `runToolLoop()` sends the
   whole thing back.
7. `runToolLoop()` repeats step 4 to 6 up to ten times. Stop sets
   `abortRequested`; the loop checks it before each model call and between
   tool calls, posts "(Stopped by user)" and returns. After ten rounds it
   posts "(Tool loop reached maximum iterations)".
8. A `turn` entry goes to the performance log, the status bar is refreshed
   with the final document-character count, the input gets focus back, and
   `scheduleProjectSave()` queues the project file.

There is no per-call timeout. A model that never finishes is stopped by the
user. The Stop button also calls `cancelPendingReviews(session.log)`, so a
diff card waiting for Accept resolves as cancelled and its tool returns the
rejected result.

Errors from the provider come back in `result.error` and are shown as an
assistant bubble beginning "Error:"; the loop ends there, and the text also
goes into `messages` so the model sees it next turn.

## The system prompt

`buildSystemPrompt()` returns one of two texts. Nothing in it is
configurable from Settings; it changes only with scope, the document's name
and location, and whether memory is offered.

### Document chat

```
You are QD, a friendly AI document assistant built into quikleaf, a markdown editor.
You help users write, edit, and improve markdown documents. Keep responses concise and helpful.

This chat is bound to one document: **<title>** (<where>). You can read and change only this document.
Other documents the user may have open are not visible to you, and you cannot open, read or search other files.
If the user asks about another document, say that this chat only sees <title> and that each tab has its own chat.

You have access to the following tools to interact with the editor:

**Document tools** (all act on <title>):
- **document_read**: Read the current document content. Always call this first before making edits.
- **document_write**: Replace the entire document with new markdown content.
- **document_replace**: Find and replace specific text in the document.
- **document_insert**: Insert text at the current cursor position.
- **document_undo**: Undo the last editor change.
- **document_redo**: Redo the last undone change.
- **document_get_selection**: Get the currently selected text in the editor.
- **document_outline**: List the document's headings (level, text, line) — a cheap way to navigate a long document before reading it all.

**Planning tools** (for multi-step work, call plan_set first and keep it updated as you go):
- **plan_set**: Set the plan as a list of short steps (replaces any earlier plan).
- **plan_update**: Mark a step pending, active, done or skipped, optionally with a short note.

[memory block, only when the document is a project file]

When the user asks you to read, edit, modify, or improve the document, use the document tools.
First call document_read to see the current content, then use document_write or document_replace to make changes.
Document and file edits may be shown to the user for review before they are applied. If a tool result contains
"rejected": true, the user declined that change: do not retry it or try a different route to the same edit —
briefly ask what they would like instead.
Use markdown formatting in your replies. Sign off briefly as QD when appropriate.
```

`<title>` is the tab title ("notes.md", "Untitled 2"). `<where>` is one of
"a file in the project", "a file on disk" or "an unsaved document". The
memory block, when present, lists the four `memory_*` and four `kv_*` tools
with one line each and calls the scratchpad "the project's scratchpad,
shared by every chat in this project".

### Project chat

```
You are QD, a friendly AI assistant built into quikleaf, a markdown editor. This is the **project chat**:
you work on the files of one project, under its root folder, and every file you read or write is named by its
project-relative path. There is no "current document" in this chat; to change a file, write it by path.
Only files under the project root exist for you. Keep responses concise and helpful.

You have access to the following tools:

**File tools** (paths are relative to the project root):
- **file_read**: Read a file's contents by relative path.
- **file_write**: Write content to a file by relative path (replaces the whole file).
- **file_list**: List directory contents (optionally recursive).
- **file_stat**: Get file metadata (size, modified date, type).
- **project_search**: Search project files for text (case-insensitive substring, or a regex). Returns matching lines with paths and line numbers.
- **tabs_list**: List the project files the user has open in editor tabs.
- **tab_open**: Open a project file in an editor tab so the user sees it.

[planning block, as above]
[memory block, always]

Read a file before changing it, and change files one at a time.
[review paragraph and sign-off, as above]
```

The prompt describes the tools in prose as well as offering them as
schemas. Small local models follow the prose better than the schema alone,
and the "call document_read first" instruction is what keeps a model from
overwriting a document it has not seen. The prompt is advisory; the
dispatcher below is what actually limits a chat.

## Tool schemas

Tools are declared once, in the OpenAI function-calling shape:

```ts
{ type: "function", function: { name, description, parameters: { type: "object", properties, required } } }
```

`toAnthropicTool()` maps that to `{ name, description, input_schema }` when
the provider is Anthropic. Descriptions are written for the model and
double as documentation; keep them short and literal.

`getTools(provider, {scope, memory})` assembles the set:

| Scope | Tools | Count |
|-------|-------|-------|
| Document chat, file outside a project or no project | 8 `document_*` + 2 `plan_*` | 10 |
| Document chat, file under the project root | the above + 4 `memory_*` + 4 `kv_*` | 18 |
| Project chat | 5 file tools (`file_read`, `file_write`, `file_list`, `file_stat`, `project_search`) + `tabs_list` + `tab_open` + 2 `plan_*` + 8 memory and KV | 17 |

`chat-utils.test.ts` asserts these counts; a new tool changes them.

## Dispatch and the scope boundary

`runTool(session, name, args)` wraps every call: it starts a stopwatch,
calls `dispatchTool(name, args, session)`, catches anything thrown and turns
it into `{"error": "..."}`, counts the call on the session, appends a tool
entry to the log (shown when Settings → Chat display → Show tool calls is
on) and writes a `tool` line to the performance log with the duration and
whether the result contained `"error"`.

Every tool result is a JSON string. Conventions:

- A failure is `{"error": "<message>"}`. The model gets the message and
  usually explains or tries something else.
- Document tools tag their result with `document: "<title>"`, so a model
  running several chats cannot confuse which file a result came from.
- A declined edit is `{"success": false, "rejected": true, "message": "User rejected the change"}`
  (`REJECTED_RESULT`), which the system prompt tells the model not to retry.

`dispatchTool` is a single `switch` on the tool name, and the first line of
every case is a gate:

| Tool group | Gate | Message when refused |
|------------|------|----------------------|
| `document_*` | `session.scope === "document"` | "… is not available in the project chat: there is no current document here. Read and write files by path." |
| `document_insert`, `_undo`, `_redo`, `_get_selection` | the session's tab is on screen | "… needs <title> on screen; it is open in a background tab. Use document_read / document_write instead." |
| `memory_*`, `kv_*` | `sessionHasMemory(session)` | names the document and says the scratchpad belongs to the project, or says to open a folder with `--project` |
| `file_*`, `project_search`, `tabs_list`, `tab_open` | `session.scope === "project"`, then `isProjectMode()` | "… is not available in a document chat: this chat sees only <title>. Cross-file work belongs in the project chat." |
| anything else | | "Unknown tool: <name>" |

This is the trust boundary. A document chat has no way to reach another
tab's text even if a model asks for `file_read` by name, and the project
chat has no "current document" to act on by accident. Files from unrelated
projects open side by side therefore never meet in one model call. Adding a
tool means adding its gate here, not only choosing which schema list it
joins.

### Document tools

They read and write the session's own tab, which need not be the one on
screen. `readDoc()` returns the editor's text when the tab is active and the
tab's parked `content` otherwise; `writeDoc()` calls `setMarkdown()` on the
editor or `updateContent()` on the tab model. So a chat left running while
the user switches tabs still edits the right document.

- `document_read` → `{document, content}`.
- `document_write {content}` → review (see below), then write; counts
  `content.length` toward the status bar. Returns `{success, document}`.
- `document_replace {search, replace, all?}` → first match, or every match
  with `all`, by plain string search (no regex). Returns `{count, document}`;
  with `count: 0` nothing is reviewed or written.
- `document_insert {text}` → `insertAtCursor()`; needs the tab on screen.
- `document_undo`, `document_redo`, `document_get_selection` → editor API;
  need the tab on screen. The selection result is `{document, selection}`.
- `document_outline` → `{document, headings: [{level, text, line}]}`, lines
  1-based, headings inside fences ignored (`outline.ts`).

### Plan tools

`plan_set {title?, steps[]}` replaces the session's plan and renders or
re-renders one card in that chat's log; up to 50 steps, blank ones dropped.
`plan_update {index, status, note?}` changes one step (`pending`, `active`,
`done`, `skipped`) and returns the step and a `done/total` progress string.
The card is kept as an element reference on the session, because a
background chat's log is not in the document and an id lookup would miss it.
`/clear` resets the plan.

### Memory and key-value tools

These go straight to Rust commands on `ProjectState` and then call
`scheduleProjectSave()` so `quikleaf.prj` follows:

| Tool | Command | Result |
|------|---------|--------|
| `memory_read` | `memory_read` | `{content}` |
| `memory_write {content}` | `memory_write` | `{success: true}` |
| `memory_append {content}` | `memory_append` | `{success: true}` |
| `memory_clear` | `memory_clear` | `{success: true}` |
| `kv_get {key}` | `kv_get` | `{value, created, modified}` or `{error: "Key not found"}` |
| `kv_set {key, value}` | `kv_set` | the stored entry |
| `kv_delete {key}` | `kv_delete` | `{deleted: bool}` |
| `kv_list` | `kv_list` | `{entries: [{key, modified}]}` |

### File and tab tools

The file tools call the Rust commands of the same name. Every path goes
through `safe_resolve()` in `project.rs`: the project root is
canonicalised, the relative path is joined under it, the result (or its
nearest existing parent, for a file about to be created) is canonicalised
too, and anything that does not start with the root is refused with "Access
denied: path escapes project root". That covers `..` and symlinks that point
outside.

- `file_read {path}` → `{path, content}`.
- `file_write {path, content}` → requires a non-empty path ("every edit in
  the project chat names its target file"), reads the current contents for
  the diff (a missing file diffs against empty), reviews when the policy
  says so, then writes. A clean tab showing that file picks up the change
  on its next open; a dirty tab keeps the user's edits.
- `file_list {path?, recursive?}`, `file_stat {path}` → the Rust responses
  as is.
- `project_search {query, path?, regex?, max_results?}` → `search_tree()` in
  Rust walks from `path` (default the root), skipping `.git`,
  `node_modules`, `target`, `dist`, `.venv`, `__pycache__`, dot-directories,
  files over 2 MB and anything not UTF-8. Substring matches are
  case-insensitive; `regex` uses the `regex` crate. Returns
  `{matches: [{path, line, text}], truncated, files_scanned}`, 200 matches by
  default.
- `tabs_list` → `{tabs: [{title, path, dirty, active}]}`, filtered to
  document tabs whose file is under the root. A tab opened from elsewhere is
  not listed, not even its name.
- `tab_open {path}` → `openPath(path, true)` and `{success, title, path}`.

## Edit review

Settings → Agent → Edit approval is read on every call (`editApprovalOf`),
so a change in the dialog applies to the next tool call:

| Policy | `document_write`, `document_replace` | `file_write` |
|--------|--------------------------------------|--------------|
| `always` | wait for Accept | wait for Accept |
| `files` (default) | apply, show the diff | wait for Accept |
| `never` | apply, show the diff | apply |

`reviewEdit()` either calls `requestApproval(req, session.log)`, which
appends a diff card with Accept and Reject to that chat's log and returns a
promise that resolves with the decision, or `showAppliedDiff()`, which draws
the same card without buttons. The tool call does not return until the
promise resolves, so the model is simply waiting on its tool result while
the user reads. Diffs are line based (`diff.ts`), with three lines of
context around each change and a cap of 500 rows per card.

## What goes over the wire

`providers.ts` keeps one internal message shape,
`{role, content, tool_calls?, tool_call_id?}`, and translates at the edge.

**URL.** `buildChatUrl(host, provider)` appends `/v1/chat/completions` to an
OpenAI-compatible host (tolerating a trailing slash or an existing `/v1`)
and `/v1/messages` to an Anthropic host. `buildModelsUrl()` gives `/v1/models`
for Fetch Models; Anthropic has no key-free listing, so a fixed list of
current model ids is offered instead.

**Body, OpenAI-compatible.** `{model, messages, tools?, stream: true}`. The
system prompt is the first message. The assistant's tool-call turn is
`{role: "assistant", content: text | null, tool_calls: [...]}` exactly as
the provider returned it, and each result is
`{role: "tool", tool_call_id, content}`.

**Body, Anthropic.** System messages are pulled out into the top-level
`system` string; `max_tokens` is 64000 for streaming and 16000 otherwise
(Anthropic requires it, and a small value truncates replies mid-sentence).
Content blocks are stored in `messages` as JSON strings so the one internal
shape still fits: the assistant's tool turn is a stringified array of
`{type: "text"}` and `{type: "tool_use", id, name, input}` blocks, and the
results are one user message whose content is a stringified array of
`{type: "tool_result", tool_use_id, content}`. `buildRequestBody()` parses
any string content that begins with `[` back into an array before sending.

**Normalising tool calls.** `normalizeToolCalls()` keeps `tool_use` blocks
for Anthropic and entries with a `function.name` otherwise.
`extractToolCallInfo()` yields `{id, name, args}`, parsing the OpenAI
`arguments` string as JSON (an unparsable string becomes `{}`).

## The Rust proxy and streaming

`llm_chat_stream` in `llm.rs` receives `{url, apiKey, body, provider}`,
sets `Authorization: Bearer <key>` for OpenAI-compatible hosts or
`x-api-key` plus `anthropic-version: 2023-06-01` for Anthropic (no header
when the key is blank, which is the local-server case), posts the body with
reqwest and reads the response as a byte stream. The webview never talks to
the provider, so there is no CORS and the key is not in page scripts.

A status of 400 or more ends the call at once: the body's `error.message`
(or `error`) is sent back in a single `llm-done` event with `error` set.

Otherwise the stream is split into lines and each `data: ` line is parsed:

- OpenAI-compatible: `choices[0].delta.content` is appended to the text and
  emitted as an `llm-chunk` event; `delta.tool_calls[]` entries are merged
  by `index`, with `id` and `function.name` set when they appear and
  `function.arguments` concatenated across chunks. `data: [DONE]` ends it.
- Anthropic: `content_block_start` with a `tool_use` block opens a call at
  that index; `content_block_delta` of type `text_delta` is text, of type
  `input_json_delta` accumulates `partial_json` on the open call;
  `content_block_stop` parses the accumulated JSON into `input`.

When the stream ends, one `llm-done` event carries `{full_text, tool_calls,
error}`. `sendChatStream()` on the TypeScript side registers both listeners
before invoking the command and removes them on `llm-done`, so a slow
first byte cannot lose chunks.

`llm_chat` is the non-streaming twin with the same headers, used for
nothing in the chat loop today but kept for completeness; `llm_list_models`
is a GET for the models endpoint.

## Timing, the status bar and the log

`streamTurn()` starts a `Stopwatch` before the request, notes the elapsed
time at the first chunk, and after `llm-done` calls `computeTiming(total,
firstTokenAt, text)`: `estTokens` is `chars / 4` (providers rarely report
usage over SSE), `tokPerSec` is tokens after the first one divided by the
time after the first token, left null when nothing streamed or the window
is under 50 ms.

Three things are done with it:

- The reply's meta line gets `summarizeTiming()` (hidden unless Settings →
  Chat display → Show timing under replies is on).
- The status bar's `#status-timing` gets `statusTiming(timing, docChars)`:
  `first token 180ms · 62 tok/s · 1.80s · ≈100 tok · 1,234 chars to document`.
  `docChars` is the running count of characters the turn put into the
  document through `document_write` (the new text's length),
  `document_replace` (replacement length times count) and
  `document_insert`; it is cleared when a turn starts and refreshed once
  more when the turn ends. It is keyed by session, so a background chat's
  turn never writes to the status bar of the tab in front.
- An `llm` line goes to the performance log with provider, model, host,
  `ttft_ms`, `total_ms`, `chars`, `est_tokens`, `tok_per_s`, `tool_calls`
  and `error`.

The log also gets a `tool` line per tool call and a `turn` line per user
message (`total_ms`, `llm_calls`, `tool_calls`, `aborted`). `logEvent()`
writes through the `log_append` command only when Settings → Diagnostics →
Write performance log is on; in-process listeners (the log tab) get every
event regardless.

## Slash commands

Input beginning with `/` never reaches the model. `handleSlashCommand()`
answers `/help`, `/clear`, `/model [name|default]`, `/memory`, `/tools` and
`/log` with an assistant bubble that is not recorded in the transcript.
`/model` sets `session.model`, which `effectiveSettings()` lays over the
Settings model for that chat's requests only; the host and provider are
always the Settings ones.

## Persistence

`exportChatHistory()` writes, for each open tab whose file is under the
project root, `{transcript, model, view}` keyed by project-relative path,
plus the project chat; untitled tabs and files outside the root are
skipped. `importChatHistory()` seeds the sessions of the tabs that are open
when the project loads and sets their pane layout. `messages` is rebuilt
from the transcript as plain turns: the model gets the conversation back
but is not shown old tool calls, which keeps restored histories small and
provider-neutral.

## Testing the loop without a model

- `chat-utils.test.ts` covers the prompt text per scope, the tool counts
  and the provider mappings.
- `chat-ui.loop.test.ts` mounts the pane under happy-dom with a stubbed
  `sendChatStream`, scripts replies with tool calls, and asserts bubbles,
  dispatch results, the scope errors, the review flow and the status bar
  line.
- The Playwright suite drives the real frontend against mocked Tauri
  commands (`e2e/mocks/tauri-core.ts`). `e2e/agentic.spec.ts` installs a
  `customStreamHandler` that answers the Nth `llm_chat_stream` call by
  emitting `llm-chunk` and `llm-done` on the in-page event bus, so a whole
  multi-round turn, including a diff card and its Accept, runs with no
  network.

## Adding a tool

1. Schema in `chat-utils.ts`, in the right list for its scope; the
   description is what the model reads.
2. A line for it in the matching prose block of `buildSystemPrompt()`.
3. A `case` in `dispatchTool` whose first line is the scope gate, returning
   a JSON string; `{"error"}` on failure.
4. If it edits, route through `reviewEdit()` and count document characters
   with `countDocChars()`.
5. Update the tool-count assertions in `chat-utils.test.ts`, the `/tools`
   text in `chat-ui.ts`, and the tables in `agents.md`,
   `docs/llm-integration.md`, `llms.txt` and this file.
