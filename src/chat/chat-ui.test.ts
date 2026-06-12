import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";

// chat-ui.ts grabs DOM elements at module load — test-setup.ts creates them.
// We dynamically import to get dispatchTool and handleSlashCommand.

let dispatchTool: typeof import("./chat-ui")["dispatchTool"];
let handleSlashCommand: typeof import("./chat-ui")["handleSlashCommand"];
let setProjectMode: typeof import("./chat-ui")["setProjectMode"];

beforeEach(async () => {
  vi.resetModules();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(null);

  // Clear chat messages
  const chatMessages = document.getElementById("chat-messages");
  if (chatMessages) chatMessages.innerHTML = "";

  const mod = await import("./chat-ui");
  dispatchTool = mod.dispatchTool;
  handleSlashCommand = mod.handleSlashCommand;
  setProjectMode = mod.setProjectMode;
});

describe("dispatchTool", () => {
  // --- Document tools ---

  it("document_read returns markdown content", async () => {
    // Editor mock returns "" by default
    const result = await dispatchTool("document_read", {});
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("content");
  });

  it("document_write returns success", async () => {
    const result = await dispatchTool("document_write", { content: "# Hello" });
    expect(JSON.parse(result)).toEqual({ success: true });
  });

  it("document_replace with no match returns count 0", async () => {
    const result = await dispatchTool("document_replace", { search: "nonexistent", replace: "new" });
    expect(JSON.parse(result)).toEqual({ count: 0 });
  });

  it("document_insert returns success", async () => {
    const result = await dispatchTool("document_insert", { text: "inserted" });
    expect(JSON.parse(result)).toEqual({ success: true });
  });

  it("document_undo returns success", async () => {
    const result = await dispatchTool("document_undo", {});
    expect(JSON.parse(result)).toEqual({ success: true });
  });

  it("document_redo returns success", async () => {
    const result = await dispatchTool("document_redo", {});
    expect(JSON.parse(result)).toEqual({ success: true });
  });

  it("document_get_selection returns selection", async () => {
    const result = await dispatchTool("document_get_selection", {});
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("selection");
  });

  // --- Memory tools ---

  it("memory_read invokes Tauri IPC", async () => {
    vi.mocked(invoke).mockResolvedValue("scratchpad content");
    const result = await dispatchTool("memory_read", {});
    expect(invoke).toHaveBeenCalledWith("memory_read");
    expect(JSON.parse(result)).toEqual({ content: "scratchpad content" });
  });

  it("memory_write invokes Tauri IPC", async () => {
    const result = await dispatchTool("memory_write", { content: "new data" });
    expect(invoke).toHaveBeenCalledWith("memory_write", { content: "new data" });
    expect(JSON.parse(result)).toEqual({ success: true });
  });

  it("memory_append invokes Tauri IPC", async () => {
    const result = await dispatchTool("memory_append", { content: "appended" });
    expect(invoke).toHaveBeenCalledWith("memory_append", { content: "appended" });
    expect(JSON.parse(result)).toEqual({ success: true });
  });

  it("memory_clear invokes Tauri IPC", async () => {
    const result = await dispatchTool("memory_clear", {});
    expect(invoke).toHaveBeenCalledWith("memory_clear");
    expect(JSON.parse(result)).toEqual({ success: true });
  });

  // --- KV tools ---

  it("kv_get returns entry or error", async () => {
    vi.mocked(invoke).mockResolvedValue({ value: "val", created: "t1", modified: "t2" });
    const result = await dispatchTool("kv_get", { key: "mykey" });
    expect(invoke).toHaveBeenCalledWith("kv_get", { key: "mykey" });
    expect(JSON.parse(result).value).toBe("val");
  });

  it("kv_get returns error for missing key (null result)", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const result = await dispatchTool("kv_get", { key: "missing" });
    expect(JSON.parse(result)).toEqual({ error: "Key not found" });
  });

  it("kv_set invokes Tauri IPC", async () => {
    vi.mocked(invoke).mockResolvedValue({ success: true });
    const result = await dispatchTool("kv_set", { key: "k", value: "v" });
    expect(invoke).toHaveBeenCalledWith("kv_set", { key: "k", value: "v" });
    expect(JSON.parse(result)).toEqual({ success: true });
  });

  it("kv_delete invokes Tauri IPC", async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    const result = await dispatchTool("kv_delete", { key: "k" });
    expect(invoke).toHaveBeenCalledWith("kv_delete", { key: "k" });
    expect(JSON.parse(result)).toEqual({ deleted: true });
  });

  it("kv_list invokes Tauri IPC", async () => {
    vi.mocked(invoke).mockResolvedValue({ entries: [] });
    const result = await dispatchTool("kv_list", {});
    expect(invoke).toHaveBeenCalledWith("kv_list");
    expect(JSON.parse(result)).toEqual({ entries: [] });
  });

  // --- File tools ---

  it("file_read rejected when not in project mode", async () => {
    setProjectMode(false);
    const result = await dispatchTool("file_read", { path: "test.txt" });
    expect(JSON.parse(result).error).toContain("project mode");
  });

  it("file_write rejected when not in project mode", async () => {
    setProjectMode(false);
    const result = await dispatchTool("file_write", { path: "test.txt", content: "data" });
    expect(JSON.parse(result).error).toContain("project mode");
  });

  it("file_list rejected when not in project mode", async () => {
    setProjectMode(false);
    const result = await dispatchTool("file_list", { path: "" });
    expect(JSON.parse(result).error).toContain("project mode");
  });

  it("file_stat rejected when not in project mode", async () => {
    setProjectMode(false);
    const result = await dispatchTool("file_stat", { path: "test.txt" });
    expect(JSON.parse(result).error).toContain("project mode");
  });

  it("file_read invokes IPC in project mode", async () => {
    setProjectMode(true);
    vi.mocked(invoke).mockResolvedValue("file content");
    const result = await dispatchTool("file_read", { path: "readme.md" });
    expect(invoke).toHaveBeenCalledWith("file_read", { path: "readme.md" });
    expect(JSON.parse(result)).toEqual({ content: "file content" });
    setProjectMode(false);
  });

  it("file_write invokes IPC in project mode", async () => {
    setProjectMode(true);
    vi.mocked(invoke).mockResolvedValue(undefined);
    const result = await dispatchTool("file_write", { path: "test.txt", content: "data" });
    expect(invoke).toHaveBeenCalledWith("file_write", { path: "test.txt", content: "data" });
    expect(JSON.parse(result)).toEqual({ success: true });
    setProjectMode(false);
  });

  it("file_list invokes IPC in project mode", async () => {
    setProjectMode(true);
    vi.mocked(invoke).mockResolvedValue({ entries: [{ name: "a.txt", type: "file" }] });
    const result = await dispatchTool("file_list", { path: "", recursive: true });
    expect(invoke).toHaveBeenCalledWith("file_list", { path: null, recursive: true });
    setProjectMode(false);
  });

  it("file_stat invokes IPC in project mode", async () => {
    setProjectMode(true);
    vi.mocked(invoke).mockResolvedValue({ size: 100, type: "file", modified: "2024-01-01" });
    const result = await dispatchTool("file_stat", { path: "test.txt" });
    expect(invoke).toHaveBeenCalledWith("file_stat", { path: "test.txt" });
    setProjectMode(false);
  });

  // --- Unknown tool ---

  it("unknown tool returns error", async () => {
    const result = await dispatchTool("nonexistent_tool", {});
    expect(JSON.parse(result).error).toContain("Unknown tool");
  });
});

describe("handleSlashCommand", () => {
  it("/help returns true and adds bubble", () => {
    const result = handleSlashCommand("/help");
    expect(result).toBe(true);
    const msgs = document.getElementById("chat-messages")!;
    expect(msgs.children.length).toBeGreaterThan(0);
  });

  it("/clear returns true and clears chat", () => {
    const result = handleSlashCommand("/clear");
    expect(result).toBe(true);
  });

  it("/model returns true", () => {
    const result = handleSlashCommand("/model");
    expect(result).toBe(true);
  });

  it("/memory returns true", () => {
    const result = handleSlashCommand("/memory");
    expect(result).toBe(true);
  });

  it("/tools returns true without project mode", () => {
    setProjectMode(false);
    const result = handleSlashCommand("/tools");
    expect(result).toBe(true);
    const msgs = document.getElementById("chat-messages")!;
    const lastMsg = msgs.lastElementChild;
    expect(lastMsg?.innerHTML).not.toContain("File:");
  });

  it("/tools with project mode includes file tools", () => {
    setProjectMode(true);
    const result = handleSlashCommand("/tools");
    expect(result).toBe(true);
    const msgs = document.getElementById("chat-messages")!;
    const lastMsg = msgs.lastElementChild;
    expect(lastMsg?.innerHTML).toContain("File:");
    setProjectMode(false);
  });

  it("unknown command returns false", () => {
    const result = handleSlashCommand("/doesnotexist");
    expect(result).toBe(false);
  });

  it("handles case-insensitive commands", () => {
    expect(handleSlashCommand("/HELP")).toBe(true);
    expect(handleSlashCommand("/Help")).toBe(true);
  });
});
