/**
 * The chat panel's send/stream/tool loop, driven through the mounted panel
 * (`makeChatPanel()` + `initChat()`), with `sendChatStream` replaced by a
 * scripted fake so each test decides what every LLM turn returns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bw from "bitwrench";
import { invoke } from "@tauri-apps/api/core";

vi.mock("./providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./providers")>();
  return { ...actual, sendChatStream: vi.fn() };
});

type ChatUi = typeof import("./chat-ui");
type Providers = typeof import("./providers");

/** One scripted LLM turn. `chunks` are streamed before `done` settles. */
interface Turn {
  chunks?: string[];
  fullText?: string;
  toolCalls?: any[];
  error?: string;
  /** Hold `done` open this long (lets a test press Stop mid-turn). */
  delayMs?: number;
  /** Throw synchronously from sendChatStream instead of returning a handle. */
  throws?: Error;
}

let mod: ChatUi;
let tabs: typeof import("../editor/tabs");
let sessions: typeof import("./session");
let sendChatStream: ReturnType<typeof vi.fn>;
const SETTINGS_KEY = "quikleaf_llm_settings";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function configure(extra: Record<string, unknown> = {}) {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ provider: "openai-compatible", host: "http://localhost:11434", apiKey: "", model: "llama3", ...extra }),
  );
}

function script(turns: Turn[]) {
  const queue = [...turns];
  sendChatStream.mockImplementation((_s: any, _m: any, _t: any, onChunk: (tok: string) => void) => {
    const turn = queue.shift();
    if (!turn) throw new Error("unscripted LLM turn");
    if (turn.throws) throw turn.throws;
    const done = (async () => {
      for (const c of turn.chunks ?? []) onChunk(c);
      if (turn.delayMs) await sleep(turn.delayMs);
      return {
        fullText: turn.fullText ?? (turn.chunks ?? []).join(""),
        toolCalls: turn.toolCalls ?? [],
        error: turn.error,
      };
    })();
    return { done };
  });
}

function openaiCall(id: string, name: string, args: any = {}) {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function input(): HTMLTextAreaElement {
  return document.getElementById("chat-input") as HTMLTextAreaElement;
}
function sendBtn(): HTMLButtonElement {
  return document.getElementById("chat-send") as HTMLButtonElement;
}
function log(): HTMLElement {
  return document.getElementById("chat-messages")!;
}
/** The active chat's own log, mounted inside #chat-messages. */
function chatLog(): HTMLElement {
  return document.querySelector("#chat-messages .chat-log") as HTMLElement;
}
function bubbles(role?: string): HTMLElement[] {
  return Array.from(log().querySelectorAll(role ? `.chat-msg.${role}` : ".chat-msg")) as HTMLElement[];
}
function bodyText(el: HTMLElement): string {
  return el.querySelector(".chat-body")!.textContent ?? "";
}
function lastBody(): string {
  const all = bubbles();
  return bodyText(all[all.length - 1]);
}
function logEntries(kind?: string): any[] {
  return vi
    .mocked(invoke)
    .mock.calls.filter((c) => c[0] === "log_append")
    .map((c) => (c[1] as any).entry)
    .filter((e) => !kind || e.kind === kind);
}

/** Type a message and click Send, then wait for the turn to finish. */
async function sendMessage(text: string) {
  input().value = text;
  sendBtn().click();
  await vi.waitFor(() => {
    if (sendBtn().textContent !== "Send") throw new Error("still sending");
  }, { timeout: 3000, interval: 5 });
}

function pressEnter(shift = false) {
  input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: shift, bubbles: true, cancelable: true }));
}

beforeEach(async () => {
  vi.resetModules();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(null);
  localStorage.clear();

  // The panel owns #chat-messages; drop the bare one test-setup pre-created.
  document.getElementById("chat-messages")?.remove();
  document.getElementById("chat-panel")?.remove();
  document.getElementById("status-timing")?.remove();

  mod = await import("./chat-ui");
  tabs = await import("../editor/tabs");
  sessions = await import("./session");
  const providers = (await import("./providers")) as Providers;
  sendChatStream = vi.mocked(providers.sendChatStream) as any;
  sendChatStream.mockReset();

  // One project-file tab, so the chat has memory/KV tools and a document name.
  tabs.resetTabs();
  sessions.resetSessions();
  tabs.openTab("notes.md", "", { projectRelative: true });

  const app = document.getElementById("app")!;
  bw.append(app, mod.makeChatPanel());
  bw.append(app, { t: "span", a: { id: "status-timing" } });
  mod.initChat();
  // Welcome bubble is not part of what the tests count.
  bw.clear(chatLog());
});

afterEach(() => {
  tabs.resetTabs();
  sessions.resetSessions();
  document.getElementById("chat-panel")?.remove();
  document.getElementById("status-timing")?.remove();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  const fresh = document.createElement("div");
  fresh.id = "chat-messages";
  document.body.appendChild(fresh);
});

describe("makeChatPanel / initChat", () => {
  it("mounts the hidden panel with header, the chat's log, input, send button and resize handle", () => {
    const panel = document.getElementById("chat-panel")!;
    expect(panel.classList.contains("hidden")).toBe(true);
    expect(chatLog().getAttribute("role")).toBe("log");
    expect(chatLog().getAttribute("aria-live")).toBe("polite");
    expect(chatLog().dataset.tabId).toBe(tabs.activeTab()!.id);
    expect(document.getElementById("chat-scope")!.textContent).toBe("Document chat");
    expect(document.getElementById("chat-target")!.textContent).toBe("notes.md");
    expect(document.getElementById("chat-model")!.textContent).toBe("no model");
    expect(input().tagName).toBe("TEXTAREA");
    expect(input().getAttribute("placeholder")).toBe("Ask about notes.md…");
    expect(sendBtn().textContent).toBe("Send");
    const handle = panel.querySelector(".chat-resize-handle") as HTMLElement;
    expect(handle.style.cursor).toBe("ew-resize");
  });

  it("initChat shows the welcome message rendered as markdown", async () => {
    // Re-mount with fresh sessions to observe the welcome bubble this time.
    document.getElementById("chat-panel")!.remove();
    sessions.resetSessions();
    bw.append(document.getElementById("app")!, mod.makeChatPanel());
    mod.initChat();
    const welcome = bubbles("assistant");
    expect(welcome.length).toBe(1);
    expect(welcome[0].querySelector(".chat-body p")!.textContent).toContain("I'm **QD**");
    expect(welcome[0].querySelector(".chat-body p")!.textContent).toContain("**notes.md**");
    expect(welcome[0].querySelector(".chat-meta time")!.textContent).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(document.getElementById("quikdown_css")).not.toBeNull();
  });

  it("switching tabs swaps in that tab's own chat and keeps the other's log and draft", async () => {
    configure();
    const first = tabs.activeTab()!;
    script([{ chunks: ["about notes"] }]);
    await sendMessage("hello notes");
    input().value = "half-typed";
    expect(bubbles().length).toBe(2);

    const second = tabs.openTab("/tmp/other.md", "# Other");
    // New tab: its own (greeted) log, empty input, header renamed.
    expect(chatLog().dataset.tabId).toBe(second.id);
    expect(bubbles("assistant").length).toBe(1);
    expect(lastBody()).toContain("**other.md**");
    expect(bubbles("user").length).toBe(0);
    expect(input().value).toBe("");
    expect(document.getElementById("chat-target")!.textContent).toBe("other.md");
    expect(input().getAttribute("placeholder")).toBe("Ask about other.md…");

    // Back: the first chat's bubbles and draft are intact.
    tabs.setActive(first.id);
    expect(chatLog().dataset.tabId).toBe(first.id);
    expect(bubbles("user").map(bodyText)).toEqual(["hello notes"]);
    expect(input().value).toBe("half-typed");
    expect(sessions.sessionFor(first.id).transcript).toEqual([
      { role: "user", text: "hello notes" },
      { role: "assistant", text: "about notes" },
    ]);
    expect(sessions.sessionFor(first.id).stats).toEqual({ turns: 1, llmCalls: 1, toolCalls: 0 });
  });

  it("editing the document does not disturb the chat draft or the log", () => {
    const tab = tabs.activeTab()!;
    mod.handleSlashCommand("/help");
    input().value = "half a question";
    // Typing in the editor updates the tab (dirty flag) and notifies tab subscribers.
    tabs.updateContent(tab.id, "# changed");
    tabs.updateContent(tab.id, "# changed more");
    expect(input().value).toBe("half a question");
    expect(bubbles().length).toBe(1);
    expect(chatLog().dataset.tabId).toBe(tab.id);
    // A rename (Save As) refreshes the header without touching the input.
    tabs.markSaved(tab.id, "docs/renamed.md", { projectRelative: true });
    expect(document.getElementById("chat-target")!.textContent).toBe("renamed.md");
    expect(input().value).toBe("half a question");
  });

  it("a turn keeps streaming into its own chat after the user switches tabs", async () => {
    configure();
    const first = tabs.activeTab()!;
    script([{ chunks: ["slow reply"], delayMs: 60 }]);
    input().value = "go";
    sendBtn().click();
    expect(sendBtn().textContent).toBe("Stop");

    const second = tabs.openTab("/tmp/other.md", "# Other");
    // The pane now shows the idle second chat.
    expect(sendBtn().textContent).toBe("Send");
    expect(bubbles("user").length).toBe(0);

    await vi.waitFor(() => {
      if (sessions.sessionFor(first.id).sending) throw new Error("still sending");
    }, { timeout: 3000, interval: 5 });
    // The reply landed in the first chat's log, not the visible one.
    expect(bubbles("assistant").filter((b) => bodyText(b) === "slow reply").length).toBe(0);
    const firstLog = sessions.sessionFor(first.id).log;
    expect(Array.from(firstLog.querySelectorAll(".chat-msg.assistant")).map((b) => bodyText(b as HTMLElement))).toEqual(["slow reply"]);
    tabs.setActive(first.id);
    expect(lastBody()).toBe("slow reply");
    expect(sendBtn().textContent).toBe("Send");
    void second;
  });

  it("closing a tab drops its chat; the project chat survives its tab", async () => {
    const first = tabs.activeTab()!;
    const other = tabs.openTab("/tmp/other.md", "# Other");
    expect(sessions.peekSession(other.id)).toBeDefined();
    tabs.closeTab(other.id);
    expect(sessions.peekSession(other.id)).toBeUndefined();
    expect(chatLog().dataset.tabId).toBe(first.id);

    const project = tabs.openProjectTab();
    expect(document.getElementById("chat-scope")!.textContent).toBe("Project chat");
    expect(document.getElementById("chat-panel")!.classList.contains("project-scope")).toBe(true);
    expect(input().getAttribute("placeholder")).toBe("Ask about the project…");
    sessions.sessionFor(project.id).transcript.push({ role: "user", text: "kept" });
    tabs.closeTab(project.id);
    expect(sessions.peekSession(project.id)?.transcript).toEqual([{ role: "user", text: "kept" }]);
  });

  it("restored transcript entries are rendered when the chat is shown", () => {
    const s = sessions.activeSession()!;
    sessions.importChatHistory({ version: 1, tabs: { "notes.md": { transcript: [{ role: "user", text: "old q" }, { role: "assistant", text: "old a" }], model: "qwen3" } }, project: null });
    expect(bubbles().map(bodyText)).toEqual(["old q", "old a"]);
    expect(document.getElementById("chat-model")!.textContent).toBe("qwen3");
    expect(document.getElementById("chat-model")!.classList.contains("override")).toBe(true);
    expect(s.rendered).toBe(2);
  });

  it("the info pane's clear request empties the visible chat and greets again", async () => {
    mod.handleSlashCommand("/help");
    expect(bubbles().length).toBe(1);
    bw.pub(sessions.CHAT_CLEAR, { tabId: tabs.activeTab()!.id });
    expect(bubbles().length).toBe(1);
    expect(lastBody()).toContain("I'm **QD**");
  });
});

describe("send()", () => {
  it("does nothing for empty input", async () => {
    configure();
    input().value = "   ";
    sendBtn().click();
    await sleep(5);
    expect(sendChatStream).not.toHaveBeenCalled();
    expect(bubbles().length).toBe(0);
  });

  it("explains when no LLM is configured and does not call the provider", async () => {
    input().value = "hello";
    sendBtn().click();
    await sleep(5);
    expect(sendChatStream).not.toHaveBeenCalled();
    expect(bubbles().length).toBe(1);
    expect(lastBody()).toContain("No LLM configured");
    expect(input().value).toBe("hello");
  });

  it("streams a plain reply: user bubble, live assistant bubble, timing meta and logs", async () => {
    configure();
    script([{ chunks: ["Hel", "lo ", "there"], delayMs: 70 }]);

    input().value = "hi there";
    sendBtn().click();
    // Synchronous part of send(): button flips to Stop, input cleared.
    expect(sendBtn().textContent).toBe("Stop");
    expect(sendBtn().classList.contains("stop-mode")).toBe(true);
    expect(sendBtn().disabled).toBe(false);
    expect(input().value).toBe("");

    const streaming = bubbles("assistant")[0];
    expect(streaming.classList.contains("streaming")).toBe(true);
    // First chunk renders immediately on bubble creation.
    expect(bodyText(streaming)).toBe("Hel");
    // The 50 ms render timer flushes the accumulated text while still streaming.
    await vi.waitFor(() => {
      if (bodyText(streaming) !== "Hello there") throw new Error("not flushed yet");
    }, { timeout: 1000, interval: 5 });
    expect(streaming.classList.contains("streaming")).toBe(true);

    await vi.waitFor(() => {
      if (sendBtn().textContent !== "Send") throw new Error("still sending");
    }, { timeout: 3000, interval: 5 });

    expect(sendBtn().classList.contains("stop-mode")).toBe(false);
    const [user, assistant] = bubbles();
    expect(user.classList.contains("user")).toBe(true);
    expect(bodyText(user)).toBe("hi there");
    expect(assistant.classList.contains("streaming")).toBe(false);
    expect(assistant.querySelector(".chat-body p")!.textContent).toBe("Hello there");
    const timing = assistant.querySelector(".chat-timing")!.textContent!;
    expect(timing).toMatch(/first token/);
    expect(timing).toMatch(/≈3 tok/);
    expect(document.getElementById("status-timing")!.textContent).toBe(`last: ${timing}`);

    // Provider got the system prompt first and the user turn last.
    const [settings, toSend, tools] = sendChatStream.mock.calls[0];
    expect(settings.model).toBe("llama3");
    expect(toSend[0].role).toBe("system");
    expect(toSend[toSend.length - 1]).toEqual({ role: "user", content: "hi there" });
    expect(Array.isArray(tools)).toBe(true);

    const llm = logEntries("llm");
    expect(llm.length).toBe(1);
    expect(llm[0]).toMatchObject({ provider: "openai-compatible", model: "llama3", chars: 11, est_tokens: 3, tool_calls: 0 });
    expect(llm[0].ttft_ms).toEqual(expect.any(Number));
    const turn = logEntries("turn");
    expect(turn).toEqual([expect.objectContaining({ llm_calls: 1, tool_calls: 0, aborted: false })]);
  });

  it("keeps history across sends so the second request carries the first exchange", async () => {
    configure();
    script([{ chunks: ["one"] }, { chunks: ["two"] }]);
    await sendMessage("first");
    await sendMessage("second");
    const toSend = sendChatStream.mock.calls[1][1];
    expect(toSend.map((m: any) => [m.role, m.content])).toEqual([
      ["system", expect.any(String)],
      ["user", "first"],
      ["assistant", "one"],
      ["user", "second"],
    ]);
  });

  it("shows '(empty response)' when nothing streamed and the result is empty", async () => {
    configure();
    script([{ fullText: "" }]);
    await sendMessage("hello");
    expect(lastBody()).toBe("(empty response)");
    expect(bubbles("assistant")[0].querySelector(".chat-timing")).toBeNull();
  });

  it("renders a provider error into the live bubble", async () => {
    configure();
    script([{ chunks: ["partial"], error: "HTTP 500" }]);
    await sendMessage("hello");
    expect(bubbles("assistant").length).toBe(1);
    expect(lastBody()).toBe("Error: HTTP 500");
    expect(logEntries("llm")[0].error).toBe("HTTP 500");
  });

  it("renders a provider error as a new bubble when nothing streamed", async () => {
    configure();
    script([{ error: "connection refused" }]);
    await sendMessage("hello");
    expect(lastBody()).toBe("Error: connection refused");
    // Error is remembered in history.
    script([{ chunks: ["ok"] }]);
    await sendMessage("again");
    const toSend = sendChatStream.mock.calls[1][1];
    expect(toSend.some((m: any) => m.role === "assistant" && m.content === "Error: connection refused")).toBe(true);
  });

  it("catches a throwing provider and resets the send state", async () => {
    configure();
    script([{ throws: new Error("kaboom") }]);
    await sendMessage("hello");
    expect(lastBody()).toBe("Error: kaboom");
    expect(sendBtn().textContent).toBe("Send");
    expect(sendBtn().disabled).toBe(false);
    expect(logEntries("turn")[0]).toMatchObject({ llm_calls: 0, tool_calls: 0 });
  });

  it("ignores a second submit while a send is in flight", async () => {
    configure();
    script([{ chunks: ["slow"], delayMs: 40 }]);
    input().value = "first";
    pressEnter();
    expect(sendBtn().textContent).toBe("Stop");
    input().value = "second";
    pressEnter();
    await vi.waitFor(() => {
      if (sendBtn().textContent !== "Send") throw new Error("still sending");
    }, { timeout: 3000, interval: 5 });
    expect(sendChatStream).toHaveBeenCalledTimes(1);
    expect(bubbles("user").length).toBe(1);
  });
});

describe("document_replace against a live editor", () => {
  async function editorWith(md: string) {
    const editor = await import("../editor/editor");
    const host = document.createElement("div");
    document.getElementById("app")!.appendChild(host);
    const inst = editor.initEditor(host);
    inst.getMarkdown.mockReturnValue(md);
    return inst;
  }

  it("replaces the first occurrence only by default", async () => {
    const inst = await editorWith("a b a");
    const result = await mod.dispatchTool("document_replace", { search: "a", replace: "c" });
    expect(JSON.parse(result)).toEqual({ count: 1, document: "notes.md" });
    expect(inst.setMarkdown).toHaveBeenCalledWith("c b a");
  });

  it("replaces every occurrence with all: true and reports the count", async () => {
    const inst = await editorWith("a b a");
    const result = await mod.dispatchTool("document_replace", { search: "a", replace: "c", all: true });
    expect(JSON.parse(result)).toEqual({ count: 2, document: "notes.md" });
    expect(inst.setMarkdown).toHaveBeenCalledWith("c b c");
  });

  it("does not write when nothing matches", async () => {
    const inst = await editorWith("a b a");
    const result = await mod.dispatchTool("document_replace", { search: "zzz", replace: "c", all: true });
    expect(JSON.parse(result)).toEqual({ count: 0, document: "notes.md" });
    expect(inst.setMarkdown).not.toHaveBeenCalled();
  });
});

describe("tool round-trips", () => {
  it("runs a tool, shows the tool bubble with timing, feeds the result back and finishes", async () => {
    configure();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "memory_read" ? "notes here" : null));
    script([
      { toolCalls: [openaiCall("call_1", "memory_read")] },
      { chunks: ["Your notes say: notes here"] },
    ]);
    await sendMessage("what's in memory?");

    const tool = bubbles("tool");
    expect(tool.length).toBe(1);
    expect(bodyText(tool[0])).toBe('memory_read() → {"content":"notes here"}');
    expect(tool[0].querySelector(".chat-timing")!.textContent).toMatch(/^\d+ms$/);
    expect(lastBody()).toBe("Your notes say: notes here");

    // Second request carries the assistant tool_call message and the tool result.
    const second = sendChatStream.mock.calls[1][1];
    const asst = second.find((m: any) => m.role === "assistant" && m.tool_calls);
    expect(asst.tool_calls[0].function.name).toBe("memory_read");
    const toolMsg = second.find((m: any) => m.role === "tool");
    expect(toolMsg).toMatchObject({ tool_call_id: "call_1", content: '{"content":"notes here"}' });

    expect(logEntries("tool")).toEqual([expect.objectContaining({ name: "memory_read", ok: true })]);
    expect(logEntries("turn")[0]).toMatchObject({ llm_calls: 2, tool_calls: 1, aborted: false });
    expect(logEntries("llm")[0].tool_calls).toBe(1);
  });

  it("truncates long tool results in the bubble and flags error results in the log", async () => {
    configure();
    const long = "x".repeat(500);
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "memory_read") return long;
      if (cmd === "kv_get") return null;
      return null;
    });
    script([
      { toolCalls: [openaiCall("a", "memory_read"), openaiCall("b", "kv_get", { key: "nope" })] },
      { chunks: ["done"] },
    ]);
    await sendMessage("go");
    const [t1, t2] = bubbles("tool");
    const text1 = bodyText(t1);
    expect(text1.endsWith("...")).toBe(true);
    expect(text1.length).toBe("memory_read() → ".length + 203);
    expect(bodyText(t2)).toBe('kv_get() → {"error":"Key not found"}');
    const tools = logEntries("tool");
    expect(tools[0]).toMatchObject({ name: "memory_read", ok: true });
    expect(tools[1]).toMatchObject({ name: "kv_get", ok: false });
    expect(logEntries("turn")[0].tool_calls).toBe(2);
  });

  it("turns a throwing tool into an error result instead of aborting the loop", async () => {
    configure();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "memory_write") throw new Error("disk full");
      return null;
    });
    script([{ toolCalls: [openaiCall("w", "memory_write", { content: "x" })] }, { chunks: ["sorry"] }]);
    await sendMessage("save it");
    expect(bodyText(bubbles("tool")[0])).toBe('memory_write() → {"error":"disk full"}');
    expect(logEntries("tool")[0]).toMatchObject({ name: "memory_write", ok: false });
    expect(lastBody()).toBe("sorry");
  });

  it("keeps streamed text that accompanies a tool call and records it in history", async () => {
    configure();
    script([
      { chunks: ["Let me look."], toolCalls: [openaiCall("1", "document_read")] },
      { chunks: ["Still looking."], toolCalls: [openaiCall("2", "document_read")] },
      { chunks: ["Empty doc."] },
    ]);
    await sendMessage("read it");
    const asst = bubbles("assistant").map(bodyText);
    expect(asst).toEqual(["Let me look.", "Still looking.", "Empty doc."]);
    const final = sendChatStream.mock.calls[2][1].map((m: any) => m.content);
    expect(sendChatStream.mock.calls[0][1][0].content).toContain("bound to one document: **notes.md**");
    expect(final).toContain("Let me look.");
    expect(final).toContain("Still looking.");
    expect(bubbles("tool").length).toBe(2);
  });

  it("removes a streaming bubble whose final text is empty when tools follow", async () => {
    configure();
    script([
      { chunks: ["  "], fullText: "", toolCalls: [openaiCall("1", "document_read")] },
      { chunks: [" "], fullText: "", toolCalls: [openaiCall("2", "document_read")] },
      { chunks: ["Done"] },
    ]);
    await sendMessage("go");
    expect(bubbles("assistant").map(bodyText)).toEqual(["Done"]);
    expect(bubbles("tool").length).toBe(2);
  });

  it("stops after ten loop iterations when the model keeps asking for tools", async () => {
    configure();
    const toolTurn = () => ({ toolCalls: [openaiCall("x", "document_read")] });
    script([toolTurn(), ...Array.from({ length: 10 }, toolTurn)]);
    await sendMessage("loop forever");
    expect(sendChatStream).toHaveBeenCalledTimes(11);
    expect(bubbles("tool").length).toBe(11);
    expect(lastBody()).toBe("(Tool loop reached maximum iterations)");
    expect(logEntries("turn")[0]).toMatchObject({ llm_calls: 11, tool_calls: 11, aborted: false });
  });

  it("surfaces a provider error inside the loop", async () => {
    configure();
    script([{ toolCalls: [openaiCall("1", "document_read")] }, { chunks: ["partial"], error: "rate limited" }]);
    await sendMessage("go");
    expect(lastBody()).toBe("Error: rate limited");
    expect(bubbles("assistant").length).toBe(1);
  });

  it("catches a throwing provider inside the loop", async () => {
    configure();
    script([{ toolCalls: [openaiCall("1", "document_read")] }, { throws: new Error("socket closed") }]);
    await sendMessage("go");
    expect(lastBody()).toBe("Error: socket closed");
    expect(sendBtn().textContent).toBe("Send");
  });

  it("uses Anthropic-shaped tool calls when that provider is configured", async () => {
    configure({ provider: "anthropic", host: "https://api.anthropic.com", apiKey: "sk", model: "claude-sonnet-5" });
    script([
      { toolCalls: [{ type: "tool_use", id: "tu_1", name: "document_read", input: {} }] },
      { chunks: ["The document is empty."] },
    ]);
    await sendMessage("read");
    expect(bodyText(bubbles("tool")[0])).toBe('document_read() → {"document":"notes.md","content":""}');
    const second = sendChatStream.mock.calls[1][1];
    const toolResult = second[second.length - 1];
    expect(toolResult.role).toBe("user");
    expect(toolResult.content).toContain("tu_1");
    expect(lastBody()).toBe("The document is empty.");
  });
});

describe("Stop", () => {
  it("clicking Stop mid-turn shows 'Stopping...' and halts before the next LLM call", async () => {
    configure();
    script([{ toolCalls: [openaiCall("1", "document_read")], delayMs: 40 }, { chunks: ["never"] }]);
    input().value = "go";
    sendBtn().click();
    expect(sendBtn().textContent).toBe("Stop");
    sendBtn().click();
    expect(sendBtn().textContent).toBe("Stopping...");
    expect(sendBtn().disabled).toBe(true);
    expect(sendBtn().classList.contains("stop-mode")).toBe(true);

    await vi.waitFor(() => {
      if (sendBtn().textContent !== "Send") throw new Error("still sending");
    }, { timeout: 3000, interval: 5 });

    // The first turn's tool still ran, but no second LLM call was made.
    expect(sendChatStream).toHaveBeenCalledTimes(1);
    expect(bubbles("tool").length).toBe(1);
    expect(lastBody()).toBe("(Stopped by user)");
    expect(sendBtn().disabled).toBe(false);
    expect(sendBtn().classList.contains("stop-mode")).toBe(false);
    expect(logEntries("turn")[0]).toMatchObject({ aborted: true, llm_calls: 1, tool_calls: 1 });
  });

  it("stopping during a later turn skips its remaining tools", async () => {
    configure();
    script([
      { toolCalls: [openaiCall("1", "document_read")] },
      { toolCalls: [openaiCall("2", "document_read"), openaiCall("3", "document_read")], delayMs: 40 },
      { chunks: ["never"] },
    ]);
    input().value = "go";
    sendBtn().click();
    await vi.waitFor(() => {
      if (sendChatStream.mock.calls.length < 2) throw new Error("second turn not started");
    }, { timeout: 2000, interval: 5 });
    sendBtn().click();
    expect(sendBtn().textContent).toBe("Stopping...");

    await vi.waitFor(() => {
      if (sendBtn().textContent !== "Send") throw new Error("still sending");
    }, { timeout: 3000, interval: 5 });

    expect(sendChatStream).toHaveBeenCalledTimes(2);
    // Only the first turn's tool ran; both of the second turn's were skipped.
    expect(bubbles("tool").length).toBe(1);
    expect(lastBody()).toBe("(Stopped by user)");
    expect(logEntries("turn")[0]).toMatchObject({ aborted: true, llm_calls: 2, tool_calls: 1 });
  });
});

describe("input handling", () => {
  it("Enter submits, Shift+Enter does not", async () => {
    configure();
    script([{ chunks: ["yo"] }]);
    input().value = "hello";
    pressEnter(true);
    await sleep(5);
    expect(sendChatStream).not.toHaveBeenCalled();
    expect(input().value).toBe("hello");

    const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input().dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      if (sendBtn().textContent !== "Send" || !sendChatStream.mock.calls.length) throw new Error("pending");
    }, { timeout: 3000, interval: 5 });
    expect(bubbles("user").map(bodyText)).toEqual(["hello"]);
  });

  it("unknown slash commands get a hint and clear the input without calling the LLM", async () => {
    configure();
    input().value = "/bogus";
    sendBtn().click();
    expect(input().value).toBe("");
    expect(sendChatStream).not.toHaveBeenCalled();
    expect(lastBody()).toContain("Unknown command: `/bogus`");
  });

  it("known slash commands are handled through the send button", () => {
    configure();
    input().value = "/model";
    sendBtn().click();
    expect(lastBody()).toContain("Currently using **llama3** via http://localhost:11434");
  });

  it("/clear empties the log and shows the welcome again", () => {
    mod.handleSlashCommand("/help");
    expect(bubbles().length).toBe(1);
    expect(mod.handleSlashCommand("/clear")).toBe(true);
    expect(bubbles().length).toBe(1);
    expect(lastBody()).toContain("I'm **QD**");
  });

  it("/model reports when nothing is configured", () => {
    mod.handleSlashCommand("/model");
    expect(lastBody()).toContain("No LLM configured");
  });
});

describe("/memory", () => {
  it("shows scratchpad contents", async () => {
    vi.mocked(invoke).mockResolvedValue("remember this");
    mod.handleSlashCommand("/memory");
    await vi.waitFor(() => {
      if (!bubbles().length) throw new Error("pending");
    });
    expect(lastBody()).toContain("**Scratchpad contents:**");
    expect(lastBody()).toContain("remember this");
  });

  it("reports an empty scratchpad", async () => {
    vi.mocked(invoke).mockResolvedValue("");
    mod.handleSlashCommand("/memory");
    await vi.waitFor(() => {
      if (!bubbles().length) throw new Error("pending");
    });
    expect(lastBody()).toBe("Scratchpad is empty.");
  });

  it("reports a failed read", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no backend"));
    mod.handleSlashCommand("/memory");
    await vi.waitFor(() => {
      if (!bubbles().length) throw new Error("pending");
    });
    expect(lastBody()).toBe("Failed to read scratchpad.");
  });
});

describe("/log", () => {
  it("shows the log path, on/off state and recent entries", async () => {
    configure({ perfLog: true });
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "log_get_path") return "/tmp/quikleaf-perf.jsonl";
      if (cmd === "log_tail") {
        expect(args).toEqual({ n: 10 });
        return [
          { kind: "llm", ts: "2026-10-31T10:20:30.000Z", model: "llama3", total_ms: 1200, ttft_ms: 300, tok_per_s: 42 },
          { kind: "tool", ts: "2026-10-31T10:20:31.000Z", name: "document_read", ms: 3, ok: false },
        ];
      }
      return null;
    });
    expect(mod.handleSlashCommand("/log")).toBe(true);
    await vi.waitFor(() => {
      if (!bubbles().length) throw new Error("pending");
    });
    const text = lastBody();
    expect(text).toContain("**Performance log** is **on**");
    expect(text).toContain("File: `/tmp/quikleaf-perf.jsonl`");
    expect(text).toContain("    10:20:30 llm llama3 · 1.20s · ttft 300ms · 42 tok/s");
    expect(text).toContain("    10:20:31 tool document_read 3ms (error)");
  });

  it("handles '/log extra' with no entries and an unavailable path when logging is off", async () => {
    configure({ perfLog: false });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "log_get_path") throw new Error("nope");
      if (cmd === "log_tail") return "not-an-array";
      return null;
    });
    expect(mod.handleSlashCommand("/log please")).toBe(true);
    await vi.waitFor(() => {
      if (!bubbles().length) throw new Error("pending");
    });
    const text = lastBody();
    expect(text).toContain("is **off**");
    expect(text).toContain("File: `unavailable`");
    expect(text).toContain("(no entries yet)");
  });
});

describe("resize handle", () => {
  function handle(): HTMLElement {
    return document.querySelector("#chat-panel .chat-resize-handle") as HTMLElement;
  }
  function mouse(type: string, clientX: number, target: EventTarget = document) {
    target.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true }));
  }

  it("mousedown starts a drag: cursor, user-select and dragging class", () => {
    mouse("mousedown", 100, handle());
    expect(document.body.style.cursor).toBe("ew-resize");
    expect(document.body.style.userSelect).toBe("none");
    expect(handle().classList.contains("dragging")).toBe(true);
  });

  it("mousemove resizes the panel clamped to [300, 600] and mouseup ends the drag", () => {
    const panel = document.getElementById("chat-panel")!;
    // happy-dom reports offsetWidth 0, so width = clamp(0 + dx).
    mouse("mousedown", 100, handle());
    mouse("mousemove", 150);
    expect(panel.style.width).toBe("300px");
    mouse("mousemove", 550);
    expect(panel.style.width).toBe("450px");
    mouse("mousemove", 2000);
    expect(panel.style.width).toBe("600px");

    mouse("mouseup", 2000);
    expect(handle().classList.contains("dragging")).toBe(false);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    // No drag in progress: moves are ignored, another mouseup is harmless.
    mouse("mousemove", 100);
    expect(panel.style.width).toBe("600px");
    expect(() => mouse("mouseup", 100)).not.toThrow();
  });

  it("with the drawer on the right, dragging left grows the panel and dragging right shrinks it", () => {
    const panel = document.getElementById("chat-panel")!;
    const body = document.createElement("div");
    body.id = "tab-body";
    body.className = "chat-right";
    document.getElementById("app")!.appendChild(body);
    try {
      mouse("mousedown", 500, handle());
      mouse("mousemove", 100); // 400px toward the left: width = clamp(0 + 400)
      expect(panel.style.width).toBe("400px");
      mouse("mousemove", 450); // back toward the editor: clamp(0 + 50) = min
      expect(panel.style.width).toBe("300px");
      mouse("mouseup", 450);
    } finally {
      body.remove();
    }
  });

  it("ignores mousedown and mousemove when the panel is not in the document", () => {
    const app = document.getElementById("app")!;
    const panel = document.getElementById("chat-panel")!;
    const h = handle();
    // Detached panel: the handle still receives the event but el("chat-panel") is null.
    panel.remove();
    mouse("mousedown", 100, h);
    expect(document.body.style.cursor).toBe("");
    expect(h.classList.contains("dragging")).toBe(false);

    // Start a real drag, then detach the panel before moving.
    app.appendChild(panel);
    mouse("mousedown", 100, h);
    expect(h.classList.contains("dragging")).toBe(true);
    panel.remove();
    mouse("mousemove", 500);
    expect(panel.style.width).toBe("");
    app.appendChild(panel);
    mouse("mouseup", 500);
    expect(h.classList.contains("dragging")).toBe(false);
  });
});
