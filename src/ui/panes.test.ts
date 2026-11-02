/**
 * Per-tab pane layout: the active tab's `view` drives the chat and info
 * panes and the editor mode; toggles write back to the tab; the project tab
 * hides the editor and pins its chat open.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import bw from "bitwrench";
import * as tabs from "../editor/tabs";
import { getEditor, initEditor, notifyEditorModeChange } from "../editor/editor";
import { makeToggleButton } from "./shell";
import { makeInfoPanel } from "./infopane";
import { resetSessions } from "../chat/session";
import {
  activeEditorMode,
  applyPanes,
  handlePanesKeydown,
  initPanes,
  isChatPaneOpen,
  isInfoPaneOpen,
  setActiveEditorMode,
  toggleChatPane,
  toggleInfoPane,
} from "./panes";

let stop: (() => void) | null = null;

function app(): HTMLElement {
  return document.getElementById("app")!;
}
const hidden = (id: string) => document.getElementById(id)!.classList.contains("hidden");
const pressed = (id: string) => document.getElementById(id)!.getAttribute("aria-pressed");

beforeEach(() => {
  tabs.resetTabs();
  resetSessions();
  bw.append(app(), { t: "div", a: { id: "editor-column" }, c: [{ t: "div", a: { id: "chat-panel", class: "hidden" } }, { t: "div", a: { id: "editor-container" } }, makeInfoPanel()] });
  bw.append(app(), makeToggleButton("btn-toggle-chat", "Chat", () => {}));
  bw.append(app(), makeToggleButton("btn-toggle-info", "Info", () => {}));
  initEditor(document.getElementById("editor-container")!);
});

afterEach(() => {
  stop?.();
  stop = null;
  tabs.resetTabs();
  resetSessions();
  bw.clear(app());
});

describe("applyPanes", () => {
  it("does nothing without an active tab", () => {
    expect(() => applyPanes()).not.toThrow();
    expect(hidden("chat-panel")).toBe(true);
  });

  it("shows the active tab's panes and editor mode, and follows tab switches", () => {
    const a = tabs.openTab("/a.md", "");
    tabs.setView(a.id, { chat: true, mode: "preview" });
    const b = tabs.openTab("/b.md", ""); // inherits a's layout (chat open, preview)
    tabs.setView(b.id, { chat: false, info: true, mode: "source" });
    stop = initPanes();

    // b is active
    expect(hidden("chat-panel")).toBe(true);
    expect(hidden("info-panel")).toBe(false);
    expect(pressed("btn-toggle-info")).toBe("true");
    expect(getEditor().mode).toBe("source");
    expect(isChatPaneOpen()).toBe(false);
    expect(isInfoPaneOpen()).toBe(true);
    expect(activeEditorMode()).toBe("source");

    tabs.setActive(a.id);
    expect(hidden("chat-panel")).toBe(false);
    expect(hidden("info-panel")).toBe(true);
    expect(pressed("btn-toggle-chat")).toBe("true");
    expect(getEditor().mode).toBe("preview");
    expect(activeEditorMode()).toBe("preview");
  });

  it("the project tab hides the editor and pins the chat open", () => {
    tabs.newUntitledTab();
    stop = initPanes();
    expect(document.getElementById("editor-column")!.classList.contains("project-tab")).toBe(false);
    tabs.openProjectTab();
    expect(hidden("chat-panel")).toBe(false);
    expect(document.getElementById("editor-column")!.classList.contains("project-tab")).toBe(true);
    expect(isChatPaneOpen()).toBe(true);
    expect(toggleChatPane()).toBe(true); // cannot be closed
    expect(hidden("chat-panel")).toBe(false);
    setActiveEditorMode("preview"); // ignored for the project tab
    expect(tabs.activeTab()!.view.mode).toBe("split");
    tabs.closeTab(tabs.PROJECT_TAB_ID);
    expect(document.getElementById("editor-column")!.classList.contains("project-tab")).toBe(false);
  });
});

describe("toggles", () => {
  it("toggleChatPane / toggleInfoPane write to the active tab and update the DOM", () => {
    const a = tabs.openTab("/a.md", "");
    stop = initPanes();
    expect(toggleChatPane()).toBe(true);
    expect(tabs.getTab(a.id)!.view.chat).toBe(true);
    expect(hidden("chat-panel")).toBe(false);
    expect(toggleInfoPane()).toBe(true);
    expect(tabs.getTab(a.id)!.view.info).toBe(true);
    expect(hidden("info-panel")).toBe(false);
    expect(toggleChatPane()).toBe(false);
    expect(toggleInfoPane()).toBe(false);
    expect(hidden("chat-panel")).toBe(true);
    expect(hidden("info-panel")).toBe(true);
    tabs.resetTabs();
    expect(toggleChatPane()).toBe(false);
    expect(toggleInfoPane()).toBe(false);
    expect(activeEditorMode()).toBe("split");
    expect(() => setActiveEditorMode("source")).not.toThrow();
  });

  it("a new tab inherits the layout of the tab it was opened from", () => {
    const a = tabs.openTab("/a.md", "");
    stop = initPanes();
    toggleChatPane();
    setActiveEditorMode("preview");
    const b = tabs.newUntitledTab();
    expect(tabs.getTab(b.id)!.view).toEqual({ chat: true, info: false, mode: "preview" });
    expect(hidden("chat-panel")).toBe(false);
    expect(getEditor().mode).toBe("preview");
    void a;
  });

  it("setActiveEditorMode drives the editor; quikdown's own toolbar writes the mode back to the tab", () => {
    const a = tabs.openTab("/a.md", "");
    stop = initPanes();
    setActiveEditorMode("source");
    expect(getEditor().mode).toBe("source");
    expect(getEditor().setMode).toHaveBeenCalledWith("source");
    // The user clicks Preview in the quikdown toolbar.
    getEditor().mode = "preview";
    notifyEditorModeChange("preview");
    expect(tabs.getTab(a.id)!.view.mode).toBe("preview");
    // Unknown modes are ignored.
    notifyEditorModeChange("bogus");
    expect(tabs.getTab(a.id)!.view.mode).toBe("preview");
  });

  it("Cmd/Ctrl+Shift+C and +I toggle the panes; other keys pass through", () => {
    tabs.openTab("/a.md", "");
    stop = initPanes();
    const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { cancelable: true, ...init });
    const c = key({ key: "C", metaKey: true, shiftKey: true });
    expect(handlePanesKeydown(c)).toBe(true);
    expect(c.defaultPrevented).toBe(true);
    expect(isChatPaneOpen()).toBe(true);
    expect(handlePanesKeydown(key({ key: "i", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isInfoPaneOpen()).toBe(true);
    expect(handlePanesKeydown(key({ key: "c", metaKey: true }))).toBe(false);
    expect(handlePanesKeydown(key({ key: "c", metaKey: true, shiftKey: true, altKey: true }))).toBe(false);
    expect(handlePanesKeydown(key({ key: "x", metaKey: true, shiftKey: true }))).toBe(false);
    expect(handlePanesKeydown(key({ key: "C", shiftKey: true }))).toBe(false);
  });

  it("initPanes is idempotent and its unsubscribe stops updates", () => {
    const a = tabs.openTab("/a.md", "");
    initPanes();
    const off = initPanes();
    tabs.setView(a.id, { chat: true });
    expect(hidden("chat-panel")).toBe(false);
    off();
    tabs.setView(a.id, { chat: false });
    expect(hidden("chat-panel")).toBe(false); // no longer applied
  });
});
