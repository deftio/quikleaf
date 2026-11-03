/**
 * Document session: tab switching against the single editor instance, file
 * open/save/close flows (with the Tauri IPC, dialog and fs plugins mocked by
 * test-setup.ts), status bar / window title, and keyboard shortcuts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import { ask, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getEditor, initEditor, notifyEditorChange } from "./editor";
import * as tabs from "./tabs";
import {
  closeDocument,
  cycleTab,
  handleKeydown,
  initDocuments,
  isProjectMode,
  listTabs,
  newDocument,
  openDocument,
  openFileDialog,
  openPath,
  openLogTab,
  openProjectChat,
  saveActiveDocument,
  setDocumentsProjectMode,
  showTab,
} from "./documents";
import { makeFileTreePanel, loadTree } from "../project/file-tree";

const mockInvoke = vi.mocked(invoke);
const mockOpen = vi.mocked(openDialog);
const mockSave = vi.mocked(saveDialog);
const mockAsk = vi.mocked(ask);
const mockRead = vi.mocked(readTextFile);
const mockWrite = vi.mocked(writeTextFile);

/** The editor's "current markdown"; the mock editor is wired to behave like quikdown. */
let editorText = "";

function app(): HTMLElement {
  return document.getElementById("app")!;
}

function status(): string {
  return document.getElementById("status-file")!.textContent ?? "";
}

/** Simulate the user typing: quikdown would call onChange with the new text. */
function type(md: string): void {
  editorText = md;
  notifyEditorChange(md, "");
}

function pressKey(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { cancelable: true, ...init });
  return e;
}

beforeEach(async () => {
  tabs.resetTabs();
  editorText = "";
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async () => null);
  mockOpen.mockReset();
  mockOpen.mockResolvedValue(null);
  mockSave.mockReset();
  mockSave.mockResolvedValue(null);
  mockAsk.mockReset();
  mockAsk.mockResolvedValue(true);
  mockRead.mockReset();
  mockRead.mockResolvedValue("");
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);

  bw.append(app(), { t: "span", a: { id: "status-file" }, c: "No file open" });
  const container = bw.append(app(), { t: "div", a: { id: "editor-container" } });
  initEditor(container);
  const inst = getEditor();
  inst.getMarkdown.mockImplementation(() => editorText);
  inst.setMarkdown.mockImplementation(async (md: string) => {
    editorText = md;
    notifyEditorChange(md, "");
  });
  setDocumentsProjectMode(false);
  await initDocuments();
});

afterEach(() => {
  bw.clear(app());
});

describe("initDocuments", () => {
  it("starts with one clean untitled tab shown in an empty editor", () => {
    expect(listTabs()).toHaveLength(1);
    expect(tabs.activeTab()).toMatchObject({ path: null, title: "Untitled", dirty: false });
    expect(getEditor().setMarkdown).toHaveBeenCalledWith("");
    expect(status()).toBe("No file open");
    expect(document.title).toBe("quikleaf — Untitled");
  });

  it("is idempotent: a second init keeps the existing tabs and does not double-subscribe", async () => {
    await openDocument("/a.md", "a");
    await initDocuments();
    expect(listTabs()).toHaveLength(2);
    const before = getEditor().setMarkdown.mock.calls.length;
    type("typed");
    expect(tabs.activeTab()?.content).toBe("typed");
    expect(getEditor().setMarkdown.mock.calls.length).toBe(before);
  });
});

describe("typing", () => {
  it("flows editor changes into the active tab and flags it dirty", () => {
    const active = tabs.activeTab()!;
    type("# Hello");
    expect(tabs.getTab(active.id)).toMatchObject({ content: "# Hello", dirty: true });
    expect(document.title).toBe("• quikleaf — Untitled");
  });
});

describe("openDocument / showTab", () => {
  it("opens a tab for a path, loads it into the editor and updates status and title", async () => {
    const tab = await openDocument("/docs/notes.md", "# Notes");
    expect(tab).toMatchObject({ path: "/docs/notes.md", title: "notes.md", dirty: false });
    expect(editorText).toBe("# Notes");
    expect(status()).toBe("/docs/notes.md");
    expect(document.title).toBe("quikleaf — notes.md");
    expect(listTabs()).toHaveLength(2); // the initial untitled tab stays
  });

  it("loading a tab is not a user edit — the tab stays clean", async () => {
    const tab = await openDocument("/a.md", "a");
    expect(tabs.getTab(tab.id)?.dirty).toBe(false);
  });

  it("switching tabs parks the outgoing text and restores it when switching back", async () => {
    const a = await openDocument("/a.md", "a");
    type("a edited");
    const b = await openDocument("/b.md", "b");
    expect(editorText).toBe("b");
    expect(tabs.getTab(a.id)).toMatchObject({ content: "a edited", dirty: true });
    expect(tabs.getTab(b.id)?.dirty).toBe(false);

    await showTab(a.id);
    expect(editorText).toBe("a edited");
    expect(tabs.activeTab()?.id).toBe(a.id);
    expect(tabs.getTab(a.id)?.dirty).toBe(true); // still dirty after the round trip
    expect(document.title).toBe("• quikleaf — a.md");
  });

  it("showTab on the active tab reloads it without parking anything odd", async () => {
    const a = await openDocument("/a.md", "a");
    type("x");
    const result = await showTab(a.id);
    expect(result?.id).toBe(a.id);
    expect(editorText).toBe("x");
  });

  it("showTab returns null for an unknown id and leaves the editor alone", async () => {
    await openDocument("/a.md", "a");
    expect(await showTab("tab-99")).toBeNull();
    expect(editorText).toBe("a");
  });

  it("re-opening the same path focuses the existing tab", async () => {
    const a = await openDocument("/a.md", "a");
    await openDocument("/b.md", "b");
    const again = await openDocument("/a.md", "a2");
    expect(again.id).toBe(a.id);
    expect(listTabs()).toHaveLength(3);
    expect(editorText).toBe("a2");
  });

  it("project tabs show the [Project] prefix and remember themselves as the open file", async () => {
    setDocumentsProjectMode(true, "/proj");
    expect(isProjectMode()).toBe(true);
    expect(status()).toBe("[Project] /proj"); // untitled tab in project mode
    await openDocument("docs/guide.md", "# Guide", true);
    expect(status()).toBe("[Project] docs/guide.md");
    expect(mockInvoke).toHaveBeenCalledWith("set_open_file", { path: "docs/guide.md" });
  });

  it("highlights the active project file in the tree as tabs change", async () => {
    setDocumentsProjectMode(true, "/proj");
    bw.append(app(), makeFileTreePanel());
    mockInvoke.mockImplementation(async (cmd) =>
      cmd === "file_list"
        ? { entries: [{ name: "a.md", type: "file", size: 1 }, { name: "b.md", type: "file", size: 1 }] }
        : null,
    );
    await loadTree();
    const a = await openDocument("a.md", "a", true);
    const items = Array.from(document.querySelectorAll(".file-tree-item"));
    expect(items[0].classList.contains("active")).toBe(true);
    await openDocument("b.md", "b", true);
    expect(items[0].classList.contains("active")).toBe(false);
    expect(items[1].classList.contains("active")).toBe(true);
    await newDocument();
    expect(document.querySelectorAll(".file-tree-item.active")).toHaveLength(0);
    await showTab(a.id);
    expect(items[0].classList.contains("active")).toBe(true);
  });

  it("a failing set_open_file is swallowed", async () => {
    setDocumentsProjectMode(true, "/proj");
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "set_open_file") throw new Error("nope");
      return null;
    });
    await expect(openDocument("a.md", "a", true)).resolves.toMatchObject({ path: "a.md" });
    await Promise.resolve();
  });
});

describe("openPath", () => {
  it("reads absolute paths through the fs plugin", async () => {
    mockRead.mockResolvedValue("# From disk");
    const tab = await openPath("/x/y.md");
    expect(mockRead).toHaveBeenCalledWith("/x/y.md");
    expect(tab).toMatchObject({ path: "/x/y.md", projectRelative: false });
    expect(editorText).toBe("# From disk");
  });

  it("reads project paths through file_read", async () => {
    mockInvoke.mockImplementation(async (cmd, args: any) => (cmd === "file_read" ? `content of ${args.path}` : null));
    const tab = await openPath("notes/a.md", true);
    expect(mockInvoke).toHaveBeenCalledWith("file_read", { path: "notes/a.md" });
    expect(tab).toMatchObject({ path: "notes/a.md", projectRelative: true, content: "content of notes/a.md" });
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("logs and returns null when the read fails, leaving tabs untouched", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRead.mockRejectedValue(new Error("missing"));
    expect(await openPath("/gone.md")).toBeNull();
    expect(listTabs()).toHaveLength(1);
    expect(err).toHaveBeenCalled();
    // The reason reaches the diagnostics log (perf log is on by default).
    const logged = mockInvoke.mock.calls.find((c) => c[0] === "log_append");
    expect(logged?.[1]).toMatchObject({ entry: { kind: "app", event: "open-failed", path: "/gone.md", error: "missing" } });
    err.mockRestore();
  });
});

describe("openFileDialog", () => {
  it("opens the chosen file", async () => {
    mockOpen.mockResolvedValue("/picked.md");
    mockRead.mockResolvedValue("picked");
    const tab = await openFileDialog();
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ multiple: false }));
    expect(tab?.path).toBe("/picked.md");
    expect(editorText).toBe("picked");
  });

  it("accepts an array result and uses its first entry", async () => {
    mockOpen.mockResolvedValue(["/first.md", "/second.md"]);
    const tab = await openFileDialog();
    expect(tab?.path).toBe("/first.md");
  });

  it("does nothing when the dialog is cancelled or returns an empty array", async () => {
    expect(await openFileDialog()).toBeNull();
    mockOpen.mockResolvedValue([]);
    expect(await openFileDialog()).toBeNull();
    expect(mockRead).not.toHaveBeenCalled();
    expect(listTabs()).toHaveLength(1);
  });

  it("logs and returns null when the dialog throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockOpen.mockRejectedValue(new Error("dialog broke"));
    expect(await openFileDialog()).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("newDocument", () => {
  it("adds an untitled tab, shows it and clears the editor", async () => {
    await openDocument("/a.md", "a");
    const t = await newDocument();
    expect(t.title).toBe("Untitled 2");
    expect(tabs.activeTab()?.id).toBe(t.id);
    expect(editorText).toBe("");
    expect(status()).toBe("No file open");
  });
});

describe("saveActiveDocument", () => {
  it("writes an absolute-path tab through the fs plugin and clears dirty", async () => {
    const a = await openDocument("/a.md", "a");
    type("a2");
    expect(await saveActiveDocument()).toBe(true);
    expect(mockWrite).toHaveBeenCalledWith("/a.md", "a2");
    expect(mockInvoke).not.toHaveBeenCalledWith("file_write", expect.anything());
    expect(tabs.getTab(a.id)).toMatchObject({ content: "a2", dirty: false });
    expect(document.title).toBe("quikleaf — a.md");
  });

  it("writes a project tab through file_write", async () => {
    setDocumentsProjectMode(true, "/proj");
    await openDocument("docs/g.md", "g", true);
    type("g2");
    expect(await saveActiveDocument()).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("file_write", { path: "docs/g.md", content: "g2" });
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("asks for a path for an untitled tab, then names the tab", async () => {
    type("# Draft");
    mockSave.mockResolvedValue("/tmp/draft.md");
    expect(await saveActiveDocument()).toBe(true);
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "untitled.md" }));
    expect(mockWrite).toHaveBeenCalledWith("/tmp/draft.md", "# Draft");
    expect(tabs.activeTab()).toMatchObject({ path: "/tmp/draft.md", title: "draft.md", dirty: false });
    expect(status()).toBe("/tmp/draft.md");
    expect(document.title).toBe("quikleaf — draft.md");
  });

  it("derives the suggested file name from the untitled title", async () => {
    await newDocument(); // "Untitled 2"
    await saveActiveDocument();
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "untitled-2.md" }));
  });

  it("returns false when the save dialog is cancelled and keeps the tab dirty", async () => {
    type("x");
    expect(await saveActiveDocument()).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
    expect(tabs.activeTab()?.dirty).toBe(true);
  });

  it("logs and returns false when the write fails, keeping the tab dirty", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = await openDocument("/a.md", "a");
    type("a2");
    mockWrite.mockRejectedValue(new Error("disk full"));
    expect(await saveActiveDocument()).toBe(false);
    expect(tabs.getTab(a.id)?.dirty).toBe(true);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("returns false when there is no tab at all", async () => {
    tabs.resetTabs();
    expect(await saveActiveDocument()).toBe(false);
  });
});

describe("closeDocument", () => {
  it("closes a clean active tab without asking and shows the neighbour", async () => {
    const a = await openDocument("/a.md", "a");
    const b = await openDocument("/b.md", "b");
    expect(await closeDocument()).toBe(true);
    expect(mockAsk).not.toHaveBeenCalled();
    expect(listTabs().map((t) => t.id)).not.toContain(b.id);
    expect(tabs.activeTab()?.id).toBe(a.id);
    expect(editorText).toBe("a");
  });

  it("asks before closing a dirty tab and keeps it when the user cancels", async () => {
    const a = await openDocument("/a.md", "a");
    type("edited");
    mockAsk.mockResolvedValue(false);
    expect(await closeDocument()).toBe(false);
    expect(mockAsk).toHaveBeenCalledWith(expect.stringContaining("a.md"), expect.objectContaining({ title: "Unsaved changes" }));
    expect(tabs.getTab(a.id)).toMatchObject({ content: "edited", dirty: true });
    expect(editorText).toBe("edited");
  });

  it("closes a dirty tab when the user confirms, discarding the edits", async () => {
    const a = await openDocument("/a.md", "a");
    type("edited");
    expect(await closeDocument(a.id)).toBe(true);
    expect(tabs.getTab(a.id)).toBeNull();
    expect(editorText).toBe(""); // back on the untitled tab
  });

  it("detects unsaved typing that the model has not seen yet", async () => {
    // Bypass onChange: the editor text changed but no change event arrived.
    const a = await openDocument("/a.md", "a");
    editorText = "silent edit";
    mockAsk.mockResolvedValue(false);
    expect(await closeDocument()).toBe(false);
    expect(mockAsk).toHaveBeenCalled();
    expect(tabs.getTab(a.id)?.dirty).toBe(true);
  });

  it("closes a background tab without touching the editor", async () => {
    const a = await openDocument("/a.md", "a");
    await openDocument("/b.md", "b");
    const calls = getEditor().setMarkdown.mock.calls.length;
    expect(await closeDocument(a.id)).toBe(true);
    expect(getEditor().setMarkdown.mock.calls.length).toBe(calls);
    expect(editorText).toBe("b");
  });

  it("closing the only tab leaves a fresh untitled tab in an empty editor", async () => {
    const untitled = tabs.activeTab()!;
    type("scratch");
    expect(await closeDocument()).toBe(true);
    expect(listTabs()).toHaveLength(1);
    expect(tabs.activeTab()?.id).not.toBe(untitled.id);
    expect(tabs.activeTab()).toMatchObject({ title: "Untitled", dirty: false });
    expect(editorText).toBe("");
  });

  it("returns false for an unknown id", async () => {
    expect(await closeDocument("tab-99")).toBe(false);
  });
});

describe("cycleTab", () => {
  it("moves right and left with wrap-around and loads the tab", async () => {
    const a = await openDocument("/a.md", "a");
    const b = await openDocument("/b.md", "b");
    // order: Untitled, a, b (b active)
    expect((await cycleTab(1))?.title).toBe("Untitled");
    expect(editorText).toBe("");
    expect((await cycleTab(-1))?.id).toBe(b.id);
    expect(editorText).toBe("b");
    expect((await cycleTab(-1))?.id).toBe(a.id);
  });

  it("returns null when there are no tabs", async () => {
    tabs.resetTabs();
    expect(await cycleTab(1)).toBeNull();
  });
});

describe("handleKeydown", () => {
  it("ignores keys without a modifier and unknown combinations", () => {
    expect(handleKeydown(pressKey({ key: "n" }))).toBe(false);
    expect(handleKeydown(pressKey({ key: "x", metaKey: true }))).toBe(false);
    expect(handleKeydown(pressKey({ key: "n", metaKey: true, shiftKey: true }))).toBe(false);
    expect(handleKeydown(pressKey({ key: "n", ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("Cmd/Ctrl+N opens a new tab", async () => {
    const e = pressKey({ key: "n", metaKey: true });
    expect(handleKeydown(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(listTabs()).toHaveLength(2);
    expect(handleKeydown(pressKey({ key: "N", ctrlKey: true }))).toBe(true);
    await Promise.resolve();
    expect(listTabs()).toHaveLength(3);
  });

  it("Cmd+O opens the file dialog and Cmd+S saves", async () => {
    expect(handleKeydown(pressKey({ key: "o", metaKey: true }))).toBe(true);
    await Promise.resolve();
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(handleKeydown(pressKey({ key: "s", ctrlKey: true }))).toBe(true);
    await Promise.resolve();
    expect(mockSave).toHaveBeenCalledTimes(1); // untitled → save dialog
  });

  it("Cmd+W closes the active tab", async () => {
    await openDocument("/a.md", "a");
    expect(handleKeydown(pressKey({ key: "w", metaKey: true }))).toBe(true);
    await vi.waitFor(() => expect(listTabs()).toHaveLength(1));
  });

  it("Ctrl+Tab / Ctrl+Shift+Tab and Cmd+Shift+] / [ cycle tabs", async () => {
    const a = await openDocument("/a.md", "a");
    const b = await openDocument("/b.md", "b");
    expect(handleKeydown(pressKey({ key: "Tab", ctrlKey: true }))).toBe(true);
    await vi.waitFor(() => expect(tabs.activeTab()?.title).toBe("Untitled"));
    expect(handleKeydown(pressKey({ key: "Tab", ctrlKey: true, shiftKey: true }))).toBe(true);
    await vi.waitFor(() => expect(tabs.activeTab()?.id).toBe(b.id));
    expect(handleKeydown(pressKey({ key: "{", code: "BracketLeft", metaKey: true, shiftKey: true }))).toBe(true);
    await vi.waitFor(() => expect(tabs.activeTab()?.id).toBe(a.id));
    expect(handleKeydown(pressKey({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true }))).toBe(true);
    await vi.waitFor(() => expect(tabs.activeTab()?.id).toBe(b.id));
    // Cmd+Shift+other bracket-ish keys are not shortcuts.
    expect(handleKeydown(pressKey({ key: "]", code: "BracketRight", metaKey: true }))).toBe(false);
  });
});

describe("the project chat tab", () => {
  it("openLogTab opens the log tab, empties the editor and says so in the status bar", async () => {
    await openPath("/x/y.md");
    const tab = await openLogTab();
    expect(tab).toMatchObject({ id: tabs.LOG_TAB_ID, kind: "log" });
    expect(getEditor().setMarkdown).toHaveBeenLastCalledWith("");
    expect(status()).toBe("Performance log");
    expect(await openLogTab()).toMatchObject({ id: tabs.LOG_TAB_ID });
  });

  it("openProjectChat is a no-op outside project mode", async () => {
    expect(await openProjectChat()).toBeNull();
    expect(listTabs().every((t) => t.kind === "document")).toBe(true);
  });

  it("opens the project tab with an empty, hidden editor, a project status line, and no saving", async () => {
    setDocumentsProjectMode(true, "/root");
    const a = await openDocument("/a.md", "# A");
    type("# A edited");
    const p = await openProjectChat();
    expect(p).toMatchObject({ kind: "project", title: "Project" });
    expect(tabs.activeTab()!.id).toBe(tabs.PROJECT_TAB_ID);
    // The outgoing document's edit was parked; the editor was emptied.
    expect(tabs.getTab(a.id)).toMatchObject({ content: "# A edited", dirty: true });
    expect(editorText).toBe("");
    expect(status()).toBe("[Project] /root — project chat");
    expect(document.title).toBe("quikleaf — Project");
    // Typing cannot reach the project tab, and it cannot be saved.
    type("stray");
    expect(tabs.getTab(tabs.PROJECT_TAB_ID)!.content).toBe("");
    expect(await saveActiveDocument()).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
    // Going back restores the parked text without parking the empty editor into the project tab.
    await showTab(a.id);
    expect(editorText).toBe("# A edited");
    expect(await openProjectChat()).toMatchObject({ id: tabs.PROJECT_TAB_ID });
    expect(listTabs().filter((t) => t.kind === "project")).toHaveLength(1);
    expect(await closeDocument()).toBe(true);
    expect(tabs.getTab(tabs.PROJECT_TAB_ID)).toBeNull();
  });
});
