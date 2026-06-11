import { invoke } from "@tauri-apps/api/core";
import { loadSettings, isConfigured } from "../settings/settings";
import { sendChat, sendChatStream, type ChatMessage } from "./providers";
import { getMarkdown, setMarkdown, undo, redo, insertAtCursor, getSelection } from "../editor/editor";
// @ts-ignore — core parser, direct ESM import
import quikdown from "quikdown";

// --- State ---
let messages: ChatMessage[] = [];
let sending = false;
let abortRequested = false;
let projectMode = false;

/** Timeout wrapper for promises (default 60s) */
function withTimeout<T>(promise: Promise<T>, ms = 60000, label = "LLM call"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// --- DOM refs ---
const chatMessages = document.getElementById("chat-messages")!;
const chatInput = document.getElementById("chat-input") as HTMLTextAreaElement;
const chatSend = document.getElementById("chat-send") as HTMLButtonElement;

// --- Inject quikdown styles once ---
let stylesInjected = false;
function ensureQuikdownStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = quikdown.emitStyles("", "light");
  document.head.appendChild(style);
}

// --- Dynamic system prompt ---
function buildSystemPrompt(isProjectMode: boolean): string {
  let prompt = `You are QD, a friendly AI document assistant built into qdedit, a markdown editor.
You help users write, edit, and improve markdown documents. Keep responses concise and helpful.

You have access to the following tools to interact with the editor:

**Document tools:**
- **document_read**: Read the current document content. Always call this first before making edits.
- **document_write**: Replace the entire document with new markdown content.
- **document_replace**: Find and replace specific text in the document.
- **document_insert**: Insert text at the current cursor position.
- **document_undo**: Undo the last editor change.
- **document_redo**: Redo the last undone change.
- **document_get_selection**: Get the currently selected text in the editor.

**Memory tools** (scratchpad for persisting notes across the conversation):
- **memory_read**: Read the scratchpad contents.
- **memory_write**: Overwrite the scratchpad with new content.
- **memory_append**: Append text to the scratchpad.
- **memory_clear**: Clear the scratchpad.

**Key-value store** (persistent named storage with timestamps):
- **kv_get**: Get a value by key.
- **kv_set**: Set a key-value pair.
- **kv_delete**: Delete a key.
- **kv_list**: List all keys with their last-modified timestamps.`;

  if (isProjectMode) {
    prompt += `

**File tools** (available in project mode — operate relative to the project root):
- **file_read**: Read a file's contents by relative path.
- **file_write**: Write content to a file by relative path.
- **file_list**: List directory contents (optionally recursive).
- **file_stat**: Get file metadata (size, modified date, type).`;
  }

  prompt += `

When the user asks you to read, edit, modify, or improve the document, use the document tools.
First call document_read to see the current content, then use document_write or document_replace to make changes.
Use markdown formatting in your replies. Sign off briefly as QD when appropriate.`;

  return prompt;
}

// --- Tool definitions for the LLM ---

// Document tools (always available)
const DOC_TOOLS_OPENAI = [
  {
    type: "function",
    function: {
      name: "document_read",
      description: "Read the full markdown content of the current editor buffer. Call this before making any edits.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "document_write",
      description: "Replace the entire editor buffer with new markdown content",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The new markdown content" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "document_replace",
      description: "Find and replace text in the editor buffer",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Text to find" },
          replace: { type: "string", description: "Replacement text" },
          all: { type: "boolean", description: "Replace all occurrences (default: false)" },
        },
        required: ["search", "replace"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "document_insert",
      description: "Insert text at the current cursor position in the editor",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to insert at cursor" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "document_undo",
      description: "Undo the last change in the editor",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "document_redo",
      description: "Redo the last undone change in the editor",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "document_get_selection",
      description: "Get the currently selected text in the editor",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// Memory tools (always available)
const MEMORY_TOOLS_OPENAI = [
  {
    type: "function",
    function: {
      name: "memory_read",
      description: "Read the contents of the scratchpad memory",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_write",
      description: "Overwrite the scratchpad memory with new content",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "New scratchpad content" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_append",
      description: "Append text to the scratchpad memory",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Text to append" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_clear",
      description: "Clear all scratchpad memory contents",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// KV tools (always available)
const KV_TOOLS_OPENAI = [
  {
    type: "function",
    function: {
      name: "kv_get",
      description: "Get a value from the key-value store",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "The key to look up" },
        },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kv_set",
      description: "Set a key-value pair in the store",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "The key" },
          value: { type: "string", description: "The value to store" },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kv_delete",
      description: "Delete a key from the key-value store",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "The key to delete" },
        },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kv_list",
      description: "List all keys in the key-value store with their last-modified timestamps",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// File tools (project mode only)
const FILE_TOOLS_OPENAI = [
  {
    type: "function",
    function: {
      name: "file_read",
      description: "Read a file's contents by path relative to the project root",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_write",
      description: "Write content to a file by path relative to the project root",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          content: { type: "string", description: "File content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_list",
      description: "List directory contents relative to the project root",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path (empty for root)" },
          recursive: { type: "boolean", description: "List recursively (default: false)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_stat",
      description: "Get file metadata (size, modified date, type) for a path relative to the project root",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
        },
        required: ["path"],
      },
    },
  },
];

/** Convert OpenAI tool format to Anthropic tool format */
function toAnthropicTool(t: any): any {
  return {
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  };
}

function getTools(provider: string): any[] {
  const tools = [
    ...DOC_TOOLS_OPENAI,
    ...MEMORY_TOOLS_OPENAI,
    ...KV_TOOLS_OPENAI,
    ...(projectMode ? FILE_TOOLS_OPENAI : []),
  ];
  return provider === "anthropic" ? tools.map(toAnthropicTool) : tools;
}

/**
 * Dispatch a tool call and return the result string.
 */
async function dispatchTool(name: string, args: any): Promise<string> {
  switch (name) {
    // --- Document tools ---
    case "document_read": {
      const md = getMarkdown();
      return JSON.stringify({ content: md });
    }
    case "document_write": {
      setMarkdown(args.content);
      return JSON.stringify({ success: true });
    }
    case "document_replace": {
      let md = getMarkdown();
      let count = 0;
      if (args.all) {
        const parts = md.split(args.search);
        count = parts.length - 1;
        md = parts.join(args.replace);
      } else {
        const idx = md.indexOf(args.search);
        if (idx !== -1) {
          md = md.substring(0, idx) + args.replace + md.substring(idx + args.search.length);
          count = 1;
        }
      }
      if (count > 0) setMarkdown(md);
      return JSON.stringify({ count });
    }
    case "document_insert": {
      insertAtCursor(args.text);
      return JSON.stringify({ success: true });
    }
    case "document_undo": {
      undo();
      return JSON.stringify({ success: true });
    }
    case "document_redo": {
      redo();
      return JSON.stringify({ success: true });
    }
    case "document_get_selection": {
      const sel = getSelection();
      return JSON.stringify({ selection: sel });
    }

    // --- Memory tools ---
    case "memory_read": {
      const content = await invoke<string>("memory_read");
      return JSON.stringify({ content });
    }
    case "memory_write": {
      await invoke("memory_write", { content: args.content });
      return JSON.stringify({ success: true });
    }
    case "memory_append": {
      await invoke("memory_append", { content: args.content });
      return JSON.stringify({ success: true });
    }
    case "memory_clear": {
      await invoke("memory_clear");
      return JSON.stringify({ success: true });
    }

    // --- KV tools ---
    case "kv_get": {
      const entry = await invoke<any>("kv_get", { key: args.key });
      return JSON.stringify(entry ?? { error: "Key not found" });
    }
    case "kv_set": {
      const result = await invoke<any>("kv_set", { key: args.key, value: args.value });
      return JSON.stringify(result);
    }
    case "kv_delete": {
      const deleted = await invoke<boolean>("kv_delete", { key: args.key });
      return JSON.stringify({ deleted });
    }
    case "kv_list": {
      const list = await invoke<any>("kv_list");
      return JSON.stringify(list);
    }

    // --- File tools (project mode) ---
    case "file_read": {
      if (!projectMode) return JSON.stringify({ error: "File tools are only available in project mode" });
      const content = await invoke<string>("file_read", { path: args.path });
      return JSON.stringify({ content });
    }
    case "file_write": {
      if (!projectMode) return JSON.stringify({ error: "File tools are only available in project mode" });
      await invoke("file_write", { path: args.path, content: args.content });
      return JSON.stringify({ success: true });
    }
    case "file_list": {
      if (!projectMode) return JSON.stringify({ error: "File tools are only available in project mode" });
      const result = await invoke<any>("file_list", {
        path: args.path || null,
        recursive: args.recursive || false,
      });
      return JSON.stringify(result);
    }
    case "file_stat": {
      if (!projectMode) return JSON.stringify({ error: "File tools are only available in project mode" });
      const stat = await invoke<any>("file_stat", { path: args.path });
      return JSON.stringify(stat);
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

/**
 * Set whether the chat is in project mode (enables file tools).
 */
export function setProjectMode(enabled: boolean) {
  projectMode = enabled;
}

/**
 * Render markdown to HTML for assistant messages.
 */
function renderMarkdown(text: string): string {
  ensureQuikdownStyles();
  return quikdown(text);
}

/**
 * Add a message bubble to the chat UI.
 * For assistant messages, renders markdown as HTML.
 * Returns the created div element so it can be updated during streaming.
 */
function appendBubble(role: string, text: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  if (role === "assistant") {
    div.innerHTML = renderMarkdown(text);
  } else {
    div.textContent = text;
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

/**
 * Update an existing assistant bubble with new markdown content.
 */
function updateBubble(div: HTMLDivElement, text: string) {
  div.innerHTML = renderMarkdown(text);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Show a tool call in the chat as a compact entry.
 */
function appendToolBubble(name: string, result: string) {
  const div = document.createElement("div");
  div.className = "chat-msg tool";
  const shortResult = result.length > 200 ? result.substring(0, 200) + "..." : result;
  div.textContent = `${name}() → ${shortResult}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Normalize tool calls from streaming done payload.
 * Handles both OpenAI and Anthropic formats uniformly.
 */
function normalizeToolCalls(toolCalls: any[], provider: string): any[] {
  if (!toolCalls || toolCalls.length === 0) return [];

  if (provider === "anthropic") {
    return toolCalls.filter((tc: any) => tc.type === "tool_use");
  }

  return toolCalls.filter((tc: any) => tc.function?.name);
}

/**
 * Extract name and args from a tool call, handling both provider formats.
 */
function extractToolCallInfo(tc: any, provider: string): { id: string; name: string; args: any } {
  if (provider === "anthropic") {
    return {
      id: tc.id || "",
      name: tc.name || "",
      args: tc.input || {},
    };
  }
  const fn = tc.function;
  let args: any = {};
  try {
    args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments || {};
  } catch {}
  return {
    id: tc.id || "",
    name: fn.name,
    args,
  };
}

/**
 * Build tool result messages in the correct format for the provider.
 */
function buildToolResultMessages(
  results: { id: string; content: string }[],
  provider: string
): ChatMessage[] {
  if (provider === "anthropic") {
    return [{
      role: "user",
      content: JSON.stringify(results.map(r => ({
        type: "tool_result",
        tool_use_id: r.id,
        content: r.content,
      }))),
    }];
  }
  return results.map(r => ({
    role: "tool" as const,
    tool_call_id: r.id,
    content: r.content,
  }));
}

/**
 * Build an assistant message with tool calls for message history.
 */
function buildAssistantToolCallMessage(toolCalls: any[], fullText: string, provider: string): ChatMessage {
  if (provider === "anthropic") {
    const contentBlocks: any[] = [];
    if (fullText) {
      contentBlocks.push({ type: "text", text: fullText });
    }
    for (const tc of toolCalls) {
      contentBlocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.input || {},
      });
    }
    return {
      role: "assistant",
      content: JSON.stringify(contentBlocks),
    };
  }
  return {
    role: "assistant",
    content: fullText || null,
    tool_calls: toolCalls,
  };
}

/**
 * Send user message and run the tool-calling loop with streaming.
 */
async function send() {
  const text = chatInput.value.trim();
  if (!text || sending) return;

  const settings = loadSettings();
  if (!isConfigured(settings)) {
    appendBubble("assistant", "No LLM configured. Click Settings to set up a provider.");
    return;
  }

  sending = true;
  abortRequested = false;
  chatSend.textContent = "Stop";
  chatSend.disabled = false;
  chatSend.classList.add("stop-mode");
  chatInput.value = "";

  messages.push({ role: "user", content: text });
  appendBubble("user", text);

  const tools = getTools(settings.provider);
  const systemPrompt = buildSystemPrompt(projectMode);

  const toSend: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const ref = { bubble: null as HTMLDivElement | null };
  let accumulated = "";
  let renderTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    const stream = sendChatStream(settings, toSend, tools, (token: string) => {
      accumulated += token;
      if (!ref.bubble) {
        ref.bubble = appendBubble("assistant", accumulated);
        ref.bubble.classList.add("streaming");
      }
      if (!renderTimer) {
        renderTimer = setTimeout(() => {
          renderTimer = null;
          if (ref.bubble) updateBubble(ref.bubble, accumulated);
        }, 50);
      }
    });

    const result = await stream.done;

    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    if (ref.bubble) ref.bubble.classList.remove("streaming");

    if (result.error) {
      if (!ref.bubble) {
        appendBubble("assistant", `Error: ${result.error}`);
      } else {
        updateBubble(ref.bubble, `Error: ${result.error}`);
      }
      messages.push({ role: "assistant", content: `Error: ${result.error}` });
      sending = false;
      chatSend.disabled = false;
      chatInput.focus();
      return;
    }

    const toolCalls = normalizeToolCalls(result.toolCalls, settings.provider);

    if (toolCalls.length === 0) {
      if (ref.bubble) {
        updateBubble(ref.bubble, result.fullText);
      } else {
        appendBubble("assistant", result.fullText || "(empty response)");
      }
      messages.push({ role: "assistant", content: result.fullText });
    } else {
      if (result.fullText && ref.bubble) {
        updateBubble(ref.bubble, result.fullText);
        messages.push({ role: "assistant", content: result.fullText });
      } else if (ref.bubble) {
        ref.bubble.remove();
      }

      const assistantMsg = buildAssistantToolCallMessage(toolCalls, result.fullText, settings.provider);
      messages.push(assistantMsg);
      toSend.push(assistantMsg);

      const toolResults: { id: string; content: string }[] = [];
      for (const tc of toolCalls) {
        const { id, name, args } = extractToolCallInfo(tc, settings.provider);
        const toolResult = await dispatchTool(name, args);
        appendToolBubble(name, toolResult);
        toolResults.push({ id, content: toolResult });
      }

      const toolMsgs = buildToolResultMessages(toolResults, settings.provider);
      for (const tm of toolMsgs) {
        messages.push(tm);
        toSend.push(tm);
      }

      let iterations = 0;
      while (iterations < 10) {
        if (abortRequested) {
          appendBubble("assistant", "(Stopped by user)");
          break;
        }
        iterations++;

        try {
          const loopResult = await withTimeout(sendChat(settings, toSend, tools), 60000, "Tool loop call");
          const msg = loopResult.message;

          const moreCalls = normalizeToolCalls(msg.tool_calls || [], settings.provider);
          if (moreCalls.length > 0) {
            const asstMsg = buildAssistantToolCallMessage(moreCalls, msg.content || "", settings.provider);
            messages.push(asstMsg);
            toSend.push(asstMsg);

            const moreResults: { id: string; content: string }[] = [];
            for (const tc of moreCalls) {
              if (abortRequested) break;
              const { id, name, args } = extractToolCallInfo(tc, settings.provider);
              const toolResult = await dispatchTool(name, args);
              appendToolBubble(name, toolResult);
              moreResults.push({ id, content: toolResult });
            }

            if (abortRequested) {
              appendBubble("assistant", "(Stopped by user)");
              break;
            }

            const moreToolMsgs = buildToolResultMessages(moreResults, settings.provider);
            for (const tm of moreToolMsgs) {
              messages.push(tm);
              toSend.push(tm);
            }
            continue;
          }

          const content = msg.content || "";
          messages.push({ role: "assistant", content });
          appendBubble("assistant", content);
          break;
        } catch (e: any) {
          appendBubble("assistant", `Error: ${e.message || e}`);
          break;
        }
      }

      if (iterations >= 10 && !abortRequested) {
        appendBubble("assistant", "(Tool loop reached maximum iterations)");
      }
    }
  } catch (e: any) {
    appendBubble("assistant", `Error: ${e.message || e}`);
  }

  sending = false;
  abortRequested = false;
  chatSend.textContent = "Send";
  chatSend.disabled = false;
  chatSend.classList.remove("stop-mode");
  chatInput.focus();
}

/**
 * Handle slash commands. Returns true if the input was a command.
 */
function handleSlashCommand(text: string): boolean {
  const cmd = text.trim().toLowerCase();

  if (cmd === "/help") {
    appendBubble("assistant", `**QD Slash Commands**

| Command | Description |
|---------|-------------|
| \`/help\` | Show this help |
| \`/clear\` | Clear chat history |
| \`/model\` | Show current LLM model |
| \`/memory\` | Show scratchpad contents |
| \`/tools\` | List available tools |

You can also just type naturally — I can read, edit, and improve your document.`);
    return true;
  }

  if (cmd === "/clear") {
    messages.length = 0;
    chatMessages.innerHTML = "";
    showWelcome();
    return true;
  }

  if (cmd === "/model") {
    const s = loadSettings();
    if (isConfigured(s)) {
      appendBubble("assistant", `Currently using **${s.model}** via ${s.host}`);
    } else {
      appendBubble("assistant", "No LLM configured. Click **Settings** in the titlebar to set one up.");
    }
    return true;
  }

  if (cmd === "/memory") {
    invoke<string>("memory_read").then((content) => {
      if (content) {
        appendBubble("assistant", `**Scratchpad contents:**\n\n${content}`);
      } else {
        appendBubble("assistant", "Scratchpad is empty.");
      }
    }).catch(() => {
      appendBubble("assistant", "Failed to read scratchpad.");
    });
    return true;
  }

  if (cmd === "/tools") {
    let toolList = `**Available tools:**

**Document:** read, write, replace, insert, undo, redo, get selection
**Memory:** read, write, append, clear
**Key-Value:** get, set, delete, list`;
    if (projectMode) {
      toolList += `\n**File:** read, write, list, stat`;
    }
    appendBubble("assistant", toolList);
    return true;
  }

  return false;
}

function showWelcome() {
  appendBubble("assistant", `Hi, I'm **QD** — your document assistant. I can help you write, edit, and improve your markdown. Type \`/help\` for commands.`);
}

export function initChat() {
  ensureQuikdownStyles();
  showWelcome();

  chatSend.addEventListener("click", () => {
    if (sending) {
      abortRequested = true;
      chatSend.disabled = true;
      chatSend.textContent = "Stopping...";
    } else {
      const text = chatInput.value.trim();
      if (text.startsWith("/")) {
        chatInput.value = "";
        if (!handleSlashCommand(text)) {
          appendBubble("assistant", `Unknown command: \`${text}\`. Type \`/help\` for available commands.`);
        }
      } else {
        send();
      }
    }
  });
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sending) {
        const text = chatInput.value.trim();
        if (text.startsWith("/")) {
          chatInput.value = "";
          if (!handleSlashCommand(text)) {
            appendBubble("assistant", `Unknown command: \`${text}\`. Type \`/help\` for available commands.`);
          }
        } else {
          send();
        }
      }
    }
  });
}
