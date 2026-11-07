/**
 * Project sidebar: panel rendering, visibility, tree loading (sorting,
 * filtering, empty/error states) and item selection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import { hideFileTree, highlightFile, isFileTreeVisible, loadTree, makeFileTreePanel, setOnFileClick, showFileTree } from "./file-tree";
import { appendEl } from "../ui/taco";

const mockInvoke = vi.mocked(invoke);

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`test: #${id} missing`);
  return node as T;
}

function items(): HTMLElement[] {
  return Array.from(byId("file-tree-list").querySelectorAll(".file-tree-item")) as HTMLElement[];
}

function labels(): string[] {
  return items().map((i) => i.textContent ?? "");
}

/** The glyph kind of each row, from its `.tree-icon` class. */
function icons(): string[] {
  return items().map((i) => (i.querySelector(".tree-icon")?.className ?? "").replace("tree-icon", "").trim());
}

type Entry = { name: string; type: "file" | "dir"; size: number };

function listing(entries: Entry[]): void {
  mockInvoke.mockImplementation(async (cmd) => (cmd === "file_list" ? { entries } : null));
}

function mount(): HTMLElement {
  return appendEl(byId("app"), makeFileTreePanel());
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async () => null);
  setOnFileClick(() => {});
});

afterEach(() => {
  // bw.clear deregisters ids from bitwrench's lookup cache; innerHTML = "" would not.
  bw.clear(byId("app"));
});

describe("makeFileTreePanel", () => {
  it("renders a hidden sidebar with a header and an empty list", () => {
    const node = mount();
    expect(node.id).toBe("file-tree");
    expect(node.classList.contains("hidden")).toBe(true);
    expect(byId("file-tree-header").textContent).toBe("Files");
    expect(byId("file-tree-list").children).toHaveLength(0);
  });
});

describe("show / hide / isFileTreeVisible", () => {
  it("toggles the hidden class and reports visibility", () => {
    mount();
    expect(isFileTreeVisible()).toBe(false);
    showFileTree();
    expect(byId("file-tree").classList.contains("hidden")).toBe(false);
    expect(isFileTreeVisible()).toBe(true);
    hideFileTree();
    expect(byId("file-tree").classList.contains("hidden")).toBe(true);
    expect(isFileTreeVisible()).toBe(false);
  });

  it("do not throw when the panel is not mounted", () => {
    expect(() => showFileTree()).not.toThrow();
    expect(() => hideFileTree()).not.toThrow();
    expect(isFileTreeVisible()).toBe(true); // no element → no hidden class
  });
});

describe("loadTree", () => {
  it("returns early without calling the backend when the list is not mounted", async () => {
    await loadTree();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("asks the backend for a recursive listing of the project root by default", async () => {
    mount();
    listing([]);
    await loadTree();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("file_list", { path: null, recursive: true });
  });

  it("passes a sub-path through and treats an empty string as the root", async () => {
    mount();
    listing([]);
    await loadTree("docs/notes");
    expect(mockInvoke).toHaveBeenLastCalledWith("file_list", { path: "docs/notes", recursive: true });
    await loadTree("");
    expect(mockInvoke).toHaveBeenLastCalledWith("file_list", { path: null, recursive: true });
  });

  it("shows a loading note while the request is in flight", async () => {
    mount();
    let resolve!: (v: unknown) => void;
    mockInvoke.mockImplementation(() => new Promise((r) => (resolve = r)));
    const pending = loadTree();
    const note = byId("file-tree-list").querySelector(".file-tree-note");
    expect(note?.textContent).toBe("Loading...");
    expect(note?.classList.contains("error")).toBe(false);
    resolve({ entries: [] });
    await pending;
    expect(byId("file-tree-list").querySelector(".file-tree-note")?.textContent).toBe("Empty project");
  });

  it("lists directories first, then files, each group alphabetical", async () => {
    mount();
    listing([
      { name: "zeta.md", type: "file", size: 1 },
      { name: "src", type: "dir", size: 0 },
      { name: "Alpha.ts", type: "file", size: 1 },
      { name: "assets", type: "dir", size: 0 },
      { name: "beta.json", type: "file", size: 1 },
    ]);
    await loadTree();
    expect(labels()).toEqual(["assets", "src", "Alpha.ts", "beta.json", "zeta.md"]);
    expect(icons()).toEqual(["dir", "dir", "code", "code", "markdown"]);
    // The glyph is decorative: hidden from assistive tech, the name is the row's text.
    expect(items()[0].querySelector(".tree-icon")?.getAttribute("aria-hidden")).toBe("true");
    const all = items();
    expect(all[0].classList.contains("dir")).toBe(true);
    expect(all[2].classList.contains("dir")).toBe(false);
    expect(all[4].getAttribute("title")).toBe("zeta.md");
  });

  it("hides dotfiles, dot-directories and the quikleaf.prj store", async () => {
    mount();
    listing([
      { name: ".git", type: "dir", size: 0 },
      { name: ".DS_Store", type: "file", size: 1 },
      { name: "quikleaf.prj", type: "file", size: 1 },
      { name: "README.md", type: "file", size: 1 },
      { name: "not.quikleaf.prj", type: "file", size: 1 },
    ]);
    await loadTree();
    // localeCompare orders case-insensitively: "not…" sorts before "README…".
    expect(labels()).toEqual(["not.quikleaf.prj", "README.md"]);
    expect(icons()).toEqual(["file", "markdown"]);
  });

  it("shows an empty-project note when nothing is left after filtering", async () => {
    mount();
    listing([
      { name: ".hidden", type: "file", size: 1 },
      { name: "quikleaf.prj", type: "file", size: 1 },
    ]);
    await loadTree();
    const note = byId("file-tree-list").querySelector(".file-tree-note");
    expect(note?.textContent).toBe("Empty project");
    expect(note?.classList.contains("error")).toBe(false);
    expect(items()).toHaveLength(0);
  });

  it("shows an error note when the backend rejects", async () => {
    mount();
    mockInvoke.mockImplementation(async () => {
      throw "permission denied";
    });
    await loadTree();
    const note = byId("file-tree-list").querySelector(".file-tree-note");
    expect(note?.textContent).toBe("Failed to load: permission denied");
    expect(note?.classList.contains("error")).toBe(true);
  });

  it("shows an error note when the response has no entries", async () => {
    mount();
    mockInvoke.mockImplementation(async () => null);
    await loadTree();
    const note = byId("file-tree-list").querySelector(".file-tree-note.error");
    expect(note?.textContent).toMatch(/^Failed to load: /);
  });

  it("replaces a previous listing on reload", async () => {
    mount();
    listing([{ name: "a.md", type: "file", size: 1 }]);
    await loadTree();
    expect(labels()).toEqual(["a.md"]);
    listing([{ name: "b.md", type: "file", size: 1 }]);
    await loadTree();
    expect(labels()).toEqual(["b.md"]);
  });
});

describe("item selection", () => {
  beforeEach(async () => {
    mount();
    listing([
      { name: "docs", type: "dir", size: 0 },
      { name: "a.md", type: "file", size: 1 },
      { name: "b.md", type: "file", size: 1 },
    ]);
  });

  it("marks the clicked file active and reports its name to the handler", async () => {
    const handler = vi.fn();
    setOnFileClick(handler);
    await loadTree();
    const [, a, b] = items();

    a.click();
    expect(a.classList.contains("active")).toBe(true);
    expect(b.classList.contains("active")).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenLastCalledWith("a.md");

    b.click();
    expect(a.classList.contains("active")).toBe(false);
    expect(b.classList.contains("active")).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith("b.md");
    expect(byId("file-tree-list").querySelectorAll(".active")).toHaveLength(1);
  });

  it("ignores clicks on directories", async () => {
    const handler = vi.fn();
    setOnFileClick(handler);
    await loadTree();
    const [dir, a] = items();
    a.click();
    dir.click();
    expect(dir.classList.contains("active")).toBe(false);
    expect(a.classList.contains("active")).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((dir as any).onclick).toBeNull();
  });

  it("still highlights the selection when no click handler was ever registered", async () => {
    // A fresh module instance has onFileClick === null.
    vi.resetModules();
    const fresh = await import("./file-tree");
    bw.clear(byId("app"));
    bw.append(byId("app"), fresh.makeFileTreePanel());
    await fresh.loadTree();
    const [, a] = items();
    expect(() => a.click()).not.toThrow();
    expect(a.classList.contains("active")).toBe(true);
  });
});

describe("highlightFile", () => {
  beforeEach(async () => {
    mount();
    listing([
      { name: "docs", type: "dir", size: 0 },
      { name: "a.md", type: "file", size: 1 },
      { name: "b.md", type: "file", size: 1 },
    ]);
    await loadTree();
  });

  it("marks the entry whose path matches and clears the previous one", () => {
    const [dir, a, b] = items();
    highlightFile("a.md");
    expect(a.classList.contains("active")).toBe(true);
    highlightFile("b.md");
    expect(a.classList.contains("active")).toBe(false);
    expect(b.classList.contains("active")).toBe(true);
    expect(dir.classList.contains("active")).toBe(false);
  });

  it("clears the highlight for null and for unknown paths, and never marks directories", () => {
    const [dir, a] = items();
    highlightFile("a.md");
    highlightFile(null);
    expect(a.classList.contains("active")).toBe(false);
    highlightFile("a.md");
    highlightFile("missing.md");
    expect(byId("file-tree-list").querySelectorAll(".active")).toHaveLength(0);
    highlightFile("docs");
    expect(dir.classList.contains("active")).toBe(false);
  });

  it("is harmless when the tree is not mounted", () => {
    bw.clear(byId("app"));
    expect(() => highlightFile("a.md")).not.toThrow();
  });
});
