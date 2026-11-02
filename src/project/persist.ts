/**
 * Project persistence: writes `quikleaf.prj` through the Rust `project_save`
 * command whenever project-scoped state changes (open file, open tabs, chat
 * history, scratchpad, key-value store). The Rust side owns memory/KV/log;
 * the frontend supplies the open file, the tabs and the chats and triggers
 * the write.
 *
 * Saves are debounced so a burst of tool calls produces one write, and
 * flushed on `pagehide` so a quick quit does not lose the last change.
 * Nothing here runs outside project mode.
 */
import { invoke } from "@tauri-apps/api/core";

export const SAVE_DEBOUNCE_MS = 300;

let enabled = false;
let openFileProvider: () => string | null = () => null;
let openTabsProvider: () => string[] = () => [];
let chatHistoryProvider: () => unknown = () => ({});
let timer: ReturnType<typeof setTimeout> | null = null;

/** Enable persistence (project mode only) and tell it where to read the state it writes. */
export function initProjectPersistence(opts: { openFile: () => string | null; openTabs?: () => string[]; chatHistory?: () => unknown }): void {
  openFileProvider = opts.openFile;
  openTabsProvider = opts.openTabs ?? (() => []);
  chatHistoryProvider = opts.chatHistory ?? (() => ({}));
  enabled = true;
}

/** Turn persistence off and drop any pending save (used by tests and when leaving project mode). */
export function disableProjectPersistence(): void {
  enabled = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export function isProjectPersistenceEnabled(): boolean {
  return enabled;
}

export function hasPendingSave(): boolean {
  return timer !== null;
}

/** Write the project file now. Never throws; a failed save is logged and reported as `false`. */
export async function saveProjectNow(): Promise<boolean> {
  if (!enabled) return false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    await invoke("project_save", {
      openFile: openFileProvider(),
      openTabs: openTabsProvider(),
      chatHistory: chatHistoryProvider(),
      preferences: {},
    });
    return true;
  } catch (e) {
    console.warn("project save failed:", e);
    return false;
  }
}

/** Coalesce rapid changes into one write. */
export function scheduleProjectSave(): void {
  if (!enabled) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void saveProjectNow();
  }, SAVE_DEBOUNCE_MS);
}

/** Flush a pending save when the page is being torn down. */
export function flushProjectSaveOnUnload(target: Window = window): void {
  target.addEventListener("pagehide", () => {
    if (enabled && timer) void saveProjectNow();
  });
}
