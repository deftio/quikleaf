import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type LLMSettings } from "../settings/settings";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface LLMResult {
  message: ChatMessage;
  error?: string;
}

/**
 * Build the chat completions URL from the host base URL.
 * Handles common user input variations:
 *   http://host:11434       → http://host:11434/v1/chat/completions
 *   http://host:11434/      → http://host:11434/v1/chat/completions
 *   http://host:11434/v1    → http://host:11434/v1/chat/completions
 *   http://host:11434/v1/   → http://host:11434/v1/chat/completions
 *   https://openrouter.ai/api/v1 → https://openrouter.ai/api/v1/chat/completions
 */
export function buildChatUrl(host: string, provider: string): string {
  let base = host.replace(/\/+$/, "");

  if (provider === "anthropic") {
    if (!base.endsWith("/messages")) {
      base += "/v1/messages";
    }
    return base;
  }

  // OpenAI-compatible
  if (base.endsWith("/chat/completions")) return base;
  if (!base.match(/\/v1$/)) {
    base += "/v1";
  }
  return base + "/chat/completions";
}

export function buildModelsUrl(host: string): string {
  let base = host.replace(/\/+$/, "");
  if (!base.match(/\/v1$/)) {
    base += "/v1";
  }
  return base + "/models";
}

/**
 * Build the request body for the given provider.
 */
export function buildRequestBody(
  settings: LLMSettings,
  messages: ChatMessage[],
  tools?: any[],
  stream?: boolean
): any {
  if (settings.provider === "anthropic") {
    // Anthropic format: separate system from messages
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const nonSystem = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        // Parse JSON-stringified content blocks back to arrays for the API
        if (typeof m.content === "string" && m.content.startsWith("[")) {
          try {
            const parsed = JSON.parse(m.content);
            if (Array.isArray(parsed)) {
              return { ...m, content: parsed };
            }
          } catch {}
        }
        return m;
      });

    const body: any = {
      model: settings.model,
      max_tokens: 4096,
      messages: nonSystem,
    };
    if (system) body.system = system;
    if (tools && tools.length > 0) body.tools = tools;
    if (stream) body.stream = true;
    return body;
  }

  // OpenAI-compatible
  const body: any = {
    model: settings.model,
    messages: messages,
  };
  if (tools && tools.length > 0) body.tools = tools;
  if (stream) body.stream = true;
  return body;
}

/**
 * Extract the assistant message from the provider's response.
 */
export function parseResponse(
  provider: string,
  status: number,
  body: any
): LLMResult {
  if (status >= 400) {
    const errMsg =
      body?.error?.message || body?.error || JSON.stringify(body);
    return {
      message: { role: "assistant", content: `Error (${status}): ${errMsg}` },
      error: String(errMsg),
    };
  }

  if (provider === "anthropic") {
    const content = body?.content
      ?.map((c: any) => (c.type === "text" ? c.text : ""))
      .join("");
    return {
      message: {
        role: "assistant",
        content: content || "",
        tool_calls: body?.content?.filter((c: any) => c.type === "tool_use"),
      },
    };
  }

  // OpenAI-compatible
  const choice = body?.choices?.[0];
  if (!choice) {
    return {
      message: { role: "assistant", content: "No response from model." },
      error: "Empty response",
    };
  }
  return { message: choice.message };
}

/**
 * Send a chat request to the LLM via the Rust proxy (non-streaming).
 */
export async function sendChat(
  settings: LLMSettings,
  messages: ChatMessage[],
  tools?: any[]
): Promise<LLMResult> {
  const url = buildChatUrl(settings.host, settings.provider);
  const body = buildRequestBody(settings, messages, tools);

  const response = await invoke<{ status: number; body: any }>("llm_chat", {
    request: {
      url,
      apiKey: settings.apiKey,
      body,
      provider: settings.provider,
    },
  });

  return parseResponse(settings.provider, response.status, response.body);
}

export interface StreamHandle {
  /** Promise that resolves when the stream is fully done */
  done: Promise<{ fullText: string; toolCalls: any[]; error?: string }>;
}

/**
 * Send a streaming chat request. Calls onChunk for each token.
 * Returns a handle with a `done` promise that resolves with the full result.
 */
export function sendChatStream(
  settings: LLMSettings,
  messages: ChatMessage[],
  tools: any[] | undefined,
  onChunk: (token: string) => void
): StreamHandle {
  const url = buildChatUrl(settings.host, settings.provider);
  const body = buildRequestBody(settings, messages, tools, true);

  const done = new Promise<{ fullText: string; toolCalls: any[]; error?: string }>(
    async (resolve) => {
      let unlistenChunk: UnlistenFn | null = null;
      let unlistenDone: UnlistenFn | null = null;

      // Set up listeners before invoking the command
      unlistenChunk = await listen<{ token: string }>("llm-chunk", (event) => {
        onChunk(event.payload.token);
      });

      unlistenDone = await listen<{
        full_text: string;
        tool_calls: any;
        error: string | null;
      }>("llm-done", (event) => {
        // Clean up listeners
        unlistenChunk?.();
        unlistenDone?.();

        const toolCalls = Array.isArray(event.payload.tool_calls)
          ? event.payload.tool_calls
          : [];

        resolve({
          fullText: event.payload.full_text,
          toolCalls,
          error: event.payload.error || undefined,
        });
      });

      // Now invoke the streaming command (fire and forget — results come via events)
      try {
        await invoke("llm_chat_stream", {
          request: {
            url,
            apiKey: settings.apiKey,
            body,
            provider: settings.provider,
          },
        });
      } catch (e: any) {
        unlistenChunk?.();
        unlistenDone?.();
        resolve({
          fullText: "",
          toolCalls: [],
          error: e.message || String(e),
        });
      }
    }
  );

  return { done };
}

/**
 * Fetch available models from the endpoint.
 * Anthropic requires an API key and uses a different endpoint/auth scheme.
 */
export async function listModels(
  settings: LLMSettings
): Promise<string[]> {
  if (settings.provider === "anthropic") {
    if (!settings.apiKey.trim()) {
      throw new Error("Anthropic requires an API key to list models. Enter your API key above.");
    }
    // Anthropic uses x-api-key header — proxy through llm_chat with a GET-style workaround
    // Since our proxy only supports POST, return the well-known Anthropic models
    return [
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-haiku-4-20250414",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
    ];
  }

  // OpenAI-compatible: use the /v1/models endpoint
  const url = buildModelsUrl(settings.host);
  const body = await invoke<any>("llm_list_models", {
    url,
    apiKey: settings.apiKey,
  });
  const models = body?.data || body?.models || [];
  return models.map((m: any) => m.id || m.name).filter(Boolean);
}
