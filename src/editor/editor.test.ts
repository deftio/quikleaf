import { describe, it, expect, vi, beforeEach } from "vitest";

// The wrapper functions over QuikdownEditor's API: null-safe before init,
// delegating afterwards. The instance is the mock in test-setup.ts, which
// implements the 1.3 API over a textarea.

describe("editor wrapper functions (without init)", () => {
  // Dynamic import to get a fresh module for each test
  let editor: typeof import("./editor");

  beforeEach(async () => {
    vi.resetModules();
    editor = await import("./editor");
  });

  it("the getters return empty values", () => {
    expect(editor.getMarkdown()).toBe("");
    expect(editor.getHTML()).toBe("");
    expect(editor.getSelection()).toBe("");
    expect(editor.getSelectionRange()).toBeNull();
    expect(editor.getFocusedPane()).toBeNull();
    expect(editor.getFormatState()).toBeNull();
    expect(editor.getScroll()).toEqual({ source: 0, preview: 0 });
    expect(editor.getHistory()).toEqual({ undo: [], redo: [] });
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);
    expect(editor.format("bold")).toBe(false);
    expect(editor.getEditor()).toBeNull();
  });

  it("the setters and actions do not throw and the async ones resolve", async () => {
    await expect(editor.setMarkdown("test")).resolves.toBeUndefined();
    await expect(editor.rerender()).resolves.toBeUndefined();
    await expect(editor.copyToClipboard("markdown")).resolves.toBe(false);
    for (const fn of [
      () => editor.undo(),
      () => editor.redo(),
      () => editor.insertAtCursor("text"),
      () => editor.replaceRange(0, 1, "x"),
      () => editor.setSelection(0, 1),
      () => editor.focusEditor(),
      () => editor.setScroll({ source: 1 }),
      () => editor.scrollToLine(3),
      () => editor.setHistory(null),
      () => editor.clearHistory(),
      () => editor.setEditorTheme(true),
      () => editor.setEditorMode("preview"),
    ]) {
      expect(fn).not.toThrow();
    }
  });
});

describe("editor wrapper functions (with init)", () => {
  let editor: typeof import("./editor");

  beforeEach(async () => {
    vi.resetModules();
    editor = await import("./editor");
    const container = document.createElement("div");
    editor.initEditor(container);
  });

  it("initEditor returns the editor instance, headless, with its shortcuts on", () => {
    expect(editor.getEditor()).not.toBeNull();
    const o = editor.getEditor().options;
    expect(o.showToolbar).toBe(false);
    expect(o.showUndoRedo).toBe(false);
    expect(o.shortcuts).toBe(true);
    expect(o.mode).toBe("split");
  });

  it("delegates the document getters and setters to the instance", async () => {
    const instance = editor.getEditor();
    instance.getMarkdown.mockReturnValue("# Hello");
    expect(editor.getMarkdown()).toBe("# Hello");
    instance.getHTML.mockReturnValue("<p>test</p>");
    expect(editor.getHTML()).toBe("<p>test</p>");
    await editor.setMarkdown("# Test");
    expect(instance.setMarkdown).toHaveBeenLastCalledWith("# Test");
    await editor.setMarkdown("# Other", { history: "reset" });
    expect(instance.setMarkdown).toHaveBeenLastCalledWith("# Other", { history: "reset" });
    await editor.rerender();
    expect(instance.setMarkdown).toHaveBeenLastCalledWith("# Hello", { history: "keep", source: "api" });
  });

  it("delegates the history calls", () => {
    const instance = editor.getEditor();
    editor.undo();
    editor.redo();
    expect(instance.undo).toHaveBeenCalled();
    expect(instance.redo).toHaveBeenCalled();
    instance.canUndo.mockReturnValue(true);
    instance.canRedo.mockReturnValue(false);
    expect(editor.canUndo()).toBe(true);
    expect(editor.canRedo()).toBe(false);
    instance.getHistory.mockReturnValue({ undo: ["a"], redo: ["b"] });
    expect(editor.getHistory()).toEqual({ undo: ["a"], redo: ["b"] });
    editor.setHistory({ undo: ["a"] });
    expect(instance.setHistory).toHaveBeenLastCalledWith({ undo: ["a"] });
    editor.setHistory(undefined);
    expect(instance.setHistory).toHaveBeenLastCalledWith(null);
    editor.clearHistory();
    expect(instance.clearHistory).toHaveBeenCalled();
  });

  describe("copyToClipboard", () => {
    const writeText = vi.fn(async () => {});
    beforeEach(() => {
      writeText.mockClear();
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    });

    it("writes the markdown or the HTML as text", async () => {
      const instance = editor.getEditor();
      instance.getMarkdown.mockReturnValue("# md");
      instance.getHTML.mockReturnValue("<h1>md</h1>");
      await expect(editor.copyToClipboard("markdown")).resolves.toBe(true);
      expect(writeText).toHaveBeenLastCalledWith("# md");
      await expect(editor.copyToClipboard("html")).resolves.toBe(true);
      expect(writeText).toHaveBeenLastCalledWith("<h1>md</h1>");
    });

    it("hands rich text to quikdown's copyRendered", async () => {
      const instance = editor.getEditor();
      await expect(editor.copyToClipboard("rendered")).resolves.toBe(true);
      expect(instance.copyRendered).toHaveBeenCalledTimes(1);
      expect(writeText).not.toHaveBeenCalled();
    });

    it("resolves false (and does not throw) when the clipboard refuses", async () => {
      writeText.mockRejectedValueOnce(new Error("denied"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(editor.copyToClipboard("markdown")).resolves.toBe(false);
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });
  });

  it("insertAtCursor goes through the editor's insertText (the mock splices the textarea at the caret)", () => {
    const inst = editor.getEditor();
    const ta = inst.sourceTextarea as HTMLTextAreaElement;
    ta.value = "hello world";
    ta.setSelectionRange(5, 5);
    editor.insertAtCursor(", there");
    expect(inst.insertText).toHaveBeenCalledWith(", there");
    expect(ta.value).toBe("hello, there world");
    ta.setSelectionRange(5, 12);
    editor.insertAtCursor("");
    expect(ta.value).toBe("hello world");
  });

  it("getSelection is the selected markdown; getSelectionRange the offsets and pane", () => {
    const ta = editor.getEditor().sourceTextarea as HTMLTextAreaElement;
    ta.value = "alpha beta gamma";
    ta.setSelectionRange(6, 10);
    expect(editor.getSelection()).toBe("beta");
    expect(editor.getSelectionRange()).toEqual({ start: 6, end: 10, text: "beta", pane: "source" });
    editor.setSelection(0, 5);
    expect(editor.getSelection()).toBe("alpha");
    editor.setSelection(2);
    expect(editor.getSelectionRange()).toMatchObject({ start: 2, end: 2 });
  });

  it("replaceRange: the caret lands after the text, on it, or stays put (clamped)", () => {
    const inst = editor.getEditor();
    const ta = inst.sourceTextarea as HTMLTextAreaElement;
    ta.value = "the cat sat";
    ta.setSelectionRange(10, 10);
    editor.replaceRange(4, 7, "dog", "preserve");
    expect(ta.value).toBe("the dog sat");
    expect(inst.replaceRange).toHaveBeenLastCalledWith(4, 7, "dog", false);
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([10, 10]);
    editor.replaceRange(0, 3, "a", "select");
    expect(ta.value).toBe("a dog sat");
    expect(inst.replaceRange).toHaveBeenLastCalledWith(0, 3, "a", true);
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([0, 1]);
    editor.replaceRange(0, 1, "the");
    expect(ta.value).toBe("the dog sat");
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([3, 3]);
    // "preserve" clamps a caret that was past the new end.
    ta.setSelectionRange(11, 11);
    editor.replaceRange(0, 11, "x", "preserve");
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([1, 1]);
  });

  it("focus, focused pane, format, format state, scroll and lines delegate to the instance", () => {
    const inst = editor.getEditor();
    const ta = inst.sourceTextarea as HTMLTextAreaElement;
    document.body.appendChild(ta);
    editor.focusEditor();
    expect(inst.focus).toHaveBeenCalled();
    expect(editor.getFocusedPane()).toBe("source");
    editor.focusEditor("preview");
    expect(inst.focus).toHaveBeenLastCalledWith("preview");

    expect(editor.format("bold")).toBe(true);
    expect(inst.format).toHaveBeenCalledWith("bold");
    inst.format.mockReturnValue(false);
    expect(editor.format("h1")).toBe(false);
    inst.getFormatState.mockReturnValue({ bold: true });
    expect(editor.getFormatState()).toEqual({ bold: true });

    ta.scrollTop = 7;
    expect(editor.getScroll()).toEqual({ source: 7, preview: 0 });
    editor.setScroll({ source: 3, preview: 9 });
    expect(inst.setScroll).toHaveBeenCalledWith({ source: 3, preview: 9 });
    editor.scrollToLine(12);
    expect(inst.scrollToLine).toHaveBeenCalledWith(12);
    editor.scrollToLine(1, "preview");
    expect(inst.scrollToLine).toHaveBeenLastCalledWith(1, "preview");
    ta.remove();
  });

  it("the link handler and image resolver are what the editor's options call; unset, they do nothing", () => {
    const o = editor.getEditor().options;
    const ev = new MouseEvent("click");
    expect(o.onLinkClick("https://x", ev)).toBe(false);
    expect(o.resolveImageSrc("a.png", { alt: "", title: "" })).toBeUndefined();
    const onLink = vi.fn(() => true);
    const resolve = vi.fn((src: string) => `asset://${src}`);
    editor.setLinkHandler(onLink);
    editor.setImageResolver(resolve);
    expect(o.onLinkClick("https://x", ev)).toBe(true);
    expect(onLink).toHaveBeenCalledWith("https://x", ev);
    expect(o.resolveImageSrc("a.png", { alt: "", title: "" })).toBe("asset://a.png");
    editor.setLinkHandler(null);
    editor.setImageResolver(null);
    expect(o.onLinkClick("https://x", ev)).toBe(false);
    expect(o.resolveImageSrc("a.png", { alt: "", title: "" })).toBeUndefined();
  });
});

describe("listeners", () => {
  let editor: typeof import("./editor");

  beforeEach(async () => {
    vi.resetModules();
    editor = await import("./editor");
  });

  it("notifyEditorChange fans out (with the change's source) to every listener until unsubscribed", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = editor.onEditorChange(a);
    editor.onEditorChange(b);
    editor.notifyEditorChange("# md", "<h1>md</h1>", { source: "user" });
    expect(a).toHaveBeenCalledWith("# md", "<h1>md</h1>", { source: "user" });
    expect(b).toHaveBeenCalledWith("# md", "<h1>md</h1>", { source: "user" });
    offA();
    editor.notifyEditorChange("x", "");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenLastCalledWith("x", "", { source: "api" });
  });

  it("the editor's onChange option is notifyEditorChange", () => {
    const seen = vi.fn();
    editor.onEditorChange(seen);
    editor.initEditor(document.createElement("div"));
    editor.getEditor().options.onChange("md", "<p>md</p>", { source: "format" });
    expect(seen).toHaveBeenCalledWith("md", "<p>md</p>", { source: "format" });
  });

  it("selection and render listeners fan out the same way", () => {
    const sel = vi.fn();
    const render = vi.fn();
    const offSel = editor.onEditorSelectionChange(sel);
    const offRender = editor.onEditorRender(render);
    editor.initEditor(document.createElement("div"));
    const o = editor.getEditor().options;
    const info = { start: 1, end: 2, text: "x", pane: "source", format: { bold: true } };
    o.onSelectionChange(info);
    expect(sel).toHaveBeenCalledWith(info);
    const preview = document.createElement("div");
    o.onRender(preview);
    expect(render).toHaveBeenCalledWith(preview);
    offSel();
    offRender();
    o.onSelectionChange(info);
    o.onRender(preview);
    expect(sel).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("setMarkdown resolves to undefined with and without an instance", async () => {
    await expect(editor.setMarkdown("a")).resolves.toBeUndefined();
    editor.initEditor(document.createElement("div"));
    await expect(editor.setMarkdown("b")).resolves.toBeUndefined();
    expect(editor.getEditor().setMarkdown).toHaveBeenCalledWith("b");
  });
});

describe("editor mode", () => {
  let editor: typeof import("./editor");

  beforeEach(async () => {
    vi.resetModules();
    editor = await import("./editor");
  });

  it("defaults to split without an instance and ignores setEditorMode", () => {
    expect(editor.getEditorMode()).toBe("split");
    expect(() => editor.setEditorMode("preview")).not.toThrow();
    expect(editor.EDITOR_MODES).toEqual(["source", "split", "preview"]);
  });

  it("tracks the mode through setEditorMode and onModeChange, skipping no-op sets", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const inst = editor.initEditor(host);
    const seen: string[] = [];
    const off = editor.onEditorModeChange((m) => seen.push(m));
    expect(editor.getEditorMode()).toBe("split");
    editor.setEditorMode("split");
    expect(inst.setMode).not.toHaveBeenCalled();
    editor.setEditorMode("preview");
    expect(inst.setMode).toHaveBeenCalledWith("preview");
    expect(editor.getEditorMode()).toBe("preview");
    // The mock editor forwards setMode to the onModeChange option, as quikdown does.
    expect(seen).toEqual(["preview"]);
    editor.notifyEditorModeChange("nonsense");
    expect(seen).toEqual(["preview"]);
    // The editor's own shortcut (Cmd+1) reports through onModeChange too.
    editor.notifyEditorModeChange("source");
    expect(editor.getEditorMode()).toBe("source");
    expect(seen).toEqual(["preview", "source"]);
    off();
    editor.notifyEditorModeChange("split");
    expect(seen).toEqual(["preview", "source"]);
    host.remove();
  });
});
