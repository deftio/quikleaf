/**
 * Watch: reload a tab when its file changes on disk.
 *
 * Off by default. The Watch toggle in the tab's control row (or `quikleaf
 * --watch file.md`) asks Rust to watch the document's absolute path; Rust
 * emits `file-changed` and the tab reloads. A tab with unsaved edits asks
 * before its text is replaced. A removed file is reported once and the tab
 * keeps its text. Closing a tab stops its watch.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import * as tabs from "./tabs";
import { absolutePathOf, reloadDocument } from "./documents";
import { flashWatchReloaded, setEditorToolbarWatch } from "../ui/editor-toolbar";
import { logEvent } from "../diag/perf";
import { notify } from "../ui/toast";

export const FILE_CHANGED = "file-changed";
/** Editors write in bursts (temp file, rename, metadata); one reload per burst. */
export const RELOAD_DEBOUNCE_MS = 150;

export interface FileChangedPayload {
  path: string;
  kind: "changed" | "removed";
}

/** Tab id → the absolute path Rust is watching for it. */
const watched = new Map<string, string>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const reported = new Set<string>();

export function isWatched(tabId: string): boolean {
  return watched.has(tabId);
}

export function watchedPaths(): string[] {
  return Array.from(watched.values());
}

/** Reflect the active tab in the Watch button: pressed when watched, disabled when it has no file. */
export function refreshWatchToolbar(): void {
  const active = tabs.activeTab();
  setEditorToolbarWatch(!!active && watched.has(active.id), !!absolutePathOf(active));
}

/**
 * Turn watching on or off for `tabId`. Resolves to the resulting state; a
 * tab with no file (untitled, project, log) cannot be watched. A failed
 * `watch_start` is reported and leaves the toggle off.
 */
export async function setWatched(tabId: string, on: boolean): Promise<boolean> {
  const tab = tabs.getTab(tabId);
  const path = absolutePathOf(tab);
  if (on) {
    if (!path) return false;
    if (watched.get(tabId) === path) return true;
    try {
      await invoke("watch_start", { path });
      watched.set(tabId, path);
      reported.delete(path);
    } catch (e) {
      notify("Cannot watch file", String((e as any)?.message ?? e), "danger");
      return false;
    }
  } else {
    const prev = watched.get(tabId);
    if (prev === undefined) return false;
    watched.delete(tabId);
    if (!watchedPaths().includes(prev)) await invoke("watch_stop", { path: prev }).catch(() => {});
  }
  refreshWatchToolbar();
  return watched.has(tabId);
}

/** The Watch button: flip the active tab. */
export async function toggleWatch(): Promise<boolean> {
  const active = tabs.activeTab();
  if (!active) return false;
  return setWatched(active.id, !watched.has(active.id));
}

async function readBack(tab: tabs.Tab, path: string): Promise<string> {
  return tab.projectRelative ? invoke<string>("file_read", { path: tab.path }) : readTextFile(path);
}

/** Reload every watched tab on `path` (after the debounce). Exported for tests. */
export async function reloadWatched(path: string, kind: FileChangedPayload["kind"]): Promise<number> {
  let n = 0;
  for (const [tabId, p] of Array.from(watched.entries())) {
    if (p !== path) continue;
    const tab = tabs.getTab(tabId);
    if (!tab) {
      watched.delete(tabId);
      continue;
    }
    if (kind === "removed") {
      if (!reported.has(path)) {
        reported.add(path);
        notify("File removed on disk", `${tab.title} was deleted or moved. The tab keeps its text; Save writes it back.`, "warning", 8000);
      }
      continue;
    }
    let content: string;
    try {
      content = await readBack(tab, path);
    } catch (e) {
      // A save in progress can leave a moment with no file; the next event will do.
      logEvent({ kind: "app", event: "watch-read-failed", path, error: String((e as any)?.message ?? e) });
      continue;
    }
    reported.delete(path);
    const current = tabs.getTab(tabId)!;
    if (content === current.content) continue;
    if (current.dirty) {
      const ok = await ask(`"${current.title}" changed on disk and has unsaved edits here. Reload it and lose those edits?`, {
        title: "File changed on disk",
        kind: "warning",
        okLabel: "Reload",
        cancelLabel: "Keep mine",
      });
      if (!ok) continue;
    }
    await reloadDocument(tabId, content);
    logEvent({ kind: "app", event: "watch-reload", path });
    if (tabs.activeTab()?.id === tabId) flashWatchReloaded();
    n++;
  }
  return n;
}

/** The `file-changed` handler: coalesce a burst of events per path, then reload. */
export function handleFileChanged(payload: FileChangedPayload): void {
  const key = payload.path;
  const prior = pending.get(key);
  if (prior) clearTimeout(prior);
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      void reloadWatched(payload.path, payload.kind);
    }, RELOAD_DEBOUNCE_MS),
  );
}

let unsubscribers: Array<() => void> = [];

/** Listen for changes and keep the button and the watch set in step with the tabs. Idempotent. */
export async function initWatch(): Promise<() => void> {
  disposeWatch();
  const offTabs = tabs.subscribe((s) => {
    // Closed tabs stop watching; the button follows the active tab.
    const live = new Set(s.tabs.map((t) => t.id));
    for (const id of Array.from(watched.keys())) if (!live.has(id)) void setWatched(id, false);
    refreshWatchToolbar();
  });
  unsubscribers.push(offTabs);
  try {
    const off = await listen<FileChangedPayload>(FILE_CHANGED, (e) => handleFileChanged(e.payload));
    unsubscribers.push(off);
  } catch (e) {
    console.warn("file watching unavailable:", e);
  }
  refreshWatchToolbar();
  return disposeWatch;
}

export function disposeWatch(): void {
  for (const off of unsubscribers) off();
  unsubscribers = [];
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
}

/** Tests: forget every watch without talking to Rust. */
export function resetWatch(): void {
  disposeWatch();
  watched.clear();
  reported.clear();
}
