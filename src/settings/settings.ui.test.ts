/**
 * Settings dialog: rendering, open/close, form round-trip, presets, display
 * switches, Fetch Models, log actions and first-launch auto-detect.
 *
 * The dialog is mounted into the pre-created `#app` root (see test-setup.ts).
 * Every DOM node this file needs beyond that (`#chat-panel`, `#llm-status`,
 * `#status-provider`) is created here and torn down in `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import {
  EDIT_APPROVAL_OPTIONS,
  HOST_PRESETS,
  CHAT_SIDE_OPTIONS,
  applyChatSettings,
  chatDisplayOf,
  editApprovalOf,
  closeSettings,
  applyLiveSettings,
  initSettingsUI,
  loadSettings,
  makeSettingsModal,
  openSettings,
  presetFor,
  saveSettings,
  updateStatus,
} from "./settings";
import type { LLMSettings } from "./settings";
import { LOG_OPEN } from "../diag/perf";

const mockInvoke = vi.mocked(invoke);

const SHOW = "bw_bccl_modal_show";

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`test: #${id} missing`);
  return node as T;
}

function text(id: string): string {
  return byId(id).textContent ?? "";
}

function setValue(id: string, value: string): void {
  byId<HTMLInputElement>(id).value = value;
}

function setChecked(id: string, checked: boolean, fire = false): void {
  const input = byId<HTMLInputElement>(id);
  input.checked = checked;
  if (fire) input.dispatchEvent(new Event("change", { bubbles: true }));
}

function choosePreset(id: string): void {
  const sel = byId<HTMLSelectElement>("set-preset");
  sel.value = id;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Let the pending `autoDetect()` / fetch promise chains settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

function toasts(): HTMLElement[] {
  return Array.from(document.querySelectorAll("#toast-root .bw_bccl_toast")) as HTMLElement[];
}

const saved: LLMSettings = {
  provider: "openai-compatible",
  host: "http://localhost:11434",
  apiKey: "",
  model: "llama3",
  showToolCalls: false,
  showTimestamps: true,
  perfLog: true,
  editApproval: "files",
};

function addDiv(id: string): void {
  const d = document.createElement("div");
  d.id = id;
  document.body.appendChild(d);
}

beforeEach(() => {
  localStorage.clear();
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async () => null);
  addDiv("tab-body");
  addDiv("chat-panel");
  addDiv("llm-status");
  addDiv("status-provider");
});

afterEach(async () => {
  await flush();
  // bw.clear deregisters ids from bitwrench's lookup cache; innerHTML = "" would not.
  bw.clear(byId("app"));
  for (const id of ["tab-body", "chat-panel", "llm-status", "status-provider"]) document.getElementById(id)?.remove();
  document.body.style.overflow = "";
});

// --- Pure helpers -----------------------------------------------------------

describe("presetFor", () => {
  it("matches a preset host exactly", () => {
    expect(presetFor("http://localhost:11434")?.id).toBe("ollama");
    expect(presetFor("https://api.anthropic.com")?.id).toBe("anthropic");
  });

  it("ignores surrounding whitespace and trailing slashes", () => {
    expect(presetFor("  http://localhost:1234/v1/  ")?.id).toBe("lmstudio");
    expect(presetFor("http://localhost:12434/engines/v1///")?.id).toBe("docker");
  });

  it("returns undefined for a custom host", () => {
    expect(presetFor("http://192.168.1.50:11434/v1")).toBeUndefined();
    expect(presetFor("")).toBeUndefined();
  });
});

describe("chatDisplayOf", () => {
  it("defaults timestamps on when the flag is absent", () => {
    expect(chatDisplayOf({ ...saved, showTimestamps: undefined, showToolCalls: false })).toEqual({ timestamps: true, tools: false });
  });

  it("reflects explicit flags", () => {
    expect(chatDisplayOf({ ...saved, showTimestamps: false, showToolCalls: true })).toEqual({ timestamps: false, tools: true });
  });
});

describe("editApprovalOf", () => {
  it("defaults to files when unset or invalid", () => {
    expect(editApprovalOf({ ...saved, editApproval: undefined })).toBe("files");
    expect(editApprovalOf({ ...saved, editApproval: "sometimes" as any })).toBe("files");
  });

  it("passes through always and never", () => {
    expect(editApprovalOf({ ...saved, editApproval: "always" })).toBe("always");
    expect(editApprovalOf({ ...saved, editApproval: "never" })).toBe("never");
  });
});

describe("HOST_PRESETS", () => {
  it("has unique ids and the three local servers flagged for auto-detect", () => {
    const ids = HOST_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(HOST_PRESETS.filter((p) => p.autoDetect).map((p) => p.id)).toEqual(["ollama", "lmstudio", "docker"]);
  });

  it("marks only Anthropic with the anthropic provider", () => {
    expect(HOST_PRESETS.filter((p) => p.provider === "anthropic").map((p) => p.id)).toEqual(["anthropic"]);
    expect(HOST_PRESETS.every((p) => p.host.startsWith("http") && p.hint.length > 0 && p.label.length > 0)).toBe(true);
  });
});

// --- Rendering --------------------------------------------------------------

describe("makeSettingsModal", () => {
  it("renders the overlay with every form control, action and footer button", () => {
    const node = bw.append(byId("app"), makeSettingsModal());
    expect(node.id).toBe("settings-overlay");
    expect(node.classList.contains("bw_bccl_modal")).toBe(true);
    expect(node.classList.contains(SHOW)).toBe(false);

    for (const id of [
      "set-preset",
      "set-preset-hint",
      "set-provider",
      "set-host",
      "set-api-key",
      "set-model",
      "settings-fetch-models",
      "models-list",
      "set-show-timestamps",
      "set-show-tools",
      "set-perf-log",
      "set-edit-approval",
      "set-chat-side",
      "set-theme",
      "set-ui-font",
      "set-editor-font",
      "set-preview-style",
      "set-preview-css",
      "settings-view-log",
      "settings-open-log",
      "settings-clear-log",
      "settings-cancel",
      "settings-save",
    ]) {
      expect(node.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(node.querySelector(".bw_close")).not.toBeNull();
    expect(node.textContent).toContain("Settings");
    expect(text("set-preset-hint")).toContain("Pick a preset");
  });

  it("lists Custom plus every preset in the preset picker, and both providers", () => {
    bw.append(byId("app"), makeSettingsModal());
    const presetOpts = Array.from(byId<HTMLSelectElement>("set-preset").options).map((o) => o.value);
    expect(presetOpts).toEqual(["custom", ...HOST_PRESETS.map((p) => p.id)]);
    expect(byId<HTMLSelectElement>("set-preset").value).toBe("custom");

    const providerOpts = Array.from(byId<HTMLSelectElement>("set-provider").options).map((o) => o.value);
    expect(providerOpts).toEqual(["openai-compatible", "anthropic"]);
    expect(byId<HTMLSelectElement>("set-provider").value).toBe("openai-compatible");
  });

  it("uses a password field for the API key and switches for the display toggles", () => {
    bw.append(byId("app"), makeSettingsModal());
    expect(byId<HTMLInputElement>("set-api-key").type).toBe("password");
    expect(byId<HTMLInputElement>("set-show-tools").getAttribute("role")).toBe("switch");
    expect(byId<HTMLInputElement>("set-show-timestamps").type).toBe("checkbox");
  });

  it("offers the three edit-approval policies under an Agent section, defaulting to files", () => {
    const node = bw.append(byId("app"), makeSettingsModal());
    const titles = Array.from(node.querySelectorAll(".settings-section-title")).map((h) => h.textContent);
    expect(titles).toEqual(["LLM provider", "Appearance", "Chat display", "Agent", "Diagnostics"]);
    const sel = byId<HTMLSelectElement>("set-edit-approval");
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(EDIT_APPROVAL_OPTIONS.map((o) => o.value));
    expect(sel.value).toBe("files");
  });

  it("offers the drawer side under Chat display, defaulting to left", () => {
    const node = bw.append(byId("app"), makeSettingsModal());
    const sel = byId<HTMLSelectElement>("set-chat-side");
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(CHAT_SIDE_OPTIONS.map((o) => o.value));
    expect(sel.value).toBe("left");
    const section = Array.from(node.querySelectorAll(".settings-section-title")).find((h) => h.textContent === "Chat display")!;
    // The picker's form group comes after the Chat display title and before the Agent title.
    const order = Array.from(node.querySelectorAll(".settings-section-title, #set-chat-side"));
    expect(order.indexOf(sel) - order.indexOf(section)).toBe(1);
  });
});

// --- Before mount -----------------------------------------------------------

describe("openSettings / closeSettings before initSettingsUI", () => {
  it("are no-ops when the dialog has not been mounted", async () => {
    vi.resetModules();
    const fresh = await import("./settings");
    // openSettings writes the form first, which needs the controls; closeSettings has no handle.
    expect(() => fresh.closeSettings()).not.toThrow();
    expect(() => fresh.openSettings()).toThrow(/not mounted/);
  });
});

// --- Mounted dialog ---------------------------------------------------------

describe("initSettingsUI", () => {
  it("mounts the dialog into #app and reflects saved settings in the status pill", async () => {
    saveSettings(saved);
    initSettingsUI();
    await flush();
    expect(byId("app").querySelector("#settings-overlay")).not.toBeNull();
    expect(text("llm-status")).toBe("llama3 @ localhost:11434");
    expect(text("status-provider")).toBe("LLM: Ollama · llama3");
  });

  it("shows 'No LLM configured' when nothing is saved", async () => {
    initSettingsUI();
    await flush();
    expect(text("llm-status")).toBe("No LLM configured");
    expect(text("status-provider")).toBe("LLM: none");
  });

  it("skips the status update when there is no status pill", async () => {
    byId("llm-status").remove();
    saveSettings(saved);
    initSettingsUI();
    await flush();
    expect(text("status-provider")).toBe("");
  });
});

describe("updateStatus", () => {
  it("falls back to the raw host when it is not a URL", () => {
    saveSettings({ ...saved, host: "not a url", model: "m1" });
    updateStatus();
    expect(text("llm-status")).toBe("m1 @ not a url");
    expect(text("status-provider")).toBe("LLM: openai-compatible · m1");
  });

  it("names the preset in the status bar when the host matches one", () => {
    saveSettings({ ...saved, provider: "anthropic", host: "https://api.anthropic.com", apiKey: "k", model: "claude" });
    updateStatus();
    expect(text("llm-status")).toBe("claude @ api.anthropic.com");
    expect(text("status-provider")).toBe("LLM: Anthropic · claude");
  });

  it("leaves the status bar alone when #status-provider is absent", () => {
    byId("status-provider").remove();
    saveSettings(saved);
    expect(() => updateStatus()).not.toThrow();
    expect(text("llm-status")).toBe("llama3 @ localhost:11434");
  });
});

describe("open / close and the form round-trip", () => {
  beforeEach(async () => {
    saveSettings({ ...saved, showToolCalls: true, showTimestamps: false, perfLog: false, editApproval: "never" });
    initSettingsUI();
    await flush();
  });

  it("openSettings fills the form from storage and shows the overlay", () => {
    openSettings();
    const overlay = byId("settings-overlay");
    expect(overlay.classList.contains(SHOW)).toBe(true);
    expect(byId<HTMLSelectElement>("set-preset").value).toBe("ollama");
    expect(text("set-preset-hint")).toContain("ollama serve");
    expect(byId<HTMLSelectElement>("set-provider").value).toBe("openai-compatible");
    expect(byId<HTMLInputElement>("set-host").value).toBe("http://localhost:11434");
    expect(byId<HTMLInputElement>("set-api-key").value).toBe("");
    expect(byId<HTMLInputElement>("set-model").value).toBe("llama3");
    expect(byId<HTMLInputElement>("set-show-tools").checked).toBe(true);
    expect(byId<HTMLInputElement>("set-show-timestamps").checked).toBe(false);
    expect(byId<HTMLInputElement>("set-perf-log").checked).toBe(false);
    expect(byId<HTMLSelectElement>("set-edit-approval").value).toBe("never");
    expect(byId<HTMLSelectElement>("set-chat-side").value).toBe("left");

    closeSettings();
    expect(overlay.classList.contains(SHOW)).toBe(false);
  });

  it("selects 'Custom…' and the generic hint for an unknown host", () => {
    saveSettings({ ...saved, host: "http://10.0.0.5:8080/v1" });
    openSettings();
    expect(byId<HTMLSelectElement>("set-preset").value).toBe("custom");
    expect(text("set-preset-hint")).toContain("Pick a preset");
  });

  it("clears a previous models list when reopened", () => {
    openSettings();
    bw.patch("models-list", "stale");
    closeSettings();
    openSettings();
    expect(text("models-list")).toBe("");
  });

  it("Save persists the form, applies display flags, updates status and closes", () => {
    openSettings();
    byId<HTMLSelectElement>("set-provider").value = "anthropic";
    setValue("set-host", "  https://api.anthropic.com/  ");
    setValue("set-api-key", "sk-ant-1");
    setValue("set-model", " claude-x ");
    setChecked("set-show-tools", false);
    setChecked("set-show-timestamps", true);
    setChecked("set-perf-log", true);
    byId<HTMLSelectElement>("set-edit-approval").value = "always";
    byId<HTMLSelectElement>("set-chat-side").value = "right";

    byId("settings-save").click();

    expect(loadSettings()).toEqual({
      provider: "anthropic",
      host: "https://api.anthropic.com/",
      apiKey: "sk-ant-1",
      model: "claude-x",
      showToolCalls: false,
      showTimestamps: true,
      perfLog: true,
      editApproval: "always",
      chatSide: "right",
      theme: "system",
      uiFontSize: 14,
      editorFontSize: 16,
      previewStyle: "default",
      previewCss: "",
    });
    const panel = byId("chat-panel");
    expect(panel.classList.contains("show-timestamps")).toBe(true);
    expect(panel.classList.contains("show-tools")).toBe(false);
    expect(byId("tab-body").classList.contains("chat-right")).toBe(true);
    expect(text("llm-status")).toBe("claude-x @ api.anthropic.com");
    expect(text("status-provider")).toBe("LLM: Anthropic · claude-x");
    expect(byId("settings-overlay").classList.contains(SHOW)).toBe(false);
  });

  it("display switches preview live and Cancel reverts them without saving", () => {
    openSettings();
    const panel = byId("chat-panel");
    // Saved: tools on, timestamps off.
    setChecked("set-show-tools", false, true);
    setChecked("set-show-timestamps", true, true);
    expect(panel.classList.contains("show-tools")).toBe(false);
    expect(panel.classList.contains("show-timestamps")).toBe(true);
    const side = byId<HTMLSelectElement>("set-chat-side");
    side.value = "right";
    side.dispatchEvent(new Event("change", { bubbles: true }));
    expect(byId("tab-body").classList.contains("chat-right")).toBe(true);
    setValue("set-model", "unsaved-model");

    byId("settings-cancel").click();

    expect(panel.classList.contains("show-tools")).toBe(true);
    expect(panel.classList.contains("show-timestamps")).toBe(false);
    expect(byId("tab-body").classList.contains("chat-right")).toBe(false);
    expect(loadSettings().model).toBe("llama3");
    expect(loadSettings().chatSide).toBe("left"); // the saved default, not the previewed "right"
    expect(byId("settings-overlay").classList.contains(SHOW)).toBe(false);
  });

  it("the dialog's close button also reverts the live preview", () => {
    openSettings();
    const panel = byId("chat-panel");
    setChecked("set-show-tools", false, true);
    expect(panel.classList.contains("show-tools")).toBe(false);

    (byId("settings-overlay").querySelector(".bw_close") as HTMLElement).click();

    expect(panel.classList.contains("show-tools")).toBe(true);
    expect(byId("settings-overlay").classList.contains(SHOW)).toBe(false);
  });
});

describe("preset picker", () => {
  beforeEach(async () => {
    initSettingsUI();
    await flush();
    openSettings();
  });

  it("fills provider, host and hint from the chosen preset and clears the models list", () => {
    bw.patch("models-list", "old");
    choosePreset("docker");
    expect(byId<HTMLSelectElement>("set-provider").value).toBe("openai-compatible");
    expect(byId<HTMLInputElement>("set-host").value).toBe("http://localhost:12434/engines/v1");
    expect(text("set-preset-hint")).toContain("docker desktop enable model-runner");
    expect(text("models-list")).toBe("");

    choosePreset("anthropic");
    expect(byId<HTMLSelectElement>("set-provider").value).toBe("anthropic");
    expect(byId<HTMLInputElement>("set-host").value).toBe("https://api.anthropic.com");
    expect(text("set-preset-hint")).toContain("sk-ant-");
  });

  it("switching back to Custom keeps the host and restores the generic hint", () => {
    choosePreset("lmstudio");
    choosePreset("custom");
    expect(byId<HTMLInputElement>("set-host").value).toBe("http://localhost:1234/v1");
    expect(text("set-preset-hint")).toContain("Pick a preset");
  });
});

describe("Fetch Models", () => {
  beforeEach(async () => {
    initSettingsUI();
    await flush();
    openSettings();
    mockInvoke.mockClear();
  });

  it("asks for a host when the OpenAI-compatible host is blank", async () => {
    setValue("set-host", "   ");
    byId("settings-fetch-models").click();
    await flush();
    expect(text("models-list")).toBe("Enter a Host URL first.");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("renders one link per model and clicking a link fills the model field", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "llm_list_models") return { data: [{ id: "llama3" }, { id: "phi3" }, { name: "" }] };
      return null;
    });
    setValue("set-host", "http://localhost:11434");
    setValue("set-api-key", "secret");
    byId("settings-fetch-models").click();
    expect(text("models-list")).toBe("Fetching models...");
    await flush();

    expect(mockInvoke).toHaveBeenCalledWith("llm_list_models", { url: "http://localhost:11434/v1/models", apiKey: "secret" });
    const links = Array.from(byId("models-list").querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["llama3", "phi3"]);

    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    links[1].dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(byId<HTMLInputElement>("set-model").value).toBe("phi3");
  });

  it("reports when the host returns no models", async () => {
    mockInvoke.mockImplementation(async () => ({ models: [] }));
    setValue("set-host", "http://localhost:1234/v1");
    byId("settings-fetch-models").click();
    await flush();
    expect(text("models-list")).toBe("No models found. Is the host correct?");
  });

  it("shows the error when the backend rejects", async () => {
    mockInvoke.mockImplementation(async () => {
      throw new Error("connection refused");
    });
    setValue("set-host", "http://localhost:9");
    byId("settings-fetch-models").click();
    await flush();
    expect(text("models-list")).toBe("Failed: connection refused");
  });

  it("shows a non-Error rejection verbatim", async () => {
    mockInvoke.mockImplementation(async () => {
      throw "plain string failure";
    });
    setValue("set-host", "http://localhost:9");
    byId("settings-fetch-models").click();
    await flush();
    expect(text("models-list")).toBe("Failed: plain string failure");
  });

  it("lists Anthropic models without a host but requires an API key", async () => {
    byId<HTMLSelectElement>("set-provider").value = "anthropic";
    setValue("set-host", "");
    setValue("set-api-key", "");
    byId("settings-fetch-models").click();
    await flush();
    expect(text("models-list")).toMatch(/^Failed: Anthropic requires an API key/);
    expect(mockInvoke).not.toHaveBeenCalled();

    setValue("set-api-key", "sk-ant-1");
    byId("settings-fetch-models").click();
    await flush();
    const links = byId("models-list").querySelectorAll("a");
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].textContent).toMatch(/^claude/);
  });
});

describe("log actions", () => {
  beforeEach(async () => {
    initSettingsUI();
    await flush();
    mockInvoke.mockClear();
  });

  it("Clear Log invokes log_clear and confirms with a success toast", async () => {
    byId("settings-clear-log").click();
    await flush();
    expect(mockInvoke).toHaveBeenCalledWith("log_clear");
    const t = toasts();
    expect(t).toHaveLength(1);
    expect(t[0].classList.contains("bw_success")).toBe(true);
    expect(t[0].textContent).toContain("Performance log cleared");
  });

  it("Clear Log shows a danger toast when the backend fails", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "log_clear") throw new Error("read-only fs");
      return null;
    });
    byId("settings-clear-log").click();
    await flush();
    const t = toasts();
    expect(t).toHaveLength(1);
    expect(t[0].classList.contains("bw_danger")).toBe(true);
    expect(t[0].textContent).toContain("Could not clear log");
    expect(t[0].textContent).toContain("read-only fs");
  });

  it("Clear Log stringifies a non-Error rejection", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "log_clear") throw "EACCES";
      return null;
    });
    byId("settings-clear-log").click();
    await flush();
    expect(toasts()[0].textContent).toContain("EACCES");
  });

  it("Open Log Folder invokes log_reveal silently on success", async () => {
    byId("settings-open-log").click();
    await flush();
    expect(mockInvoke).toHaveBeenCalledWith("log_reveal");
    expect(toasts()).toHaveLength(0);
  });

  it("Open Log Folder shows a danger toast when the backend fails", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "log_reveal") throw "no file manager";
      return null;
    });
    byId("settings-open-log").click();
    await flush();
    const t = toasts();
    expect(t).toHaveLength(1);
    expect(t[0].classList.contains("bw_danger")).toBe(true);
    expect(t[0].textContent).toContain("Cannot open log folder");
    expect(t[0].textContent).toContain("no file manager");
  });
});

describe("autoDetect on first launch", () => {
  const OLLAMA = "http://localhost:11434/v1/models";
  const LMSTUDIO = "http://localhost:1234/v1/models";
  const DOCKER = "http://localhost:12434/engines/v1/models";

  function listCalls(): string[] {
    return mockInvoke.mock.calls.filter((c) => c[0] === "llm_list_models").map((c) => (c[1] as { url: string }).url);
  }

  it("probes Ollama, LM Studio and Docker Model Runner in order with an empty key", async () => {
    initSettingsUI();
    await flush();
    expect(listCalls()).toEqual([OLLAMA, LMSTUDIO, DOCKER]);
    for (const c of mockInvoke.mock.calls) expect(c[1]).toMatchObject({ apiKey: "" });
    expect(loadSettings().model).toBe("");
    expect(text("llm-status")).toBe("No LLM configured");
  });

  it("stops at the first host that lists models and saves it", async () => {
    mockInvoke.mockImplementation(async (cmd, args) => {
      if (cmd !== "llm_list_models") return null;
      const { url } = args as { url: string };
      if (url === OLLAMA) throw new Error("ECONNREFUSED");
      if (url === LMSTUDIO) return { data: [{ id: "qwen2.5" }, { id: "phi3" }] };
      return { data: [{ id: "ai/smollm2" }] };
    });
    initSettingsUI();
    await flush();

    expect(listCalls()).toEqual([OLLAMA, LMSTUDIO]);
    const s = loadSettings();
    expect(s.host).toBe("http://localhost:1234/v1");
    expect(s.provider).toBe("openai-compatible");
    expect(s.model).toBe("qwen2.5");
    expect(s.apiKey).toBe("");
    expect(text("llm-status")).toBe("qwen2.5 @ LM Studio (auto-detected)");
    expect(text("status-provider")).toBe("LLM: LM Studio · qwen2.5");
  });

  it("falls through hosts that answer with an empty list and accepts the `models` shape", async () => {
    mockInvoke.mockImplementation(async (cmd, args) => {
      if (cmd !== "llm_list_models") return null;
      const { url } = args as { url: string };
      if (url === DOCKER) return { models: [{ name: "ai/smollm2" }] };
      return { data: [] };
    });
    initSettingsUI();
    await flush();
    expect(listCalls()).toEqual([OLLAMA, LMSTUDIO, DOCKER]);
    expect(loadSettings().host).toBe("http://localhost:12434/engines/v1");
    expect(loadSettings().model).toBe("ai/smollm2");
    expect(text("llm-status")).toBe("ai/smollm2 @ Docker Model Runner (auto-detected)");
  });

  it("does not probe when settings are already configured", async () => {
    saveSettings(saved);
    initSettingsUI();
    await flush();
    expect(listCalls()).toEqual([]);
    expect(loadSettings()).toMatchObject(saved);
  });
});

describe("applyChatSettings", () => {
  it("restyles the chat on the spot: display classes on #chat-panel, side on #tab-body", () => {
    applyChatSettings({ ...saved, showToolCalls: true, showTimestamps: false, chatSide: "right" });
    expect(byId("chat-panel").classList.contains("show-tools")).toBe(true);
    expect(byId("chat-panel").classList.contains("show-timestamps")).toBe(false);
    expect(byId("tab-body").classList.contains("chat-right")).toBe(true);
    applyChatSettings(saved);
    expect(byId("chat-panel").classList.contains("show-tools")).toBe(false);
    expect(byId("chat-panel").classList.contains("show-timestamps")).toBe(true);
    expect(byId("tab-body").classList.contains("chat-right")).toBe(false);
  });
});

describe("applyLiveSettings / Appearance", () => {
  it("sets the font sizes and preview style on #app and installs the user's CSS", () => {
    applyLiveSettings({ ...saved, uiFontSize: 16, editorFontSize: 20, previewStyle: "book", previewCss: "h1 { color: red }" });
    const app = byId("app");
    expect(app.style.getPropertyValue("--ui-font-size")).toBe("16px");
    expect(app.style.getPropertyValue("--editor-font-size")).toBe("20px");
    expect(app.classList.contains("preview-book")).toBe(true);
    expect(document.getElementById("quikleaf_user_css")!.textContent).toBe("#editor-container .qde-preview {\nh1 { color: red }\n}");
    applyLiveSettings(saved);
    expect(app.style.getPropertyValue("--ui-font-size")).toBe("14px");
    expect(app.classList.contains("preview-book")).toBe(false);
    expect(app.classList.contains("preview-default")).toBe(true);
    expect(document.getElementById("quikleaf_user_css")!.textContent).toBe("");
  });

  it("the Appearance pickers preview live, Save keeps them, Cancel puts them back", async () => {
    saveSettings(saved);
    initSettingsUI();
    await flush();
    openSettings();
    const style = byId<HTMLSelectElement>("set-preview-style");
    style.value = "mono";
    style.dispatchEvent(new Event("change", { bubbles: true }));
    expect(byId("app").classList.contains("preview-mono")).toBe(true);
    const css = byId<HTMLTextAreaElement>("set-preview-css");
    css.value = "p { margin: 0 }";
    css.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.getElementById("quikleaf_user_css")!.textContent).toContain("p { margin: 0 }");
    byId("settings-cancel").click();
    expect(byId("app").classList.contains("preview-mono")).toBe(false);
    expect(document.getElementById("quikleaf_user_css")!.textContent).toBe("");

    openSettings();
    const font = byId<HTMLSelectElement>("set-ui-font");
    font.value = "16";
    font.dispatchEvent(new Event("change", { bubbles: true }));
    byId("settings-save").click();
    expect(loadSettings().uiFontSize).toBe(16);
    expect(byId("app").style.getPropertyValue("--ui-font-size")).toBe("16px");
  });
});

describe("theme and View Log", () => {
  beforeEach(async () => {
    saveSettings(saved);
    initSettingsUI();
    await flush();
  });

  it("the Theme picker previews live and is saved; Cancel goes back to what was saved", () => {
    openSettings();
    const theme = byId<HTMLSelectElement>("set-theme");
    expect(theme.value).toBe("system");
    theme.value = "dark";
    theme.dispatchEvent(new Event("change", { bubbles: true }));
    expect(byId("app").classList.contains("dark")).toBe(true);
    byId("settings-cancel").click();
    expect(byId("app").classList.contains("dark")).toBe(false); // happy-dom: no OS dark preference
    openSettings();
    theme.value = "dark";
    theme.dispatchEvent(new Event("change", { bubbles: true }));
    byId("settings-save").click();
    expect(loadSettings().theme).toBe("dark");
    expect(byId("app").classList.contains("dark")).toBe(true);
    applyLiveSettings({ ...saved, theme: "light" });
    expect(byId("app").classList.contains("dark")).toBe(false);
  });

  it("View Log closes the dialog and publishes log:open", () => {
    const seen = vi.fn();
    const off = bw.sub(LOG_OPEN, seen);
    openSettings();
    byId("settings-view-log").click();
    expect(byId("settings-overlay").classList.contains(SHOW)).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });
});
