/**
 * Files dropped on the window: an outline while dragging, documents open as
 * tabs (after the fs scope is widened), images are linked, the rest is noted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { getEditor, initEditor } from "./editor";
import * as tabs from "./tabs";
import { initDocuments, listTabs, setDocumentsProjectMode } from "./documents";
import { DRAG_CLASS, handleDragEvent, handleDroppedPaths, initDropZone } from "./dropzone";
import { appendEl } from "../ui/taco";

const mockInvoke = vi.mocked(invoke);
const mockRead = vi.mocked(readTextFile);
const mockWebview = vi.mocked(getCurrentWebview);

function app(): HTMLElement {
  return document.getElementById("app")!;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  tabs.resetTabs();
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async () => null);
  mockRead.mockReset();
  mockRead.mockResolvedValue("# dropped");
  bw.append(app(), { t: "span", a: { id: "status-file" } });
  initEditor(appendEl(app(), { t: "div", a: { id: "editor-container" } }));
  setDocumentsProjectMode(false);
  await initDocuments();
});

afterEach(() => {
  bw.clear(app());
  app().classList.remove(DRAG_CLASS);
});

describe("handleDragEvent", () => {
  it("outlines the window while a drag hovers and clears it on leave or drop", async () => {
    handleDragEvent({ type: "enter", paths: ["/x/a.md"] });
    expect(app().classList.contains(DRAG_CLASS)).toBe(true);
    handleDragEvent({ type: "over" });
    expect(app().classList.contains(DRAG_CLASS)).toBe(true);
    handleDragEvent({ type: "leave" });
    expect(app().classList.contains(DRAG_CLASS)).toBe(false);
    handleDragEvent({ type: "enter", paths: ["/x/a.md"] });
    handleDragEvent({ type: "drop", paths: ["/x/a.md"] });
    expect(app().classList.contains(DRAG_CLASS)).toBe(false);
    await flush();
    expect(listTabs().map((t) => t.path)).toContain("/x/a.md");
  });

  it("ignores unknown payloads", () => {
    expect(() => handleDragEvent({ type: "bogus" } as any)).not.toThrow();
  });
});

describe("handleDroppedPaths", () => {
  it("opens markdown and text files as tabs after widening the fs scope to them", async () => {
    expect(await handleDroppedPaths(["/x/a.md", "/x/b.txt"])).toBe(2);
    expect(mockInvoke).toHaveBeenCalledWith("allow_path", { path: "/x/a.md" });
    expect(mockInvoke).toHaveBeenCalledWith("allow_path", { path: "/x/b.txt" });
    expect(mockRead).toHaveBeenCalledWith("/x/a.md");
    expect(listTabs().map((t) => t.path)).toEqual([null, "/x/a.md", "/x/b.txt"]);
    expect(tabs.activeTab()!.path).toBe("/x/b.txt");
  });

  it("links an image into the active document instead of opening it", async () => {
    const tab = tabs.openTab("/docs/x.md", "", {});
    tabs.setActive(tab.id);
    const ta = getEditor().sourceTextarea as HTMLTextAreaElement;
    ta.value = "";
    expect(await handleDroppedPaths(["/docs/img/p.png"])).toBe(1);
    expect(ta.value).toBe("![p](img/p.png)");
    expect(listTabs()).toHaveLength(2);
  });

  it("notes files it cannot use: unknown types, images with no document active, unreadable files", async () => {
    mockRead.mockRejectedValueOnce(new Error("forbidden path"));
    tabs.setActive(tabs.openProjectTab().id);
    expect(await handleDroppedPaths(["/x/report.pdf", "/x/p.png", "/x/gone.md"])).toBe(0);
    const toast = app().textContent ?? "";
    expect(toast).toContain("Not opened");
    expect(toast).toContain("report.pdf, p.png, gone.md");
  });

  it("says nothing when every file was used", async () => {
    await handleDroppedPaths(["/x/a.md"]);
    expect(app().textContent ?? "").not.toContain("Not opened");
  });
});

describe("initDropZone", () => {
  it("subscribes to the webview's drag-drop events and returns the unlisten function", async () => {
    const unlisten = vi.fn();
    const onDragDropEvent = vi.fn(async (handler: any) => {
      handler({ payload: { type: "enter", paths: [] } });
      return unlisten;
    });
    mockWebview.mockReturnValueOnce({ onDragDropEvent } as any);
    const off = await initDropZone();
    expect(onDragDropEvent).toHaveBeenCalledTimes(1);
    expect(app().classList.contains(DRAG_CLASS)).toBe(true);
    expect(off).toBe(unlisten);
  });

  it("degrades to a no-op where the webview API is missing (the browser, tests)", async () => {
    mockWebview.mockImplementationOnce(() => {
      throw new Error("not in tauri");
    });
    const off = await initDropZone();
    expect(() => off()).not.toThrow();
  });
});
