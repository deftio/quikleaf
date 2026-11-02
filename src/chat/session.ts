/**
 * Chat sessions: one per tab, sealed to that tab.
 *
 * A **document chat** belongs to one editor tab. The model is shown that
 * document and the conversation, nothing else, and its tools can change only
 * that document. Nothing about other open tabs reaches it, so files from
 * different projects that happen to be open side by side can never leak into
 * each other's chats.
 *
 * The **project chat** belongs to the project tab (see `tabs.ts`). It is the
 * only scope that sees across files, and only files under the project root.
 * Every edit it makes names its target path, and there is no "current
 * document" for it to act on by accident.
 *
 * The scratchpad and key-value store are project state (they live in
 * `quikleaf.prj`), so only chats for project files and the project chat may
 * use them; a document outside the project gets neither.
 *
 * This module is the registry and the pure-ish state. Rendering bubbles into
 * `log` is `chat-ui.ts`'s job; `log` is kept here so a chat keeps its DOM
 * (streaming bubble, review cards, plan card) while its tab is in the
 * background.
 */
import bw from "bitwrench";
import type { ChatMessage } from "./providers";
import type { Plan } from "./plan";
import { PROJECT_TAB_ID, activeTab, getTab, listTabs, setView, type Tab, type TabView } from "../editor/tabs";

export type ChatScope = "document" | "project";

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

export interface ChatStats {
  /** User messages sent. */
  turns: number;
  llmCalls: number;
  toolCalls: number;
}

export interface ChatSession {
  tabId: string;
  scope: ChatScope;
  /** Provider-format history sent to the model, tool traffic included. Not persisted. */
  messages: ChatMessage[];
  /** The visible conversation; this is what `quikleaf.prj` keeps. */
  transcript: TranscriptEntry[];
  /** How many transcript entries have a bubble in `log` (restored chats are rendered lazily). */
  rendered: number;
  plan: Plan | null;
  planCard: HTMLElement | null;
  /** Model override for this chat (same host and provider as Settings), or null for the Settings model. */
  model: string | null;
  sending: boolean;
  abortRequested: boolean;
  stats: ChatStats;
  /** Unsent text in the input box, kept per chat across tab switches. */
  draft: string;
  /** Whether the welcome bubble has been shown. */
  greeted: boolean;
  /** This chat's message log; mounted into `#chat-messages` while its tab is active. */
  log: HTMLElement;
}

/** Published (detail `{ tabId }`) whenever a session's transcript, stats or model change. */
export const CHAT_CHANGED = "chat:changed";
/** Published (detail `{ tabId }`) by UI that wants a chat cleared (the info pane's button). */
export const CHAT_CLEAR = "chat:clear";

const sessions = new Map<string, ChatSession>();

function newStats(): ChatStats {
  return { turns: 0, llmCalls: 0, toolCalls: 0 };
}

export function scopeForTab(tab: Tab | null): ChatScope {
  return tab?.kind === "project" ? "project" : "document";
}

function create(tabId: string): ChatSession {
  const scope: ChatScope = tabId === PROJECT_TAB_ID ? "project" : scopeForTab(getTab(tabId));
  return {
    tabId,
    scope,
    messages: [],
    transcript: [],
    rendered: 0,
    plan: null,
    planCard: null,
    model: null,
    sending: false,
    abortRequested: false,
    stats: newStats(),
    draft: "",
    greeted: false,
    log: bw.create({ t: "div", a: { class: "chat-log", "data-tab-id": tabId, role: "log", "aria-live": "polite" } }) as HTMLElement,
  };
}

/** The session for a tab, created on first use. */
export function sessionFor(tabId: string): ChatSession {
  let s = sessions.get(tabId);
  if (!s) {
    s = create(tabId);
    sessions.set(tabId, s);
  }
  return s;
}

export function peekSession(tabId: string): ChatSession | undefined {
  return sessions.get(tabId);
}

/** The active tab's session, or null before any tab exists. */
export function activeSession(): ChatSession | null {
  const tab = activeTab();
  return tab ? sessionFor(tab.id) : null;
}

export function listSessions(): ChatSession[] {
  return Array.from(sessions.values());
}

/** The tab a session belongs to (null once the tab is closed). */
export function sessionTab(s: ChatSession): Tab | null {
  return getTab(s.tabId);
}

export function isSessionActive(s: ChatSession): boolean {
  return activeTab()?.id === s.tabId;
}

/** "notes.md", "Untitled 2" or "the project" — how the chat names what it acts on. */
export function sessionLabel(s: ChatSession): string {
  if (s.scope === "project") return "the project";
  return sessionTab(s)?.title ?? "this document";
}

/**
 * Whether the scratchpad / key-value tools are available: the project chat
 * and chats for files inside the project root. A document outside the
 * project (or any document in simple mode) must not share project memory.
 */
export function sessionHasMemory(s: ChatSession): boolean {
  if (s.scope === "project") return true;
  const tab = sessionTab(s);
  return !!tab?.projectRelative;
}

export function dropSession(tabId: string): void {
  sessions.delete(tabId);
}

/**
 * Forget sessions whose tabs are gone. The project session is kept: it is
 * the project's chat, not the tab's, and comes back with View → Project Chat.
 */
export function pruneSessions(liveTabIds: Iterable<string> = listTabs().map((t) => t.id)): void {
  const live = new Set(liveTabIds);
  for (const id of Array.from(sessions.keys())) {
    if (id !== PROJECT_TAB_ID && !live.has(id)) sessions.delete(id);
  }
}

/** Empty a session: conversation, plan, stats and log. The model override stays. */
export function clearSession(s: ChatSession): void {
  s.messages = [];
  s.transcript = [];
  s.rendered = 0;
  s.plan = null;
  s.planCard = null;
  s.stats = newStats();
  s.greeted = false;
  bw.clear(s.log);
}

export function notifyChatChanged(s: ChatSession): void {
  bw.pub(CHAT_CHANGED, { tabId: s.tabId });
}

/** Set (or with null clear) this chat's model override. */
export function setSessionModel(s: ChatSession, model: string | null): void {
  const next = model && model.trim() ? model.trim() : null;
  if (s.model === next) return;
  s.model = next;
  notifyChatChanged(s);
}

/** Drop every session (tests). */
export function resetSessions(): void {
  sessions.clear();
}

// --- Persistence (quikleaf.prj `chatHistory`) -------------------------------

export interface PersistedChat {
  transcript: TranscriptEntry[];
  model: string | null;
  view?: TabView;
}

export interface ChatHistory {
  version: 1;
  /** Keyed by project-relative path. */
  tabs: Record<string, PersistedChat>;
  project: PersistedChat | null;
}

function persisted(s: ChatSession, view?: TabView): PersistedChat | null {
  if (s.transcript.length === 0 && !s.model && !view) return null;
  return { transcript: s.transcript.map((e) => ({ ...e })), model: s.model, ...(view ? { view: { ...view } } : {}) };
}

/**
 * What goes into `quikleaf.prj`: the chats of open project files (by path,
 * with their pane layout) and the project chat. Untitled tabs and files
 * outside the project are never written — they are not the project's.
 */
export function exportChatHistory(): ChatHistory {
  const tabs: Record<string, PersistedChat> = {};
  for (const tab of listTabs()) {
    if (tab.kind !== "document" || !tab.projectRelative || !tab.path) continue;
    const s = sessions.get(tab.id);
    const entry = s ? persisted(s, tab.view) : { transcript: [], model: null, view: { ...tab.view } };
    if (entry) tabs[tab.path] = entry;
  }
  const project = sessions.get(PROJECT_TAB_ID);
  return { version: 1, tabs, project: project ? persisted(project) : null };
}

function isEntry(e: unknown): e is TranscriptEntry {
  return !!e && typeof e === "object" && ((e as any).role === "user" || (e as any).role === "assistant") && typeof (e as any).text === "string";
}

function seed(s: ChatSession, data: PersistedChat): void {
  const transcript = Array.isArray(data.transcript) ? data.transcript.filter(isEntry) : [];
  s.transcript = transcript.map((e) => ({ role: e.role, text: e.text }));
  // The model gets the visible conversation back; tool traffic is not replayed.
  s.messages = s.transcript.map((e) => ({ role: e.role, content: e.text }) as ChatMessage);
  s.rendered = 0;
  s.stats = { ...newStats(), turns: s.transcript.filter((e) => e.role === "user").length };
  s.model = typeof data.model === "string" && data.model.trim() ? data.model.trim() : null;
  s.greeted = s.transcript.length > 0;
  bw.clear(s.log);
  notifyChatChanged(s);
}

/**
 * Restore chats from a loaded project file onto the tabs that are open now.
 * Unknown shapes are ignored; a path with no open tab is skipped.
 */
export function importChatHistory(data: unknown): number {
  if (!data || typeof data !== "object" || (data as any).version !== 1) return 0;
  const h = data as ChatHistory;
  let restored = 0;
  const byPath = new Map(listTabs().filter((t) => t.projectRelative && t.path).map((t) => [t.path as string, t]));
  for (const [path, entry] of Object.entries(h.tabs ?? {})) {
    const tab = byPath.get(path);
    if (!tab || !entry || typeof entry !== "object") continue;
    seed(sessionFor(tab.id), entry);
    if (entry.view && typeof entry.view === "object") {
      const v = entry.view;
      setView(tab.id, {
        chat: !!v.chat,
        info: !!v.info,
        mode: v.mode === "source" || v.mode === "preview" ? v.mode : "split",
      });
    }
    restored++;
  }
  if (h.project && typeof h.project === "object") {
    seed(sessionFor(PROJECT_TAB_ID), h.project);
    restored++;
  }
  return restored;
}
