import bw from "bitwrench";
import type { Taco } from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import { buildModelsUrl, listModels } from "../chat/providers";
import { control, el, makeModal, modalHandle, withAttrs } from "../ui/taco";
import { setChatDisplay, setChatSide, setStatusProvider, type ChatSide } from "../ui/shell";
import { notify } from "../ui/toast";

export interface LLMSettings {
  provider: "openai-compatible" | "anthropic";
  host: string;
  apiKey: string;
  model: string;
  /** Show tool-call entries in the chat log. */
  showToolCalls: boolean;
  /** Show a timestamp and timing line under each message. */
  showTimestamps?: boolean;
  /** Append timings to the performance log file. */
  perfLog?: boolean;
  /**
   * When QD's edits pause for review in the chat (Accept / Reject card):
   * "always" — every document and file write; "files" — project file writes
   * only (default); "never" — apply directly and just show the diff.
   */
  editApproval?: EditApproval;
  /** Which edge of the tab the chat drawer slides out of. Default left. */
  chatSide?: ChatSide;
}

export type EditApproval = "always" | "files" | "never";

export const CHAT_SIDE_OPTIONS: { value: ChatSide; text: string }[] = [
  { value: "left", text: "Left — chat slides out beside the file tree" },
  { value: "right", text: "Right — chat slides out from the right edge" },
];

export const EDIT_APPROVAL_OPTIONS: { value: EditApproval; text: string }[] = [
  { value: "always", text: "Always — review every document and file edit" },
  { value: "files", text: "Files only — review project file writes, apply document edits directly" },
  { value: "never", text: "Never — apply edits directly, show the diff" },
];

const STORAGE_KEY = "quikleaf_llm_settings";

const defaults: LLMSettings = {
  provider: "openai-compatible",
  host: "http://localhost:11434",
  apiKey: "",
  model: "",
  showToolCalls: false,
  showTimestamps: true,
  perfLog: true,
  editApproval: "files",
  chatSide: "left",
};

export function loadSettings(): LLMSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return { ...defaults };
}

export function saveSettings(s: LLMSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function isConfigured(s: LLMSettings): boolean {
  return s.host.trim().length > 0 && s.model.trim().length > 0;
}

/** Chat display flags derived from settings (with defaults applied). */
export function chatDisplayOf(s: LLMSettings) {
  return { timestamps: s.showTimestamps !== false, tools: !!s.showToolCalls };
}

/** The edit-approval policy with the default applied (and bad stored values ignored). */
export function editApprovalOf(s: LLMSettings): EditApproval {
  return s.editApproval === "always" || s.editApproval === "never" ? s.editApproval : "files";
}

/** The chat drawer's side with the default applied (and bad stored values ignored). */
export function chatSideOf(s: LLMSettings): ChatSide {
  return s.chatSide === "right" ? "right" : "left";
}

/** Everything in Settings that restyles the chat on the spot: display flags and drawer side. */
export function applyChatSettings(s: LLMSettings): void {
  setChatDisplay(chatDisplayOf(s));
  setChatSide(chatSideOf(s));
}

// --- Presets ----------------------------------------------------------------

export interface HostPreset {
  id: string;
  label: string;
  provider: LLMSettings["provider"];
  host: string;
  /** Shown under the preset picker when selected. */
  hint: string;
  /** Probed on first launch when nothing is configured. */
  autoDetect?: boolean;
}

export const HOST_PRESETS: HostPreset[] = [
  {
    id: "ollama",
    label: "Ollama",
    provider: "openai-compatible",
    host: "http://localhost:11434",
    hint: "Run `ollama serve`; models are listed from /v1/models.",
    autoDetect: true,
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    provider: "openai-compatible",
    host: "http://localhost:1234/v1",
    hint: "Start the local server in LM Studio (Developer tab).",
    autoDetect: true,
  },
  {
    id: "docker",
    label: "Docker Model Runner",
    provider: "openai-compatible",
    host: "http://localhost:12434/engines/v1",
    hint: "Enable host access first: `docker desktop enable model-runner --tcp 12434`, then `docker model pull ai/<model>`.",
    autoDetect: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    provider: "openai-compatible",
    host: "https://openrouter.ai/api/v1",
    hint: "Needs an API key (sk-or-...). Model ids look like meta-llama/llama-3.1-70b-instruct.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    provider: "anthropic",
    host: "https://api.anthropic.com",
    hint: "Needs an API key (sk-ant-...). Model ids like claude-sonnet-5-5.",
  },
];

export function presetFor(host: string): HostPreset | undefined {
  const norm = host.trim().replace(/\/+$/, "");
  return HOST_PRESETS.find((p) => p.host.replace(/\/+$/, "") === norm);
}

// --- UI ---------------------------------------------------------------------

const PROVIDER_OPTIONS = [
  { value: "openai-compatible", text: "OpenAI-compatible (Ollama, LM Studio, Docker Model Runner, OpenRouter, Groq, ...)" },
  { value: "anthropic", text: "Anthropic (Claude)" },
];

const CUSTOM_HINT = "Pick a preset to fill in the host, or type any OpenAI-compatible base URL (…/v1).";

let modalEl: HTMLElement | null = null;

function field<T extends HTMLElement>(id: string): T {
  return control<T>(id);
}

function readForm(): LLMSettings {
  return {
    provider: field<HTMLSelectElement>("set-provider").value as LLMSettings["provider"],
    host: field<HTMLInputElement>("set-host").value.trim(),
    apiKey: field<HTMLInputElement>("set-api-key").value,
    model: field<HTMLInputElement>("set-model").value.trim(),
    showToolCalls: field<HTMLInputElement>("set-show-tools").checked,
    showTimestamps: field<HTMLInputElement>("set-show-timestamps").checked,
    perfLog: field<HTMLInputElement>("set-perf-log").checked,
    editApproval: field<HTMLSelectElement>("set-edit-approval").value as EditApproval,
    chatSide: field<HTMLSelectElement>("set-chat-side").value as ChatSide,
  };
}

function writeForm(s: LLMSettings): void {
  const preset = presetFor(s.host);
  field<HTMLSelectElement>("set-preset").value = preset?.id ?? "custom";
  bw.patch("set-preset-hint", preset?.hint ?? CUSTOM_HINT);
  field<HTMLSelectElement>("set-provider").value = s.provider;
  field<HTMLInputElement>("set-host").value = s.host;
  field<HTMLInputElement>("set-api-key").value = s.apiKey;
  field<HTMLInputElement>("set-model").value = s.model;
  field<HTMLInputElement>("set-show-tools").checked = !!s.showToolCalls;
  field<HTMLInputElement>("set-show-timestamps").checked = s.showTimestamps !== false;
  field<HTMLInputElement>("set-perf-log").checked = s.perfLog !== false;
  field<HTMLSelectElement>("set-edit-approval").value = editApprovalOf(s);
  field<HTMLSelectElement>("set-chat-side").value = chatSideOf(s);
  bw.clear("models-list");
}

/** Reflect the saved settings in the title bar pill and the status bar. */
export function updateStatus(): void {
  const s = loadSettings();
  let text = "No LLM configured";
  if (isConfigured(s)) {
    try {
      text = `${s.model} @ ${new URL(s.host).host}`;
    } catch {
      text = `${s.model} @ ${s.host}`;
    }
  }
  bw.patch("llm-status", text);
  if (el("status-provider")) {
    setStatusProvider(isConfigured(s) ? `LLM: ${presetFor(s.host)?.label ?? s.provider} · ${s.model}` : "LLM: none");
  }
}

export function openSettings(): void {
  writeForm(loadSettings());
  modalHandle(modalEl)?.open();
}

export function closeSettings(): void {
  modalHandle(modalEl)?.close();
}

/** Display toggles and the drawer side preview live; Cancel/close puts them back the way they were saved. */
function revertDisplay(): void {
  applyChatSettings(loadSettings());
}

function onCancel(): void {
  revertDisplay();
  closeSettings();
}

function onSave(): void {
  const s = readForm();
  saveSettings(s);
  applyChatSettings(s);
  updateStatus();
  closeSettings();
}

/** Switches and the side picker apply immediately so the chat updates while the dialog is open. */
function onDisplayToggle(): void {
  applyChatSettings(readForm());
}

function onPresetChange(e: Event): void {
  const id = (e.target as HTMLSelectElement).value;
  const p = HOST_PRESETS.find((x) => x.id === id);
  if (!p) {
    bw.patch("set-preset-hint", CUSTOM_HINT);
    return;
  }
  field<HTMLSelectElement>("set-provider").value = p.provider;
  field<HTMLInputElement>("set-host").value = p.host;
  bw.patch("set-preset-hint", p.hint);
  bw.clear("models-list");
}

async function onFetchModels(): Promise<void> {
  const draft = readForm();
  if (!draft.host && draft.provider !== "anthropic") {
    bw.patch("models-list", "Enter a Host URL first.");
    return;
  }
  bw.patch("models-list", "Fetching models...");
  try {
    const models = await listModels({ ...draft, model: "" });
    if (models.length === 0) {
      bw.patch("models-list", "No models found. Is the host correct?");
      return;
    }
    bw.patch(
      "models-list",
      models.map(
        (m): Taco => ({
          t: "a",
          a: {
            href: "#",
            onclick: (e: Event) => {
              e.preventDefault();
              field<HTMLInputElement>("set-model").value = m;
            },
          },
          c: m,
        }),
      ),
    );
  } catch (e: any) {
    bw.patch("models-list", `Failed: ${e.message || e}`);
  }
}

async function onClearLog(): Promise<void> {
  try {
    await invoke("log_clear");
    notify("Performance log cleared", "New entries will start a fresh file.", "success");
  } catch (e: any) {
    notify("Could not clear log", String(e?.message || e), "danger");
  }
}

function onRevealLog(): void {
  invoke("log_reveal").catch((e: any) => notify("Cannot open log folder", String(e?.message || e), "danger"));
}

function sectionTitle(text: string): Taco {
  return { t: "h4", a: { class: "settings-section-title" }, c: text };
}

/** The settings dialog as TACO: a bitwrench modal wrapping a bitwrench form. */
export function makeSettingsModal(): Taco {
  const form: Taco = {
    t: "div",
    a: { class: "settings-form" },
    c: [
      sectionTitle("LLM provider"),
      bw.makeFormGroup({
        id: "set-preset",
        label: "Preset",
        input: bw.makeSelect({
          id: "set-preset",
          options: [{ value: "custom", text: "Custom…" }, ...HOST_PRESETS.map((p) => ({ value: p.id, text: p.label }))],
          value: "custom",
          onchange: onPresetChange,
        }),
      }),
      { t: "div", a: { id: "set-preset-hint", class: "preset-hint" }, c: CUSTOM_HINT },
      bw.makeFormGroup({
        id: "set-provider",
        label: "Provider",
        input: bw.makeSelect({ id: "set-provider", options: PROVIDER_OPTIONS, value: defaults.provider }),
      }),
      bw.makeFormGroup({
        id: "set-host",
        label: "Host URL",
        input: withAttrs(bw.makeInput({ type: "text", placeholder: "http://192.168.1.50:11434/v1" }), { id: "set-host" }),
        help: "Full base URL. Ollama: http://localhost:11434 — Docker Model Runner: http://localhost:12434/engines/v1 — OpenRouter: https://openrouter.ai/api/v1",
      }),
      bw.makeFormGroup({
        id: "set-api-key",
        label: "API Key",
        input: withAttrs(bw.makeInput({ type: "password", placeholder: "sk-... (leave blank for local models)" }), {
          id: "set-api-key",
        }),
        help: "Not needed for local servers. Required for OpenRouter, OpenAI, Anthropic.",
      }),
      bw.makeFormGroup({
        id: "set-model",
        label: "Model",
        input: {
          t: "div",
          a: { class: "model-row" },
          c: [
            withAttrs(bw.makeInput({ type: "text", placeholder: "llama3, ai/smollm2, claude-sonnet-5-5, ..." }), { id: "set-model" }),
            withAttrs(bw.makeButton({ text: "Fetch Models", variant: "secondary", onclick: onFetchModels }), {
              id: "settings-fetch-models",
            }),
          ],
        },
        help: 'Model name as the provider expects it. Click "Fetch Models" to list available models from the host.',
      }),
      { t: "div", a: { id: "models-list" } },

      sectionTitle("Chat display"),
      bw.makeSwitch({ id: "set-show-timestamps", label: "Show timestamps and timing under messages", onchange: onDisplayToggle }),
      bw.makeSwitch({ id: "set-show-tools", label: "Show tool calls in chat", onchange: onDisplayToggle }),
      bw.makeFormGroup({
        id: "set-chat-side",
        label: "Chat drawer side",
        input: bw.makeSelect({ id: "set-chat-side", options: CHAT_SIDE_OPTIONS, value: defaults.chatSide, onchange: onDisplayToggle }),
        help: "The chat slides out of this edge of the tab. Open it with the pull on that edge, the Chat button, or Cmd/Ctrl+Shift+C.",
      }),

      sectionTitle("Agent"),
      bw.makeFormGroup({
        id: "set-edit-approval",
        label: "Review QD's edits before applying",
        input: bw.makeSelect({ id: "set-edit-approval", options: EDIT_APPROVAL_OPTIONS, value: defaults.editApproval }),
        help: "Reviewed edits appear in the chat as a diff with Accept and Reject. Stop cancels any pending review.",
      }),

      sectionTitle("Diagnostics"),
      bw.makeSwitch({ id: "set-perf-log", label: "Write performance log (timings per request and tool call)" }),
      {
        t: "div",
        a: { class: "settings-actions" },
        c: [
          withAttrs(bw.makeButton({ text: "Open Log Folder", variant: "secondary", size: "sm", onclick: onRevealLog }), {
            id: "settings-open-log",
          }),
          withAttrs(bw.makeButton({ text: "Clear Log", variant: "secondary", size: "sm", onclick: onClearLog }), {
            id: "settings-clear-log",
          }),
        ],
      },
      {
        t: "small",
        a: { class: "bw_bccl_form_text bw_text_muted" },
        c: "The log lives in the OS log folder (exact path under About → Diagnostics). Nothing is written while this is off.",
      },
    ],
  };

  const footer: Taco[] = [
    withAttrs(bw.makeButton({ text: "Cancel", variant: "secondary", onclick: onCancel }), { id: "settings-cancel" }),
    withAttrs(bw.makeButton({ text: "Save", variant: "primary", onclick: onSave }), { id: "settings-save" }),
  ];

  const modal = makeModal({ title: "Settings", content: form, footer, closeButton: true, onClose: revertDisplay });
  return withAttrs(modal, { id: "settings-overlay" });
}

/** Auto-detect a local LLM server on first launch (no saved settings yet). */
async function autoDetect(): Promise<void> {
  if (isConfigured(loadSettings())) return;

  for (const p of HOST_PRESETS.filter((x) => x.autoDetect)) {
    try {
      const body = await invoke<any>("llm_list_models", { url: buildModelsUrl(p.host), apiKey: "" });
      const models = body?.data || body?.models || [];
      const names: string[] = models.map((m: any) => m.id || m.name).filter(Boolean);
      if (names.length > 0) {
        saveSettings({ ...loadSettings(), provider: p.provider, host: p.host, apiKey: "", model: names[0] });
        updateStatus();
        bw.patch("llm-status", `${names[0]} @ ${p.label} (auto-detected)`);
        return;
      }
    } catch {
      // endpoint not available, try next
    }
  }
}

/** Mount the settings dialog into the app root and wire the status pill. */
export function initSettingsUI(): void {
  modalEl = bw.append(control("app"), makeSettingsModal());
  if (el("llm-status")) updateStatus();
  autoDetect();
}
