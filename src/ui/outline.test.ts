import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { getEditor, initEditor, notifyEditorChange } from "../editor/editor";
import * as tabs from "../editor/tabs";
import { makeToggleButton } from "./shell";
import {
  OUTLINE_DEBOUNCE_MS,
  handleOutlineKeydown,
  hideOutline,
  initOutline,
  isOutlineVisible,
  jumpToHeading,
  makeOutlinePanel,
  renderOutline,
  showOutline,
  toggleOutline,
} from "./outline";

function app(): HTMLElement {
  return document.getElementById("app")!;
}

function panel(): HTMLElement {
  return document.getElementById("outline")!;
}

function items(): HTMLElement[] {
  return Array.from(document.querySelectorAll("#outline-list .outline-item")) as HTMLElement[];
}

function textarea(): HTMLTextAreaElement {
  return getEditor().sourceTextarea as HTMLTextAreaElement;
}

let editorText = "";
let off: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  tabs.resetTabs();
  editorText = "";
  bw.append(app(), makeToggleButton("btn-toggle-outline", "Outline", vi.fn()));
  bw.append(app(), makeOutlinePanel());
  const container = bw.append(app(), { t: "div", a: { id: "editor-container" } });
  initEditor(container);
  getEditor().getMarkdown.mockImplementation(() => editorText);
});

afterEach(() => {
  off?.();
  off = null;
  bw.clear(app());
  vi.useRealTimers();
});

describe("makeOutlinePanel", () => {
  it("starts hidden with a header and the empty-state note", () => {
    expect(panel().classList.contains("hidden")).toBe(true);
    expect(document.getElementById("outline-header")!.textContent).toBe("Outline");
    expect(document.querySelector("#outline-list .outline-note")!.textContent).toBe("No headings yet");
    expect(isOutlineVisible()).toBe(false);
  });
});

describe("show / hide / toggle", () => {
  it("showOutline reveals the panel, presses the button and renders the current text", () => {
    editorText = "# Hi";
    showOutline();
    expect(isOutlineVisible()).toBe(true);
    expect(document.getElementById("btn-toggle-outline")!.getAttribute("aria-pressed")).toBe("true");
    expect(items().map((i) => i.textContent)).toEqual(["Hi"]);
  });

  it("hideOutline hides it and releases the button", () => {
    showOutline();
    hideOutline();
    expect(isOutlineVisible()).toBe(false);
    expect(document.getElementById("btn-toggle-outline")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggleOutline flips and reports the new state", () => {
    expect(toggleOutline()).toBe(true);
    expect(isOutlineVisible()).toBe(true);
    expect(toggleOutline()).toBe(false);
    expect(isOutlineVisible()).toBe(false);
  });

  it("isOutlineVisible is false when the panel is not mounted", () => {
    bw.clear(app());
    expect(isOutlineVisible()).toBe(false);
  });
});

describe("renderOutline", () => {
  it("renders one item per heading with its level class and line", () => {
    const headings = renderOutline("# A\ntext\n## B\n### C");
    expect(headings).toHaveLength(3);
    const rows = items();
    expect(rows.map((r) => r.textContent)).toEqual(["A", "B", "C"]);
    expect(rows[0].className).toBe("outline-item level-1");
    expect(rows[1].className).toBe("outline-item level-2");
    expect(rows[2].getAttribute("data-line")).toBe("3");
    expect(rows[0].getAttribute("role")).toBe("button");
    expect(document.querySelector("#outline-list .outline-note")).toBeNull();
  });

  it("shows the empty note again when the headings go away", () => {
    renderOutline("# A");
    expect(items()).toHaveLength(1);
    renderOutline("no headings");
    expect(items()).toHaveLength(0);
    expect(document.querySelector("#outline-list .outline-note")!.textContent).toBe("No headings yet");
  });

  it("reconciles by key, keeping unchanged rows and labelling empty headings", () => {
    renderOutline("# A\n## B");
    const first = items()[0];
    renderOutline("# A\n## B\n## C\n#");
    const rows = items();
    expect(rows[0]).toBe(first);
    expect(rows.map((r) => r.textContent)).toEqual(["A", "B", "C", "(untitled)"]);
  });

  it("returns the parsed headings even when the panel is not mounted", () => {
    bw.clear(app());
    expect(renderOutline("# Solo")).toEqual([{ level: 1, text: "Solo", line: 0 }]);
  });
});

describe("jumpToHeading", () => {
  it("moves the caret to the heading's line, scrolls the textarea and focuses it", () => {
    const ta = textarea();
    ta.value = "intro\n\n# A\nbody\n## B";
    renderOutline(ta.value);
    const focus = vi.spyOn(ta, "focus");
    items()[1].click(); // "## B" starts at offset 16
    expect(focus).toHaveBeenCalled();
    expect(ta.selectionStart).toBe(16);
    expect(ta.selectionEnd).toBe(16);
    expect(ta.scrollTop).toBeGreaterThanOrEqual(0);
  });

  it("scrolls the nth matching preview heading into view", () => {
    const ta = textarea();
    ta.value = "# Dup\n\ntext\n\n# Dup\n";
    const preview = document.createElement("div");
    preview.className = "qde-preview";
    const h1a = document.createElement("h1");
    h1a.textContent = "Dup";
    const h1b = document.createElement("h1");
    h1b.textContent = " Dup ";
    preview.append(h1a, h1b);
    document.getElementById("editor-container")!.appendChild(preview);
    const a = (h1a.scrollIntoView = vi.fn());
    const b = (h1b.scrollIntoView = vi.fn());

    const headings = renderOutline(ta.value);
    jumpToHeading(headings[1]);
    expect(b).toHaveBeenCalledWith({ block: "start" });
    expect(a).not.toHaveBeenCalled();

    // Falls back to the first candidate when the rank overshoots.
    jumpToHeading({ level: 1, text: "Dup", line: 99 });
    expect(a).toHaveBeenCalled();
  });

  it("prefers the editor's own previewPanel handle when present", () => {
    const preview = document.createElement("div");
    const h2 = document.createElement("h2");
    h2.textContent = "Sub";
    h2.scrollIntoView = vi.fn();
    preview.appendChild(h2);
    getEditor().previewPanel = preview;
    renderOutline("## Sub");
    jumpToHeading({ level: 2, text: "Sub", line: 0 });
    expect(h2.scrollIntoView).toHaveBeenCalled();
    delete getEditor().previewPanel;
  });

  it("does nothing harmful without a preview pane or matching element", () => {
    renderOutline("# X");
    expect(() => jumpToHeading({ level: 1, text: "X", line: 0 })).not.toThrow();
    const preview = document.createElement("div");
    preview.className = "qde-preview";
    document.getElementById("editor-container")!.appendChild(preview);
    expect(() => jumpToHeading({ level: 1, text: "missing", line: 0 })).not.toThrow();
  });

  it("Enter and Space on a focused row jump too", () => {
    const ta = textarea();
    ta.value = "a\n# B";
    renderOutline(ta.value);
    const row = items()[0];
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(ta.selectionStart).toBe(2);
    ta.setSelectionRange(0, 0);
    row.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(ta.selectionStart).toBe(2);
    ta.setSelectionRange(0, 0);
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true }));
    expect(ta.selectionStart).toBe(0);
  });
});

describe("initOutline", () => {
  it("renders at init, then re-parses (debounced) on editor changes while visible", () => {
    editorText = "# Start";
    off = initOutline();
    expect(items().map((i) => i.textContent)).toEqual(["Start"]);

    showOutline();
    notifyEditorChange("# Start\n## More", "");
    expect(items()).toHaveLength(1);
    vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS);
    expect(items().map((i) => i.textContent)).toEqual(["Start", "More"]);
  });

  it("skips re-rendering while hidden and catches up when shown", () => {
    off = initOutline();
    notifyEditorChange("# Hidden", "");
    vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS);
    expect(items()).toHaveLength(0);
    editorText = "# Hidden";
    showOutline();
    expect(items()).toHaveLength(1);
  });

  it("re-parses on tab changes", () => {
    off = initOutline();
    showOutline();
    editorText = "# From tab";
    tabs.newUntitledTab();
    vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS);
    expect(items().map((i) => i.textContent)).toEqual(["From tab"]);
  });

  it("is idempotent and unsubscribes cleanly", () => {
    initOutline();
    off = initOutline();
    showOutline();
    off();
    off = null;
    notifyEditorChange("# Gone", "");
    vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS);
    expect(items()).toHaveLength(0);
  });
});

describe("handleOutlineKeydown", () => {
  function key(init: KeyboardEventInit): KeyboardEvent {
    return new KeyboardEvent("keydown", { cancelable: true, ...init });
  }

  it("toggles on Cmd/Ctrl+Shift+O and prevents default", () => {
    const e = key({ key: "O", metaKey: true, shiftKey: true });
    expect(handleOutlineKeydown(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(isOutlineVisible()).toBe(true);
    expect(handleOutlineKeydown(key({ key: "o", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isOutlineVisible()).toBe(false);
  });

  it("ignores other combinations", () => {
    expect(handleOutlineKeydown(key({ key: "o", metaKey: true }))).toBe(false);
    expect(handleOutlineKeydown(key({ key: "o", shiftKey: true }))).toBe(false);
    expect(handleOutlineKeydown(key({ key: "p", metaKey: true, shiftKey: true }))).toBe(false);
    expect(handleOutlineKeydown(key({ key: "o", metaKey: true, shiftKey: true, altKey: true }))).toBe(false);
    expect(isOutlineVisible()).toBe(false);
  });
});
