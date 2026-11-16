/**
 * Images: relative `img` sources are resolved for the preview against the
 * active document through quikdown's `resolveImageSrc`; an image pasted into
 * the source pane is saved beside the document and linked at the caret.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import { getEditor, initEditor } from "./editor";
import * as tabs from "./tabs";
import { initDocuments, setDocumentsProjectMode } from "./documents";
import { appendEl } from "../ui/taco";
import {
  disposePreviewImages,
  handlePaste,
  imageFileOf,
  imageMarkdown,
  imageUrl,
  initImagePaste,
  initPreviewImages,
  insertImageFile,
  resolveImageSrc,
  saveImageBytes,
} from "./images";

const mockInvoke = vi.mocked(invoke);

function app(): HTMLElement {
  return document.getElementById("app")!;
}

const info = { alt: "", title: "" };

beforeEach(async () => {
  tabs.resetTabs();
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async () => null);
  bw.append(app(), { t: "span", a: { id: "status-file" } });
  const container = appendEl(app(), { t: "div", a: { id: "editor-container" } });
  initEditor(container);
  setDocumentsProjectMode(false);
  await initDocuments();
});

afterEach(() => {
  disposePreviewImages();
  bw.clear(app());
});

describe("resolveImageSrc", () => {
  it("points relative sources at the asset scheme beside the document", () => {
    expect(resolveImageSrc("images/a.png", "/docs/notes/x.md")).toBe(imageUrl("/docs/notes/images/a.png"));
    expect(resolveImageSrc("./b.png", "/docs/notes/x.md")).toBe(imageUrl("/docs/notes/b.png"));
    expect(resolveImageSrc("../c.png", "/docs/notes/x.md")).toBe(imageUrl("/docs/c.png"));
    expect(imageUrl("/docs/c.png")).toBe("asset://localhost/%2Fdocs%2Fc.png");
  });

  it("converts absolute file paths and leaves URLs and data URIs as written", () => {
    expect(resolveImageSrc("/abs/a.png", "/docs/x.md")).toBe(imageUrl("/abs/a.png"));
    expect(resolveImageSrc("https://x/y.png", "/docs/x.md")).toBeUndefined();
    expect(resolveImageSrc("data:image/png;base64,AAAA", "/docs/x.md")).toBeUndefined();
  });

  it("leaves relative images of an unsaved document alone (nothing to resolve against)", () => {
    expect(resolveImageSrc("images/a.png", null)).toBeUndefined();
    expect(resolveImageSrc("/abs/a.png", null)).toBe(imageUrl("/abs/a.png"));
  });
});

describe("initPreviewImages", () => {
  it("gives quikdown a resolver that follows the active document, and renders again when the document gains a folder", () => {
    const inst = getEditor();
    const resolve = inst.options.resolveImageSrc as (src: string, i: typeof info) => string | void;
    const tab = tabs.openTab("/docs/x.md", "", {});
    tabs.setActive(tab.id);
    initPreviewImages();
    expect(resolve("a.png", info)).toBe(imageUrl("/docs/a.png"));
    expect(resolve("https://x/y.png", info)).toBeUndefined();

    // Another tab: the switch itself re-renders (documents.ts), so no extra render here.
    const before = inst.setMarkdown.mock.calls.length;
    const other = tabs.openTab("/elsewhere/y.md", "", {});
    tabs.setActive(other.id);
    expect(resolve("a.png", info)).toBe(imageUrl("/elsewhere/a.png"));
    expect(inst.setMarkdown.mock.calls.length).toBe(before);

    // Save As of an untitled document: same tab, new folder → render again (not an edit).
    const untitled = tabs.newUntitledTab();
    tabs.setActive(untitled.id);
    expect(resolve("a.png", info)).toBeUndefined();
    const calls = inst.setMarkdown.mock.calls.length;
    tabs.markSaved(untitled.id, "/saved/z.md");
    expect(inst.setMarkdown.mock.calls.length).toBe(calls + 1);
    expect(inst.setMarkdown).toHaveBeenLastCalledWith(expect.any(String), { history: "keep", source: "api" });
    expect(resolve("a.png", info)).toBe(imageUrl("/saved/a.png"));

    disposePreviewImages();
    expect(resolve("a.png", info)).toBeUndefined();
    tabs.markSaved(untitled.id, "/moved/z.md");
    expect(inst.setMarkdown.mock.calls.length).toBe(calls + 1);
  });

  it("is harmless without a tab", () => {
    tabs.resetTabs();
    expect(() => initPreviewImages()).not.toThrow();
    expect(getEditor().options.resolveImageSrc("a.png", info)).toBeUndefined();
  });
});

describe("imageMarkdown", () => {
  it("links relative to the document, encodes spaces and parentheses, and names the image after the file", () => {
    expect(imageMarkdown("/docs/images/a b.png", "/docs/x.md")).toBe("![a b](images/a%20b.png)");
    expect(imageMarkdown("/pics/shot (1).png", "/docs/notes/x.md", "shot")).toBe("![shot](../../pics/shot%20%281%29.png)");
  });

  it("falls back to the absolute path for an unsaved document", () => {
    expect(imageMarkdown("/pics/a.png", null)).toBe("![a](/pics/a.png)");
  });
});

describe("saveImageBytes", () => {
  it("refuses with a note when the active document has no location", async () => {
    expect(tabs.activeTab()!.path).toBeNull();
    expect(await saveImageBytes(new Uint8Array([1, 2, 3]), "image/png")).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalledWith("image_save", expect.anything());
    expect(app().textContent).toContain("Save the document first");
  });

  it("sends the bytes as base64 with the document's absolute path and the extension for the type", async () => {
    const tab = tabs.openTab("/docs/x.md", "", {});
    tabs.setActive(tab.id);
    mockInvoke.mockImplementation(async (cmd) => (cmd === "image_save" ? { relative: "images/x-1.png", absolute: "/docs/images/x-1.png" } : null));
    const saved = await saveImageBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png");
    expect(saved).toEqual({ relative: "images/x-1.png", absolute: "/docs/images/x-1.png" });
    expect(mockInvoke).toHaveBeenCalledWith("image_save", { docPath: "/docs/x.md", ext: "png", data: btoa("\x89PNG") });
  });

  it("joins a project-relative document to the project root, maps jpeg, and reports a failed save", async () => {
    setDocumentsProjectMode(true, "/proj");
    const tab = tabs.openTab("notes/x.md", "", { projectRelative: true });
    tabs.setActive(tab.id);
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "image_save") throw new Error("disk full");
      return null;
    });
    expect(await saveImageBytes(new Uint8Array([1]), "image/jpeg")).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith("image_save", expect.objectContaining({ docPath: "/proj/notes/x.md", ext: "jpg" }));
    expect(app().textContent).toContain("disk full");
  });
});

describe("imageFileOf", () => {
  it("finds the first image among files, then items, else null", () => {
    const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const txt = new File(["x"], "a.txt", { type: "text/plain" });
    expect(imageFileOf({ files: [txt, png], items: [] } as any)).toBe(png);
    expect(imageFileOf({ files: [], items: [{ kind: "file", type: "image/gif", getAsFile: () => png }] } as any)).toBe(png);
    expect(imageFileOf({ files: [txt], items: [{ kind: "string", type: "text/plain" }] } as any)).toBeNull();
    expect(imageFileOf(null)).toBeNull();
  });
});

describe("handlePaste", () => {
  function pasteEvent(target: EventTarget, data: any) {
    const e = { target, clipboardData: data, preventDefault: vi.fn() } as unknown as ClipboardEvent;
    return e;
  }

  it("ignores pastes outside the source pane and pastes without an image", async () => {
    const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const elsewhere = document.createElement("textarea");
    expect(await handlePaste(pasteEvent(elsewhere, { files: [png], items: [] }))).toBe(false);
    const ta = getEditor().sourceTextarea as HTMLTextAreaElement;
    expect(await handlePaste(pasteEvent(ta, { files: [], items: [] }))).toBe(false);
    expect(await handlePaste(pasteEvent(ta, null))).toBe(false);
  });

  it("saves an image pasted into the source pane and inserts the link at the caret", async () => {
    const tab = tabs.openTab("/docs/x.md", "", {});
    tabs.setActive(tab.id);
    mockInvoke.mockImplementation(async (cmd) => (cmd === "image_save" ? { relative: "images/x-1.png", absolute: "/docs/images/x-1.png" } : null));
    const ta = getEditor().sourceTextarea as HTMLTextAreaElement;
    ta.value = "before\n";
    ta.selectionStart = ta.selectionEnd = ta.value.length;
    const png = new File([new Uint8Array([0x89, 0x50])], "a.png", { type: "image/png" });
    const e = pasteEvent(ta, { files: [png], items: [] });
    expect(await handlePaste(e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(ta.value).toBe("before\n![x-1](images/x-1.png)");
  });

  it("still claims the paste (and inserts nothing) when the document is unsaved", async () => {
    const ta = getEditor().sourceTextarea as HTMLTextAreaElement;
    ta.value = "";
    const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const e = pasteEvent(ta, { files: [png], items: [] });
    expect(await handlePaste(e)).toBe(true);
    expect(ta.value).toBe("");
  });

  it("initImagePaste listens on the document and the returned function stops it", () => {
    const doc = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Document;
    const off = initImagePaste(doc);
    expect(doc.addEventListener).toHaveBeenCalledWith("paste", expect.any(Function));
    off();
    expect(doc.removeEventListener).toHaveBeenCalledWith("paste", expect.any(Function));
    // The real document path: a paste event with no clipboard data is simply ignored.
    const stop = initImagePaste();
    expect(() => document.dispatchEvent(new Event("paste"))).not.toThrow();
    stop();
  });
});

describe("insertImageFile", () => {
  it("links a dropped image relative to the active document", () => {
    const tab = tabs.openTab("/docs/x.md", "", {});
    tabs.setActive(tab.id);
    const ta = getEditor().sourceTextarea as HTMLTextAreaElement;
    ta.value = "";
    expect(insertImageFile("/docs/pics/shot.png")).toBe(true);
    expect(ta.value).toBe("![shot](pics/shot.png)");
  });
});
