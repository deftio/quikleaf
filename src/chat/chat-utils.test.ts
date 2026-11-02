import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  toAnthropicTool,
  getTools,
  normalizeToolCalls,
  extractToolCallInfo,
  buildToolResultMessages,
  buildAssistantToolCallMessage,
} from "./chat-utils";

const DOC = { scope: "document" as const, title: "notes.md", path: "notes.md", projectRelative: true, memory: true };
const LOOSE_DOC = { scope: "document" as const, title: "Untitled", path: null, projectRelative: false, memory: false };
const PROJECT = { scope: "project" as const, title: "Project", path: null, projectRelative: false, memory: true };

describe("buildSystemPrompt", () => {
  it("binds a document chat to its document and offers only document tools (plus memory for project files)", () => {
    const prompt = buildSystemPrompt(DOC);
    expect(prompt).toContain("bound to one document: **notes.md** (a file in the project)");
    expect(prompt).toContain("only sees notes.md");
    expect(prompt).toContain("document_read");
    expect(prompt).toContain("document_outline");
    expect(prompt).toContain("plan_set");
    expect(prompt).toContain("plan_update");
    expect(prompt).toContain("memory_read");
    expect(prompt).toContain("kv_get");
    expect(prompt).not.toContain("project_search");
    expect(prompt).not.toContain("file_read");
    expect(prompt).not.toContain("tabs_list");
    expect(prompt).not.toContain("File tools");
  });

  it("leaves memory and KV out for a document outside any project", () => {
    const prompt = buildSystemPrompt(LOOSE_DOC);
    expect(prompt).toContain("**Untitled** (an unsaved document)");
    expect(prompt).not.toContain("memory_read");
    expect(prompt).not.toContain("kv_get");
    expect(buildSystemPrompt({ ...LOOSE_DOC, path: "/tmp/x.md" })).toContain("(a file on disk)");
  });

  it("describes the project chat as path-based with file tools and no current document", () => {
    const prompt = buildSystemPrompt(PROJECT);
    expect(prompt).toContain("**project chat**");
    expect(prompt).toContain('no "current document"');
    expect(prompt).toContain("file_read");
    expect(prompt).toContain("file_write");
    expect(prompt).toContain("file_list");
    expect(prompt).toContain("file_stat");
    expect(prompt).toContain("project_search");
    expect(prompt).toContain("tabs_list");
    expect(prompt).toContain("tab_open");
    expect(prompt).toContain("File tools");
    expect(prompt).toContain("memory_read");
    expect(prompt).not.toContain("document_read");
  });

  it("tells the model edits may be reviewed and not to retry a rejected one", () => {
    for (const ctx of [DOC, PROJECT]) {
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain("may be shown to the user for review");
      expect(prompt).toContain('"rejected": true');
      expect(prompt).toMatch(/do not retry/);
    }
  });

  it("always includes the sign-off instruction", () => {
    expect(buildSystemPrompt(DOC)).toContain("Sign off briefly as QD");
    expect(buildSystemPrompt(PROJECT)).toContain("Sign off briefly as QD");
  });
});

describe("toAnthropicTool", () => {
  it("converts OpenAI format to Anthropic format", () => {
    const openai = {
      type: "function",
      function: {
        name: "document_read",
        description: "Read the doc",
        parameters: { type: "object", properties: {}, required: [] },
      },
    };
    const result = toAnthropicTool(openai);
    expect(result).toEqual({
      name: "document_read",
      description: "Read the doc",
      input_schema: { type: "object", properties: {}, required: [] },
    });
  });
});

describe("getTools", () => {
  const names = (tools: any[]) => tools.map((t: any) => t.function?.name ?? t.name);

  it("gives a project-file document chat 18 tools: document, plan, memory and KV", () => {
    const tools = getTools("openai-compatible", { scope: "document", memory: true });
    expect(tools.length).toBe(18);
    const n = names(tools);
    expect(n).toContain("document_outline");
    expect(n).toContain("plan_set");
    expect(n).toContain("plan_update");
    expect(n).toContain("memory_read");
    expect(n).toContain("kv_list");
    expect(n).not.toContain("project_search");
    expect(n).not.toContain("file_read");
    expect(n).not.toContain("tabs_list");
    expect(n).not.toContain("tab_open");
    expect(n).not.toContain("tab_switch");
    expect(tools[0].type).toBe("function");
    expect(tools[0].function.name).toBe("document_read");
  });

  it("gives a document outside the project 10 tools: no memory or KV", () => {
    const tools = getTools("openai-compatible", { scope: "document", memory: false });
    expect(tools.length).toBe(10);
    expect(names(tools)).not.toContain("memory_read");
    expect(names(tools)).not.toContain("kv_get");
  });

  it("gives the project chat 17 tools: files, search, tabs, plan, memory and KV, but no document tools", () => {
    const tools = getTools("openai-compatible", { scope: "project", memory: true });
    expect(tools.length).toBe(17);
    const n = names(tools);
    for (const t of ["file_read", "file_write", "file_list", "file_stat", "project_search", "tabs_list", "tab_open", "plan_set", "memory_read", "kv_set"]) {
      expect(n).toContain(t);
    }
    expect(n).not.toContain("document_read");
    expect(n).not.toContain("document_write");
    const search = tools.find((t: any) => t.function.name === "project_search");
    expect(search.function.parameters.required).toEqual(["query"]);
    expect(Object.keys(search.function.parameters.properties)).toEqual(["query", "path", "regex", "max_results"]);
  });

  it("returns Anthropic-formatted tools", () => {
    const tools = getTools("anthropic", { scope: "document", memory: false });
    expect(tools.length).toBe(10);
    expect(tools[0].name).toBe("document_read");
    expect(tools[0].input_schema).toBeDefined();
    expect(tools[0].function).toBeUndefined();
  });
});

describe("normalizeToolCalls", () => {
  it("returns empty array for empty input", () => {
    expect(normalizeToolCalls([], "openai-compatible")).toEqual([]);
  });

  it("returns empty array for null/undefined input", () => {
    expect(normalizeToolCalls(null as any, "openai-compatible")).toEqual([]);
    expect(normalizeToolCalls(undefined as any, "openai-compatible")).toEqual([]);
  });

  it("filters Anthropic calls by type === 'tool_use'", () => {
    const calls = [
      { type: "tool_use", id: "1", name: "document_read" },
      { type: "text", text: "hello" },
    ];
    const result = normalizeToolCalls(calls, "anthropic");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("document_read");
  });

  it("filters OpenAI calls by function.name presence", () => {
    const calls = [
      { id: "1", function: { name: "kv_get", arguments: '{"key":"a"}' } },
      { id: "2", function: { name: "" } }, // empty name filtered
    ];
    const result = normalizeToolCalls(calls, "openai-compatible");
    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe("kv_get");
  });
});

describe("extractToolCallInfo", () => {
  it("extracts from Anthropic format", () => {
    const tc = { id: "tu_1", name: "document_read", input: { foo: "bar" }, type: "tool_use" };
    const info = extractToolCallInfo(tc, "anthropic");
    expect(info).toEqual({ id: "tu_1", name: "document_read", args: { foo: "bar" } });
  });

  it("extracts from OpenAI format (parses JSON arguments)", () => {
    const tc = { id: "call_1", function: { name: "kv_set", arguments: '{"key":"a","value":"b"}' } };
    const info = extractToolCallInfo(tc, "openai-compatible");
    expect(info.id).toBe("call_1");
    expect(info.name).toBe("kv_set");
    expect(info.args).toEqual({ key: "a", value: "b" });
  });

  it("handles malformed JSON arguments gracefully", () => {
    const tc = { id: "call_2", function: { name: "test", arguments: "{bad json" } };
    const info = extractToolCallInfo(tc, "openai-compatible");
    expect(info.name).toBe("test");
    expect(info.args).toEqual({}); // falls back to empty object
  });

  it("handles object arguments (already parsed)", () => {
    const tc = { id: "call_3", function: { name: "test", arguments: { key: "val" } } };
    const info = extractToolCallInfo(tc, "openai-compatible");
    expect(info.args).toEqual({ key: "val" });
  });
});

describe("buildToolResultMessages", () => {
  const results = [
    { id: "1", content: '{"content":"hello"}' },
    { id: "2", content: '{"success":true}' },
  ];

  it("builds Anthropic format: single user message with JSON array", () => {
    const msgs = buildToolResultMessages(results, "anthropic");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    const parsed = JSON.parse(msgs[0].content as string);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe("tool_result");
    expect(parsed[0].tool_use_id).toBe("1");
  });

  it("builds OpenAI format: array of tool messages", () => {
    const msgs = buildToolResultMessages(results, "openai-compatible");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("tool");
    expect(msgs[0].tool_call_id).toBe("1");
    expect(msgs[1].tool_call_id).toBe("2");
  });
});

describe("buildAssistantToolCallMessage", () => {
  it("builds Anthropic format with text and tool calls", () => {
    const toolCalls = [{ id: "tu_1", name: "doc_read", input: {} }];
    const msg = buildAssistantToolCallMessage(toolCalls, "thinking...", "anthropic");
    expect(msg.role).toBe("assistant");
    const blocks = JSON.parse(msg.content as string);
    expect(blocks[0]).toEqual({ type: "text", text: "thinking..." });
    expect(blocks[1].type).toBe("tool_use");
  });

  it("builds Anthropic format without text", () => {
    const toolCalls = [{ id: "tu_1", name: "doc_read", input: {} }];
    const msg = buildAssistantToolCallMessage(toolCalls, "", "anthropic");
    const blocks = JSON.parse(msg.content as string);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("tool_use");
  });

  it("builds OpenAI format with tool_calls property", () => {
    const toolCalls = [{ id: "call_1", function: { name: "kv_get" } }];
    const msg = buildAssistantToolCallMessage(toolCalls, "here", "openai-compatible");
    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("here");
    expect(msg.tool_calls).toEqual(toolCalls);
  });

  it("builds OpenAI format with null content when empty", () => {
    const toolCalls = [{ id: "call_1", function: { name: "kv_get" } }];
    const msg = buildAssistantToolCallMessage(toolCalls, "", "openai-compatible");
    expect(msg.content).toBeNull();
  });
});
