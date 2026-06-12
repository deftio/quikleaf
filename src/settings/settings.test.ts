import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, saveSettings, isConfigured } from "./settings";
import type { LLMSettings } from "./settings";

describe("isConfigured", () => {
  it("returns false when host is empty", () => {
    expect(isConfigured({ provider: "openai-compatible", host: "", apiKey: "", model: "llama3" })).toBe(false);
  });

  it("returns false when model is empty", () => {
    expect(isConfigured({ provider: "openai-compatible", host: "http://localhost", apiKey: "", model: "" })).toBe(false);
  });

  it("returns false when host is whitespace only", () => {
    expect(isConfigured({ provider: "openai-compatible", host: "   ", apiKey: "", model: "llama3" })).toBe(false);
  });

  it("returns true when host and model are set", () => {
    expect(isConfigured({ provider: "openai-compatible", host: "http://localhost", apiKey: "", model: "llama3" })).toBe(true);
  });

  it("returns true even without API key (local LLMs)", () => {
    expect(isConfigured({ provider: "openai-compatible", host: "http://localhost:11434", apiKey: "", model: "mistral" })).toBe(true);
  });
});

describe("loadSettings / saveSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns defaults when no stored data", () => {
    const s = loadSettings();
    expect(s.provider).toBe("openai-compatible");
    expect(s.host).toBe("http://localhost:11434");
    expect(s.apiKey).toBe("");
    expect(s.model).toBe("");
  });

  it("round-trips through save and load", () => {
    const settings: LLMSettings = {
      provider: "anthropic",
      host: "https://api.anthropic.com",
      apiKey: "sk-test",
      model: "claude-sonnet-4-20250514",
    };
    saveSettings(settings);
    const loaded = loadSettings();
    expect(loaded).toEqual(settings);
  });

  it("uses correct localStorage key", () => {
    const settings: LLMSettings = {
      provider: "openai-compatible",
      host: "http://localhost:1234",
      apiKey: "",
      model: "phi3",
    };
    saveSettings(settings);
    const raw = localStorage.getItem("qdedit_llm_settings");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.model).toBe("phi3");
  });

  it("returns defaults on corrupted JSON", () => {
    localStorage.setItem("qdedit_llm_settings", "{not valid json}");
    const s = loadSettings();
    expect(s.provider).toBe("openai-compatible");
    expect(s.host).toBe("http://localhost:11434");
  });

  it("merges partial saved data with defaults", () => {
    localStorage.setItem("qdedit_llm_settings", JSON.stringify({ model: "custom" }));
    const s = loadSettings();
    expect(s.model).toBe("custom");
    expect(s.host).toBe("http://localhost:11434"); // from defaults
  });
});
