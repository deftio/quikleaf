/**
 * Images: relative `img` sources in the preview are pointed at the asset
 * scheme, resolved against the active document; an image pasted into the
 * source pane is saved beside the document and linked at the caret.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import { getEditor, initEditor, notifyEditorChange } from "./editor";
import * as tabs from "./tabs";
import { initDocuments, setDocumentsProjectMode } from "./documents";
import {
  SRC_ATTR,
  disposePreviewImages,
  handlePaste,
  imageFileOf,
  imageMarkdown,
  imageUrl,
  initImagePaste,
  initPreviewImages,
  insertImageFile,
  rewriteImages,
  saveImageBytes,
} from "./images";

const mockInvoke = vi.mocked(invoke);

function app(): HTMLElement {
  return document.getElementById("app")!;
}

function pane(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html; // test fixture only: the preview's own markup is quikdown's, not ours
  return div;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  tabs.resetTabs();
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async () => null);
  bw.append(app(), { t: "span", a: { id: "status-file" } });
  const container = bw.append(app(), { t: "div", a: { id: "editor-container" } });
  initEditor(container);
  setDocumentsProjectMode(false);
  await initDocuments();
});

afterEach(() => {
  disposePreviewImages();
  bw.clear(app());
});

describe("rewriteImages", () => {
  it("points relative sources at the asset scheme beside the document and keeps the original", () => {
    const p = pane('<img src="images/a.png"><img src="./b.png"><img src="../c.png">');
    expect(rewriteImages(p, "/docs/notes/x.md")).toBe(3);
    const imgs = Array.from(p.querySelectorAll("img"));
    expect(imgs[0].getAttribute("src")).toBe(imageUrl("/docs/notes/images/a.png"));
    expect(imgs[0].getAttribute(SRC_ATTR)).toBe("images/a.png");
    expect(imgs[1].getAttribute("src")).toBe(imageUrl("/docs/notes/b.png"));
    expect(imgs[2].getAttribute("src")).toBe(imageUrl("/docs/c.png"));
    expect(imageUrl("/docs/c.png")).toBe("asset://localhost/%2Fdocs%2Fc.png");
  });

  it("converts absolute file paths, leaves URLs and data URIs alone, and is idempotent", () => {
    const p = pane('<img src="/abs/a.png"><img src="https://x/y.png"><img src="data:image/png;base64,AAAA">');
    expect(rewriteImages(p, "/docs/x.md")).toBe(1);
    const imgs = Array.from(p.querySelectorAll("img"));
    expect(imgs[0].getAttribute("src")).toBe(imageUrl("/abs/a.png"));
    expect(imgs[1].getAttribute("src")).toBe("https://x/y.png");
    expect(imgs[2].getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(rewriteImages(p, "/docs/x.md")).toBe(0);
  });

  it("leaves relative images of an unsaved document alone (nothing to resolve against)", () => {
    const p = pane('<img src="images/a.png">');
    expect(rewriteImages(p, null)).toBe(0);
    expect(p.querySelector("img")!.getAttribute("src")).toBe("images/a.png");
  });

  it("re-resolves when the document changes (a tab switch) because the original is kept", () => {
    const p = pane('<img src="a.png">');
    rewriteImages(p, "/one/x.md");
    expect(rewriteImages(p, "/two/y.md")).toBe(1);
    expect(p.querySelector("img")!.getAttribute("src")).toBe(imageUrl("/two/a.png"));
  });
});

describe("initPreviewImages", () => {
  it("rewrites after the preview re-renders, on editor changes and on tab switches", async () => {
    const preview = document.createElement("div");
    getEditor().previewPanel = preview;
    const tab = tabs.openTab("/docs/x.md", "", {});
    tabs.setActive(tab.id);
    initPreviewImages();

    preview.appendChild(pane('<img src="a.png">').firstElementChild!);
    await flush(); // MutationObserver delivers asynchronously
    expect(preview.querySelector("img")!.getAttribute("src")).toBe(imageUrl("/docs/a.png"));

    // A new render (quikdown replaces the children) is caught too.
    preview.innerHTML = '<img src="b.png">';
    await flush();
    expect(preview.querySelector("img")!.getAttribute("src")).toBe(imageUrl("/docs/b.png"));

    // Switching to a document elsewhere re-resolves the same markup.
    const other = tabs.openTab("/elsewhere/y.md", "", {});
    tabs.setActive(other.id);
    expect(preview.querySelector("img")!.getAttribute("src")).toBe(imageUrl("/elsewhere/b.png"));

    // The editor's own change callback refreshes synchronously.
    preview.querySelector("img")!.setAttribute("src", "c.png");
    preview.querySelector("img")!.removeAttribute(SRC_ATTR);
    notifyEditorChange("", "");
    expect(preview.querySelector("img")!.getAttribute("src")).toBe(imageUrl("/elsewhere/c.png"));

    disposePreviewImages();
    preview.innerHTML = '<img src="d.png">';
    await flush();
    expect(preview.querySelector("img")!.getAttribute("src")).toBe("d.png");
  });

  it("is harmless before the editor has a preview pane", () => {
    getEditor().previewPanel = undefined;
    expect(() => initPreviewImages()).not.toThrow();
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
