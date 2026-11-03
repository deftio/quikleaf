/**
 * quikleaf's editor toolbar (quikdown runs headless): mode radio buttons,
 * Undo / Redo following the editor's history, the copy buttons' feedback, and
 * the wiring to the editor's change / mode events.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import {
  copyButtonId,
  flashCopied,
  initEditorToolbar,
  makeEditorToolbar,
  modeButtonId,
  setEditorToolbarHistory,
  setEditorToolbarMode,
  type EditorToolbarHandlers,
} from "./editor-toolbar";
import { getEditor, initEditor, notifyEditorChange, notifyEditorModeChange } from "../editor/editor";

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`test: #${id} missing`);
  return node;
}
const btn = (id: string) => byId(id) as HTMLButtonElement;

const h: EditorToolbarHandlers = { onMode: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onCopy: vi.fn() };
let stop: (() => void) | null = null;

beforeEach(() => {
  for (const fn of Object.values(h)) vi.mocked(fn).mockReset();
  bw.append(byId("app"), makeEditorToolbar(h));
});

afterEach(() => {
  stop?.();
  stop = null;
  bw.clear(byId("app"));
  vi.useRealTimers();
});

describe("makeEditorToolbar", () => {
  it("draws no panel toggles unless handlers are given, and the editor controls are marked editor-only", () => {
    for (const id of ["btn-toggle-files", "btn-toggle-outline", "btn-toggle-chat", "btn-toggle-info"]) {
      expect(document.getElementById(id), id).toBeNull();
    }
    const groups = Array.from(document.querySelectorAll("#editor-toolbar .tool-group"));
    expect(groups.length).toBe(3);
    expect(groups.every((g) => g.classList.contains("editor-only"))).toBe(true);
  });

  it("puts Files / Outline / Chat toggles at the start and Info at the end when handlers are given", () => {
    bw.clear(byId("app"));
    const t = { onToggleFiles: vi.fn(), onToggleOutline: vi.fn(), onToggleChat: vi.fn(), onToggleInfo: vi.fn() };
    bw.append(byId("app"), makeEditorToolbar({ ...h, ...t }));
    const kids = Array.from(byId("editor-toolbar").children);
    expect(kids.slice(0, 3).map((c) => c.id)).toEqual(["btn-toggle-files", "btn-toggle-outline", "btn-toggle-chat"]);
    expect(kids[kids.length - 1].id).toBe("btn-toggle-info");
    expect(byId("btn-toggle-files").classList.contains("hidden")).toBe(true); // project mode reveals it
    expect(byId("btn-toggle-chat").className).toBe("tool-toggle toggle-btn");
    expect(byId("btn-toggle-chat").getAttribute("aria-pressed")).toBe("false");
    for (const id of ["btn-toggle-files", "btn-toggle-outline", "btn-toggle-chat", "btn-toggle-info"]) byId(id).click();
    for (const fn of Object.values(t)) expect(fn).toHaveBeenCalledTimes(1);
  });

  it("renders the three view modes as a radio group with Split checked", () => {
    expect(byId("editor-toolbar").getAttribute("role")).toBe("toolbar");
    const group = document.querySelector("#editor-toolbar [role=radiogroup]")!;
    const radios = Array.from(group.querySelectorAll("[role=radio]")).map((r) => [r.id, r.textContent, r.getAttribute("aria-checked")]);
    expect(radios).toEqual([
      ["tool-mode-source", "Source", "false"],
      ["tool-mode-split", "Split", "true"],
      ["tool-mode-preview", "Rendered", "false"],
    ]);
    btn(modeButtonId("preview")).click();
    expect(h.onMode).toHaveBeenCalledWith("preview");
  });

  it("starts with Undo / Redo disabled and wires them to the handlers once enabled", () => {
    expect(btn("tool-undo").disabled).toBe(true);
    expect(btn("tool-redo").disabled).toBe(true);
    setEditorToolbarHistory(true, true);
    btn("tool-undo").click();
    btn("tool-redo").click();
    expect(h.onUndo).toHaveBeenCalledTimes(1);
    expect(h.onRedo).toHaveBeenCalledTimes(1);
    setEditorToolbarHistory(false, true);
    expect(btn("tool-undo").disabled).toBe(true);
    expect(btn("tool-redo").disabled).toBe(false);
  });

  it("offers Copy MD / Copy HTML / Copy Rendered and reports the kind", () => {
    const labels = ["tool-copy-md", "tool-copy-html", "tool-copy-rendered"].map((id) => byId(id).textContent);
    expect(labels).toEqual(["Copy MD", "Copy HTML", "Copy Rendered"]);
    btn(copyButtonId("html")).click();
    expect(h.onCopy).toHaveBeenCalledWith("html");
    btn(copyButtonId("rendered")).click();
    expect(h.onCopy).toHaveBeenLastCalledWith("rendered");
  });

  it("setEditorToolbarMode moves the check", () => {
    setEditorToolbarMode("source");
    expect(btn(modeButtonId("source")).getAttribute("aria-checked")).toBe("true");
    expect(btn(modeButtonId("split")).getAttribute("aria-checked")).toBe("false");
    expect(btn(modeButtonId("preview")).getAttribute("aria-checked")).toBe("false");
  });

  it("the setters are no-ops when the toolbar is not mounted", () => {
    bw.clear(byId("app"));
    expect(() => setEditorToolbarMode("source")).not.toThrow();
    expect(() => setEditorToolbarHistory(true, true)).not.toThrow();
    expect(() => flashCopied("markdown")).not.toThrow();
  });

  it("flashCopied shows Copied for a moment, then restores the label", () => {
    vi.useFakeTimers();
    flashCopied("markdown", 500);
    const b = btn(copyButtonId("markdown"));
    expect(b.textContent).toBe("Copied");
    expect(b.classList.contains("copied")).toBe(true);
    vi.advanceTimersByTime(500);
    expect(b.textContent).toBe("Copy MD");
    expect(b.classList.contains("copied")).toBe(false);
  });
});

describe("initEditorToolbar", () => {
  it("follows the editor's mode changes and history", () => {
    initEditor(document.createElement("div"));
    stop = initEditorToolbar();
    notifyEditorModeChange("preview");
    expect(btn(modeButtonId("preview")).getAttribute("aria-checked")).toBe("true");
    expect(btn(modeButtonId("split")).getAttribute("aria-checked")).toBe("false");

    const instance = getEditor();
    instance.canUndo.mockReturnValue(true);
    instance.canRedo.mockReturnValue(false);
    notifyEditorChange("x", "<p>x</p>");
    expect(btn("tool-undo").disabled).toBe(false);
    expect(btn("tool-redo").disabled).toBe(true);
  });

  it("is idempotent: a second init replaces the first subscriptions", () => {
    initEditor(document.createElement("div"));
    initEditorToolbar();
    stop = initEditorToolbar();
    getEditor().canUndo.mockReturnValue(true);
    notifyEditorChange("x", "<p>x</p>");
    expect(btn("tool-undo").disabled).toBe(false);
    stop();
    stop = null;
    getEditor().canUndo.mockReturnValue(false);
    notifyEditorChange("y", "<p>y</p>");
    // Unsubscribed: the button keeps its last state.
    expect(btn("tool-undo").disabled).toBe(false);
  });
});
