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
