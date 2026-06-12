import { vi } from "vitest";

// Stub @tauri-apps/api/core — invoke is the main IPC function
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
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
  class MockEditor {
    getMarkdown = vi.fn(() => "");
    setMarkdown = vi.fn();
    getHTML = vi.fn(() => "");
    undo = vi.fn();
    redo = vi.fn();
    insertText = vi.fn();
    getSelection = vi.fn(() => "");
    constructor(_container: any, _options: any) {}
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

// Set up minimal DOM structure needed by modules that grab elements at import time
function ensureElement(id: string, tag = "div") {
  if (!document.getElementById(id)) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.appendChild(el);
  }
}

// chat-ui.ts grabs these at module load
ensureElement("chat-messages");
ensureElement("chat-input", "textarea");
ensureElement("chat-send", "button");

// settings.ts DOM
ensureElement("settings-overlay");
ensureElement("btn-settings", "button");
ensureElement("settings-cancel", "button");
ensureElement("settings-save", "button");
ensureElement("settings-fetch-models", "button");
ensureElement("models-list");
ensureElement("llm-status");
const selectEl = document.createElement("select");
selectEl.id = "set-provider";
if (!document.getElementById("set-provider")) document.body.appendChild(selectEl);
ensureElement("set-host", "input");
ensureElement("set-api-key", "input");
ensureElement("set-model", "input");

// main.ts DOM
ensureElement("app");
ensureElement("editor-container");
ensureElement("btn-file-menu", "button");
ensureElement("file-menu-dropdown");
ensureElement("btn-open", "button");
ensureElement("btn-save", "button");
ensureElement("btn-toggle-chat", "button");
ensureElement("chat-panel");
ensureElement("status-file");
ensureElement("about-overlay");
ensureElement("about-modal");
ensureElement("btn-about", "button");
ensureElement("file-tree");
ensureElement("file-tree-list");
