import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildChatUrl,
  buildModelsUrl,
  buildRequestBody,
  parseResponse,
  sendChat,
  sendChatStream,
  listModels,
  ANTHROPIC_MAX_TOKENS,
  ANTHROPIC_MAX_TOKENS_STREAMING,
} from "./providers";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LLMSettings } from "../settings/settings";

describe("buildChatUrl", () => {
  it("appends /v1/chat/completions to bare host", () => {
    expect(buildChatUrl("http://localhost:11434", "openai-compatible"))
      .toBe("http://localhost:11434/v1/chat/completions");
  });

  it("strips trailing slash before appending", () => {
    expect(buildChatUrl("http://localhost:11434/", "openai-compatible"))
      .toBe("http://localhost:11434/v1/chat/completions");
  });

  it("does not duplicate /v1", () => {
    expect(buildChatUrl("http://localhost:11434/v1", "openai-compatible"))
      .toBe("http://localhost:11434/v1/chat/completions");
  });

  it("handles trailing slash on /v1/", () => {
    expect(buildChatUrl("http://localhost:11434/v1/", "openai-compatible"))
      .toBe("http://localhost:11434/v1/chat/completions");
  });

  it("preserves path prefix like /api/v1", () => {
    expect(buildChatUrl("https://openrouter.ai/api/v1", "openai-compatible"))
      .toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("returns already-complete URL unchanged", () => {
    expect(buildChatUrl("http://host/v1/chat/completions", "openai-compatible"))
      .toBe("http://host/v1/chat/completions");
  });

  it("builds Anthropic URL with /v1/messages", () => {
    expect(buildChatUrl("https://api.anthropic.com", "anthropic"))
      .toBe("https://api.anthropic.com/v1/messages");
  });

  it("does not duplicate /messages for Anthropic", () => {
    expect(buildChatUrl("https://api.anthropic.com/v1/messages", "anthropic"))
      .toBe("https://api.anthropic.com/v1/messages");
  });
});

describe("buildModelsUrl", () => {
  it("appends /v1/models to bare host", () => {
    expect(buildModelsUrl("http://localhost:11434"))
      .toBe("http://localhost:11434/v1/models");
  });

  it("does not duplicate /v1", () => {
    expect(buildModelsUrl("http://localhost:11434/v1"))
      .toBe("http://localhost:11434/v1/models");
  });

  it("strips trailing slash", () => {
    expect(buildModelsUrl("http://localhost:1234/"))
      .toBe("http://localhost:1234/v1/models");
  });
});

describe("buildRequestBody", () => {
  const settings: LLMSettings = {
    provider: "openai-compatible",
    host: "http://localhost:11434",
    apiKey: "",
    model: "llama3",
    showToolCalls: false,
  };

  it("builds OpenAI format without tools", () => {
    const messages = [{ role: "user" as const, content: "hello" }];
    const body = buildRequestBody(settings, messages);
    expect(body.model).toBe("llama3");
    expect(body.messages).toEqual(messages);
    expect(body.tools).toBeUndefined();
    expect(body.stream).toBeUndefined();
  });

  it("builds OpenAI format with tools and stream", () => {
    const messages = [{ role: "user" as const, content: "hello" }];
    const tools = [{ type: "function", function: { name: "test" } }];
    const body = buildRequestBody(settings, messages, tools, true);
    expect(body.tools).toEqual(tools);
    expect(body.stream).toBe(true);
  });

  it("builds Anthropic format with system extracted", () => {
    const anthropicSettings: LLMSettings = {
      ...settings,
      provider: "anthropic",
      model: "claude-opus-5",
    };
    const messages = [
      { role: "system" as const, content: "You are helpful." },
      { role: "user" as const, content: "hello" },
    ];
    const body = buildRequestBody(anthropicSettings, messages);
    expect(body.system).toBe("You are helpful.");
    expect(body.max_tokens).toBe(ANTHROPIC_MAX_TOKENS);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
  });

  it("Anthropic: streaming requests get the larger max_tokens ceiling", () => {
    const anthropicSettings: LLMSettings = {
      ...settings,
      provider: "anthropic",
      model: "claude-opus-5",
    };
    const messages = [{ role: "user" as const, content: "hello" }];
    const streamed = buildRequestBody(anthropicSettings, messages, undefined, true);
    expect(streamed.max_tokens).toBe(ANTHROPIC_MAX_TOKENS_STREAMING);
    expect(ANTHROPIC_MAX_TOKENS_STREAMING).toBeGreaterThan(ANTHROPIC_MAX_TOKENS);
  });

  it("Anthropic: parses JSON-stringified content blocks", () => {
    const anthropicSettings: LLMSettings = {
      ...settings,
      provider: "anthropic",
      model: "claude-opus-5",
    };
    const messages = [
      { role: "user" as const, content: JSON.stringify([{ type: "tool_result", content: "ok" }]) },
    ];
    const body = buildRequestBody(anthropicSettings, messages);
    expect(Array.isArray(body.messages[0].content)).toBe(true);
  });

  it("Anthropic: leaves non-JSON content as string", () => {
    const anthropicSettings: LLMSettings = {
      ...settings,
      provider: "anthropic",
      model: "claude-opus-5",
    };
    const messages = [{ role: "user" as const, content: "just text" }];
    const body = buildRequestBody(anthropicSettings, messages);
    expect(body.messages[0].content).toBe("just text");
  });
});

describe("parseResponse", () => {
  it("returns error message for status >= 400", () => {
    const result = parseResponse("openai-compatible", 401, { error: { message: "Unauthorized" } });
    expect(result.error).toBe("Unauthorized");
    expect(result.message.content).toContain("Error (401)");
  });

  it("handles string error in body", () => {
    const result = parseResponse("openai-compatible", 500, { error: "Server error" });
    expect(result.error).toBe("Server error");
  });

  it("parses Anthropic text content", () => {
    const body = {
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "World" },
      ],
    };
    const result = parseResponse("anthropic", 200, body);
    expect(result.message.content).toBe("Hello World");
    expect(result.error).toBeUndefined();
  });

  it("parses Anthropic tool_use content", () => {
    const body = {
      content: [
        { type: "text", text: "Let me read" },
        { type: "tool_use", id: "tu_1", name: "document_read", input: {} },
      ],
    };
    const result = parseResponse("anthropic", 200, body);
    expect(result.message.tool_calls).toHaveLength(1);
    expect(result.message.tool_calls![0].type).toBe("tool_use");
  });

  it("parses OpenAI choice", () => {
    const body = {
      choices: [{ message: { role: "assistant", content: "Hi!" } }],
    };
    const result = parseResponse("openai-compatible", 200, body);
    expect(result.message.content).toBe("Hi!");
  });

  it("handles empty OpenAI response", () => {
    const result = parseResponse("openai-compatible", 200, { choices: [] });
    expect(result.message.content).toBe("No response from model.");
    expect(result.error).toBe("Empty response");
  });

  it("handles null body", () => {
    const result = parseResponse("openai-compatible", 200, null);
    expect(result.error).toBe("Empty response");
  });
});

describe("sendChat", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("invokes llm_chat with correct args for OpenAI", async () => {
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      body: { choices: [{ message: { role: "assistant", content: "reply" } }] },
    });

    const settings: LLMSettings = {
      provider: "openai-compatible",
      host: "http://localhost:11434",
      apiKey: "test-key",
      model: "llama3",
      showToolCalls: false,
    };
    const messages = [{ role: "user" as const, content: "hello" }];
    const result = await sendChat(settings, messages);

    expect(invoke).toHaveBeenCalledWith("llm_chat", {
      request: {
        url: "http://localhost:11434/v1/chat/completions",
        apiKey: "test-key",
        body: expect.objectContaining({ model: "llama3" }),
        provider: "openai-compatible",
      },
    });
    expect(result.message.content).toBe("reply");
  });
});

describe("listModels", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("returns hardcoded list for Anthropic", async () => {
    const settings: LLMSettings = {
      provider: "anthropic",
      host: "https://api.anthropic.com",
      apiKey: "sk-test",
      model: "",
      showToolCalls: false,
    };
    const models = await listModels(settings);
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("claude-opus-5");
  });

  it("throws for Anthropic without API key", async () => {
    const settings: LLMSettings = {
      provider: "anthropic",
      host: "https://api.anthropic.com",
      apiKey: "",
      model: "",
      showToolCalls: false,
    };
    await expect(listModels(settings)).rejects.toThrow("API key");
  });

  it("invokes llm_list_models for OpenAI-compatible", async () => {
    vi.mocked(invoke).mockResolvedValue({
      data: [{ id: "model-a" }, { id: "model-b" }],
    });

    const settings: LLMSettings = {
      provider: "openai-compatible",
      host: "http://localhost:11434",
      apiKey: "",
      model: "",
      showToolCalls: false,
    };
    const models = await listModels(settings);
    expect(models).toEqual(["model-a", "model-b"]);
    expect(invoke).toHaveBeenCalledWith("llm_list_models", {
      url: "http://localhost:11434/v1/models",
      apiKey: "",
    });
  });
});

describe("sendChatStream", () => {
  type Handler = (event: { payload: any }) => void;
  let handlers: Record<string, Handler>;
  let unlisten: ReturnType<typeof vi.fn<() => void>>;

  const settings: LLMSettings = {
    provider: "openai-compatible",
    host: "http://localhost:11434",
    apiKey: "sk-test",
    model: "llama3",
    showToolCalls: false,
  };
  const messages = [{ role: "user" as const, content: "hi" }];

  /** Let the async promise executor register both listeners and call invoke. */
  const settle = () => new Promise<void>((r) => setTimeout(r, 0));

  beforeEach(() => {
    handlers = {};
    unlisten = vi.fn<() => void>();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(null);
    vi.mocked(listen).mockReset();
    vi.mocked(listen).mockImplementation(async (name: string, cb: any) => {
      handlers[name] = cb;
      return unlisten;
    });
  });

  it("registers listeners, invokes llm_chat_stream with a streaming body, and forwards tokens", async () => {
    const onChunk = vi.fn();
    const handle = sendChatStream(settings, messages, [{ type: "function", function: { name: "t" } }], onChunk);
    await settle();

    expect(listen).toHaveBeenCalledWith("llm-chunk", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("llm-done", expect.any(Function));
    expect(invoke).toHaveBeenCalledWith("llm_chat_stream", {
      request: {
        url: "http://localhost:11434/v1/chat/completions",
        apiKey: "sk-test",
        body: expect.objectContaining({ model: "llama3", stream: true, tools: expect.any(Array) }),
        provider: "openai-compatible",
      },
    });

    handlers["llm-chunk"]({ payload: { token: "Hel" } });
    handlers["llm-chunk"]({ payload: { token: "lo" } });
    expect(onChunk).toHaveBeenNthCalledWith(1, "Hel");
    expect(onChunk).toHaveBeenNthCalledWith(2, "lo");

    handlers["llm-done"]({ payload: { full_text: "Hello", tool_calls: null, error: null } });
    const result = await handle.done;
    expect(result).toEqual({ fullText: "Hello", toolCalls: [], error: undefined });
    // Both listeners are torn down once the stream finishes.
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it("passes tool_calls through when the done payload carries an array", async () => {
    const handle = sendChatStream(settings, messages, undefined, vi.fn());
    await settle();
    const calls = [{ id: "c1", type: "function", function: { name: "document_read", arguments: "{}" } }];
    handlers["llm-done"]({ payload: { full_text: "", tool_calls: calls, error: null } });
    const result = await handle.done;
    expect(result.toolCalls).toEqual(calls);
    expect(result.error).toBeUndefined();
  });

  it("surfaces an error string from the done payload", async () => {
    const handle = sendChatStream(settings, messages, undefined, vi.fn());
    await settle();
    handlers["llm-done"]({ payload: { full_text: "", tool_calls: undefined, error: "HTTP 401: unauthorized" } });
    const result = await handle.done;
    expect(result).toEqual({ fullText: "", toolCalls: [], error: "HTTP 401: unauthorized" });
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it("resolves with the invoke error and unlistens when the command throws", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("connection refused"));
    const onChunk = vi.fn();
    const result = await sendChatStream(settings, messages, undefined, onChunk).done;
    expect(result).toEqual({ fullText: "", toolCalls: [], error: "connection refused" });
    expect(onChunk).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it("stringifies a non-Error rejection", async () => {
    vi.mocked(invoke).mockRejectedValue("plain failure");
    const result = await sendChatStream(settings, messages, undefined, vi.fn()).done;
    expect(result.error).toBe("plain failure");
  });

  it("uses the Anthropic URL, streaming max_tokens and tool conversion for the anthropic provider", async () => {
    const anthropic: LLMSettings = { ...settings, provider: "anthropic", host: "https://api.anthropic.com", model: "claude-sonnet-5" };
    const handle = sendChatStream(
      anthropic,
      [{ role: "system", content: "sys" }, ...messages],
      [{ type: "function", function: { name: "t", description: "d", parameters: { type: "object" } } }],
      vi.fn(),
    );
    await settle();
    expect(invoke).toHaveBeenCalledWith("llm_chat_stream", {
      request: expect.objectContaining({
        url: "https://api.anthropic.com/v1/messages",
        provider: "anthropic",
        body: expect.objectContaining({ stream: true, system: "sys", max_tokens: ANTHROPIC_MAX_TOKENS_STREAMING }),
      }),
    });
    handlers["llm-done"]({ payload: { full_text: "ok", tool_calls: [], error: null } });
    expect((await handle.done).fullText).toBe("ok");
  });
});
