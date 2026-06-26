import { invoke } from "@tauri-apps/api/core";
import { loadSettings, isConfigured } from "../settings/settings";
import { sendChatStream, type ChatMessage } from "./providers";
import { getMarkdown, setMarkdown, undo, redo, insertAtCursor, getSelection } from "../editor/editor";
import {
  buildSystemPrompt,
  getTools,
  normalizeToolCalls,
  extractToolCallInfo,
  buildToolResultMessages,
  buildAssistantToolCallMessage,
} from "./chat-utils";
// @ts-ignore — core parser, direct ESM import
import quikdown from "quikdown";

// --- State ---
let messages: ChatMessage[] = [];
let sending = false;
let abortRequested = false;
let projectMode = false;

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

/**
 * Dispatch a tool call and return the result string.
 */
export async function dispatchTool(name: string, args: any): Promise<string> {
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
  if (!loadSettings().showToolCalls) return;
  const div = document.createElement("div");
  div.className = "chat-msg tool";
  const shortResult = result.length > 200 ? result.substring(0, 200) + "..." : result;
  div.textContent = `${name}() → ${shortResult}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
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

  const tools = getTools(settings.provider, projectMode);
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
          let loopAccum = "";
          let loopBubble: HTMLDivElement | null = null;
          let loopTimer: ReturnType<typeof setTimeout> | null = null;

          const loopStream = sendChatStream(settings, toSend, tools, (token: string) => {
            loopAccum += token;
            if (!loopBubble) {
              loopBubble = appendBubble("assistant", loopAccum);
              loopBubble.classList.add("streaming");
            }
            if (!loopTimer) {
              loopTimer = setTimeout(() => {
                loopTimer = null;
                if (loopBubble) updateBubble(loopBubble, loopAccum);
              }, 50);
            }
          });

          const loopResult = await loopStream.done;

          if (loopTimer) {
            clearTimeout(loopTimer);
            loopTimer = null;
          }
          // loopBubble is mutated inside the onChunk closure, so TS can't track it
          const bubble = loopBubble as HTMLDivElement | null;
          if (bubble) bubble.classList.remove("streaming");

          if (loopResult.error) {
            if (!bubble) {
              appendBubble("assistant", `Error: ${loopResult.error}`);
            } else {
              updateBubble(bubble, `Error: ${loopResult.error}`);
            }
            break;
          }

          const moreCalls = normalizeToolCalls(loopResult.toolCalls, settings.provider);
          if (moreCalls.length > 0) {
            if (loopResult.fullText && bubble) {
              updateBubble(bubble, loopResult.fullText);
              messages.push({ role: "assistant", content: loopResult.fullText });
            } else if (bubble) {
              bubble.remove();
            }

            const asstMsg = buildAssistantToolCallMessage(moreCalls, loopResult.fullText, settings.provider);
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

          const content = loopResult.fullText || "";
          if (bubble) {
            updateBubble(bubble, content);
          } else {
            appendBubble("assistant", content || "(empty response)");
          }
          messages.push({ role: "assistant", content });
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
export function handleSlashCommand(text: string): boolean {
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
