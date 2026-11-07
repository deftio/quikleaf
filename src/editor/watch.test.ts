/**
 * Watch: the toggle asks Rust to watch the tab's file, `file-changed` reloads
 * the tab (debounced), unsaved edits are asked about, removed files are
 * reported once, closed tabs stop watching, and `--watch` wiring works
 * through `setWatched`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { getEditor, initEditor, notifyEditorChange } from "./editor";
import * as tabs from "./tabs";
import { closeDocument, initDocuments, openPath, setDocumentsProjectMode } from "./documents";
import { makeEditorToolbar } from "../ui/editor-toolbar";
import { appendEl } from "../ui/taco";
import {
  FILE_CHANGED,
  RELOAD_DEBOUNCE_MS,
  handleFileChanged,
  initWatch,
  isWatched,
  reloadWatched,
  resetWatch,
  setWatched,
  toggleWatch,
  watchedPaths,
} from "./watch";

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);
const mockAsk = vi.mocked(ask);
const mockRead = vi.mocked(readTextFile);

let editorText = "";
let handlers: Record<string, (e: { payload: any }) => void> = {};

function app(): HTMLElement {
  return document.getElementById("app")!;
}

function watchButton(): HTMLButtonElement {
  return document.getElementById("tool-watch") as HTMLButtonElement;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  tabs.resetTabs();
  resetWatch();
  handlers = {};
  editorText = "";
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async () => null);
  mockListen.mockReset();
  mockListen.mockImplementation(async (name: string, handler: any) => {
    handlers[name] = handler;
    return () => delete handlers[name];
  });
  mockAsk.mockReset();
  mockAsk.mockResolvedValue(true);
  mockRead.mockReset();
  mockRead.mockResolvedValue("");
  bw.append(app(), { t: "span", a: { id: "status-file" } });
  bw.append(app(), makeEditorToolbar({ onMode() {}, onUndo() {}, onRedo() {}, onCopy() {}, onToggleWatch: () => void toggleWatch() }));
  initEditor(appendEl(app(), { t: "div", a: { id: "editor-container" } }));
  const inst = getEditor();
  inst.getMarkdown.mockImplementation(() => editorText);
  inst.setMarkdown.mockImplementation(async (md: string) => {
    editorText = md;
    notifyEditorChange(md, "");
  });
  setDocumentsProjectMode(false);
  await initDocuments();
  await initWatch();
});

afterEach(() => {
  resetWatch();
  bw.clear(app());
});

async function openFile(path: string, content: string) {
  mockRead.mockResolvedValueOnce(content);
  return (await openPath(path))!;
}

describe("the toggle", () => {
  it("is disabled on an untitled tab, enabled with a file, pressed once watching", async () => {
    expect(watchButton().disabled).toBe(true);
    expect(await setWatched(tabs.activeTab()!.id, true)).toBe(false);
    const tab = await openFile("/docs/a.md", "# a");
    expect(watchButton().disabled).toBe(false);
    expect(watchButton().getAttribute("aria-pressed")).toBe("false");
    expect(await toggleWatch()).toBe(true);
    expect(isWatched(tab.id)).toBe(true);
    expect(watchedPaths()).toEqual(["/docs/a.md"]);
    expect(mockInvoke).toHaveBeenCalledWith("watch_start", { path: "/docs/a.md" });
    expect(watchButton().getAttribute("aria-pressed")).toBe("true");
    expect(watchButton().title).toContain("Watching");
    expect(await setWatched(tab.id, true)).toBe(true); // idempotent, no second start
    expect(mockInvoke.mock.calls.filter((c) => c[0] === "watch_start")).toHaveLength(1);
    expect(await toggleWatch()).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("watch_stop", { path: "/docs/a.md" });
    expect(watchButton().getAttribute("aria-pressed")).toBe("false");
  });

  it("follows the active tab and stops when a watched tab closes", async () => {
    const a = await openFile("/docs/a.md", "# a");
    await setWatched(a.id, true);
    const b = await openFile("/docs/b.md", "# b");
    expect(watchButton().getAttribute("aria-pressed")).toBe("false");
    tabs.setActive(a.id);
    expect(watchButton().getAttribute("aria-pressed")).toBe("true");
    await closeDocument(a.id);
    await flush();
    expect(isWatched(a.id)).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("watch_stop", { path: "/docs/a.md" });
    expect(tabs.activeTab()!.id).toBe(b.id);
  });

  it("reports a failed watch_start and leaves the toggle off; watching a project file uses the root-joined path", async () => {
    const a = await openFile("/docs/a.md", "# a");
    mockInvoke.mockImplementationOnce(async () => {
      throw new Error("no such folder");
    });
    expect(await setWatched(a.id, true)).toBe(false);
    expect(app().textContent).toContain("no such folder");
    expect(await setWatched(a.id, false)).toBe(false);

    setDocumentsProjectMode(true, "/proj");
    mockInvoke.mockImplementation(async (cmd) => (cmd === "file_read" ? "# p" : null));
    const p = (await openPath("notes/p.md", true))!;
    expect(await setWatched(p.id, true)).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("watch_start", { path: "/proj/notes/p.md" });
  });
});

describe("file-changed", () => {
  it("reloads a clean watched tab, marks it saved, and flashes the button", async () => {
    vi.useFakeTimers();
    try {
      const a = await openFile("/docs/a.md", "# v1");
      await setWatched(a.id, true);
      mockRead.mockResolvedValueOnce("# v2");
      handlers[FILE_CHANGED]({ payload: { path: "/docs/a.md", kind: "changed" } });
      handlers[FILE_CHANGED]({ payload: { path: "/docs/a.md", kind: "changed" } }); // a burst: one reload
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 5);
      expect(mockRead).toHaveBeenCalledTimes(2); // open + one reload
      expect(tabs.getTab(a.id)).toMatchObject({ content: "# v2", dirty: false });
      expect(editorText).toBe("# v2");
      expect(watchButton().textContent).toBe("Reloaded");
      await vi.advanceTimersByTimeAsync(1300);
      expect(watchButton().textContent).toBe("Watch");
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips when the text is unchanged, and reloads a background tab without touching the editor", async () => {
    const a = await openFile("/docs/a.md", "# a");
    await setWatched(a.id, true);
    mockRead.mockResolvedValueOnce("# a");
    expect(await reloadWatched("/docs/a.md", "changed")).toBe(0);

    await openFile("/docs/b.md", "# b");
    const sets = getEditor().setMarkdown.mock.calls.length;
    mockRead.mockResolvedValueOnce("# a2");
    expect(await reloadWatched("/docs/a.md", "changed")).toBe(1);
    expect(tabs.getTab(a.id)!.content).toBe("# a2");
    expect(getEditor().setMarkdown.mock.calls.length).toBe(sets);
    expect(editorText).toBe("# b");
  });

  it("asks before replacing unsaved edits and keeps them on Cancel", async () => {
    const a = await openFile("/docs/a.md", "# a");
    await setWatched(a.id, true);
    editorText = "# a edited";
    notifyEditorChange(editorText, "");
    expect(tabs.getTab(a.id)!.dirty).toBe(true);

    mockAsk.mockResolvedValueOnce(false);
    mockRead.mockResolvedValueOnce("# disk");
    expect(await reloadWatched("/docs/a.md", "changed")).toBe(0);
    expect(mockAsk).toHaveBeenCalledWith(expect.stringContaining("unsaved edits"), expect.objectContaining({ okLabel: "Reload" }));
    expect(tabs.getTab(a.id)).toMatchObject({ content: "# a edited", dirty: true });

    mockAsk.mockResolvedValueOnce(true);
    mockRead.mockResolvedValueOnce("# disk");
    expect(await reloadWatched("/docs/a.md", "changed")).toBe(1);
    expect(tabs.getTab(a.id)).toMatchObject({ content: "# disk", dirty: false });
  });

  it("reports a removed file once and keeps the text; a failed read is logged and retried next time", async () => {
    const a = await openFile("/docs/a.md", "# a");
    await setWatched(a.id, true);
    expect(await reloadWatched("/docs/a.md", "removed")).toBe(0);
    expect(await reloadWatched("/docs/a.md", "removed")).toBe(0);
    expect(app().querySelectorAll(".bw_bccl_toast")).toHaveLength(1);
    expect(tabs.getTab(a.id)!.content).toBe("# a");

    mockRead.mockRejectedValueOnce(new Error("busy"));
    expect(await reloadWatched("/docs/a.md", "changed")).toBe(0);
    const logged = mockInvoke.mock.calls.find((c) => c[0] === "log_append" && (c[1] as any)?.entry?.event === "watch-read-failed");
    expect(logged).toBeTruthy();
    mockRead.mockResolvedValueOnce("# back");
    expect(await reloadWatched("/docs/a.md", "changed")).toBe(1);
  });

  it("ignores paths nobody watches and drops watches whose tab is gone", async () => {
    expect(await reloadWatched("/nobody/x.md", "changed")).toBe(0);
    const a = await openFile("/docs/a.md", "# a");
    await setWatched(a.id, true);
    tabs.resetTabs(); // the tab vanished without closeDocument
    expect(await reloadWatched("/docs/a.md", "changed")).toBe(0);
    expect(isWatched(a.id)).toBe(false);
  });

  it("initWatch survives a missing event API and handleFileChanged coalesces per path", async () => {
    mockListen.mockImplementationOnce(async () => {
      throw new Error("no events here");
    });
    await expect(initWatch()).resolves.toBeTypeOf("function");
    vi.useFakeTimers();
    try {
      handleFileChanged({ path: "/x.md", kind: "changed" });
      handleFileChanged({ path: "/y.md", kind: "changed" });
      handleFileChanged({ path: "/x.md", kind: "changed" });
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS + 5);
    } finally {
      vi.useRealTimers();
    }
    expect(mockRead).not.toHaveBeenCalled(); // nothing watched, nothing read
  });
});
