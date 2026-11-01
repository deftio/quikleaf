import bw from "bitwrench";
import type { Taco, TacoContent } from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import { loadSettings, isConfigured, editApprovalOf } from "../settings/settings";
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
import { el, withAttrs } from "../ui/taco";
import { REJECTED_RESULT, cancelPendingReviews, requestApproval, showAppliedDiff, type ReviewRequest } from "./review";
import { planSet, planUpdate, resetPlan } from "./plan";
import { outlineOf } from "./outline";
import { activeTab, listTabs, openPath, showTab } from "../editor/documents";
import { setStatusTiming } from "../ui/shell";
import { Stopwatch, computeTiming, describeEntry, formatClock, formatMs, getLogPath, isPerfLogEnabled, logEvent, summarizeTiming, tailLog } from "../diag/perf";
// @ts-ignore — core parser, direct ESM import
import quikdown from "quikdown";

// --- State ---
let messages: ChatMessage[] = [];
let sending = false;
let abortRequested = false;
let projectMode = false;

const MIN_WIDTH = 300;
const MAX_WIDTH = 600;

/** Per-send accounting for the `turn` log entry. */
let turnStats = { sw: new Stopwatch(), llmCalls: 0, toolCalls: 0 };

// --- Inject quikdown styles once ---
let stylesInjected = false;
function ensureQuikdownStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  bw.injectCSS(quikdown.emitStyles("", "light"), { id: "quikdown_css" });
}

/**
 * Whether an edit of this kind must be approved in the chat before it is
 * applied. Read from settings on every call so a change in the dialog
 * applies to the next tool call.
 */
function approvalRequired(kind: ReviewRequest["kind"]): boolean {
  const policy = editApprovalOf(loadSettings());
  if (policy === "always") return true;
  if (policy === "files") return kind === "file";
  return false;
}

/**
 * Gate a proposed edit: show a review card and wait when the policy says so,
 * otherwise show the diff as already applied. Resolves `false` when the user
 * rejected (or Stop cancelled) the change.
 */
async function reviewEdit(req: ReviewRequest): Promise<boolean> {
  if (approvalRequired(req.kind)) return requestApproval(req);
  showAppliedDiff(req);
  return true;
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
      const after = typeof args.content === "string" ? args.content : String(args.content ?? "");
      if (!(await reviewEdit({ kind: "document", before: getMarkdown(), after }))) return REJECTED_RESULT;
      setMarkdown(after);
      return JSON.stringify({ success: true });
    }
    case "document_replace": {
      const before = getMarkdown();
      let md = before;
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
      if (count > 0) {
        if (!(await reviewEdit({ kind: "document", before, after: md }))) return REJECTED_RESULT;
        setMarkdown(md);
      }
      return JSON.stringify({ count });
    }
    case "document_outline": {
      return JSON.stringify({ headings: outlineOf(getMarkdown()) });
    }

    // --- Tab tools ---
    case "tabs_list": {
      const current = activeTab();
      return JSON.stringify({
        tabs: listTabs().map((t) => ({ id: t.id, title: t.title, path: t.path, dirty: t.dirty, active: current?.id === t.id })),
      });
    }
    case "tab_switch": {
      const tabs = listTabs();
      const target = tabs.find((t) => args?.id && t.id === args.id) ?? tabs.find((t) => args?.path && t.path === args.path);
      if (!target) return JSON.stringify({ error: "No open tab matches that id or path; call tabs_list first" });
      const shown = await showTab(target.id);
      return JSON.stringify({ success: !!shown, id: target.id, title: target.title, path: target.path });
    }
    case "tab_open": {
      if (!projectMode) return JSON.stringify({ error: "tab_open is only available in project mode" });
      if (typeof args?.path !== "string" || !args.path) return JSON.stringify({ error: "tab_open needs a path" });
      const tab = await openPath(args.path, true);
      if (!tab) return JSON.stringify({ error: `Could not open ${args.path}` });
      return JSON.stringify({ success: true, id: tab.id, title: tab.title, path: tab.path });
    }

    // --- Planning tools ---
    case "plan_set":
      return planSet(args ?? {});
    case "plan_update":
      return planUpdate(args ?? {});
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
      const after = typeof args.content === "string" ? args.content : String(args.content ?? "");
      if (approvalRequired("file")) {
        // Current contents for the diff; a missing file diffs against "".
        let before = "";
        try {
          before = await invoke<string>("file_read", { path: args.path });
        } catch {}
        if (!(await requestApproval({ kind: "file", path: args.path, before, after }))) return REJECTED_RESULT;
      }
      await invoke("file_write", { path: args.path, content: after });
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
    case "project_search": {
      if (!projectMode) return JSON.stringify({ error: "File tools are only available in project mode" });
      const query = typeof args.query === "string" ? args.query : "";
      if (!query) return JSON.stringify({ error: "project_search needs a non-empty query" });
      const result = await invoke<any>("project_search", {
        query,
        path: args.path || null,
        regex: !!args.regex,
        maxResults: typeof args.max_results === "number" ? args.max_results : null,
      });
      return JSON.stringify(result);
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

// --- View -------------------------------------------------------------------

/** The chat side panel as TACO. Hidden until the user opens it. */
export function makeChatPanel(): Taco {
  return {
    t: "div",
    a: { id: "chat-panel", class: "hidden" },
    c: [
      { t: "div", a: { id: "chat-messages", role: "log", "aria-live": "polite" } },
      {
        t: "div",
        a: { id: "chat-input-area" },
        c: [
          bw.makeTextarea({ id: "chat-input", rows: 2, placeholder: "Ask the LLM...", onkeydown: onInputKeydown }),
          withAttrs(bw.makeButton({ text: "Send", variant: "primary", onclick: onSendClick }), { id: "chat-send" }),
        ],
      },
      makeResizeHandle(),
    ],
  };
}

/**
 * Drag handle on the panel's right edge. The mousedown lives in `a:`; the
 * document-level move/up listeners are installed once by `initChat()`.
 * Inline `cursor: ew-resize` is what the e2e suite looks for.
 */
function makeResizeHandle(): Taco {
  return {
    t: "div",
    a: {
      class: "chat-resize-handle",
      style: { position: "absolute", right: "-4px", top: "0", bottom: "0", width: "8px", cursor: "ew-resize", "z-index": "10" },
      onmousedown: (e: MouseEvent) => {
        const panel = el("chat-panel");
        if (!panel) return;
        resize = { startX: e.clientX, startWidth: panel.offsetWidth, handle: e.currentTarget as HTMLElement };
        document.body.style.cursor = "ew-resize";
        document.body.style.userSelect = "none";
        bw.addClass(resize.handle, "dragging");
      },
    },
  };
}

let resize: { startX: number; startWidth: number; handle: HTMLElement } | null = null;

function onDocumentMouseMove(e: MouseEvent) {
  if (!resize) return;
  const panel = el("chat-panel");
  if (!panel) return;
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, resize.startWidth + e.clientX - resize.startX));
  panel.style.width = `${width}px`;
}

function onDocumentMouseUp() {
  if (!resize) return;
  bw.removeClass(resize.handle, "dragging");
  resize = null;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

function inputEl(): HTMLTextAreaElement | null {
  return el<HTMLTextAreaElement>("chat-input");
}

function sendButton(): HTMLButtonElement | null {
  return el<HTMLButtonElement>("chat-send");
}

function scrollToBottom() {
  const log = el("chat-messages");
  if (log) log.scrollTop = log.scrollHeight;
}

/**
 * Render markdown to HTML for assistant messages.
 */
function renderMarkdown(text: string): string {
  ensureQuikdownStyles();
  return quikdown(text);
}

/**
 * A rendered message: the bubble root, its body (patched while streaming)
 * and its meta line (timestamp, timing). Kept as element refs returned by
 * `bw.append`, so no DOM querying is needed later.
 */
interface Bubble {
  root: HTMLElement;
  body: HTMLElement;
  meta: HTMLElement;
}

function metaParts(stamp: string, detail?: string): TacoContent {
  const parts: Taco[] = [{ t: "time", a: { class: "chat-time" }, c: stamp }];
  if (detail) parts.push({ t: "span", a: { class: "chat-timing" }, c: detail });
  return parts;
}

/**
 * Add a message bubble to the chat log. Assistant messages are rendered
 * markdown; user and tool messages are plain text. Every bubble carries a
 * meta line with its timestamp; the panel's `show-timestamps` class decides
 * whether it is visible, so toggling the setting updates old messages too.
 */
function appendBubble(role: "user" | "assistant" | "tool", text: string, detail?: string): Bubble {
  // bitwrench 2.1.11 resolves string targets for append() as selectors only,
  // so pass the element (the bare-id form is fixed in 2.1.12).
  const log = el("chat-messages");
  if (!log) throw new Error("quikleaf: #chat-messages is not mounted");
  const root = bw.append(log, { t: "div", a: { class: `chat-msg ${role}` } });
  const body = bw.append(root, {
    t: "div",
    a: { class: "chat-body" },
    c: role === "assistant" ? bw.raw(renderMarkdown(text)) : text,
  });
  const meta = bw.append(root, { t: "div", a: { class: "chat-meta" }, c: metaParts(formatClock(), detail) });
  scrollToBottom();
  return { root, body, meta };
}

/**
 * Update an existing assistant bubble with new markdown content.
 */
function updateBubble(bubble: Bubble, text: string) {
  bw.patch(bubble.body, bw.raw(renderMarkdown(text)));
  scrollToBottom();
}

/** Replace a bubble's meta line (timestamp stays, detail changes). */
function setBubbleDetail(bubble: Bubble, detail: string) {
  const stamp = bubble.meta.querySelector("time")?.textContent || formatClock();
  bw.patch(bubble.meta, metaParts(stamp, detail));
}

/**
 * Show a tool call in the chat as a compact entry. Always appended; the
 * panel's `show-tools` class decides visibility.
 */
function appendToolBubble(name: string, result: string, ms: number) {
  const shortResult = result.length > 200 ? result.substring(0, 200) + "..." : result;
  appendBubble("tool", `${name}() → ${shortResult}`, formatMs(ms));
}

/** Run one tool, time it, show it, log it. */
async function runTool(name: string, args: any): Promise<string> {
  const sw = new Stopwatch();
  let result: string;
  let ok = true;
  try {
    result = await dispatchTool(name, args);
    ok = !result.includes('"error"');
  } catch (e: any) {
    ok = false;
    result = JSON.stringify({ error: e?.message || String(e) });
  }
  const ms = sw.elapsed();
  appendToolBubble(name, result, ms);
  logEvent({ kind: "tool", name, ms: Math.round(ms), ok });
  return result;
}

function setSendState(state: "idle" | "sending" | "stopping") {
  const btn = sendButton();
  if (!btn) return;
  bw.patch(btn, state === "idle" ? "Send" : state === "sending" ? "Stop" : "Stopping...");
  bw.toggleClass(btn, "stop-mode", state !== "idle");
  btn.disabled = state === "stopping";
}

/**
 * Stream one assistant turn into a live bubble. Resolves with the provider
 * result and the bubble (if any text arrived).
 */
async function streamTurn(settings: ReturnType<typeof loadSettings>, toSend: ChatMessage[], tools: any[]) {
  let accumulated = "";
  let bubble: Bubble | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  const sw = new Stopwatch();
  let firstTokenAt: number | null = null;

  const stream = sendChatStream(settings, toSend, tools, (token: string) => {
    if (firstTokenAt === null) firstTokenAt = sw.elapsed();
    accumulated += token;
    if (!bubble) {
      bubble = appendBubble("assistant", accumulated);
      bw.addClass(bubble.root, "streaming");
    }
    if (!renderTimer) {
      renderTimer = setTimeout(() => {
        renderTimer = null;
        if (bubble) updateBubble(bubble, accumulated);
      }, 50);
    }
  });

  const result = await stream.done;

  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }
  // `bubble` is assigned inside the onChunk closure, so TS can't narrow it.
  const live = bubble as Bubble | null;
  if (live) bw.removeClass(live.root, "streaming");

  const timing = computeTiming(sw.elapsed(), firstTokenAt, result.fullText || accumulated);
  const summary = summarizeTiming(timing);
  if (live) setBubbleDetail(live, summary);
  setStatusTiming(`last: ${summary}`);
  logEvent({
    kind: "llm",
    provider: settings.provider,
    model: settings.model,
    host: settings.host,
    ttft_ms: timing.ttftMs === null ? null : Math.round(timing.ttftMs),
    total_ms: timing.totalMs,
    chars: timing.chars,
    est_tokens: timing.estTokens,
    tok_per_s: timing.tokPerSec,
    tool_calls: Array.isArray(result.toolCalls) ? result.toolCalls.length : 0,
    error: result.error || undefined,
  });
  return { result, bubble: live, timing };
}

/** Show `text` in the streaming bubble if there is one, else as a new bubble. */
function finishBubble(bubble: Bubble | null, text: string) {
  if (bubble) {
    updateBubble(bubble, text);
  } else {
    appendBubble("assistant", text || "(empty response)");
  }
}

/**
 * Send user message and run the tool-calling loop with streaming.
 */
async function send() {
  const input = inputEl();
  const text = input?.value.trim() ?? "";
  if (!text || sending) return;

  const settings = loadSettings();
  if (!isConfigured(settings)) {
    appendBubble("assistant", "No LLM configured. Click Settings to set up a provider.");
    return;
  }

  sending = true;
  abortRequested = false;
  setSendState("sending");
  if (input) input.value = "";
  turnStats = { sw: new Stopwatch(), llmCalls: 0, toolCalls: 0 };

  messages.push({ role: "user", content: text });
  appendBubble("user", text);

  const tools = getTools(settings.provider, projectMode);
  const systemPrompt = buildSystemPrompt(projectMode);

  const toSend: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...messages];

  try {
    const { result, bubble } = await streamTurn(settings, toSend, tools);
    turnStats.llmCalls++;

    if (result.error) {
      finishBubble(bubble, `Error: ${result.error}`);
      messages.push({ role: "assistant", content: `Error: ${result.error}` });
    } else {
      const toolCalls = normalizeToolCalls(result.toolCalls, settings.provider);

      if (toolCalls.length === 0) {
        finishBubble(bubble, result.fullText);
        messages.push({ role: "assistant", content: result.fullText });
      } else {
        if (result.fullText && bubble) {
          updateBubble(bubble, result.fullText);
          messages.push({ role: "assistant", content: result.fullText });
        } else if (bubble) {
          bw.remove(bubble.root);
        }

        const assistantMsg = buildAssistantToolCallMessage(toolCalls, result.fullText, settings.provider);
        messages.push(assistantMsg);
        toSend.push(assistantMsg);

        const toolResults: { id: string; content: string }[] = [];
        for (const tc of toolCalls) {
          const { id, name, args } = extractToolCallInfo(tc, settings.provider);
          const toolResult = await runTool(name, args);
          turnStats.toolCalls++;
          toolResults.push({ id, content: toolResult });
        }

        const toolMsgs = buildToolResultMessages(toolResults, settings.provider);
        for (const tm of toolMsgs) {
          messages.push(tm);
          toSend.push(tm);
        }

        await runToolLoop(settings, toSend, tools);
      }
    }
  } catch (e: any) {
    appendBubble("assistant", `Error: ${e.message || e}`);
  }

  logEvent({
    kind: "turn",
    total_ms: Math.round(turnStats.sw.elapsed()),
    llm_calls: turnStats.llmCalls,
    tool_calls: turnStats.toolCalls,
    aborted: abortRequested,
  });
  sending = false;
  abortRequested = false;
  setSendState("idle");
  inputEl()?.focus();
}

/** Keep calling the model while it keeps asking for tools (bounded). */
async function runToolLoop(settings: ReturnType<typeof loadSettings>, toSend: ChatMessage[], tools: any[]) {
  let iterations = 0;
  while (iterations < 10) {
    if (abortRequested) {
      appendBubble("assistant", "(Stopped by user)");
      return;
    }
    iterations++;

    try {
      const { result, bubble } = await streamTurn(settings, toSend, tools);
      turnStats.llmCalls++;

      if (result.error) {
        finishBubble(bubble, `Error: ${result.error}`);
        return;
      }

      const moreCalls = normalizeToolCalls(result.toolCalls, settings.provider);
      if (moreCalls.length > 0) {
        if (result.fullText && bubble) {
          updateBubble(bubble, result.fullText);
          messages.push({ role: "assistant", content: result.fullText });
        } else if (bubble) {
          bw.remove(bubble.root);
        }

        const asstMsg = buildAssistantToolCallMessage(moreCalls, result.fullText, settings.provider);
        messages.push(asstMsg);
        toSend.push(asstMsg);

        const moreResults: { id: string; content: string }[] = [];
        for (const tc of moreCalls) {
          if (abortRequested) break;
          const { id, name, args } = extractToolCallInfo(tc, settings.provider);
          const toolResult = await runTool(name, args);
          turnStats.toolCalls++;
          moreResults.push({ id, content: toolResult });
        }

        if (abortRequested) {
          appendBubble("assistant", "(Stopped by user)");
          return;
        }

        const moreToolMsgs = buildToolResultMessages(moreResults, settings.provider);
        for (const tm of moreToolMsgs) {
          messages.push(tm);
          toSend.push(tm);
        }
        continue;
      }

      const content = result.fullText || "";
      finishBubble(bubble, content);
      messages.push({ role: "assistant", content });
      return;
    } catch (e: any) {
      appendBubble("assistant", `Error: ${e.message || e}`);
      return;
    }
  }

  if (!abortRequested) {
    appendBubble("assistant", "(Tool loop reached maximum iterations)");
  }
}

/**
 * Handle slash commands. Returns true if the input was a command.
 */
export function handleSlashCommand(text: string): boolean {
  const cmd = text.trim().toLowerCase();

  if (cmd === "/help") {
    appendBubble(
      "assistant",
      `**QD Slash Commands**

| Command | Description |
|---------|-------------|
| \`/help\` | Show this help |
| \`/clear\` | Clear chat history |
| \`/model\` | Show current LLM model |
| \`/memory\` | Show scratchpad contents |
| \`/tools\` | List available tools |
| \`/log\` | Show performance log location and recent timings |

You can also just type naturally — I can read, edit, and improve your document.`,
    );
    return true;
  }

  if (cmd === "/clear") {
    messages.length = 0;
    resetPlan();
    bw.clear("chat-messages");
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
    invoke<string>("memory_read")
      .then((content) => {
        if (content) {
          appendBubble("assistant", `**Scratchpad contents:**\n\n${content}`);
        } else {
          appendBubble("assistant", "Scratchpad is empty.");
        }
      })
      .catch(() => {
        appendBubble("assistant", "Failed to read scratchpad.");
      });
    return true;
  }

  if (cmd === "/log" || cmd.startsWith("/log ")) {
    (async () => {
      const path = await getLogPath();
      const rows = await tailLog(10);
      const lines = rows.length ? rows.map(describeEntry).map((l) => `    ${l}`).join("\n") : "    (no entries yet)";
      appendBubble(
        "assistant",
        `**Performance log** is **${isPerfLogEnabled() ? "on" : "off"}** (Settings → Diagnostics).\n\nFile: \`${path || "unavailable"}\`\n\nRecent:\n\n${lines}`,
      );
    })();
    return true;
  }

  if (cmd === "/tools") {
    let toolList = `**Available tools:**

**Document:** read, write, replace, insert, undo, redo, get selection, outline
**Plan:** set, update
**Memory:** read, write, append, clear
**Key-Value:** get, set, delete, list`;
    if (projectMode) {
      toolList += `\n**File:** read, write, list, stat, search`;
    }
    appendBubble("assistant", toolList);
    return true;
  }

  return false;
}

function showWelcome() {
  appendBubble(
    "assistant",
    `Hi, I'm **QD** — your document assistant. I can help you write, edit, and improve your markdown. Type \`/help\` for commands.`,
  );
}

/** Submit whatever is in the input: a slash command or a chat message. */
function submit() {
  const input = inputEl();
  const text = input?.value.trim() ?? "";
  if (text.startsWith("/")) {
    if (input) input.value = "";
    if (!handleSlashCommand(text)) {
      appendBubble("assistant", `Unknown command: \`${text}\`. Type \`/help\` for available commands.`);
    }
  } else {
    send();
  }
}

function onSendClick() {
  if (sending) {
    abortRequested = true;
    cancelPendingReviews();
    setSendState("stopping");
  } else {
    submit();
  }
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sending) submit();
  }
}

/** Call once after the shell (including `makeChatPanel()`) is mounted. */
export function initChat() {
  ensureQuikdownStyles();
  showWelcome();
  document.addEventListener("mousemove", onDocumentMouseMove);
  document.addEventListener("mouseup", onDocumentMouseUp);
}
