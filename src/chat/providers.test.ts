import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildChatUrl,
  buildModelsUrl,
  buildRequestBody,
  parseResponse,
  sendChat,
  listModels,
} from "./providers";
import { invoke } from "@tauri-apps/api/core";
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
      model: "claude-sonnet-4-20250514",
    };
    const messages = [
      { role: "system" as const, content: "You are helpful." },
      { role: "user" as const, content: "hello" },
    ];
    const body = buildRequestBody(anthropicSettings, messages);
    expect(body.system).toBe("You are helpful.");
    expect(body.max_tokens).toBe(4096);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
  });

  it("Anthropic: parses JSON-stringified content blocks", () => {
    const anthropicSettings: LLMSettings = {
      ...settings,
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
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
      model: "claude-sonnet-4-20250514",
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
    expect(models).toContain("claude-sonnet-4-20250514");
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
