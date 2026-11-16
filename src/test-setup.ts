import { vi } from "vitest";

// Stub @tauri-apps/api/core — invoke is the main IPC function
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: vi.fn((path: string, protocol = "asset") => `${protocol}://localhost/${encodeURIComponent(path)}`),
}));

// Stub @tauri-apps/api/webview — native drag and drop (editor/dropzone.ts)
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: vi.fn(() => ({ onDragDropEvent: vi.fn(async () => () => {}) })),
}));

// Stub @tauri-apps/api/event
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));

// Stub @tauri-apps/plugin-dialog
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
  save: vi.fn(async () => null),
  ask: vi.fn(async () => true),
}));

// Stub @tauri-apps/plugin-fs
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async () => ""),
  writeTextFile: vi.fn(async () => {}),
}));

// Stub @tauri-apps/plugin-shell
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

// Stub quikdown — the standalone editor (used with `new QuikdownEditor(...)`)
vi.mock("quikdown/edit-standalone", () => {
  // A stand-in for QuikdownEditor 1.3's public API, backed by a textarea so
  // the selection and edit calls have real effects. Tests read and set the
  // document through `sourceTextarea` (the real editor has that element too);
  // application code goes through the API only (`editor/editor.ts`).
  const NO_FORMAT = { bold: false, italic: false, strike: false, code: false, link: false, heading: 0, list: null, quote: false, codeblock: false };
  class MockEditor {
    options: any;
    sourceTextarea: HTMLTextAreaElement;
    previewPanel: HTMLElement | null | undefined = null;
    mode = "split";
    constructor(container: any, options: any) {
      this.options = options ?? {};
      this.mode = this.options.mode ?? "split";
      this.sourceTextarea = document.createElement("textarea");
      this.sourceTextarea.className = "qde-textarea";
      (container ?? document.body).appendChild(this.sourceTextarea);
    }
    private input() {
      this.sourceTextarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
    getMarkdown = vi.fn(() => this.sourceTextarea.value);
    setMarkdown = vi.fn();
    getHTML = vi.fn(() => "");
    getMode = vi.fn(() => this.mode);
    setMode = vi.fn((mode: string) => {
      this.mode = mode;
      this.options?.onModeChange?.(mode);
    });
    undo = vi.fn();
    redo = vi.fn();
    canUndo = vi.fn(() => false);
    canRedo = vi.fn(() => false);
    clearHistory = vi.fn();
    getHistory = vi.fn(() => ({ undo: [] as string[], redo: [] as string[] }));
    setHistory = vi.fn();
    copyRendered = vi.fn(async () => {});
    setTheme = vi.fn();
    getFocusedPane = vi.fn(() => (document.activeElement === this.sourceTextarea ? "source" : null));
    focus = vi.fn(() => this.sourceTextarea.focus());
    getSelection = vi.fn(() => {
      const ta = this.sourceTextarea;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? start;
      return { start, end, text: ta.value.slice(start, end), pane: "source" as const };
    });
    setSelection = vi.fn((start: number, end: number = start) => {
      this.sourceTextarea.setSelectionRange(start, end);
      return { start, end };
    });
    insertText = vi.fn((text: string) => {
      const ta = this.sourceTextarea;
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? start;
      ta.setRangeText(text, start, end, "end");
      this.input();
      return { start: start + text.length, end: start + text.length };
    });
    replaceRange = vi.fn((start: number, end: number, text: string, select = false) => {
      const ta = this.sourceTextarea;
      ta.setRangeText(text, start, end);
      // happy-dom's setRangeText ignores the selection mode; place it by hand.
      const sel = select ? { start, end: start + text.length } : { start: start + text.length, end: start + text.length };
      ta.setSelectionRange(sel.start, sel.end);
      this.input();
      return sel;
    });
    format = vi.fn(() => true);
    getFormatState = vi.fn(() => ({ ...NO_FORMAT }));
    getScroll = vi.fn(() => ({ source: this.sourceTextarea.scrollTop, preview: this.previewPanel?.scrollTop ?? 0 }));
    setScroll = vi.fn((s: { source?: number; preview?: number } | null) => {
      if (s?.source != null) this.sourceTextarea.scrollTop = s.source;
      if (s?.preview != null && this.previewPanel) this.previewPanel.scrollTop = s.preview;
    });
    scrollToLine = vi.fn(() => null);
    lineOf = vi.fn(() => -1);
    destroy = vi.fn();
  }
  return { default: MockEditor };
});

// Stub quikdown parser — imported as default and called as quikdown(text)
// Also has quikdown.emitStyles() method
vi.mock("quikdown", () => {
  const fn = vi.fn((md: string) => `<p>${md}</p>`);
  (fn as any).emitStyles = vi.fn(() => "");
  return { default: fn };
});

// The UI is built by bitwrench at runtime from TACO objects, so modules no
// longer grab elements at import time. main.ts mounts the whole shell into
// #app; chat-ui.ts appends bubbles to #chat-messages, which the chat tests
// exercise without mounting the shell, so that one container is pre-created.
function ensureElement(id: string, tag = "div") {
  if (!document.getElementById(id)) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.appendChild(el);
  }
}

ensureElement("chat-messages");
ensureElement("app");
