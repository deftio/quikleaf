/**
 * Per-tab pane layout: `[chat | quikdown view | info]`.
 *
 * Each tab remembers which panes it shows and the editor's mode
 * (`Tab.view`, in `editor/tabs.ts`). This module applies the active tab's
 * layout to the DOM whenever the tab model changes, and turns the toolbar /
 * menu / keyboard toggles into `setView` calls on the active tab. The
 * project tab is special: it has no document, so its editor is hidden and
 * its chat is always shown.
 */
import bw from "bitwrench";
import { activeTab, setView, snapshot, subscribe, type EditorMode, type TabsSnapshot } from "../editor/tabs";
import { onEditorModeChange, setEditorMode } from "../editor/editor";
import { setChatPanelVisible, setInfoPanelVisible } from "./shell";
import { refreshInfo } from "./infopane";

let unsubscribers: Array<() => void> = [];

/** Reflect a snapshot's active tab in the DOM. Exported for tests. */
export function applyPanes(s: TabsSnapshot = snapshot()): void {
  const tab = s.active;
  if (!tab) return;
  const project = tab.kind === "project";
  const log = tab.kind === "log";
  setChatPanelVisible(project || (tab.view.chat && !log));
  setInfoPanelVisible(tab.view.info);
  bw.toggleClass("editor-column", "project-tab", project);
  bw.toggleClass("editor-column", "log-tab", log);
  if (tab.kind === "document") setEditorMode(tab.view.mode);
  if (tab.view.info) refreshInfo();
}

/**
 * Start applying tab layouts. Idempotent; returns the unsubscribe function.
 * Also records mode changes made with quikdown's own toolbar on the tab.
 */
export function initPanes(): () => void {
  for (const off of unsubscribers) off();
  unsubscribers = [
    subscribe(applyPanes),
    onEditorModeChange((mode) => {
      const tab = activeTab();
      if (tab && tab.kind === "document" && tab.view.mode !== mode) setView(tab.id, { mode });
    }),
  ];
  applyPanes();
  return () => {
    for (const off of unsubscribers) off();
    unsubscribers = [];
  };
}

export function isChatPaneOpen(): boolean {
  const tab = activeTab();
  return !!tab && tab.kind !== "log" && (tab.kind === "project" || tab.view.chat);
}

export function isInfoPaneOpen(): boolean {
  return !!activeTab()?.view.info;
}

export function activeEditorMode(): EditorMode {
  return activeTab()?.view.mode ?? "split";
}

/** Show or hide the active tab's chat. Returns the new state. The project tab's chat stays open; the log tab has none. */
export function toggleChatPane(): boolean {
  const tab = activeTab();
  if (!tab) return false;
  if (tab.kind === "project") return true;
  if (tab.kind === "log") return false;
  const on = !tab.view.chat;
  setView(tab.id, { chat: on });
  return on;
}

/** Show or hide the active tab's info pane. Returns the new state. */
export function toggleInfoPane(): boolean {
  const tab = activeTab();
  if (!tab) return false;
  const on = !tab.view.info;
  setView(tab.id, { info: on });
  return on;
}

/** Source / Split / Preview for the active tab (View menu). */
export function setActiveEditorMode(mode: EditorMode): void {
  const tab = activeTab();
  if (!tab || tab.kind !== "document") return;
  setView(tab.id, { mode });
}

/** Cmd/Ctrl+Shift+C toggles the chat pane, Cmd/Ctrl+Shift+I the info pane. Returns true when handled. */
export function handlePanesKeydown(e: KeyboardEvent): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || !e.shiftKey || e.altKey) return false;
  const key = e.key.toLowerCase();
  if (key === "c") {
    e.preventDefault();
    toggleChatPane();
    return true;
  }
  if (key === "i") {
    e.preventDefault();
    toggleInfoPane();
    return true;
  }
  return false;
}
