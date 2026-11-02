/**
 * The info pane: document facts, chat facts, the per-chat model picker and
 * the Clear button, for document tabs and the project tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";

vi.mock("../chat/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../chat/providers")>();
  return { ...actual, listModels: vi.fn(async () => ["llama3", "qwen3"]) };
});

import * as tabs from "../editor/tabs";
import { getEditor, initEditor, notifyEditorChange } from "../editor/editor";
import { CHAT_CLEAR, resetSessions, sessionFor } from "../chat/session";
import { listModels } from "../chat/providers";
import { INFO_DEBOUNCE_MS, infoModelSelect, initInfoPane, makeInfoPanel, refreshInfo, setInfoProjectRoot } from "./infopane";

let stop: (() => void) | null = null;

function app(): HTMLElement {
  return document.getElementById("app")!;
}
function rows(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of Array.from(document.querySelectorAll("#info-body .info-row"))) {
    const k = r.querySelector(".info-key")?.textContent ?? "";
    const v = r.querySelector(".info-val")?.textContent ?? "";
    if (k) out[k] = v;
  }
  return out;
}
function titles(): string[] {
  return Array.from(document.querySelectorAll("#info-body .info-title")).map((t) => t.textContent ?? "");
}
function show() {
  bw.removeClass("info-panel", "hidden");
}
const configure = () =>
  localStorage.setItem("quikleaf_llm_settings", JSON.stringify({ provider: "openai-compatible", host: "http://localhost:11434", apiKey: "", model: "llama3" }));

beforeEach(() => {
  localStorage.clear();
  tabs.resetTabs();
  resetSessions();
  vi.mocked(listModels).mockClear();
  bw.append(app(), { t: "div", a: { id: "editor-container" } });
  bw.append(app(), makeInfoPanel());
  initEditor(document.getElementById("editor-container")!);
  setInfoProjectRoot(null);
});

afterEach(() => {
  stop?.();
  stop = null;
  tabs.resetTabs();
  resetSessions();
  bw.clear(app());
});

describe("refreshInfo", () => {
  it("renders nothing while hidden or without a tab", () => {
    refreshInfo();
    expect(document.getElementById("info-body")!.children.length).toBe(0);
    show();
    refreshInfo();
    expect(document.getElementById("info-body")!.children.length).toBe(0);
  });

  it("describes the document and its chat", () => {
    const t = tabs.openTab("docs/notes.md", "", { projectRelative: true });
    getEditor().getMarkdown.mockReturnValue("# Title\n\nHello world, don't panic.\n\n## Two\n");
    show();
    refreshInfo();
    expect(titles()).toEqual(["Document", "Chat"]);
    const r = rows();
    expect(r.Name).toBe("notes.md");
    expect(r.Location).toBe("[Project] docs/notes.md");
    expect(r.State).toBe("Saved");
    expect(r.Words).toBe("6");
    expect(r.Characters).toBe("43");
    expect(r.Lines).toBe("6");
    expect(r["Reading time"]).toBe("1 min");
    expect(r.Headings).toBe("2");
    expect(r.Scope).toBe("This document only (notes.md)");
    expect(r.Turns).toBe("0");
    expect(r["Tool calls"]).toBe("0");
    expect(r["Memory tools"]).toBe("Project scratchpad");
    expect(r.Provider).toBe("Not configured");
    expect(infoModelSelect()!.value).toBe("");
    expect(infoModelSelect()!.options[0].textContent).toBe("Default (none)");
    tabs.updateContent(t.id, "x");
    refreshInfo("");
    expect(rows().State).toBe("Unsaved changes");
    expect(rows().Words).toBe("0");
    expect(rows()["Reading time"]).toBe("—");
  });

  it("marks unsaved documents and documents outside the project", () => {
    tabs.newUntitledTab();
    show();
    refreshInfo("hi");
    expect(rows().Location).toBe("Unsaved");
    expect(rows()["Memory tools"]).toBe("Off (not a project file)");
    tabs.openTab("/abs/x.md", "");
    refreshInfo("hi");
    expect(rows().Location).toBe("/abs/x.md");
  });

  it("describes the project on the project tab", () => {
    setInfoProjectRoot("/home/me/proj");
    tabs.openProjectTab();
    show();
    refreshInfo();
    expect(titles()).toEqual(["Project", "Chat"]);
    expect(rows().Root).toBe("/home/me/proj");
    expect(rows().Scope).toBe("Project: files under the root");
    setInfoProjectRoot(null);
    refreshInfo();
    expect(rows().Root).toBe("—");
  });

  it("shows provider, host and the chat's model; the picker fetches models once and sets the override", async () => {
    configure();
    const t = tabs.openTab("/a.md", "");
    const s = sessionFor(t.id);
    show();
    refreshInfo();
    expect(rows().Provider).toBe("Ollama · localhost:11434");
    expect(infoModelSelect()!.options[0].textContent).toBe("Default (llama3)");
    await vi.waitFor(() => {
      if (infoModelSelect()!.options.length < 3) throw new Error("models not listed yet");
    });
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(Array.from(infoModelSelect()!.options).map((o) => o.value)).toEqual(["", "llama3", "qwen3"]);

    infoModelSelect()!.value = "qwen3";
    infoModelSelect()!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(s.model).toBe("qwen3");
    refreshInfo();
    expect(infoModelSelect()!.value).toBe("qwen3");
    expect(listModels).toHaveBeenCalledTimes(1); // cached per host

    // An override that the host does not list is still offered.
    s.model = "custom:latest";
    refreshInfo();
    expect(Array.from(infoModelSelect()!.options).map((o) => o.value)).toEqual(["", "custom:latest", "llama3", "qwen3"]);
    expect(infoModelSelect()!.value).toBe("custom:latest");

    infoModelSelect()!.value = "";
    infoModelSelect()!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(s.model).toBeNull();
  });

  it("tolerates a failing model list", async () => {
    // A different host than the previous test, so the module's per-host cache does not apply.
    localStorage.setItem("quikleaf_llm_settings", JSON.stringify({ provider: "openai-compatible", host: "http://localhost:1234/v1", apiKey: "", model: "m" }));
    vi.mocked(listModels).mockRejectedValueOnce(new Error("offline"));
    tabs.openTab("/a.md", "");
    show();
    refreshInfo();
    await vi.waitFor(() => {
      if (vi.mocked(listModels).mock.calls.length < 1) throw new Error("not called");
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(infoModelSelect()!.options.length).toBe(1);
  });

  it("the Clear button asks the chat to clear itself", () => {
    const t = tabs.openTab("/a.md", "");
    show();
    refreshInfo();
    const seen: any[] = [];
    const off = bw.sub(CHAT_CLEAR, (d) => seen.push(d));
    (document.getElementById("info-clear-chat") as HTMLButtonElement).click();
    off();
    expect(seen).toEqual([{ tabId: t.id }]);
  });
});

describe("initInfoPane", () => {
  it("refreshes on tab changes, debounced editor changes and chat changes", async () => {
    const t = tabs.openTab("/a.md", "");
    show();
    stop = initInfoPane();
    expect(rows().Name).toBe("a.md");
    tabs.openTab("/b.md", "");
    expect(rows().Name).toBe("b.md");

    notifyEditorChange("one two three", "");
    expect(rows().Words).toBe("0");
    await new Promise((r) => setTimeout(r, INFO_DEBOUNCE_MS + 30));
    expect(rows().Words).toBe("3");

    const s = sessionFor(tabs.activeTab()!.id);
    s.stats.turns = 4;
    bw.pub("chat:changed", { tabId: s.tabId });
    expect(rows().Turns).toBe("4");
    void t;
  });

  it("is idempotent and stops on unsubscribe", () => {
    tabs.openTab("/a.md", "");
    show();
    initInfoPane();
    const off = initInfoPane();
    expect(rows().Name).toBe("a.md");
    off();
    tabs.openTab("/b.md", "");
    expect(rows().Name).toBe("a.md");
  });
});
