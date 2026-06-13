/**
 * Mock for @tauri-apps/api/core
 *
 * Stateful mock exposed via window.__E2E__:
 *   - invokeLog: array of {cmd, args} for assertion
 *   - launchInfo: configurable get_launch_info response
 *   - memoryContent: in-memory scratchpad
 *   - kvStore: in-memory KV map with timestamps
 *   - fsStore: in-memory file map (shared with tauri-fs mock)
 *   - llmChatResponse: configurable mock for llm_chat
 *   - llmModels: configurable mock for llm_list_models
 *   - projectData: in-memory project state
 *   - openFile: last set_open_file path
 */

interface E2EState {
  invokeLog: { cmd: string; args: any }[];
  launchInfo: any;
  memoryContent: string;
  kvStore: Record<string, { value: string; ts: string }>;
  fsStore: Record<string, string>;
  llmChatResponse: any;
  llmModels: any;
  projectData: any;
  openFile: string | null;
  dialogResult: any;
  saveResult: any;
  shellOpened: string[];
}

function getE2E(): E2EState {
  const w = window as any;
  if (!w.__E2E__) {
    const defaults: E2EState = {
      invokeLog: [],
      launchInfo: { type: "Simple", file_path: null },
      memoryContent: "",
      kvStore: {},
      fsStore: {},
      llmChatResponse: null,
      llmModels: { data: [] },
      projectData: { open_file: null },
      openFile: null,
      dialogResult: null,
      saveResult: null,
      shellOpened: [],
    };
    // Merge any pre-configured state set via page.addInitScript()
    const preconfig = w.__E2E_PRECONFIG__;
    if (preconfig) {
      Object.assign(defaults, preconfig);
    }
    w.__E2E__ = defaults;
  }
  return w.__E2E__;
}

// Initialize immediately
getE2E();

export async function invoke<T = any>(cmd: string, args?: any): Promise<T> {
  const state = getE2E();
  state.invokeLog.push({ cmd, args });

  switch (cmd) {
    case "get_launch_info":
      return state.launchInfo as T;

    case "get_cli_file":
      return null as T;

    // --- Memory ---
    case "memory_read":
      return state.memoryContent as T;
    case "memory_write":
      state.memoryContent = args?.content ?? "";
      return undefined as T;
    case "memory_append":
      state.memoryContent += args?.content ?? "";
      return undefined as T;
    case "memory_clear":
      state.memoryContent = "";
      return undefined as T;

    // --- KV ---
    case "kv_get": {
      const entry = state.kvStore[args?.key];
      return (entry ?? null) as T;
    }
    case "kv_set": {
      const now = new Date().toISOString();
      state.kvStore[args?.key] = { value: args?.value, ts: now };
      return { key: args?.key, value: args?.value, ts: now } as T;
    }
    case "kv_delete": {
      const existed = args?.key in state.kvStore;
      delete state.kvStore[args?.key];
      return existed as T;
    }
    case "kv_list":
      return state.kvStore as T;

    // --- LLM ---
    case "llm_chat":
      if (state.llmChatResponse) return state.llmChatResponse as T;
      return {
        status: 200,
        body: {
          choices: [
            {
              message: {
                role: "assistant",
                content: "Mock LLM response",
              },
            },
          ],
        },
      } as T;

    case "llm_chat_stream": {
      // Fire chunk and done events via the event bus after a small delay
      const bus = (window as any).__E2E_EVENTS__;
      if (bus) {
        setTimeout(() => {
          bus.emit("llm-chunk", { token: "Mock " });
          bus.emit("llm-chunk", { token: "streamed " });
          bus.emit("llm-chunk", { token: "response" });
          bus.emit("llm-done", {
            full_text: "Mock streamed response",
            tool_calls: [],
            error: null,
          });
        }, 50);
      }
      return undefined as T;
    }

    case "llm_list_models":
      return state.llmModels as T;

    // --- File operations (project mode) ---
    case "file_read":
      if (args?.path && args.path in state.fsStore) {
        return state.fsStore[args.path] as T;
      }
      throw new Error(`File not found: ${args?.path}`);

    case "file_write":
      if (args?.path) {
        state.fsStore[args.path] = args?.content ?? "";
      }
      return undefined as T;

    case "file_list":
      return {
        entries: Object.keys(state.fsStore).map((name) => ({
          name,
          type: "file" as const,
          size: state.fsStore[name].length,
        })),
      } as T;

    case "file_stat":
      if (args?.path && args.path in state.fsStore) {
        return {
          name: args.path,
          type: "file",
          size: state.fsStore[args.path].length,
        } as T;
      }
      throw new Error(`File not found: ${args?.path}`);

    // --- Project ---
    case "project_init":
      state.projectData = { open_file: null };
      return undefined as T;
    case "project_load":
      return state.projectData as T;
    case "project_save":
      return undefined as T;
    case "set_open_file":
      state.openFile = args?.path ?? null;
      return undefined as T;

    default:
      console.warn(`[e2e-mock] Unhandled invoke: ${cmd}`, args);
      return null as T;
  }
}
