import type { ChatMessage } from "./providers";

// --- Dynamic system prompt ---
export function buildSystemPrompt(isProjectMode: boolean): string {
  let prompt = `You are QD, a friendly AI document assistant built into qdedit, a markdown editor.
You help users write, edit, and improve markdown documents. Keep responses concise and helpful.

You have access to the following tools to interact with the editor:

**Document tools:**
- **document_read**: Read the current document content. Always call this first before making edits.
- **document_write**: Replace the entire document with new markdown content.
- **document_replace**: Find and replace specific text in the document.
- **document_insert**: Insert text at the current cursor position.
- **document_undo**: Undo the last editor change.
- **document_redo**: Redo the last undone change.
- **document_get_selection**: Get the currently selected text in the editor.

**Memory tools** (scratchpad for persisting notes across the conversation):
- **memory_read**: Read the scratchpad contents.
- **memory_write**: Overwrite the scratchpad with new content.
- **memory_append**: Append text to the scratchpad.
- **memory_clear**: Clear the scratchpad.

**Key-value store** (persistent named storage with timestamps):
- **kv_get**: Get a value by key.
- **kv_set**: Set a key-value pair.
- **kv_delete**: Delete a key.
- **kv_list**: List all keys with their last-modified timestamps.`;

  if (isProjectMode) {
    prompt += `

**File tools** (available in project mode — operate relative to the project root):
- **file_read**: Read a file's contents by relative path.
- **file_write**: Write content to a file by relative path.
- **file_list**: List directory contents (optionally recursive).
- **file_stat**: Get file metadata (size, modified date, type).`;
  }

  prompt += `

When the user asks you to read, edit, modify, or improve the document, use the document tools.
First call document_read to see the current content, then use document_write or document_replace to make changes.
Use markdown formatting in your replies. Sign off briefly as QD when appropriate.`;

  return prompt;
}

// --- Tool definitions for the LLM ---

// Document tools (always available)
const DOC_TOOLS_OPENAI = [
  {
    type: "function",
    function: {
      name: "document_read",
      description: "Read the full markdown content of the current editor buffer. Call this before making any edits.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "document_write",
      description: "Replace the entire editor buffer with new markdown content",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The new markdown content" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "document_replace",
      description: "Find and replace text in the editor buffer",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Text to find" },
          replace: { type: "string", description: "Replacement text" },
          all: { type: "boolean", description: "Replace all occurrences (default: false)" },
        },
        required: ["search", "replace"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "document_insert",
      description: "Insert text at the current cursor position in the editor",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to insert at cursor" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "document_undo",
      description: "Undo the last change in the editor",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "document_redo",
      description: "Redo the last undone change in the editor",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "document_get_selection",
      description: "Get the currently selected text in the editor",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// Memory tools (always available)
const MEMORY_TOOLS_OPENAI = [
  {
    type: "function",
    function: {
      name: "memory_read",
      description: "Read the contents of the scratchpad memory",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_write",
      description: "Overwrite the scratchpad memory with new content",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "New scratchpad content" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_append",
      description: "Append text to the scratchpad memory",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Text to append" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_clear",
      description: "Clear all scratchpad memory contents",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// KV tools (always available)
const KV_TOOLS_OPENAI = [
  {
    type: "function",
    function: {
      name: "kv_get",
      description: "Get a value from the key-value store",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "The key to look up" },
        },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kv_set",
      description: "Set a key-value pair in the store",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "The key" },
          value: { type: "string", description: "The value to store" },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kv_delete",
      description: "Delete a key from the key-value store",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "The key to delete" },
        },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kv_list",
      description: "List all keys in the key-value store with their last-modified timestamps",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// File tools (project mode only)
const FILE_TOOLS_OPENAI = [
  {
    type: "function",
    function: {
      name: "file_read",
      description: "Read a file's contents by path relative to the project root",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_write",
      description: "Write content to a file by path relative to the project root",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          content: { type: "string", description: "File content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_list",
      description: "List directory contents relative to the project root",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path (empty for root)" },
          recursive: { type: "boolean", description: "List recursively (default: false)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_stat",
      description: "Get file metadata (size, modified date, type) for a path relative to the project root",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
        },
        required: ["path"],
      },
    },
  },
];

/** Convert OpenAI tool format to Anthropic tool format */
export function toAnthropicTool(t: any): any {
  return {
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  };
}

export function getTools(provider: string, isProjectMode: boolean): any[] {
  const tools = [
    ...DOC_TOOLS_OPENAI,
    ...MEMORY_TOOLS_OPENAI,
    ...KV_TOOLS_OPENAI,
    ...(isProjectMode ? FILE_TOOLS_OPENAI : []),
  ];
  return provider === "anthropic" ? tools.map(toAnthropicTool) : tools;
}

/**
 * Normalize tool calls from streaming done payload.
 * Handles both OpenAI and Anthropic formats uniformly.
 */
export function normalizeToolCalls(toolCalls: any[], provider: string): any[] {
  if (!toolCalls || toolCalls.length === 0) return [];

  if (provider === "anthropic") {
    return toolCalls.filter((tc: any) => tc.type === "tool_use");
  }

  return toolCalls.filter((tc: any) => tc.function?.name);
}

/**
 * Extract name and args from a tool call, handling both provider formats.
 */
export function extractToolCallInfo(tc: any, provider: string): { id: string; name: string; args: any } {
  if (provider === "anthropic") {
    return {
      id: tc.id || "",
      name: tc.name || "",
      args: tc.input || {},
    };
  }
  const fn = tc.function;
  let args: any = {};
  try {
    args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments || {};
  } catch {}
  return {
    id: tc.id || "",
    name: fn.name,
    args,
  };
}

/**
 * Build tool result messages in the correct format for the provider.
 */
export function buildToolResultMessages(
  results: { id: string; content: string }[],
  provider: string
): ChatMessage[] {
  if (provider === "anthropic") {
    return [{
      role: "user",
      content: JSON.stringify(results.map(r => ({
        type: "tool_result",
        tool_use_id: r.id,
        content: r.content,
      }))),
    }];
  }
  return results.map(r => ({
    role: "tool" as const,
    tool_call_id: r.id,
    content: r.content,
  }));
}

/**
 * Build an assistant message with tool calls for message history.
 */
export function buildAssistantToolCallMessage(toolCalls: any[], fullText: string, provider: string): ChatMessage {
  if (provider === "anthropic") {
    const contentBlocks: any[] = [];
    if (fullText) {
      contentBlocks.push({ type: "text", text: fullText });
    }
    for (const tc of toolCalls) {
      contentBlocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.input || {},
      });
    }
    return {
      role: "assistant",
      content: JSON.stringify(contentBlocks),
    };
  }
  return {
    role: "assistant",
    content: fullText || null,
    tool_calls: toolCalls,
  };
}
