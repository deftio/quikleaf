import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bw from "bitwrench";
import { notifyEditorSelectionChange, type FormatState } from "../editor/editor";
import {
  FORMAT_BUTTONS,
  FORMAT_GROUPS,
  formatButtonId,
  initFormatToolbar,
  isFormatToolbarVisible,
  makeFormatToolbar,
  setFormatToolbarState,
  setFormatToolbarVisible,
} from "./format-toolbar";

const app = () => document.getElementById("app")!;

const PLAIN: FormatState = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  link: false,
  heading: 0,
  list: null,
  quote: false,
  codeblock: false,
};

describe("format toolbar", () => {
  const onFormat = vi.fn();
  let off: (() => void) | null = null;

  beforeEach(() => {
    onFormat.mockClear();
    bw.append(app(), makeFormatToolbar({ onFormat }));
  });

  afterEach(() => {
    off?.();
    off = null;
    bw.clear(app());
  });

  it("draws every command as a tool button in groups, with separators between the groups", () => {
    const bar = document.getElementById("format-toolbar")!;
    expect(bar.getAttribute("role")).toBe("toolbar");
    expect(bar.querySelectorAll(".tool-group").length).toBe(FORMAT_GROUPS.length);
    expect(bar.querySelectorAll(".tool-sep").length).toBe(FORMAT_GROUPS.length - 1);
    const ids = Array.from(bar.querySelectorAll("button")).map((b) => b.id);
    expect(ids).toEqual(FORMAT_BUTTONS.map((b) => formatButtonId(b.cmd)));
    expect(ids).toContain("fmt-bold");
    expect(ids).toContain("fmt-indent");
    for (const b of bar.querySelectorAll("button")) {
      expect(b.getAttribute("type")).toBe("button");
      expect(b.getAttribute("aria-pressed")).toBe("false");
      expect(b.classList.contains("tool-btn")).toBe(true);
    }
    expect(document.getElementById("fmt-bold")!.textContent).toBe("B");
    expect(document.getElementById("fmt-ul")!.textContent).toBe("• List");
  });

  it("a click runs the command; the mousedown is swallowed so the editor keeps the caret", () => {
    const bold = document.getElementById("fmt-bold")!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    bold.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    bold.click();
    expect(onFormat).toHaveBeenCalledWith("bold");
    document.getElementById("fmt-h2")!.click();
    document.getElementById("fmt-outdent")!.click();
    expect(onFormat.mock.calls.map((c) => c[0])).toEqual(["bold", "h2", "outdent"]);
  });

  it("presses the buttons that describe the caret's formatting; null releases them all", () => {
    const pressed = () =>
      Array.from(document.querySelectorAll("#format-toolbar [aria-pressed=true]")).map((b) => b.id);
    setFormatToolbarState({ ...PLAIN, bold: true, heading: 2, list: "task", quote: true });
    expect(pressed()).toEqual(["fmt-bold", "fmt-h2", "fmt-task", "fmt-quote"]);
    setFormatToolbarState({ ...PLAIN, italic: true, strike: true, code: true, link: true, codeblock: true, list: "ol" });
    expect(pressed()).toEqual(["fmt-italic", "fmt-strike", "fmt-code", "fmt-link", "fmt-ol", "fmt-codeblock"]);
    // Table, Rule, Indent and Outdent are actions, never pressed.
    setFormatToolbarState({ ...PLAIN, heading: 1, list: "ul" });
    expect(pressed()).toEqual(["fmt-h1", "fmt-ul"]);
    setFormatToolbarState(null);
    expect(pressed()).toEqual([]);
  });

  it("follows the editor's selection once initialised, until unsubscribed", () => {
    off = initFormatToolbar();
    notifyEditorSelectionChange({ start: 0, end: 0, text: "", pane: "source", format: { ...PLAIN, bold: true } });
    expect(document.getElementById("fmt-bold")!.getAttribute("aria-pressed")).toBe("true");
    notifyEditorSelectionChange({ start: 0, end: 0, text: "", pane: "preview", format: { ...PLAIN, italic: true } });
    expect(document.getElementById("fmt-bold")!.getAttribute("aria-pressed")).toBe("false");
    expect(document.getElementById("fmt-italic")!.getAttribute("aria-pressed")).toBe("true");
    off();
    off = null;
    notifyEditorSelectionChange({ start: 0, end: 0, text: "", pane: "source", format: PLAIN });
    expect(document.getElementById("fmt-italic")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("can be hidden and shown; a bar built hidden starts that way", () => {
    expect(isFormatToolbarVisible()).toBe(true);
    setFormatToolbarVisible(false);
    expect(isFormatToolbarVisible()).toBe(false);
    expect(document.getElementById("format-toolbar")!.classList.contains("hidden")).toBe(true);
    setFormatToolbarVisible(true);
    expect(isFormatToolbarVisible()).toBe(true);
    bw.clear(app());
    bw.append(app(), makeFormatToolbar({ onFormat }, false));
    expect(isFormatToolbarVisible()).toBe(false);
  });

  it("reports hidden when there is no bar, and the setters are harmless then", () => {
    bw.clear(app());
    expect(isFormatToolbarVisible()).toBe(false);
    expect(() => setFormatToolbarVisible(true)).not.toThrow();
    expect(() => setFormatToolbarState({ ...PLAIN, bold: true })).not.toThrow();
  });
});
