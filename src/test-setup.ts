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
vi.mock("quikdown-standalone", () => {
  // Mirror the real QuikdownEditor surface only — it has no insertText() or
  // getSelection(); editor.ts drives the source textarea for those.
  class MockEditor {
    getMarkdown = vi.fn(() => "");
    setMarkdown = vi.fn();
    getHTML = vi.fn(() => "");
    undo = vi.fn();
    redo = vi.fn();
    canUndo = vi.fn(() => false);
    canRedo = vi.fn(() => false);
    copyRendered = vi.fn(async () => {});
    setTheme = vi.fn();
    sourceTextarea: HTMLTextAreaElement;
    mode = "split";
    options: any;
    setMode = vi.fn((mode: string) => {
      this.mode = mode;
      this.options?.onModeChange?.(mode);
    });
    constructor(container: any, options: any) {
      this.options = options ?? {};
      this.mode = this.options.mode ?? "split";
      this.sourceTextarea = document.createElement("textarea");
      this.sourceTextarea.className = "qde-textarea";
      (container ?? document.body).appendChild(this.sourceTextarea);
    }
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
