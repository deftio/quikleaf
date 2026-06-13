import { invoke } from "@tauri-apps/api/core";
import { listModels } from "../chat/providers";

export interface LLMSettings {
  provider: "openai-compatible" | "anthropic";
  host: string;
  apiKey: string;
  model: string;
}

const STORAGE_KEY = "qudown_llm_settings";

const defaults: LLMSettings = {
  provider: "openai-compatible",
  host: "http://localhost:11434",
  apiKey: "",
  model: "",
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

export function initSettingsUI(): void {
  const overlay = document.getElementById("settings-overlay")!;
  const btnSettings = document.getElementById("btn-settings")!;
  const btnCancel = document.getElementById("settings-cancel")!;
  const btnSave = document.getElementById("settings-save")!;
  const btnFetchModels = document.getElementById("settings-fetch-models")!;
  const inputProvider = document.getElementById("set-provider") as HTMLSelectElement;
  const inputHost = document.getElementById("set-host") as HTMLInputElement;
  const inputKey = document.getElementById("set-api-key") as HTMLInputElement;
  const inputModel = document.getElementById("set-model") as HTMLInputElement;
  const modelsList = document.getElementById("models-list")!;
  const llmStatus = document.getElementById("llm-status")!;

  function updateStatus() {
    const s = loadSettings();
    if (isConfigured(s)) {
      try {
        llmStatus.textContent = `${s.model} @ ${new URL(s.host).host}`;
      } catch {
        llmStatus.textContent = `${s.model} @ ${s.host}`;
      }
    } else {
      llmStatus.textContent = "No LLM configured";
    }
  }

  function openModal() {
    const s = loadSettings();
    inputProvider.value = s.provider;
    inputHost.value = s.host;
    inputKey.value = s.apiKey;
    inputModel.value = s.model;
    modelsList.innerHTML = "";
    overlay.classList.add("open");
  }

  function closeModal() {
    overlay.classList.remove("open");
  }

  btnSettings.addEventListener("click", openModal);
  btnCancel.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  btnSave.addEventListener("click", () => {
    saveSettings({
      provider: inputProvider.value as LLMSettings["provider"],
      host: inputHost.value.trim(),
      apiKey: inputKey.value,
      model: inputModel.value.trim(),
    });
    updateStatus();
    closeModal();
  });

  btnFetchModels.addEventListener("click", async () => {
    const host = inputHost.value.trim();
    const provider = inputProvider.value as LLMSettings["provider"];

    if (!host && provider !== "anthropic") {
      modelsList.innerHTML = "Enter a Host URL first.";
      return;
    }

    modelsList.innerHTML = "Fetching models...";
    try {
      const tempSettings: LLMSettings = {
        provider,
        host,
        apiKey: inputKey.value,
        model: "",
      };
      const models = await listModels(tempSettings);
      if (models.length === 0) {
        modelsList.innerHTML = "No models found. Is the host correct?";
        return;
      }
      modelsList.innerHTML = "";
      for (const m of models) {
        const link = document.createElement("a");
        link.href = "#";
        link.textContent = m;
        link.style.cssText = "display:block; padding:2px 0; color:#007bff; text-decoration:none;";
        link.addEventListener("click", (e) => {
          e.preventDefault();
          inputModel.value = m;
        });
        modelsList.appendChild(link);
      }
    } catch (e: any) {
      modelsList.innerHTML = `Failed: ${e.message || e}`;
    }
  });

  // Escape key closes modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) {
      closeModal();
    }
  });

  // Auto-detect local LLM on first launch
  async function autoDetect() {
    const s = loadSettings();
    if (isConfigured(s)) return; // already set up

    const endpoints = [
      { host: "http://localhost:11434", label: "Ollama" },
      { host: "http://localhost:1234", label: "LM Studio" },
    ];

    for (const ep of endpoints) {
      try {
        const url = ep.host + "/v1/models";
        const body = await invoke<any>("llm_list_models", { url, apiKey: "" });
        const models = body?.data || body?.models || [];
        const names: string[] = models.map((m: any) => m.id || m.name).filter(Boolean);
        if (names.length > 0) {
          // Auto-configure with the first model found
          const autoSettings: LLMSettings = {
            provider: "openai-compatible",
            host: ep.host,
            apiKey: "",
            model: names[0],
          };
          saveSettings(autoSettings);
          updateStatus();
          llmStatus.textContent = `${names[0]} @ ${ep.label} (auto-detected)`;
          return;
        }
      } catch {
        // endpoint not available, try next
      }
    }
  }

  updateStatus();
  autoDetect();
}
