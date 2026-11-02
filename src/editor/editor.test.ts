import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to test the wrapper functions. Since initEditor creates the instance,
// we test the null-safety behavior (returns defaults when editor not initialized)
// and delegation when initialized.

describe("editor wrapper functions (without init)", () => {
  // Dynamic import to get a fresh module for each test
  let editor: typeof import("./editor");

  beforeEach(async () => {
    vi.resetModules();
    editor = await import("./editor");
  });

  it("getMarkdown returns empty string when editor not initialized", () => {
    expect(editor.getMarkdown()).toBe("");
  });

  it("getHTML returns empty string when editor not initialized", () => {
    expect(editor.getHTML()).toBe("");
  });

  it("getSelection returns empty string when editor not initialized", () => {
    expect(editor.getSelection()).toBe("");
  });

  it("setMarkdown does not throw when editor not initialized", () => {
    expect(() => editor.setMarkdown("test")).not.toThrow();
  });

  it("undo does not throw when editor not initialized", () => {
    expect(() => editor.undo()).not.toThrow();
  });

  it("redo does not throw when editor not initialized", () => {
    expect(() => editor.redo()).not.toThrow();
  });

  it("insertAtCursor does not throw when editor not initialized", () => {
    expect(() => editor.insertAtCursor("text")).not.toThrow();
  });

  it("replaceRange does not throw and the textarea/preview getters return null when not initialized", () => {
    expect(() => editor.replaceRange(0, 1, "x")).not.toThrow();
    expect(editor.getSourceTextarea()).toBeNull();
    expect(editor.getPreviewPane()).toBeNull();
  });

  it("getEditor returns null when not initialized", () => {
    expect(editor.getEditor()).toBeNull();
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

  it("initEditor returns the editor instance", () => {
    expect(editor.getEditor()).not.toBeNull();
  });

  it("delegates getMarkdown to the instance", () => {
    const instance = editor.getEditor();
    instance.getMarkdown.mockReturnValue("# Hello");
    expect(editor.getMarkdown()).toBe("# Hello");
  });

  it("delegates setMarkdown to the instance", () => {
    const instance = editor.getEditor();
    editor.setMarkdown("# Test");
    expect(instance.setMarkdown).toHaveBeenCalledWith("# Test");
  });

  it("delegates undo to the instance", () => {
    const instance = editor.getEditor();
    editor.undo();
    expect(instance.undo).toHaveBeenCalled();
  });

  it("delegates redo to the instance", () => {
    const instance = editor.getEditor();
    editor.redo();
    expect(instance.redo).toHaveBeenCalled();
  });

  it("insertAtCursor splices text into the source textarea at the caret", () => {
    const ta = editor.getEditor().sourceTextarea as HTMLTextAreaElement;
    ta.value = "hello world";
    ta.setSelectionRange(5, 5);
    editor.insertAtCursor(", there");
    expect(ta.value).toBe("hello, there world");
  });

  it("insertAtCursor replaces the current selection and fires input", () => {
    const ta = editor.getEditor().sourceTextarea as HTMLTextAreaElement;
    const onInput = vi.fn();
    ta.addEventListener("input", onInput);
    ta.value = "keep DROP keep";
    ta.setSelectionRange(5, 9);
    editor.insertAtCursor("NEW");
    expect(ta.value).toBe("keep NEW keep");
    expect(onInput).toHaveBeenCalled();
  });

  it("getSourceTextarea returns the instance's textarea; getPreviewPane its preview panel (or null)", () => {
    const instance = editor.getEditor();
    expect(editor.getSourceTextarea()).toBe(instance.sourceTextarea);
    expect(editor.getPreviewPane()).toBeNull();
    const preview = document.createElement("div");
    instance.previewPanel = preview;
    expect(editor.getPreviewPane()).toBe(preview);
  });

  it("replaceRange replaces a span and fires input (selection modes are exercised in the browser e2e)", () => {
    const ta = editor.getEditor().sourceTextarea as HTMLTextAreaElement;
    const onInput = vi.fn();
    ta.addEventListener("input", onInput);
    ta.value = "the cat sat";
    editor.replaceRange(4, 7, "dog", "preserve");
    expect(ta.value).toBe("the dog sat");
    expect(onInput).toHaveBeenCalledTimes(1);
    editor.replaceRange(0, 3, "a");
    expect(ta.value).toBe("a dog sat");
    expect(onInput).toHaveBeenCalledTimes(2);
  });

  it("getSelection returns the selected slice of the source textarea", () => {
    const ta = editor.getEditor().sourceTextarea as HTMLTextAreaElement;
    ta.value = "alpha beta gamma";
    ta.setSelectionRange(6, 10);
    expect(editor.getSelection()).toBe("beta");
  });

  it("delegates getHTML to the instance", () => {
    const instance = editor.getEditor();
    instance.getHTML.mockReturnValue("<p>test</p>");
    expect(editor.getHTML()).toBe("<p>test</p>");
  });
});

describe("change listeners", () => {
  let editor: typeof import("./editor");

  beforeEach(async () => {
    vi.resetModules();
    editor = await import("./editor");
  });

  it("notifyEditorChange fans out to every listener until unsubscribed", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = editor.onEditorChange(a);
    editor.onEditorChange(b);
    editor.notifyEditorChange("# md", "<h1>md</h1>");
    expect(a).toHaveBeenCalledWith("# md", "<h1>md</h1>");
    expect(b).toHaveBeenCalledWith("# md", "<h1>md</h1>");
    offA();
    editor.notifyEditorChange("x", "");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
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

  it("reads and sets the instance mode, skipping no-op sets, and fans out onModeChange", () => {
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
    inst.mode = "weird";
    expect(editor.getEditorMode()).toBe("split");
    off();
    editor.notifyEditorModeChange("source");
    expect(seen).toEqual(["preview"]);
    host.remove();
  });
});
