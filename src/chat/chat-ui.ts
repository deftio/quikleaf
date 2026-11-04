/**
 * The chat pane and the tool-calling loop.
 *
 * Every tab has its own chat (`session.ts`). The pane shows the active tab's
 * session: its message log is swapped in on tab switches, the header names
 * the document (or "Project") the chat acts on, and the Send/Stop button
 * reflects that session's state. A turn that is still streaming when the
 * user switches tabs keeps running against its own session and document.
 *
 * Tool dispatch is scoped: a document chat's tools read and write only its
 * own tab's document (on screen or parked), the project chat's tools work on
 * files under the project root by path, and neither can reach the other's
 * territory. See `dispatchTool`.
 */
import bw from "bitwrench";
import type { Taco, TacoContent } from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import { loadSettings, isConfigured, editApprovalOf, type LLMSettings } from "../settings/settings";
import { sendChatStream, type ChatMessage } from "./providers";
import { getMarkdown, setMarkdown, undo, redo, insertAtCursor, getSelection } from "../editor/editor";
import {
  buildSystemPrompt,
  getTools,
  normalizeToolCalls,
  extractToolCallInfo,
  buildToolResultMessages,
  buildAssistantToolCallMessage,
  type PromptContext,
  type ToolScope,
} from "./chat-utils";
import { el, patchAttrs, withAttrs } from "../ui/taco";
import { REJECTED_RESULT, cancelPendingReviews, requestApproval, showAppliedDiff, type ReviewRequest } from "./review";
import { planSet, planUpdate, resetPlan } from "./plan";
import { outlineOf } from "./outline";
import { isProjectMode, listTabs, openPath } from "../editor/documents";
import { subscribe as subscribeTabs, updateContent } from "../editor/tabs";
import {
  CHAT_CHANGED,
  CHAT_CLEAR,
  activeSession,
  clearSession,
  isSessionActive,
  notifyChatChanged,
  peekSession,
  pruneSessions,
  sessionFor,
  sessionHasMemory,
  sessionLabel,
  sessionTab,
  setSessionModel,
  type ChatSession,
} from "./session";
import { scheduleProjectSave } from "../project/persist";
import { chatSide, setStatusTiming } from "../ui/shell";
import { Stopwatch, computeTiming, describeEntry, formatClock, formatMs, getLogPath, isPerfLogEnabled, logEvent, summarizeTiming, tailLog } from "../diag/perf";
// @ts-ignore — core parser, direct ESM import
import quikdown from "quikdown";

const MIN_WIDTH = 300;
const MAX_WIDTH = 600;

/** The session whose log is currently inside `#chat-messages`. */
let mounted: ChatSession | null = null;
let unsubscribers: Array<() => void> = [];

// --- Inject quikdown styles once ---
let stylesInjected = false;
function ensureQuikdownStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  bw.injectCSS(quikdown.emitStyles("", "light"), { id: "quikdown_css" });
}

// --- Settings per chat ------------------------------------------------------

/** Settings for one chat: the global Settings with this chat's model override applied. */
export function effectiveSettings(session: ChatSession): LLMSettings {
  const s = loadSettings();
  return session.model ? { ...s, model: session.model } : s;
}

function toolScope(session: ChatSession): ToolScope {
  return { scope: session.scope, memory: sessionHasMemory(session) };
}

function promptContext(session: ChatSession): PromptContext {
  const tab = sessionTab(session);
  return {
    scope: session.scope,
    title: tab?.title ?? "this document",
    path: tab?.path ?? null,
    projectRelative: !!tab?.projectRelative,
    memory: sessionHasMemory(session),
  };
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
 * Gate a proposed edit: show a review card in this chat's log and wait when
 * the policy says so, otherwise show the diff as already applied. Resolves
 * `false` when the user rejected (or Stop cancelled) the change.
 */
async function reviewEdit(session: ChatSession, req: ReviewRequest): Promise<boolean> {
  if (approvalRequired(req.kind)) return requestApproval(req, session.log);
  showAppliedDiff(req, session.log);
  return true;
}

// --- Document access for a session ----------------------------------------

function err(message: string): string {
  return JSON.stringify({ error: message });
}

/** The session's document text: the editor's when its tab is on screen, the parked text otherwise. */
function readDoc(session: ChatSession): string {
  if (isSessionActive(session)) return getMarkdown();
  return sessionTab(session)?.content ?? "";
}

/** Replace the session's document, on screen or in the background. */
async function writeDoc(session: ChatSession, md: string): Promise<void> {
  if (isSessionActive(session)) {
    await setMarkdown(md);
    return;
  }
  updateContent(session.tabId, md);
}

/** Cursor tools need the document in the editor; a background tab has no cursor. */
function notOnScreen(session: ChatSession, tool: string): string {
  return err(`${tool} needs ${sessionLabel(session)} on screen; it is open in a background tab. Use document_read / document_write instead.`);
}

function sealed(session: ChatSession, tool: string): string {
  if (session.scope === "document") {
    return err(`${tool} is not available in a document chat: this chat sees only ${sessionLabel(session)}. Cross-file work belongs in the project chat.`);
  }
  return err(`${tool} is not available in the project chat: there is no current document here. Read and write files by path.`);
}

// --- Tools -----------------------------------------------------------------

/**
 * Dispatch a tool call for a chat and return the result string. Defaults to
 * the active tab's session (tests and slash commands); the tool loop passes
 * the session it is running for, which may be in the background.
 */
export async function dispatchTool(name: string, args: any, session: ChatSession | null = activeSession()): Promise<string> {
  if (!session) return err("No chat is open");
  const isDoc = session.scope === "document";
  const label = sessionLabel(session);

  switch (name) {
    // --- Document tools (document chats; always the session's own tab) ---
    case "document_read": {
      if (!isDoc) return sealed(session, name);
      return JSON.stringify({ document: label, content: readDoc(session) });
    }
    case "document_write": {
      if (!isDoc) return sealed(session, name);
      const after = typeof args?.content === "string" ? args.content : String(args?.content ?? "");
      if (!(await reviewEdit(session, { kind: "document", before: readDoc(session), after }))) return REJECTED_RESULT;
      await writeDoc(session, after);
      return JSON.stringify({ success: true, document: label });
    }
    case "document_replace": {
      if (!isDoc) return sealed(session, name);
      const before = readDoc(session);
      const search = String(args?.search ?? "");
      const replace = String(args?.replace ?? "");
      let md = before;
      let count = 0;
      if (search) {
        if (args?.all) {
          const parts = md.split(search);
          count = parts.length - 1;
          md = parts.join(replace);
        } else {
          const idx = md.indexOf(search);
          if (idx !== -1) {
            md = md.substring(0, idx) + replace + md.substring(idx + search.length);
            count = 1;
          }
        }
      }
      if (count > 0) {
        if (!(await reviewEdit(session, { kind: "document", before, after: md }))) return REJECTED_RESULT;
        await writeDoc(session, md);
      }
      return JSON.stringify({ count, document: label });
    }
    case "document_outline": {
      if (!isDoc) return sealed(session, name);
      return JSON.stringify({ document: label, headings: outlineOf(readDoc(session)) });
    }
    case "document_insert": {
      if (!isDoc) return sealed(session, name);
      if (!isSessionActive(session)) return notOnScreen(session, name);
      insertAtCursor(String(args?.text ?? ""));
      return JSON.stringify({ success: true, document: label });
    }
    case "document_undo": {
      if (!isDoc) return sealed(session, name);
      if (!isSessionActive(session)) return notOnScreen(session, name);
      undo();
      return JSON.stringify({ success: true, document: label });
    }
    case "document_redo": {
      if (!isDoc) return sealed(session, name);
      if (!isSessionActive(session)) return notOnScreen(session, name);
      redo();
      return JSON.stringify({ success: true, document: label });
    }
    case "document_get_selection": {
      if (!isDoc) return sealed(session, name);
      if (!isSessionActive(session)) return notOnScreen(session, name);
      return JSON.stringify({ document: label, selection: getSelection() });
    }

    // --- Planning tools (every chat; the plan belongs to the chat) ---
    case "plan_set":
      return planSet(args ?? {}, session);
    case "plan_update":
      return planUpdate(args ?? {}, session);

    // --- Memory and KV tools (project state: project files and the project chat) ---
    case "memory_read":
    case "memory_write":
    case "memory_append":
    case "memory_clear":
    case "kv_get":
    case "kv_set":
    case "kv_delete":
    case "kv_list": {
      if (!sessionHasMemory(session)) {
        return err(
          isProjectMode()
            ? `${name} is not available here: the scratchpad and key-value store belong to the project, and ${label} is not a project file.`
            : `${name} needs a project: the scratchpad and key-value store live in quikleaf.prj. Open a folder with --project.`,
        );
      }
      return dispatchMemoryTool(name, args);
    }

    // --- File and tab tools (project chat only) ---
    case "file_read":
    case "file_write":
    case "file_list":
    case "file_stat":
    case "project_search":
    case "tabs_list":
    case "tab_open": {
      if (session.scope !== "project") return sealed(session, name);
      if (!isProjectMode()) return err("File tools are only available in project mode");
      return dispatchProjectTool(session, name, args);
    }

    default:
      return err(`Unknown tool: ${name}`);
  }
}

async function dispatchMemoryTool(name: string, args: any): Promise<string> {
  switch (name) {
    case "memory_read": {
      const content = await invoke<string>("memory_read");
      return JSON.stringify({ content });
    }
    case "memory_write": {
      await invoke("memory_write", { content: args.content });
      scheduleProjectSave();
      return JSON.stringify({ success: true });
    }
    case "memory_append": {
      await invoke("memory_append", { content: args.content });
      scheduleProjectSave();
      return JSON.stringify({ success: true });
    }
    case "memory_clear": {
      await invoke("memory_clear");
      scheduleProjectSave();
      return JSON.stringify({ success: true });
    }
    case "kv_get": {
      const entry = await invoke<any>("kv_get", { key: args.key });
      return JSON.stringify(entry ?? { error: "Key not found" });
    }
    case "kv_set": {
      const result = await invoke<any>("kv_set", { key: args.key, value: args.value });
      scheduleProjectSave();
      return JSON.stringify(result);
    }
    case "kv_delete": {
      const deleted = await invoke<boolean>("kv_delete", { key: args.key });
      scheduleProjectSave();
      return JSON.stringify({ deleted });
    }
    default: {
      const list = await invoke<any>("kv_list");
      return JSON.stringify(list);
    }
  }
}

async function dispatchProjectTool(session: ChatSession, name: string, args: any): Promise<string> {
  switch (name) {
    case "file_read": {
      const content = await invoke<string>("file_read", { path: args.path });
      return JSON.stringify({ path: args.path, content });
    }
    case "file_write": {
      if (typeof args?.path !== "string" || !args.path) return err("file_write needs a path: every edit in the project chat names its target file");
      const after = typeof args.content === "string" ? args.content : String(args.content ?? "");
      if (approvalRequired("file")) {
        // Current contents for the diff; a missing file diffs against "".
        let before = "";
        try {
          before = await invoke<string>("file_read", { path: args.path });
        } catch {}
        if (!(await requestApproval({ kind: "file", path: args.path, before, after }, session.log))) return REJECTED_RESULT;
      }
      await invoke("file_write", { path: args.path, content: after });
      // If that file is open in a clean tab, the tab model refreshes it on next open; a dirty tab keeps the user's edits.
      return JSON.stringify({ success: true, path: args.path });
    }
    case "file_list": {
      const result = await invoke<any>("file_list", { path: args.path || null, recursive: args.recursive || false });
      return JSON.stringify(result);
    }
    case "file_stat": {
      const stat = await invoke<any>("file_stat", { path: args.path });
      return JSON.stringify(stat);
    }
    case "project_search": {
      const query = typeof args.query === "string" ? args.query : "";
      if (!query) return err("project_search needs a non-empty query");
      const result = await invoke<any>("project_search", {
        query,
        path: args.path || null,
        regex: !!args.regex,
        maxResults: typeof args.max_results === "number" ? args.max_results : null,
      });
      return JSON.stringify(result);
    }
    case "tabs_list": {
      // Only project files: a tab from outside the root is not the project's business.
      const tabs = listTabs()
        .filter((t) => t.kind === "document" && t.projectRelative && t.path)
        .map((t) => ({ title: t.title, path: t.path, dirty: t.dirty, active: isSessionActive(sessionFor(t.id)) }));
      return JSON.stringify({ tabs });
    }
    default: {
      if (typeof args?.path !== "string" || !args.path) return err("tab_open needs a path");
      const tab = await openPath(args.path, true);
      if (!tab) return err(`Could not open ${args.path}`);
      return JSON.stringify({ success: true, title: tab.title, path: tab.path });
    }
  }
}

// --- View -------------------------------------------------------------------

/** The chat pane as TACO. Hidden until a tab shows it. */
export function makeChatPanel(): Taco {
  return {
    t: "div",
    a: { id: "chat-panel", class: "hidden", "aria-label": "Chat" },
    c: [
      {
        t: "div",
        a: { id: "chat-header" },
        c: [
          { t: "span", a: { id: "chat-scope", class: "chat-scope" }, c: "Document chat" },
          { t: "span", a: { id: "chat-target", class: "chat-target" }, c: "" },
          { t: "span", a: { id: "chat-model", class: "chat-model" }, c: "" },
        ],
      },
      { t: "div", a: { id: "chat-messages" } },
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
 * Drag handle on the drawer's inner edge (the theme places it right or left
 * to match the drawer side). The mousedown lives in `a:`; the document-level
 * move/up listeners are installed once by `initChat()`. Inline
 * `cursor: ew-resize` is what the e2e suite looks for.
 */
function makeResizeHandle(): Taco {
  return {
    t: "div",
    a: {
      class: "chat-resize-handle",
      style: { cursor: "ew-resize" },
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
  // Dragging toward the editor shrinks the drawer whichever side it is on.
  const delta = e.clientX - resize.startX;
  const grow = chatSide() === "right" ? -delta : delta;
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, resize.startWidth + grow));
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

function scrollToBottom(session: ChatSession) {
  if (mounted !== session) return;
  const log = el("chat-messages");
  if (log) log.scrollTop = log.scrollHeight;
}

/** Render markdown to HTML for assistant messages. */
function renderMarkdown(text: string): string {
  ensureQuikdownStyles();
  return quikdown(text);
}

// --- Session ↔ pane -----------------------------------------------------------

/** The short model name shown in the header: this chat's override or the Settings model. */
function modelLabel(session: ChatSession): string {
  const s = effectiveSettings(session);
  if (!isConfigured(s)) return "no model";
  return s.model;
}

function renderHeader(session: ChatSession) {
  const tab = sessionTab(session);
  const project = session.scope === "project";
  bw.patch("chat-scope", project ? "Project chat" : "Document chat");
  bw.patch("chat-target", project ? "all files under the project root" : (tab?.title ?? ""));
  bw.patch("chat-model", modelLabel(session));
  bw.toggleClass("chat-model", "override", !!session.model);
  bw.toggleClass("chat-panel", "project-scope", project);
  patchAttrs("chat-header", {
    title: project ? "This chat works on files under the project root, by path." : `This chat sees only ${tab?.title ?? "this document"}.`,
  });
  const input = inputEl();
  if (input) patchAttrs(input, { placeholder: project ? "Ask about the project…" : `Ask about ${tab?.title ?? "this document"}…` });
}

/** Add bubbles for transcript entries that were restored from the project file. */
function hydrate(session: ChatSession) {
  while (session.rendered < session.transcript.length) {
    const entry = session.transcript[session.rendered++];
    appendBubble(session, entry.role, entry.text, undefined, false);
  }
}

/**
 * Put a session's log into the pane. The log is an existing element kept by
 * the session, so it is re-parented directly: bitwrench's `append` takes
 * TACO, not elements.
 */
function mountSession(session: ChatSession) {
  const container = el("chat-messages");
  if (!container) return;
  // The tab model notifies on every edit (dirty flag, parked text), so this
  // runs often for the session already on screen. Only a real switch may
  // touch the input box: otherwise typing in the editor would wipe a chat draft.
  const switching = mounted !== session;
  if (switching) {
    const input = inputEl();
    if (mounted) {
      if (input) mounted.draft = input.value;
      if (mounted.log.parentNode === container) container.removeChild(mounted.log);
    }
    if (session.log.parentNode !== container) container.appendChild(session.log);
    mounted = session;
    if (input) input.value = session.draft;
  }
  if (!session.greeted) showWelcome(session);
  hydrate(session);
  renderHeader(session);
  if (switching) {
    setSendState(session, session.sending ? "sending" : "idle");
    scrollToBottom(session);
  }
}

/** Show the active tab's chat and forget chats whose tabs are gone. */
function syncActiveSession() {
  pruneSessions();
  const session = activeSession();
  if (session) mountSession(session);
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
 * Add a message bubble to a chat's log. Assistant messages are rendered
 * markdown; user and tool messages are plain text. Every bubble carries a
 * meta line with its timestamp; the pane's `show-timestamps` class decides
 * whether it is visible, so toggling the setting updates old messages too.
 * `record` adds user/assistant text to the transcript (off for restored or
 * informational bubbles).
 */
function appendBubble(session: ChatSession, role: "user" | "assistant" | "tool", text: string, detail?: string, record = false): Bubble {
  const root = bw.append(session.log, { t: "div", a: { class: `chat-msg ${role}` } });
  const body = bw.append(root, {
    t: "div",
    a: { class: "chat-body" },
    c: role === "assistant" ? bw.raw(renderMarkdown(text)) : text,
  });
  const meta = bw.append(root, { t: "div", a: { class: "chat-meta" }, c: metaParts(formatClock(), detail) });
  if (record && role !== "tool") {
    session.transcript.push({ role, text });
    session.rendered = session.transcript.length;
  }
  scrollToBottom(session);
  return { root, body, meta };
}

/** Update an existing assistant bubble with new markdown content. */
function updateBubble(session: ChatSession, bubble: Bubble, text: string) {
  bw.patch(bubble.body, bw.raw(renderMarkdown(text)));
  scrollToBottom(session);
}

/** Replace a bubble's meta line (timestamp stays, detail changes). */
function setBubbleDetail(bubble: Bubble, detail: string) {
  const stamp = bubble.meta.querySelector("time")?.textContent || formatClock();
  bw.patch(bubble.meta, metaParts(stamp, detail));
}

/**
 * Show a tool call in the chat as a compact entry. Always appended; the
 * pane's `show-tools` class decides visibility.
 */
function appendToolBubble(session: ChatSession, name: string, result: string, ms: number) {
  const shortResult = result.length > 200 ? result.substring(0, 200) + "..." : result;
  appendBubble(session, "tool", `${name}() → ${shortResult}`, formatMs(ms));
}

/** Run one tool for a session, time it, show it, log it. */
async function runTool(session: ChatSession, name: string, args: any): Promise<string> {
  const sw = new Stopwatch();
  let result: string;
  let ok = true;
  try {
    result = await dispatchTool(name, args, session);
    ok = !result.includes('"error"');
  } catch (e: any) {
    ok = false;
    result = JSON.stringify({ error: e?.message || String(e) });
  }
  const ms = sw.elapsed();
  session.stats.toolCalls++;
  appendToolBubble(session, name, result, ms);
  logEvent({ kind: "tool", name, ms: Math.round(ms), ok });
  return result;
}

/** Reflect a session's send state on the button — only while that session is the one on screen. */
function setSendState(session: ChatSession, state: "idle" | "sending" | "stopping") {
  if (mounted !== session) return;
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
async function streamTurn(session: ChatSession, settings: LLMSettings, toSend: ChatMessage[], tools: any[]) {
  let accumulated = "";
  let bubble: Bubble | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  const sw = new Stopwatch();
  let firstTokenAt: number | null = null;

  const stream = sendChatStream(settings, toSend, tools, (token: string) => {
    if (firstTokenAt === null) firstTokenAt = sw.elapsed();
    accumulated += token;
    if (!bubble) {
      bubble = appendBubble(session, "assistant", accumulated);
      bw.addClass(bubble.root, "streaming");
    }
    if (!renderTimer) {
      renderTimer = setTimeout(() => {
        renderTimer = null;
        if (bubble) updateBubble(session, bubble, accumulated);
      }, 50);
    }
  });

  const result = await stream.done;
  session.stats.llmCalls++;

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
  if (mounted === session) setStatusTiming(`last: ${summary}`);
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

/** Show `text` in the streaming bubble if there is one, else as a new bubble, and record it. */
function finishBubble(session: ChatSession, bubble: Bubble | null, text: string) {
  if (bubble) {
    updateBubble(session, bubble, text);
    session.transcript.push({ role: "assistant", text });
    session.rendered = session.transcript.length;
  } else {
    appendBubble(session, "assistant", text || "(empty response)", undefined, true);
  }
}

/** Send the input as a user message for the active chat and run the tool loop. */
async function send() {
  const session = activeSession();
  const input = inputEl();
  const text = input?.value.trim() ?? "";
  if (!session || !text || session.sending) return;

  const settings = effectiveSettings(session);
  if (!isConfigured(settings)) {
    appendBubble(session, "assistant", "No LLM configured. Click Settings to set up a provider.");
    return;
  }

  session.sending = true;
  session.abortRequested = false;
  setSendState(session, "sending");
  if (input) input.value = "";
  session.draft = "";
  const turn = { sw: new Stopwatch(), llmCalls: session.stats.llmCalls, toolCalls: session.stats.toolCalls };

  session.messages.push({ role: "user", content: text });
  session.stats.turns++;
  appendBubble(session, "user", text, undefined, true);

  const tools = getTools(settings.provider, toolScope(session));
  const systemPrompt = buildSystemPrompt(promptContext(session));
  const toSend: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...session.messages];

  try {
    const { result, bubble } = await streamTurn(session, settings, toSend, tools);

    if (result.error) {
      finishBubble(session, bubble, `Error: ${result.error}`);
      session.messages.push({ role: "assistant", content: `Error: ${result.error}` });
    } else {
      const toolCalls = normalizeToolCalls(result.toolCalls, settings.provider);

      if (toolCalls.length === 0) {
        finishBubble(session, bubble, result.fullText);
        session.messages.push({ role: "assistant", content: result.fullText });
      } else {
        if (result.fullText && bubble) {
          updateBubble(session, bubble, result.fullText);
          session.transcript.push({ role: "assistant", text: result.fullText });
          session.rendered = session.transcript.length;
          session.messages.push({ role: "assistant", content: result.fullText });
        } else if (bubble) {
          bw.remove(bubble.root);
        }

        const assistantMsg = buildAssistantToolCallMessage(toolCalls, result.fullText, settings.provider);
        session.messages.push(assistantMsg);
        toSend.push(assistantMsg);

        const toolResults: { id: string; content: string }[] = [];
        for (const tc of toolCalls) {
          const { id, name, args } = extractToolCallInfo(tc, settings.provider);
          const toolResult = await runTool(session, name, args);
          toolResults.push({ id, content: toolResult });
        }

        const toolMsgs = buildToolResultMessages(toolResults, settings.provider);
        for (const tm of toolMsgs) {
          session.messages.push(tm);
          toSend.push(tm);
        }

        await runToolLoop(session, settings, toSend, tools);
      }
    }
  } catch (e: any) {
    appendBubble(session, "assistant", `Error: ${e.message || e}`);
  }

  logEvent({
    kind: "turn",
    total_ms: Math.round(turn.sw.elapsed()),
    llm_calls: session.stats.llmCalls - turn.llmCalls,
    tool_calls: session.stats.toolCalls - turn.toolCalls,
    aborted: session.abortRequested,
  });
  session.sending = false;
  session.abortRequested = false;
  setSendState(session, "idle");
  if (mounted === session) inputEl()?.focus();
  notifyChatChanged(session);
  scheduleProjectSave();
}

/** Keep calling the model while it keeps asking for tools (bounded). */
async function runToolLoop(session: ChatSession, settings: LLMSettings, toSend: ChatMessage[], tools: any[]) {
  let iterations = 0;
  while (iterations < 10) {
    if (session.abortRequested) {
      appendBubble(session, "assistant", "(Stopped by user)");
      return;
    }
    iterations++;

    try {
      const { result, bubble } = await streamTurn(session, settings, toSend, tools);

      if (result.error) {
        finishBubble(session, bubble, `Error: ${result.error}`);
        return;
      }

      const moreCalls = normalizeToolCalls(result.toolCalls, settings.provider);
      if (moreCalls.length > 0) {
        if (result.fullText && bubble) {
          updateBubble(session, bubble, result.fullText);
          session.transcript.push({ role: "assistant", text: result.fullText });
          session.rendered = session.transcript.length;
          session.messages.push({ role: "assistant", content: result.fullText });
        } else if (bubble) {
          bw.remove(bubble.root);
        }

        const asstMsg = buildAssistantToolCallMessage(moreCalls, result.fullText, settings.provider);
        session.messages.push(asstMsg);
        toSend.push(asstMsg);

        const moreResults: { id: string; content: string }[] = [];
        for (const tc of moreCalls) {
          if (session.abortRequested) break;
          const { id, name, args } = extractToolCallInfo(tc, settings.provider);
          const toolResult = await runTool(session, name, args);
          moreResults.push({ id, content: toolResult });
        }

        if (session.abortRequested) {
          appendBubble(session, "assistant", "(Stopped by user)");
          return;
        }

        const moreToolMsgs = buildToolResultMessages(moreResults, settings.provider);
        for (const tm of moreToolMsgs) {
          session.messages.push(tm);
          toSend.push(tm);
        }
        continue;
      }

      const content = result.fullText || "";
      finishBubble(session, bubble, content);
      session.messages.push({ role: "assistant", content });
      return;
    } catch (e: any) {
      appendBubble(session, "assistant", `Error: ${e.message || e}`);
      return;
    }
  }

  if (!session.abortRequested) {
    appendBubble(session, "assistant", "(Tool loop reached maximum iterations)");
  }
}

// --- Slash commands -----------------------------------------------------------

/** `/tools` text for a chat's scope. */
function toolsText(session: ChatSession): string {
  const memory = sessionHasMemory(session)
    ? `\n**Memory (project scratchpad):** read, write, append, clear\n**Key-Value (project):** get, set, delete, list`
    : `\n*Memory and key-value tools are project state and are not offered here${isProjectMode() ? " (this document is outside the project)" : " (no project open)"}.*`;
  if (session.scope === "project") {
    return `**Available tools — project chat** (files under the project root, by path):

**File:** read, write, list, stat, search
**Tabs:** list open project files, open a file in a tab
**Plan:** set, update${memory}`;
  }
  return `**Available tools — document chat** (acting on **${sessionLabel(session)}** only):

**Document:** read, write, replace, insert, undo, redo, get selection, outline
**Plan:** set, update${memory}`;
}

/** Empty a chat and show the welcome bubble again. */
export function clearChat(session: ChatSession) {
  resetPlan(session);
  clearSession(session);
  if (mounted === session) showWelcome(session);
  notifyChatChanged(session);
  scheduleProjectSave();
}

/**
 * Handle slash commands for a chat (the active one by default). Returns true
 * if the input was a command.
 */
export function handleSlashCommand(text: string, session: ChatSession | null = activeSession()): boolean {
  if (!session) return false;
  const raw = text.trim();
  const cmd = raw.toLowerCase();
  const say = (md: string) => appendBubble(session, "assistant", md);

  if (cmd === "/help") {
    say(`**QD Slash Commands**

| Command | Description |
|---------|-------------|
| \`/help\` | Show this help |
| \`/clear\` | Clear this chat |
| \`/model\` | Show the model this chat uses |
| \`/model <name>\` | Use a different model for this chat only (\`/model default\` to go back) |
| \`/memory\` | Show the project scratchpad |
| \`/tools\` | List the tools this chat has |
| \`/log\` | Show performance log location and recent timings |

Each tab has its own chat. This one acts on **${sessionLabel(session)}** and sees nothing else.`);
    return true;
  }

  if (cmd === "/clear") {
    clearChat(session);
    return true;
  }

  if (cmd === "/model" || cmd.startsWith("/model ")) {
    const arg = raw.slice("/model".length).trim();
    const global = loadSettings();
    if (arg) {
      setSessionModel(session, arg.toLowerCase() === "default" ? null : arg);
      renderHeader(session);
      scheduleProjectSave();
      const s = effectiveSettings(session);
      say(session.model ? `This chat now uses **${s.model}** via ${s.host} (Settings keeps **${global.model || "none"}** for other chats).` : `This chat is back to the Settings model, **${global.model || "none"}**.`);
      return true;
    }
    const s = effectiveSettings(session);
    if (isConfigured(s)) {
      say(session.model ? `This chat uses **${s.model}** via ${s.host} (override; Settings model is **${global.model}**).` : `Currently using **${s.model}** via ${s.host}.`);
    } else {
      say("No LLM configured. Click **Settings** in the titlebar to set one up.");
    }
    return true;
  }

  if (cmd === "/memory") {
    if (!sessionHasMemory(session)) {
      say(isProjectMode() ? `The scratchpad is project state; **${sessionLabel(session)}** is not a project file, so this chat does not use it.` : "The scratchpad lives in a project (quikleaf.prj). Open a folder with `--project` to use it.");
      return true;
    }
    invoke<string>("memory_read")
      .then((content) => say(content ? `**Scratchpad contents:**\n\n${content}` : "Scratchpad is empty."))
      .catch(() => say("Failed to read scratchpad."));
    return true;
  }

  if (cmd === "/log" || cmd.startsWith("/log ")) {
    (async () => {
      const path = await getLogPath();
      const rows = await tailLog(10);
      const lines = rows.length ? rows.map(describeEntry).map((l) => `    ${l}`).join("\n") : "    (no entries yet)";
      say(`**Performance log** is **${isPerfLogEnabled() ? "on" : "off"}** (Settings → Diagnostics).\n\nFile: \`${path || "unavailable"}\`\n\nRecent:\n\n${lines}`);
    })();
    return true;
  }

  if (cmd === "/tools") {
    say(toolsText(session));
    return true;
  }

  return false;
}

function showWelcome(session: ChatSession) {
  session.greeted = true;
  const what = session.scope === "project" ? "the files in this project, by path" : `**${sessionLabel(session)}** — this chat sees only this document`;
  appendBubble(session, "assistant", `Hi, I'm **QD**. I can help you write, edit, and improve ${what}. Type \`/help\` for commands.`);
}

/** Submit whatever is in the input: a slash command or a chat message. */
function submit() {
  const input = inputEl();
  const text = input?.value.trim() ?? "";
  if (text.startsWith("/")) {
    if (input) input.value = "";
    const session = activeSession();
    if (session && !handleSlashCommand(text, session)) {
      appendBubble(session, "assistant", `Unknown command: \`${text}\`. Type \`/help\` for available commands.`);
    }
  } else {
    send();
  }
}

function onSendClick() {
  const session = activeSession();
  if (session?.sending) {
    session.abortRequested = true;
    cancelPendingReviews(session.log);
    setSendState(session, "stopping");
  } else {
    submit();
  }
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!activeSession()?.sending) submit();
  }
}

/** Call once after the shell (including `makeChatPanel()`) is mounted. Idempotent. */
export function initChat() {
  ensureQuikdownStyles();
  for (const off of unsubscribers) off();
  unsubscribers = [
    subscribeTabs(syncActiveSession),
    bw.sub(CHAT_CHANGED, (d: { tabId?: string }) => {
      const s = d?.tabId ? peekSession(d.tabId) : null;
      if (s && mounted === s) {
        hydrate(s);
        renderHeader(s);
      }
    }),
    bw.sub(CHAT_CLEAR, (d: { tabId?: string }) => {
      const s = d?.tabId ? peekSession(d.tabId) : null;
      if (s) clearChat(s);
    }),
  ];
  document.removeEventListener("mousemove", onDocumentMouseMove);
  document.removeEventListener("mouseup", onDocumentMouseUp);
  document.addEventListener("mousemove", onDocumentMouseMove);
  document.addEventListener("mouseup", onDocumentMouseUp);
  mounted = null;
  syncActiveSession();
}
