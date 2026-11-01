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

  it("file_write invokes IPC in project mode when approval is off", async () => {
    localStorage.setItem("quikleaf_llm_settings", JSON.stringify({ editApproval: "never" }));
    setProjectMode(true);
    vi.mocked(invoke).mockResolvedValue(undefined);
    const result = await dispatchTool("file_write", { path: "test.txt", content: "data" });
    expect(invoke).toHaveBeenCalledWith("file_write", { path: "test.txt", content: "data" });
    expect(invoke).not.toHaveBeenCalledWith("file_read", expect.anything());
    expect(JSON.parse(result)).toEqual({ success: true });
    setProjectMode(false);
    localStorage.clear();
  });

  it("project_search is rejected outside project mode and needs a query", async () => {
    setProjectMode(false);
    expect(JSON.parse(await dispatchTool("project_search", { query: "x" })).error).toContain("project mode");
    setProjectMode(true);
    expect(JSON.parse(await dispatchTool("project_search", {})).error).toContain("non-empty query");
    expect(invoke).not.toHaveBeenCalledWith("project_search", expect.anything());
    setProjectMode(false);
  });

  it("project_search forwards query, path, regex and max_results to the backend", async () => {
    setProjectMode(true);
    const resp = { matches: [{ path: "a.md", line: 2, text: "hit" }], truncated: false, files_scanned: 3 };
    vi.mocked(invoke).mockResolvedValue(resp);
    const result = await dispatchTool("project_search", { query: "hit", path: "docs", regex: true, max_results: 5 });
    expect(invoke).toHaveBeenCalledWith("project_search", { query: "hit", path: "docs", regex: true, maxResults: 5 });
    expect(JSON.parse(result)).toEqual(resp);

    vi.mocked(invoke).mockClear();
    await dispatchTool("project_search", { query: "hit" });
    expect(invoke).toHaveBeenCalledWith("project_search", { query: "hit", path: null, regex: false, maxResults: null });
    setProjectMode(false);
  });

  it("document_outline lists the headings of the current document", async () => {
    const result = await dispatchTool("document_outline", {});
    expect(JSON.parse(result)).toEqual({ headings: [] });
  });

  it("plan_set and plan_update are dispatched", async () => {
    expect(JSON.parse(await dispatchTool("plan_set", { steps: ["a", "b"] }))).toMatchObject({ success: true, steps: 2 });
    expect(JSON.parse(await dispatchTool("plan_update", { index: 1, status: "done" }))).toMatchObject({ success: true, progress: "1/2" });
    expect(JSON.parse(await dispatchTool("plan_update", undefined)).error).toContain("index");
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

  it("/clear returns true, clears chat and forgets the plan", async () => {
    await dispatchTool("plan_set", { steps: ["a"] });
    expect(document.getElementById("plan-card")).not.toBeNull();
    const result = handleSlashCommand("/clear");
    expect(result).toBe(true);
    expect(document.getElementById("plan-card")).toBeNull();
    expect(JSON.parse(await dispatchTool("plan_update", { index: 0, status: "done" })).error).toContain("No plan set");
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

describe("tab tools", () => {
  it("tabs_list returns the open tabs with an active flag", async () => {
    const docs = await import("../editor/documents");
    const { resetTabs } = await import("../editor/tabs");
    resetTabs();
    const a = await docs.openDocument("/tmp/a.md", "# A");
    await docs.openDocument("/tmp/b.md", "# B");
    const parsed = JSON.parse(await dispatchTool("tabs_list", {}));
    expect(parsed.tabs).toHaveLength(2);
    expect(parsed.tabs.map((t: any) => t.path)).toEqual(["/tmp/a.md", "/tmp/b.md"]);
    expect(parsed.tabs.filter((t: any) => t.active)).toHaveLength(1);
    expect(parsed.tabs.find((t: any) => t.id === a.id).title).toBe("a.md");
    resetTabs();
  });

  it("tab_switch activates by id or path and errors on unknown", async () => {
    const docs = await import("../editor/documents");
    const { resetTabs, activeTab } = await import("../editor/tabs");
    resetTabs();
    const a = await docs.openDocument("/tmp/a.md", "# A");
    await docs.openDocument("/tmp/b.md", "# B");
    expect(JSON.parse(await dispatchTool("tab_switch", { id: a.id })).success).toBe(true);
    expect(activeTab()?.id).toBe(a.id);
    expect(JSON.parse(await dispatchTool("tab_switch", { path: "/tmp/b.md" })).path).toBe("/tmp/b.md");
    expect(activeTab()?.path).toBe("/tmp/b.md");
    expect(JSON.parse(await dispatchTool("tab_switch", { id: "nope" })).error).toContain("tabs_list");
    resetTabs();
  });

  it("tab_open is project-only, validates path, and opens through file_read", async () => {
    setProjectMode(false);
    expect(JSON.parse(await dispatchTool("tab_open", { path: "x.md" })).error).toContain("project mode");
    setProjectMode(true);
    expect(JSON.parse(await dispatchTool("tab_open", {})).error).toContain("path");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "file_read" ? "# Hello" : null));
    const ok = JSON.parse(await dispatchTool("tab_open", { path: "notes/hello.md" }));
    expect(ok.success).toBe(true);
    expect(ok.title).toBe("hello.md");
    expect(invoke).toHaveBeenCalledWith("file_read", { path: "notes/hello.md" });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "file_read") throw new Error("missing");
      return null;
    });
    expect(JSON.parse(await dispatchTool("tab_open", { path: "missing.md" })).error).toContain("Could not open");
    setProjectMode(false);
    const { resetTabs } = await import("../editor/tabs");
    resetTabs();
  });
});
