import type { ChatMessage } from "./providers";

// --- Dynamic system prompt ---

export type ChatScope = "document" | "project";

/** What the prompt needs to know about the chat it is written for. */
export interface PromptContext {
  scope: ChatScope;
  /** Tab title ("notes.md", "Untitled 2"); ignored for the project chat. */
  title: string;
  /** The document's path, project-relative or absolute; null for an unsaved document. */
  path: string | null;
  /** True when the document is a file under the project root. */
  projectRelative: boolean;
  /** Whether the scratchpad / key-value tools are offered (project files and the project chat). */
  memory: boolean;
}

const MEMORY_PROMPT = `

**Memory tools** (the project's scratchpad, shared by every chat in this project):
- **memory_read**: Read the scratchpad contents.
- **memory_write**: Overwrite the scratchpad with new content.
- **memory_append**: Append text to the scratchpad.
- **memory_clear**: Clear the scratchpad.

**Key-value store** (persistent named storage with timestamps):
- **kv_get**: Get a value by key.
- **kv_set**: Set a key-value pair.
- **kv_delete**: Delete a key.
- **kv_list**: List all keys with their last-modified timestamps.`;

const PLAN_PROMPT = `

**Planning tools** (for multi-step work, call plan_set first and keep it updated as you go):
- **plan_set**: Set the plan as a list of short steps (replaces any earlier plan).
- **plan_update**: Mark a step pending, active, done or skipped, optionally with a short note.`;

const REVIEW_PROMPT = `
Document and file edits may be shown to the user for review before they are applied. If a tool result contains
"rejected": true, the user declined that change: do not retry it or try a different route to the same edit —
briefly ask what they would like instead.
Use markdown formatting in your replies. Sign off briefly as QD when appropriate.`;

/**
 * The system prompt for one chat. A document chat is told exactly which
 * document it is bound to and that nothing else is visible to it; the
 * project chat is told it works on files under the project root by path.
 */
export function buildSystemPrompt(ctx: PromptContext): string {
  if (ctx.scope === "project") {
    return `You are QD, a friendly AI assistant built into quikleaf, a markdown editor. This is the **project chat**:
you work on the files of one project, under its root folder, and every file you read or write is named by its
project-relative path. There is no "current document" in this chat; to change a file, write it by path.
Only files under the project root exist for you. Keep responses concise and helpful.

You have access to the following tools:

**File tools** (paths are relative to the project root):
- **file_read**: Read a file's contents by relative path.
- **file_write**: Write content to a file by relative path (replaces the whole file).
- **file_list**: List directory contents (optionally recursive).
- **file_stat**: Get file metadata (size, modified date, type).
- **project_search**: Search project files for text (case-insensitive substring, or a regex). Returns matching lines with paths and line numbers.
- **tabs_list**: List the project files the user has open in editor tabs.
- **tab_open**: Open a project file in an editor tab so the user sees it.${PLAN_PROMPT}${MEMORY_PROMPT}

Read a file before changing it, and change files one at a time.${REVIEW_PROMPT}`;
  }

  const where = ctx.projectRelative ? "a file in the project" : ctx.path ? "a file on disk" : "an unsaved document";
  let prompt = `You are QD, a friendly AI document assistant built into quikleaf, a markdown editor.
You help users write, edit, and improve markdown documents. Keep responses concise and helpful.

This chat is bound to one document: **${ctx.title}** (${where}). You can read and change only this document.
Other documents the user may have open are not visible to you, and you cannot open, read or search other files.
If the user asks about another document, say that this chat only sees ${ctx.title} and that each tab has its own chat.

You have access to the following tools to interact with the editor:

**Document tools** (all act on ${ctx.title}):
- **document_read**: Read the current document content. Always call this first before making edits.
- **document_write**: Replace the entire document with new markdown content.
- **document_replace**: Find and replace specific text in the document.
- **document_insert**: Insert text at the current cursor position.
- **document_undo**: Undo the last editor change.
- **document_redo**: Redo the last undone change.
- **document_get_selection**: Get the currently selected text in the editor.
- **document_outline**: List the document's headings (level, text, line) — a cheap way to navigate a long document before reading it all.${PLAN_PROMPT}`;

  if (ctx.memory) prompt += MEMORY_PROMPT;

  prompt += `

When the user asks you to read, edit, modify, or improve the document, use the document tools.
First call document_read to see the current content, then use document_write or document_replace to make changes.${REVIEW_PROMPT}`;

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
  {
    type: "function",
    function: {
      name: "document_outline",
      description:
        "List the markdown headings of the current document as [{level, text, line}] (1-based lines; headings inside code fences are ignored). Useful to navigate a long document without reading all of it.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// Tab tools (project chat only)
const TABS_LIST_TOOL_OPENAI = {
  type: "function",
  function: {
    name: "tabs_list",
    description: "List the project files the user has open in editor tabs as [{title, path, dirty, active}]. Files outside the project are not listed.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const TAB_OPEN_TOOL_OPENAI = {
  type: "function",
  function: {
    name: "tab_open",
    description:
      "Open a file from the project in an editor tab (or focus its tab if already open) and make it active. Path is relative to the project root.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Project-relative file path" } },
      required: ["path"],
    },
  },
};

// Planning tools (always available)
const PLAN_TOOLS_OPENAI = [
  {
    type: "function",
    function: {
      name: "plan_set",
      description:
        "Set (or replace) the visible plan for a multi-step task. Shown to the user as a checklist card in the chat. Call this first for any task with more than one step, then keep it updated with plan_update.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short plan title (optional)" },
          steps: { type: "array", items: { type: "string" }, description: "Ordered list of short step descriptions" },
        },
        required: ["steps"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_update",
      description: "Update one step of the current plan: mark it pending, active, done or skipped, optionally with a short note.",
      parameters: {
        type: "object",
        properties: {
          index: { type: "integer", description: "0-based step index" },
          status: { type: "string", enum: ["pending", "active", "done", "skipped"], description: "New status" },
          note: { type: "string", description: "Short note shown next to the step (optional)" },
        },
        required: ["index", "status"],
      },
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
  {
    type: "function",
    function: {
      name: "project_search",
      description:
        "Search text files under the project root (skipping .git, node_modules, build output and dot-directories). Case-insensitive substring match by default, or a regular expression when regex is true. Returns {matches: [{path, line, text}], truncated, files_scanned}.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text or regex to search for" },
          path: { type: "string", description: "Relative directory to search within (default: project root)" },
          regex: { type: "boolean", description: "Treat query as a regular expression (default: false)" },
          max_results: { type: "integer", description: "Maximum matches to return (default 200)" },
        },
        required: ["query"],
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

/** Which tools a chat gets. */
export interface ToolScope {
  scope: ChatScope;
  /** Scratchpad / key-value tools (project files and the project chat). */
  memory: boolean;
}

/** The tool count for a scope, for tests and the `/tools` text. */
export function getTools(provider: string, ts: ToolScope): any[] {
  const memory = ts.memory ? [...MEMORY_TOOLS_OPENAI, ...KV_TOOLS_OPENAI] : [];
  const tools =
    ts.scope === "project"
      ? [...FILE_TOOLS_OPENAI, TABS_LIST_TOOL_OPENAI, TAB_OPEN_TOOL_OPENAI, ...PLAN_TOOLS_OPENAI, ...memory]
      : [...DOC_TOOLS_OPENAI, ...PLAN_TOOLS_OPENAI, ...memory];
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
