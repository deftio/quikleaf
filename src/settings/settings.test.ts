import { describe, it, expect, beforeEach } from "vitest";
import { appearanceOf, chatSideOf, loadSettings, saveSettings, isConfigured } from "./settings";
import type { LLMSettings } from "./settings";

describe("isConfigured", () => {
  it("returns false when host is empty", () => {
    expect(isConfigured({ provider: "openai-compatible", host: "", apiKey: "", model: "llama3", showToolCalls: false })).toBe(false);
  });

  it("returns false when model is empty", () => {
    expect(isConfigured({ provider: "openai-compatible", host: "http://localhost", apiKey: "", model: "", showToolCalls: false })).toBe(false);
  });

  it("returns false when host is whitespace only", () => {
    expect(isConfigured({ provider: "openai-compatible", host: "   ", apiKey: "", model: "llama3", showToolCalls: false })).toBe(false);
  });

  it("returns true when host and model are set", () => {
    expect(isConfigured({ provider: "openai-compatible", host: "http://localhost", apiKey: "", model: "llama3", showToolCalls: false })).toBe(true);
  });

  it("returns true even without API key (local LLMs)", () => {
    expect(isConfigured({ provider: "openai-compatible", host: "http://localhost:11434", apiKey: "", model: "mistral", showToolCalls: false })).toBe(true);
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
      showToolCalls: false,
    };
    saveSettings(settings);
    const loaded = loadSettings();
    // loadSettings fills in defaults for newer optional fields
    expect(loaded).toMatchObject(settings);
    expect(loaded.showTimestamps).toBe(true);
    expect(loaded.perfLog).toBe(true);
  });

  it("uses correct localStorage key", () => {
    const settings: LLMSettings = {
      provider: "openai-compatible",
      host: "http://localhost:1234",
      apiKey: "",
      model: "phi3",
      showToolCalls: false,
    };
    saveSettings(settings);
    const raw = localStorage.getItem("quikleaf_llm_settings");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.model).toBe("phi3");
  });

  it("returns defaults on corrupted JSON", () => {
    localStorage.setItem("quikleaf_llm_settings", "{not valid json}");
    const s = loadSettings();
    expect(s.provider).toBe("openai-compatible");
    expect(s.host).toBe("http://localhost:11434");
  });

  it("merges partial saved data with defaults", () => {
    localStorage.setItem("quikleaf_llm_settings", JSON.stringify({ model: "custom" }));
    const s = loadSettings();
    expect(s.model).toBe("custom");
    expect(s.host).toBe("http://localhost:11434"); // from defaults
  });
});

describe("chatSideOf", () => {
  const base: LLMSettings = { provider: "openai-compatible", host: "http://localhost", apiKey: "", model: "m", showToolCalls: false };

  it("defaults to left, including for unknown stored values", () => {
    expect(chatSideOf(base)).toBe("left");
    expect(chatSideOf({ ...base, chatSide: "left" })).toBe("left");
    expect(chatSideOf({ ...base, chatSide: "top" as any })).toBe("left");
  });

  it("returns right when chosen", () => {
    expect(chatSideOf({ ...base, chatSide: "right" })).toBe("right");
  });

  it("is stored and loaded with the rest of the settings", () => {
    localStorage.clear();
    saveSettings({ ...base, chatSide: "right" });
    expect(loadSettings().chatSide).toBe("right");
    localStorage.clear();
    expect(loadSettings().chatSide).toBe("left");
  });
});

describe("appearanceOf", () => {
  const base: LLMSettings = { provider: "openai-compatible", host: "http://localhost", apiKey: "", model: "m", showToolCalls: false };

  it("applies the defaults when nothing is stored", () => {
    expect(appearanceOf(base)).toEqual({ theme: "system", uiFontSize: 14, editorFontSize: 16, previewStyle: "default", previewCss: "" });
  });

  it("keeps chosen values and drops sizes and styles it does not offer", () => {
    expect(appearanceOf({ ...base, theme: "dark", uiFontSize: 16, editorFontSize: 20, previewStyle: "book", previewCss: "h1 { color: red }" })).toEqual({
      theme: "dark",
      uiFontSize: 16,
      editorFontSize: 20,
      previewStyle: "book",
      previewCss: "h1 { color: red }",
    });
    expect(appearanceOf({ ...base, theme: "sepia" as any, uiFontSize: 9, editorFontSize: 99, previewStyle: "comic" as any, previewCss: 7 as any })).toEqual({
      theme: "system",
      uiFontSize: 14,
      editorFontSize: 16,
      previewStyle: "default",
      previewCss: "",
    });
  });

  it("is stored and loaded with the rest of the settings", () => {
    localStorage.clear();
    saveSettings({ ...base, previewStyle: "mono", editorFontSize: 18 });
    expect(appearanceOf(loadSettings())).toMatchObject({ previewStyle: "mono", editorFontSize: 18 });
    localStorage.clear();
  });
});
