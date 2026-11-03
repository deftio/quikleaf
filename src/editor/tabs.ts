/**
 * Editor tab model — pure state, no DOM.
 *
 * One tab per open document. The quikdown editor is a single instance, so
 * the tab model owns each document's markdown while it is not on screen;
 * `documents.ts` moves text between the model and the editor on switches.
 *
 * Change notifications go through bitwrench pub/sub on `TABS_CHANGED`
 * (quikleaf dogfoods bitwrench); `subscribe()` is a typed wrapper around it.
 *
 * Invariant: there is always at least one tab. Closing the last tab replaces
 * it with a fresh untitled one, so the editor is never left without a document.
 */
import bw from "bitwrench";

/**
 * What a tab is: a markdown document, or the project chat — a tab with no
 * document whose chat sees the project root instead of one file.
 */
/** `document`: a markdown file or untitled text. `project`: the project chat. `log`: the performance log viewer. */
export type TabKind = "document" | "project" | "log";

export type EditorMode = "source" | "split" | "preview";

/**
 * The panes a tab shows: `[chat | quikdown view | info]`. Each tab remembers
 * its own layout; a new tab inherits the active tab's layout at creation.
 */
export interface TabView {
  chat: boolean;
  info: boolean;
  mode: EditorMode;
}

export const DEFAULT_VIEW: TabView = { chat: false, info: false, mode: "split" };

/** The single project chat tab's id; there is at most one such tab. */
export const PROJECT_TAB_ID = "tab-project";
/** The single log viewer tab's id; there is at most one such tab. */
export const LOG_TAB_ID = "tab-log";

export interface Tab {
  id: string;
  kind: TabKind;
  /** Absolute path, project-relative path, or null for an unsaved document (and the project tab). */
  path: string | null;
  /** File name (or "Untitled", "Untitled 2", …; "Project" for the project tab). */
  title: string;
  /** Current markdown — the editor's text when active, the parked text otherwise. */
  content: string;
  /** True when `content` differs from what was last loaded or saved. */
  dirty: boolean;
  /** True when `path` is relative to the project root (saved via `file_write`). */
  projectRelative: boolean;
  /** Which panes this tab shows and the editor's mode. */
  view: TabView;
}

export interface TabsSnapshot {
  tabs: Tab[];
  active: Tab | null;
}

export const TABS_CHANGED = "tabs:changed";

interface TabRecord extends Tab {
  /** The content as last loaded or saved; `dirty` is derived from it. */
  saved: string;
}

let records: TabRecord[] = [];
let activeId: string | null = null;
let seq = 0;

function pub(rec: TabRecord): Tab {
  const { saved: _saved, ...tab } = rec;
  return { ...tab, view: { ...rec.view } };
}

/** The layout a new tab starts with: the active tab's, or the default. */
function inheritView(): TabView {
  const active = activeId ? find(activeId) : undefined;
  return active ? { ...active.view } : { ...DEFAULT_VIEW };
}

function find(id: string): TabRecord | undefined {
  return records.find((r) => r.id === id);
}

function notify(): void {
  bw.pub(TABS_CHANGED, snapshot());
}

function nextUntitledTitle(): string {
  const taken = new Set(records.filter((r) => r.path === null).map((r) => r.title));
  if (!taken.has("Untitled")) return "Untitled";
  let n = 2;
  while (taken.has(`Untitled ${n}`)) n++;
  return `Untitled ${n}`;
}

/** The last path segment, or the path itself when it has no separators. */
export function fileName(path: string): string {
  return path.split("/").pop() || path.split("\\").pop() || path;
}

/** Current tabs in display order plus the active one. */
export function snapshot(): TabsSnapshot {
  return { tabs: listTabs(), active: activeTab() };
}

export function listTabs(): Tab[] {
  return records.map(pub);
}

export function activeTab(): Tab | null {
  const rec = activeId ? find(activeId) : undefined;
  return rec ? pub(rec) : null;
}

export function getTab(id: string): Tab | null {
  const rec = find(id);
  return rec ? pub(rec) : null;
}

/**
 * Open `path` with `content` and make it active. If a tab for the same path
 * already exists it is focused instead; a clean existing tab also takes the
 * freshly read content (the file may have changed on disk), a dirty one keeps
 * the user's edits.
 */
export function openTab(path: string, content: string, opts: { projectRelative?: boolean } = {}): Tab {
  const projectRelative = opts.projectRelative ?? false;
  let rec = records.find((r) => r.path === path && r.projectRelative === projectRelative);
  if (rec) {
    if (!rec.dirty) {
      rec.content = content;
      rec.saved = content;
    }
  } else {
    rec = {
      id: `tab-${++seq}`,
      kind: "document",
      path,
      title: fileName(path),
      content,
      saved: content,
      dirty: false,
      projectRelative,
      view: inheritView(),
    };
    records.push(rec);
  }
  activeId = rec.id;
  notify();
  return pub(rec);
}

/** Open a new, empty, unsaved document and make it active. */
export function newUntitledTab(content = ""): Tab {
  const rec: TabRecord = {
    id: `tab-${++seq}`,
    kind: "document",
    path: null,
    title: nextUntitledTitle(),
    content,
    saved: content,
    dirty: false,
    projectRelative: false,
    view: inheritView(),
  };
  records.push(rec);
  activeId = rec.id;
  notify();
  return pub(rec);
}

/**
 * Open (or focus) the project chat tab. It has no document: its chat pane is
 * always shown and its info pane describes the project. Only one exists.
 */
export function openProjectTab(): Tab {
  let rec = find(PROJECT_TAB_ID);
  if (!rec) {
    rec = {
      id: PROJECT_TAB_ID,
      kind: "project",
      path: null,
      title: "Project",
      content: "",
      saved: "",
      dirty: false,
      projectRelative: false,
      view: { ...inheritView(), chat: true },
    };
    records.push(rec);
  }
  activeId = rec.id;
  notify();
  return pub(rec);
}

/**
 * Open (or focus) the log viewer tab. It has no document and no chat: the
 * tab body shows the performance log (`diag/log-pane.ts`). Only one exists.
 */
export function openLogTab(): Tab {
  let rec = find(LOG_TAB_ID);
  if (!rec) {
    rec = {
      id: LOG_TAB_ID,
      kind: "log",
      path: null,
      title: "Log",
      content: "",
      saved: "",
      dirty: false,
      projectRelative: false,
      view: { ...inheritView(), chat: false },
    };
    records.push(rec);
  }
  activeId = rec.id;
  notify();
  return pub(rec);
}

/** Change which panes a tab shows (or its editor mode). Notifies only when something changed. */
export function setView(id: string, patch: Partial<TabView>): Tab | null {
  const rec = find(id);
  if (!rec) return null;
  const next = { ...rec.view, ...patch };
  if (rec.kind === "project") next.chat = true; // the project tab is its chat
  if (rec.kind === "log") next.chat = false; // the log tab has nothing to chat about
  const changed = next.chat !== rec.view.chat || next.info !== rec.view.info || next.mode !== rec.view.mode;
  rec.view = next;
  if (changed) notify();
  return pub(rec);
}

/**
 * Remove a tab. Returns the tab that is active afterwards: the right-hand
 * neighbour of a closed active tab (or the left-hand one at the end), the
 * unchanged active tab when a background tab was closed, or a fresh untitled
 * tab when the last one was closed. Returns null for an unknown id.
 */
export function closeTab(id: string): Tab | null {
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const wasActive = records[idx].id === activeId;
  records.splice(idx, 1);

  if (records.length === 0) {
    return newUntitledTab(); // notifies
  }
  if (wasActive) {
    activeId = records[Math.min(idx, records.length - 1)].id;
  }
  notify();
  return activeTab();
}

/** Make `id` the active tab. Returns it, or null (and no change) for an unknown id. */
export function setActive(id: string): Tab | null {
  const rec = find(id);
  if (!rec) return null;
  if (activeId !== rec.id) {
    activeId = rec.id;
    notify();
  }
  return pub(rec);
}

/** Record the editor's current markdown for a tab; sets `dirty` when it differs from the saved text. */
export function updateContent(id: string, md: string): void {
  const rec = find(id);
  if (!rec) return;
  const dirty = md !== rec.saved;
  const changed = rec.content !== md || rec.dirty !== dirty;
  rec.content = md;
  rec.dirty = dirty;
  if (changed) notify();
}

/** Mark a tab as saved; with `path` (Save As / first save of an untitled tab) also names it. */
export function markSaved(id: string, path?: string, opts: { projectRelative?: boolean } = {}): void {
  const rec = find(id);
  if (!rec) return;
  rec.saved = rec.content;
  rec.dirty = false;
  if (path) {
    rec.path = path;
    rec.title = fileName(path);
    rec.projectRelative = opts.projectRelative ?? false;
  }
  notify();
}

function cycle(step: 1 | -1): Tab | null {
  if (records.length === 0) return null;
  const idx = Math.max(0, records.findIndex((r) => r.id === activeId));
  const next = records[(idx + step + records.length) % records.length];
  return setActive(next.id);
}

/** Activate the tab to the right (wrapping). */
export function nextTab(): Tab | null {
  return cycle(1);
}

/** Activate the tab to the left (wrapping). */
export function prevTab(): Tab | null {
  return cycle(-1);
}

/** Subscribe to tab changes. Returns the unsubscribe function. */
export function subscribe(fn: (s: TabsSnapshot) => void): () => void {
  return bw.sub(TABS_CHANGED, fn as (detail: unknown) => void);
}

/** Drop every tab (tests, and a future "close all"). Does not notify. */
export function resetTabs(): void {
  records = [];
  activeId = null;
  seq = 0;
}
