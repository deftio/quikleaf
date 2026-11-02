/**
 * Tool dispatch and slash commands, per chat scope.
 *
 * A chat belongs to a tab (`session.ts`): a document chat may touch only its
 * own document, the project chat only files under the project root. These
 * tests set up tabs directly on the tab model and run `dispatchTool` against
 * the sessions they imply.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import bw from "bitwrench";

type ChatUi = typeof import("./chat-ui");
type Session = typeof import("./session");
type Tabs = typeof import("./../editor/tabs");
type Docs = typeof import("../editor/documents");

let mod: ChatUi;
let session: Session;
let tabs: Tabs;
let docs: Docs;

beforeEach(async () => {
  vi.resetModules();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(null);
  localStorage.clear();

  mod = await import("./chat-ui");
  session = await import("./session");
  tabs = await import("../editor/tabs");
  docs = await import("../editor/documents");
  tabs.resetTabs();
  session.resetSessions();
  docs.setDocumentsProjectMode(false);
});

afterEach(() => {
  tabs.resetTabs();
  session.resetSessions();
  docs.setDocumentsProjectMode(false);
});

/** A document chat for a file inside the project (memory/KV allowed). */
function projectFileTab() {
  docs.setDocumentsProjectMode(true, "/root");
  return tabs.openTab("notes.md", "# Notes", { projectRelative: true });
}

/** The project chat (file tools). */
function projectTab() {
  docs.setDocumentsProjectMode(true, "/root");
  return tabs.openProjectTab();
}

const parse = async (p: Promise<string>) => JSON.parse(await p);

describe("document tools in a document chat", () => {
  beforeEach(() => {
    tabs.newUntitledTab();
  });

  it("document_read returns the content tagged with the document name", async () => {
    const parsed = await parse(mod.dispatchTool("document_read", {}));
    expect(parsed).toEqual({ document: "Untitled", content: "" });
  });

  it("document_write returns success", async () => {
    expect(await parse(mod.dispatchTool("document_write", { content: "# Hello" }))).toEqual({ success: true, document: "Untitled" });
  });

  it("document_replace with no match returns count 0", async () => {
    expect(await parse(mod.dispatchTool("document_replace", { search: "nonexistent", replace: "new" }))).toEqual({ count: 0, document: "Untitled" });
  });

  it("document_insert / undo / redo / get_selection work on the visible tab", async () => {
    expect(await parse(mod.dispatchTool("document_insert", { text: "inserted" }))).toMatchObject({ success: true });
    expect(await parse(mod.dispatchTool("document_undo", {}))).toMatchObject({ success: true });
    expect(await parse(mod.dispatchTool("document_redo", {}))).toMatchObject({ success: true });
    expect(await parse(mod.dispatchTool("document_get_selection", {}))).toHaveProperty("selection");
  });

  it("document_outline lists the headings of the current document", async () => {
    expect(await parse(mod.dispatchTool("document_outline", {}))).toEqual({ document: "Untitled", headings: [] });
  });

  it("plan_set and plan_update are dispatched and the plan belongs to the chat", async () => {
    expect(await parse(mod.dispatchTool("plan_set", { steps: ["a", "b"] }))).toMatchObject({ success: true, steps: 2 });
    expect(await parse(mod.dispatchTool("plan_update", { index: 1, status: "done" }))).toMatchObject({ success: true, progress: "1/2" });
    expect((await parse(mod.dispatchTool("plan_update", undefined))).error).toContain("index");
    const s = session.activeSession()!;
    expect(s.plan?.steps.length).toBe(2);
    expect(s.log.querySelector("#plan-card")).not.toBeNull();
  });

  it("unknown tool returns error", async () => {
    expect((await parse(mod.dispatchTool("nonexistent_tool", {}))).error).toContain("Unknown tool");
  });

  it("returns an error when no chat is open", async () => {
    tabs.resetTabs();
    expect((await parse(mod.dispatchTool("document_read", {}))).error).toContain("No chat is open");
  });
});

describe("a document chat is sealed to its own tab", () => {
  it("reads and writes its own document even while another tab is active", async () => {
    const a = tabs.openTab("/tmp/a.md", "# A");
    const b = tabs.openTab("/tmp/b.md", "# B");
    const chatA = session.sessionFor(a.id);
    expect(tabs.activeTab()?.id).toBe(b.id);
    // Background read: the parked text, not the editor's.
    expect(await parse(mod.dispatchTool("document_read", {}, chatA))).toEqual({ document: "a.md", content: "# A" });
    // Background write lands in tab A and marks it dirty; tab B is untouched.
    localStorage.setItem("quikleaf_llm_settings", JSON.stringify({ editApproval: "never" }));
    expect(await parse(mod.dispatchTool("document_write", { content: "# A2" }, chatA))).toEqual({ success: true, document: "a.md" });
    expect(tabs.getTab(a.id)).toMatchObject({ content: "# A2", dirty: true });
    expect(tabs.getTab(b.id)).toMatchObject({ content: "# B", dirty: false });
    expect(await parse(mod.dispatchTool("document_replace", { search: "A2", replace: "A3" }, chatA))).toEqual({ count: 1, document: "a.md" });
    expect(tabs.getTab(a.id)?.content).toBe("# A3");
    // The applied-diff cards went into chat A's log, not the active chat's.
    expect(chatA.log.querySelectorAll(".chat-msg.review").length).toBe(2);
    expect(session.sessionFor(b.id).log.querySelectorAll(".chat-msg.review").length).toBe(0);
  });

  it("refuses cursor tools for a background tab", async () => {
    const a = tabs.openTab("/tmp/a.md", "# A");
    tabs.openTab("/tmp/b.md", "# B");
    const chatA = session.sessionFor(a.id);
    for (const tool of ["document_insert", "document_undo", "document_redo", "document_get_selection"]) {
      const res = await parse(mod.dispatchTool(tool, { text: "x" }, chatA));
      expect(res.error).toContain("a.md");
      expect(res.error).toContain("background tab");
    }
  });

  it("has no file, search or tab tools, even in project mode", async () => {
    projectFileTab();
    for (const tool of ["file_read", "file_write", "file_list", "file_stat", "project_search", "tabs_list", "tab_open"]) {
      const res = await parse(mod.dispatchTool(tool, { path: "x.md", query: "q", content: "c" }));
      expect(res.error).toContain("not available in a document chat");
      expect(res.error).toContain("notes.md");
    }
    expect(invoke).not.toHaveBeenCalledWith("file_read", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("project_search", expect.anything());
  });
});

describe("memory and KV tools are project state", () => {
  it("are refused for an untitled document outside any project", async () => {
    tabs.newUntitledTab();
    for (const tool of ["memory_read", "memory_write", "memory_append", "memory_clear", "kv_get", "kv_set", "kv_delete", "kv_list"]) {
      const res = await parse(mod.dispatchTool(tool, { key: "k", value: "v", content: "c" }));
      expect(res.error).toContain("needs a project");
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it("are refused for a file outside the project root in project mode", async () => {
    docs.setDocumentsProjectMode(true, "/root");
    tabs.openTab("/elsewhere/other.md", "x");
    const res = await parse(mod.dispatchTool("memory_read", {}));
    expect(res.error).toContain("other.md is not a project file");
    expect(invoke).not.toHaveBeenCalledWith("memory_read");
  });

  describe("for a project file", () => {
    beforeEach(() => {
      projectFileTab();
    });

    it("memory_read invokes Tauri IPC", async () => {
      vi.mocked(invoke).mockResolvedValue("scratchpad content");
      expect(await parse(mod.dispatchTool("memory_read", {}))).toEqual({ content: "scratchpad content" });
      expect(invoke).toHaveBeenCalledWith("memory_read");
    });

    it("memory_write / append / clear invoke Tauri IPC", async () => {
      expect(await parse(mod.dispatchTool("memory_write", { content: "new data" }))).toEqual({ success: true });
      expect(invoke).toHaveBeenCalledWith("memory_write", { content: "new data" });
      expect(await parse(mod.dispatchTool("memory_append", { content: "appended" }))).toEqual({ success: true });
      expect(invoke).toHaveBeenCalledWith("memory_append", { content: "appended" });
      expect(await parse(mod.dispatchTool("memory_clear", {}))).toEqual({ success: true });
      expect(invoke).toHaveBeenCalledWith("memory_clear");
    });

    it("kv_get returns entry or error", async () => {
      vi.mocked(invoke).mockResolvedValue({ value: "val", created: "t1", modified: "t2" });
      expect((await parse(mod.dispatchTool("kv_get", { key: "mykey" }))).value).toBe("val");
      expect(invoke).toHaveBeenCalledWith("kv_get", { key: "mykey" });
      vi.mocked(invoke).mockResolvedValue(null);
      expect(await parse(mod.dispatchTool("kv_get", { key: "missing" }))).toEqual({ error: "Key not found" });
    });

    it("kv_set / kv_delete / kv_list invoke Tauri IPC", async () => {
      vi.mocked(invoke).mockResolvedValue({ success: true });
      expect(await parse(mod.dispatchTool("kv_set", { key: "k", value: "v" }))).toEqual({ success: true });
      expect(invoke).toHaveBeenCalledWith("kv_set", { key: "k", value: "v" });
      vi.mocked(invoke).mockResolvedValue(true);
      expect(await parse(mod.dispatchTool("kv_delete", { key: "k" }))).toEqual({ deleted: true });
      vi.mocked(invoke).mockResolvedValue({ entries: [] });
      expect(await parse(mod.dispatchTool("kv_list", {}))).toEqual({ entries: [] });
      expect(invoke).toHaveBeenCalledWith("kv_list");
    });
  });
});

describe("the project chat", () => {
  beforeEach(() => {
    projectTab();
  });

  it("has no document tools", async () => {
    for (const tool of ["document_read", "document_write", "document_replace", "document_outline", "document_insert", "document_undo", "document_redo", "document_get_selection"]) {
      const res = await parse(mod.dispatchTool(tool, { content: "x" }));
      expect(res.error).toContain("not available in the project chat");
    }
  });

  it("file_read invokes IPC and tags the path", async () => {
    vi.mocked(invoke).mockResolvedValue("file content");
    expect(await parse(mod.dispatchTool("file_read", { path: "readme.md" }))).toEqual({ path: "readme.md", content: "file content" });
    expect(invoke).toHaveBeenCalledWith("file_read", { path: "readme.md" });
  });

  it("file_write needs a path and writes directly when approval is off", async () => {
    localStorage.setItem("quikleaf_llm_settings", JSON.stringify({ editApproval: "never" }));
    expect((await parse(mod.dispatchTool("file_write", { content: "data" }))).error).toContain("names its target file");
    vi.mocked(invoke).mockResolvedValue(undefined);
    expect(await parse(mod.dispatchTool("file_write", { path: "test.txt", content: "data" }))).toEqual({ success: true, path: "test.txt" });
    expect(invoke).toHaveBeenCalledWith("file_write", { path: "test.txt", content: "data" });
    expect(invoke).not.toHaveBeenCalledWith("file_read", expect.anything());
  });

  it("file_write with approval shows the card in the project chat's log", async () => {
    localStorage.setItem("quikleaf_llm_settings", JSON.stringify({ editApproval: "files" }));
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "file_read" ? "old" : undefined));
    const p = mod.dispatchTool("file_write", { path: "a.md", content: "new" });
    const s = session.activeSession()!;
    // The card appears once the current contents (for the diff) have been read.
    await new Promise((r) => setTimeout(r, 0));
    const card = s.log.querySelector(".chat-msg.review") as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.querySelector(".review-header")!.textContent).toBe("QD proposes to write a.md");
    (card.querySelector('[id^="review-accept-"]') as HTMLButtonElement).click();
    expect(await parse(p)).toEqual({ success: true, path: "a.md" });
    expect(invoke).toHaveBeenCalledWith("file_write", { path: "a.md", content: "new" });
  });

  it("file_list and file_stat invoke IPC", async () => {
    vi.mocked(invoke).mockResolvedValue({ entries: [{ name: "a.txt", type: "file" }] });
    await mod.dispatchTool("file_list", { path: "", recursive: true });
    expect(invoke).toHaveBeenCalledWith("file_list", { path: null, recursive: true });
    vi.mocked(invoke).mockResolvedValue({ size: 100, type: "file", modified: "2024-01-01" });
    expect(await parse(mod.dispatchTool("file_stat", { path: "test.txt" }))).toEqual({ size: 100, type: "file", modified: "2024-01-01" });
    expect(invoke).toHaveBeenCalledWith("file_stat", { path: "test.txt" });
  });

  it("project_search needs a query and forwards query, path, regex and max_results", async () => {
    expect((await parse(mod.dispatchTool("project_search", {}))).error).toContain("non-empty query");
    expect(invoke).not.toHaveBeenCalledWith("project_search", expect.anything());
    const resp = { matches: [{ path: "a.md", line: 2, text: "hit" }], truncated: false, files_scanned: 3 };
    vi.mocked(invoke).mockResolvedValue(resp);
    expect(await parse(mod.dispatchTool("project_search", { query: "hit", path: "docs", regex: true, max_results: 5 }))).toEqual(resp);
    expect(invoke).toHaveBeenCalledWith("project_search", { query: "hit", path: "docs", regex: true, maxResults: 5 });
    vi.mocked(invoke).mockClear();
    await mod.dispatchTool("project_search", { query: "hit" });
    expect(invoke).toHaveBeenCalledWith("project_search", { query: "hit", path: null, regex: false, maxResults: null });
  });

  it("tabs_list lists only project files, with the active flag", async () => {
    tabs.openTab("docs/guide.md", "# G", { projectRelative: true });
    tabs.openTab("/outside/secret.md", "# S");
    tabs.newUntitledTab();
    const project = session.sessionFor(tabs.PROJECT_TAB_ID);
    const parsed = await parse(mod.dispatchTool("tabs_list", {}, project));
    expect(parsed.tabs).toEqual([{ title: "guide.md", path: "docs/guide.md", dirty: false, active: false }]);
    tabs.setActive("tab-1");
    expect((await parse(mod.dispatchTool("tabs_list", {}, project))).tabs[0].active).toBe(true);
  });

  it("tab_open validates the path and opens through file_read", async () => {
    expect((await parse(mod.dispatchTool("tab_open", {}))).error).toContain("path");
    const project = session.activeSession()!;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "file_read" ? "# Hello" : null));
    const ok = await parse(mod.dispatchTool("tab_open", { path: "notes/hello.md" }, project));
    expect(ok).toEqual({ success: true, title: "hello.md", path: "notes/hello.md" });
    expect(invoke).toHaveBeenCalledWith("file_read", { path: "notes/hello.md" });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "file_read") throw new Error("missing");
      return null;
    });
    expect((await parse(mod.dispatchTool("tab_open", { path: "missing.md" }, project))).error).toContain("Could not open");
  });

  it("memory tools are available", async () => {
    vi.mocked(invoke).mockResolvedValue("shared notes");
    expect(await parse(mod.dispatchTool("memory_read", {}))).toEqual({ content: "shared notes" });
  });

  it("file tools are refused outside project mode even for a project-scoped session", async () => {
    docs.setDocumentsProjectMode(false);
    expect((await parse(mod.dispatchTool("file_read", { path: "x" }))).error).toContain("project mode");
  });
});

describe("handleSlashCommand", () => {
  function lastBody(s = session.activeSession()!): string {
    const all = s.log.querySelectorAll(".chat-msg");
    return (all[all.length - 1] as HTMLElement).querySelector(".chat-body")!.textContent ?? "";
  }

  it("/help returns true, adds a bubble and names the document", () => {
    tabs.openTab("/tmp/a.md", "x");
    expect(mod.handleSlashCommand("/help")).toBe(true);
    expect(lastBody()).toContain("acts on **a.md**");
  });

  it("/clear returns true, clears chat and forgets the plan", async () => {
    tabs.newUntitledTab();
    await mod.dispatchTool("plan_set", { steps: ["a"] });
    const s = session.activeSession()!;
    expect(s.log.querySelector("#plan-card")).not.toBeNull();
    expect(mod.handleSlashCommand("/clear")).toBe(true);
    expect(s.log.querySelector("#plan-card")).toBeNull();
    expect((await parse(mod.dispatchTool("plan_update", { index: 0, status: "done" }))).error).toContain("No plan set");
  });

  it("/model shows, sets and clears this chat's model override", () => {
    tabs.newUntitledTab();
    localStorage.setItem("quikleaf_llm_settings", JSON.stringify({ provider: "openai-compatible", host: "http://localhost:11434", apiKey: "", model: "llama3" }));
    expect(mod.handleSlashCommand("/model")).toBe(true);
    expect(lastBody()).toContain("Currently using **llama3**");
    expect(mod.handleSlashCommand("/model qwen3")).toBe(true);
    expect(session.activeSession()!.model).toBe("qwen3");
    expect(lastBody()).toContain("This chat now uses **qwen3**");
    expect(mod.effectiveSettings(session.activeSession()!).model).toBe("qwen3");
    expect(mod.handleSlashCommand("/model")).toBe(true);
    expect(lastBody()).toContain("override");
    expect(mod.handleSlashCommand("/model default")).toBe(true);
    expect(session.activeSession()!.model).toBeNull();
    expect(lastBody()).toContain("back to the Settings model");
  });

  it("/model reports when nothing is configured", () => {
    tabs.newUntitledTab();
    expect(mod.handleSlashCommand("/model")).toBe(true);
    expect(lastBody()).toContain("No LLM configured");
  });

  it("/memory explains when the chat has no project memory", () => {
    tabs.newUntitledTab();
    expect(mod.handleSlashCommand("/memory")).toBe(true);
    expect(lastBody()).toContain("Open a folder with `--project`");
    docs.setDocumentsProjectMode(true, "/root");
    tabs.openTab("/elsewhere/x.md", "x");
    expect(mod.handleSlashCommand("/memory")).toBe(true);
    expect(lastBody()).toContain("**x.md** is not a project file");
    expect(invoke).not.toHaveBeenCalledWith("memory_read");
  });

  it("/memory reads the scratchpad for a project file", async () => {
    projectFileTab();
    vi.mocked(invoke).mockResolvedValue("remember");
    expect(mod.handleSlashCommand("/memory")).toBe(true);
    await vi.waitFor(() => {
      if (!lastBody().includes("remember")) throw new Error("pending");
    });
    expect(invoke).toHaveBeenCalledWith("memory_read");
  });

  it("/tools describes the document chat's tools and whether memory is on", () => {
    tabs.newUntitledTab();
    expect(mod.handleSlashCommand("/tools")).toBe(true);
    let text = lastBody();
    expect(text).toContain("document chat");
    expect(text).toContain("**Untitled**");
    expect(text).toContain("Document:");
    expect(text).not.toContain("File:");
    expect(text).toContain("not offered here");

    projectFileTab();
    mod.handleSlashCommand("/tools");
    text = lastBody();
    expect(text).toContain("Memory (project scratchpad)");
    expect(text).not.toContain("File:");
  });

  it("/tools describes the project chat's tools", () => {
    projectTab();
    expect(mod.handleSlashCommand("/tools")).toBe(true);
    const text = lastBody();
    expect(text).toContain("project chat");
    expect(text).toContain("File:");
    expect(text).toContain("Tabs:");
    expect(text).not.toContain("Document:");
  });

  it("unknown command returns false; commands are case-insensitive; no chat returns false", () => {
    tabs.newUntitledTab();
    expect(mod.handleSlashCommand("/doesnotexist")).toBe(false);
    expect(mod.handleSlashCommand("/HELP")).toBe(true);
    expect(mod.handleSlashCommand("/Help")).toBe(true);
    tabs.resetTabs();
    expect(mod.handleSlashCommand("/help")).toBe(false);
  });
});

describe("clearChat", () => {
  it("empties the session, drops the plan card and re-greets only when mounted", async () => {
    tabs.newUntitledTab();
    const s = session.activeSession()!;
    await mod.dispatchTool("plan_set", { steps: ["a"] });
    s.transcript.push({ role: "user", text: "hi" });
    s.stats.turns = 1;
    mod.clearChat(s);
    expect(s.transcript).toEqual([]);
    expect(s.plan).toBeNull();
    expect(s.stats.turns).toBe(0);
    // Not mounted in a pane here, so no welcome bubble is added.
    expect(s.log.children.length).toBe(0);
    expect(s.greeted).toBe(false);
  });
});

// Keep bitwrench's id cache honest between files.
afterEach(() => {
  const app = document.getElementById("app");
  if (app) bw.clear(app);
});
