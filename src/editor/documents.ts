/**
 * Document session: binds the tab model to the single quikdown editor, the
 * status bar and the window title, and does file I/O for the active tab.
 *
 * The editor holds only the active tab's markdown. Switching tabs parks the
 * outgoing text in its tab and loads the incoming tab's text; the editor's
 * onChange keeps the active tab's content (and dirty flag) current.
 *
 * Every way a file reaches the editor — File → Open, the CLI argument, a
 * file-tree click, the project's remembered `open_file` — goes through
 * `openDocument`, so each path gets exactly one tab.
 */
import { invoke } from "@tauri-apps/api/core";
import { scheduleProjectSave } from "../project/persist";
import { ask, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getMarkdown, onEditorChange, setMarkdown } from "./editor";
import * as tabs from "./tabs";
import type { Tab } from "./tabs";
import { setStatusFile } from "../ui/shell";
import { highlightFile } from "../project/file-tree";
import { logEvent } from "../diag/perf";
import { joinPath } from "./paths";

const FILE_FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown", "txt"] },
  { name: "All Files", extensions: ["*"] },
];

let projectMode = false;
let projectRoot: string | null = null;
/** True while a tab switch is loading text into the editor; its onChange is not a user edit. */
let loading = false;
let unsubscribers: Array<() => void> = [];

/**
 * Wire the editor and the tab model together. Idempotent. Ensures there is a
 * tab (an untitled one on a fresh start) and shows it.
 */
export async function initDocuments(): Promise<void> {
  for (const off of unsubscribers) off();
  unsubscribers = [
    onEditorChange((md) => {
      if (loading) return;
      const active = tabs.activeTab();
      // The project tab has no document; its (hidden) editor is empty and not anyone's text.
      if (active && active.kind === "document") tabs.updateContent(active.id, md);
    }),
    tabs.subscribe(refreshChrome),
  ];
  if (!tabs.activeTab()) tabs.newUntitledTab();
  await showTab(tabs.activeTab()!.id);
}

/** Project mode changes how files are read/written and what the status bar shows when no file is open. */
export function setDocumentsProjectMode(on: boolean, root: string | null = null): void {
  projectMode = on;
  projectRoot = root;
  refreshChrome();
}

export function isProjectMode(): boolean {
  return projectMode;
}

export function projectRootPath(): string | null {
  return projectRoot;
}

/** The absolute path of `tab`'s file (project paths joined to the root), or null for an unsaved document. */
export function absolutePathOf(tab: Tab | null): string | null {
  if (!tab || tab.kind !== "document" || !tab.path) return null;
  return tab.projectRelative && projectRoot ? joinPath(projectRoot, tab.path) : tab.path;
}

/** The active document's absolute path, for images saved or resolved beside it. */
export function activeDocumentPath(): string | null {
  return absolutePathOf(tabs.activeTab());
}

// --- Status bar and window title ---

function statusLabel(tab: Tab | null): string {
  if (!tab || !tab.path) return projectMode && projectRoot ? `[Project] ${projectRoot}` : "No file open";
  return tab.projectRelative ? `[Project] ${tab.path}` : tab.path;
}

/** The project chat tab's status line: the root, since there is no file. */
function projectTabStatus(): string {
  return projectRoot ? `[Project] ${projectRoot} — project chat` : "Project chat";
}

function refreshChrome(): void {
  const active = tabs.activeTab();
  setStatusFile(active?.kind === "project" ? projectTabStatus() : active?.kind === "log" ? "Performance log" : statusLabel(active));
  const title = active?.title ?? "Untitled";
  document.title = `${active?.dirty ? "• " : ""}quikleaf — ${title}`;
  highlightFile(active?.projectRelative ? active.path : null);
}

// --- Switching ---

/**
 * Make `id` the active tab and load its text into the editor, parking the
 * outgoing tab's text first. Resolves once the editor reports the new text.
 */
export async function showTab(id: string): Promise<Tab | null> {
  const outgoing = tabs.activeTab();
  const incoming = tabs.getTab(id);
  if (!incoming) return null;
  if (outgoing && outgoing.kind === "document" && outgoing.id !== incoming.id && !loading) {
    tabs.updateContent(outgoing.id, getMarkdown());
  }
  tabs.setActive(incoming.id);
  loading = true;
  try {
    // The project and log tabs show no document: the editor is hidden and
    // emptied so the outline and stats do not keep describing the previous tab.
    await setMarkdown(incoming.kind === "document" ? tabs.getTab(incoming.id)!.content : "");
  } finally {
    loading = false;
  }
  if (incoming.projectRelative && incoming.path) {
    invoke("set_open_file", { path: incoming.path }).catch(() => {});
    scheduleProjectSave();
  }
  return tabs.activeTab();
}

/** Open (or focus) a tab for `path` holding `content`, and show it. */
export async function openDocument(path: string, content: string, projectRelative = false): Promise<Tab> {
  const tab = tabs.openTab(path, content, { projectRelative });
  await showTab(tab.id);
  return tabs.getTab(tab.id)!;
}

/**
 * Read a path from disk and open it: absolute paths via the fs plugin, project
 * paths via `file_read`. The fs plugin only reads paths in its scope (the
 * dialog's picks, the command-line file); `allow_path` adds this one first so
 * a dropped file opens too.
 */
export async function openPath(path: string, projectRelative = false): Promise<Tab | null> {
  try {
    if (!projectRelative) await invoke("allow_path", { path }).catch(() => {});
    const content = projectRelative ? await invoke<string>("file_read", { path }) : await readTextFile(path);
    return await openDocument(path, content, projectRelative);
  } catch (e) {
    console.error("Failed to open file:", e);
    // Into the diagnostics log too: About → Diagnostics and `/log` show it.
    logEvent({ kind: "app", event: "open-failed", path, error: String((e as any)?.message ?? e) });
    return null;
  }
}

/** File → Open: pick a file with the system dialog and open it in a tab. */
export async function openFileDialog(): Promise<Tab | null> {
  try {
    const selected = await openDialog({ multiple: false, filters: FILE_FILTERS });
    const path = typeof selected === "string" ? selected : Array.isArray(selected) ? selected[0] : null;
    if (!path) return null;
    return await openPath(path, false);
  } catch (e) {
    console.error("Failed to open file:", e);
    return null;
  }
}

/** File → New: a fresh untitled tab. */
export async function newDocument(): Promise<Tab> {
  const tab = tabs.newUntitledTab();
  await showTab(tab.id);
  return tab;
}

/**
 * View → Project Chat: open (or focus) the project tab, whose chat works on
 * files under the project root. Only in project mode; returns null otherwise.
 */
export async function openProjectChat(): Promise<Tab | null> {
  if (!projectMode) return null;
  const tab = tabs.openProjectTab();
  await showTab(tab.id);
  return tabs.getTab(tab.id);
}

/** About → Diagnostics → View Log, Settings → View Log, `quikleaf --log`: open (or focus) the log viewer tab. */
export async function openLogTab(): Promise<Tab | null> {
  const tab = tabs.openLogTab();
  await showTab(tab.id);
  return tabs.getTab(tab.id);
}

// --- Reloading (Watch) ---

/**
 * Replace a tab's text with what is on disk and mark it clean. The active
 * tab's editor is reloaded too (not a user edit, so `loading` is set).
 */
export async function reloadDocument(id: string, content: string): Promise<void> {
  const tab = tabs.getTab(id);
  if (!tab || tab.kind !== "document") return;
  tabs.updateContent(id, content);
  tabs.markSaved(id);
  if (tabs.activeTab()?.id === id) {
    loading = true;
    try {
      await setMarkdown(content);
    } finally {
      loading = false;
    }
  }
}

// --- Saving ---

async function writeTab(tab: Tab, path: string, projectRelative: boolean, md: string): Promise<void> {
  if (projectRelative) await invoke("file_write", { path, content: md });
  else await writeTextFile(path, md);
}

/**
 * File → Save for the active tab. Project tabs go through `file_write`,
 * absolute paths through the fs plugin, and an untitled tab asks for a path
 * first. Returns true when something was written.
 */
export async function saveActiveDocument(): Promise<boolean> {
  const tab = tabs.activeTab();
  if (!tab || tab.kind !== "document") return false;
  const md = getMarkdown();
  tabs.updateContent(tab.id, md);
  try {
    if (tab.path) {
      await writeTab(tab, tab.path, tab.projectRelative, md);
      tabs.markSaved(tab.id);
      return true;
    }
    const path = await saveDialog({
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      defaultPath: `${tab.title.toLowerCase().replace(/\s+/g, "-")}.md`,
    });
    if (!path) return false;
    await writeTab(tab, path, false, md);
    tabs.markSaved(tab.id, path);
    return true;
  } catch (e) {
    console.error("Failed to save file:", e);
    return false;
  }
}

// --- Closing ---

/**
 * Close a tab (the active one by default). A dirty tab asks for confirmation
 * first. Returns true when the tab was closed.
 */
export async function closeDocument(id?: string): Promise<boolean> {
  const tab = id ? tabs.getTab(id) : tabs.activeTab();
  if (!tab) return false;
  const isActive = tabs.activeTab()?.id === tab.id;
  // The active tab's text lives in the editor; sync it before judging dirtiness.
  if (isActive) tabs.updateContent(tab.id, getMarkdown());
  if (tabs.getTab(tab.id)!.dirty) {
    const ok = await ask(`"${tab.title}" has unsaved changes. Close it anyway?`, {
      title: "Unsaved changes",
      kind: "warning",
      okLabel: "Close",
      cancelLabel: "Cancel",
    });
    if (!ok) return false;
  }
  const next = tabs.closeTab(tab.id);
  if (tab.projectRelative) scheduleProjectSave();
  if (isActive && next) {
    loading = true; // the outgoing tab is gone; do not park the editor text anywhere
    try {
      await showTab(next.id);
    } finally {
      loading = false;
    }
  }
  return true;
}

/** Ctrl+Tab / Ctrl+Shift+Tab: activate the neighbouring tab. */
export async function cycleTab(step: 1 | -1): Promise<Tab | null> {
  const next = step === 1 ? tabs.nextTab() : tabs.prevTab();
  return next ? showTab(next.id) : null;
}

// --- Keyboard ---

/**
 * Application shortcuts. Returns true (and prevents default) when handled.
 *   Cmd/Ctrl+N new · Cmd/Ctrl+O open · Cmd/Ctrl+S save · Cmd/Ctrl+W close tab
 *   Ctrl+Tab / Ctrl+Shift+Tab and Cmd+Shift+] / [ cycle tabs
 */
export function handleKeydown(e: KeyboardEvent): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return false;
  const key = e.key.toLowerCase();
  let action: (() => unknown) | null = null;

  if (e.ctrlKey && key === "tab") action = () => cycleTab(e.shiftKey ? -1 : 1);
  else if (e.metaKey && e.shiftKey && e.code === "BracketRight") action = () => cycleTab(1);
  else if (e.metaKey && e.shiftKey && e.code === "BracketLeft") action = () => cycleTab(-1);
  else if (!e.shiftKey && !e.altKey) {
    if (key === "n") action = newDocument;
    else if (key === "o") action = openFileDialog;
    else if (key === "s") action = saveActiveDocument;
    else if (key === "w") action = () => closeDocument();
  }

  if (!action) return false;
  e.preventDefault();
  void action();
  return true;
}

/** Re-export the model's read/select API for other modules (chat tools, tests). */
export { listTabs, activeTab, getTab, setActive } from "./tabs";
