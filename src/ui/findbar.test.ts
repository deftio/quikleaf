import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { getEditor, initEditor, notifyEditorChange } from "../editor/editor";
import { appendEl } from "./taco";
import {
  closeFind,
  findNext,
  findPrev,
  findState,
  handleFindKeydown,
  initFindBar,
  isFindOpen,
  makeFindBar,
  openFind,
  replaceAll,
  replaceCurrent,
  toggleFind,
} from "./findbar";

const TEXT = "The cat sat.\nthe Cat ran; THE dog slept.";

function app(): HTMLElement {
  return document.getElementById("app")!;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function textarea(): HTMLTextAreaElement {
  return getEditor().sourceTextarea as HTMLTextAreaElement;
}

function count(): string {
  return byId("find-count").textContent ?? "";
}

function selection(): [number, number] {
  return [textarea().selectionStart, textarea().selectionEnd];
}

function type(id: string, value: string): void {
  const input = byId<HTMLInputElement>(id);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSwitch(id: string, on: boolean): void {
  const input = byId<HTMLInputElement>(id);
  input.checked = on;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function key(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

let off: (() => void) | null = null;
let inputEvents = 0;

beforeEach(() => {
  bw.append(app(), makeFindBar());
  const container = appendEl(app(), { t: "div", a: { id: "editor-container" } });
  initEditor(container);
  textarea().value = TEXT;
  textarea().setSelectionRange(0, 0);
  inputEvents = 0;
  textarea().addEventListener("input", () => inputEvents++);
});

afterEach(() => {
  off?.();
  off = null;
  bw.clear(app());
});

describe("makeFindBar", () => {
  it("renders every control, hidden", () => {
    const bar = byId("find-bar");
    expect(bar.classList.contains("hidden")).toBe(true);
    expect(bar.getAttribute("role")).toBe("search");
    for (const id of [
      "find-input",
      "find-replace-input",
      "find-prev",
      "find-next",
      "find-replace-one",
      "find-replace-all",
      "find-case",
      "find-regex",
      "find-close",
      "find-count",
    ]) {
      expect(byId(id), id).not.toBeNull();
    }
    expect(byId("find-case").getAttribute("role")).toBe("switch");
    expect(byId("find-input").classList.contains("bw_bccl_form_control")).toBe(true);
    expect(byId("find-input").classList.contains("find-field")).toBe(true);
    expect(isFindOpen()).toBe(false);
  });
});

describe("open / close", () => {
  it("openFind shows the bar and focuses the find field", () => {
    openFind();
    expect(isFindOpen()).toBe(true);
    expect(document.activeElement).toBe(byId("find-input"));
    expect(count()).toBe("");
  });

  it("prefills the query from a single-line selection and selects the first match from it", () => {
    textarea().setSelectionRange(4, 7); // "cat"
    openFind();
    expect(byId<HTMLInputElement>("find-input").value).toBe("cat");
    expect(count()).toBe("1 of 2");
    expect(selection()).toEqual([4, 7]);
  });

  it("leaves the query alone for a multi-line selection", () => {
    type("find-input", "keep");
    textarea().setSelectionRange(0, 20);
    openFind();
    expect(byId<HTMLInputElement>("find-input").value).toBe("keep");
  });

  it("openFind({ replace: true }) focuses the replace field", () => {
    openFind({ replace: true });
    expect(document.activeElement).toBe(byId("find-replace-input"));
  });

  it("closeFind hides the bar and returns focus to the textarea; toggleFind flips", () => {
    openFind();
    closeFind();
    expect(isFindOpen()).toBe(false);
    expect(document.activeElement).toBe(textarea());
    toggleFind();
    expect(isFindOpen()).toBe(true);
    toggleFind();
    expect(isFindOpen()).toBe(false);
  });

  it("open/close are no-ops when the bar is not mounted", () => {
    bw.clear(app());
    expect(() => openFind()).not.toThrow();
    expect(() => closeFind()).not.toThrow();
    expect(isFindOpen()).toBe(false);
  });
});

describe("searching", () => {
  beforeEach(() => openFind());

  it("typing selects the first match at or after the caret and reports the count", () => {
    type("find-input", "the");
    expect(count()).toBe("1 of 3");
    expect(selection()).toEqual([0, 3]);
    expect(findState().matches).toHaveLength(3);
    expect(findState().index).toBe(0);
  });

  it("next and prev cycle through matches with wrap-around", () => {
    type("find-input", "the");
    findNext();
    expect(count()).toBe("2 of 3");
    expect(selection()).toEqual([13, 16]);
    findNext();
    expect(count()).toBe("3 of 3");
    findNext();
    expect(count()).toBe("1 of 3");
    findPrev();
    expect(count()).toBe("3 of 3");
    expect(selection()).toEqual([26, 29]);
    findPrev();
    expect(count()).toBe("2 of 3");
  });

  it("the arrow buttons and Enter / Shift+Enter drive next and prev", () => {
    type("find-input", "the");
    byId("find-next").click();
    expect(count()).toBe("2 of 3");
    byId("find-prev").click();
    expect(count()).toBe("1 of 3");
    const enter = key(byId("find-input"), { key: "Enter" });
    expect(enter.defaultPrevented).toBe(true);
    expect(count()).toBe("2 of 3");
    key(byId("find-input"), { key: "Enter", shiftKey: true });
    expect(count()).toBe("1 of 3");
    key(byId("find-input"), { key: "a" }); // ignored
    expect(count()).toBe("1 of 3");
  });

  it("reports No results, an empty count and invalid regexes", () => {
    type("find-input", "zebra");
    expect(count()).toBe("No results");
    expect(findState().index).toBe(-1);
    type("find-input", "");
    expect(count()).toBe("");
    setSwitch("find-regex", true);
    type("find-input", "(");
    expect(count()).toBe("Invalid regex");
    expect(byId("find-input").classList.contains("invalid")).toBe(true);
    type("find-input", "c.t");
    expect(byId("find-input").classList.contains("invalid")).toBe(false);
    expect(count()).toBe("1 of 2");
  });

  it("the switches change the match set", () => {
    type("find-input", "the");
    setSwitch("find-case", true);
    expect(count()).toBe("1 of 1");
    expect(selection()).toEqual([13, 16]);
    setSwitch("find-case", false);
    expect(count()).toBe("2 of 3"); // stays on the match under the caret
  });

  it("scrolls the textarea when the match is off screen", () => {
    const ta = textarea();
    ta.value = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n") + "\nneedle";
    Object.defineProperty(ta, "clientHeight", { value: 210, configurable: true });
    type("find-input", "needle");
    expect(ta.scrollTop).toBeGreaterThan(0);
    const top = ta.scrollTop;
    // Re-selecting the same visible match does not move the viewport.
    findNext();
    expect(ta.scrollTop).toBe(top);
  });

  it("findNext / findPrev without matches leave the state empty", () => {
    findNext();
    findPrev();
    expect(count()).toBe("");
    expect(findState().index).toBe(-1);
  });
});

describe("replacing", () => {
  beforeEach(() => openFind());

  it("replaceCurrent swaps the selected match through an input event and moves on", () => {
    type("find-input", "cat");
    type("find-replace-input", "dog");
    replaceCurrent();
    expect(textarea().value).toBe("The dog sat.\nthe Cat ran; THE dog slept.");
    expect(inputEvents).toBe(1);
    expect(count()).toBe("1 of 1");
    expect(selection()).toEqual([17, 20]);
    replaceCurrent();
    expect(textarea().value).toBe("The dog sat.\nthe dog ran; THE dog slept.");
    expect(count()).toBe("No results");
  });

  it("replaceCurrent selects a match first when none is current, and does nothing with no matches", () => {
    type("find-input", "zzz");
    type("find-replace-input", "x");
    replaceCurrent();
    expect(textarea().value).toBe(TEXT);
    expect(inputEvents).toBe(0);

    type("find-input", "sat");
    textarea().setSelectionRange(0, 0);
    findState().matches.length = 0; // simulate a stale state
    replaceCurrent();
    expect(textarea().value).toContain("The cat x.");
  });

  it("Enter in the replace field replaces; Shift+Enter goes back; the Replace button works too", () => {
    type("find-input", "the");
    type("find-replace-input", "a");
    key(byId("find-replace-input"), { key: "Enter" });
    expect(textarea().value.startsWith("a cat")).toBe(true);
    key(byId("find-replace-input"), { key: "Enter", shiftKey: true });
    expect(count()).toBe("2 of 2");
    byId("find-replace-one").click();
    expect(findState().matches).toHaveLength(1);
  });

  it("replaceAll rewrites every match in one input event and parks the caret where the current match was", () => {
    textarea().setSelectionRange(5, 5);
    type("find-input", "the");
    expect(selection()).toEqual([13, 16]); // the match after the caret
    type("find-replace-input", "a");
    byId("find-replace-all").click();
    expect(textarea().value).toBe("a cat sat.\na Cat ran; a dog slept.");
    expect(inputEvents).toBe(1);
    expect(count()).toBe("No results");
    expect(selection()).toEqual([13, 13]);
  });

  it("replaceAll with no matches changes nothing", () => {
    type("find-input", "nothing-here");
    replaceAll();
    expect(textarea().value).toBe(TEXT);
    expect(inputEvents).toBe(0);
    expect(count()).toBe("No results");
  });

  it("replace functions are safe without an editor", () => {
    bw.clear(app());
    initEditor(null as any); // mock editor attaches its textarea to body
    const ta = textarea();
    ta.remove();
    (getEditor() as any).sourceTextarea = null;
    bw.append(app(), makeFindBar());
    expect(() => replaceCurrent()).not.toThrow();
    expect(() => replaceAll()).not.toThrow();
    expect(() => findNext()).not.toThrow();
    expect(count()).toBe("");
  });
});

describe("initFindBar", () => {
  it("keeps the count current while open as the document changes underneath", () => {
    off = initFindBar();
    openFind();
    type("find-input", "cat");
    expect(count()).toBe("1 of 2");
    textarea().value = "cat";
    notifyEditorChange("cat", "");
    expect(count()).toBe("1 of 1");
    textarea().value = "nothing";
    notifyEditorChange("nothing", "");
    expect(count()).toBe("No results");
  });

  it("ignores changes while closed and unsubscribes", () => {
    off = initFindBar();
    type("find-input", "cat"); // the field's own input handler still searches
    expect(count()).toBe("1 of 2");
    textarea().value = "cat";
    notifyEditorChange("cat", "");
    expect(count()).toBe("1 of 2"); // closed: not listening
    off();
    off = null;
    openFind();
    textarea().value = "x";
    notifyEditorChange("x", "");
    expect(count()).toBe("1 of 1"); // openFind re-searched "cat" in "cat"; the change to "x" was not seen
  });

  it("is idempotent", () => {
    initFindBar();
    off = initFindBar();
    openFind();
    type("find-input", "dog");
    textarea().value = "dog dog";
    notifyEditorChange("dog dog", "");
    expect(count()).toBe("1 of 2");
  });
});

describe("handleFindKeydown and Escape", () => {
  function k(init: KeyboardEventInit): KeyboardEvent {
    return new KeyboardEvent("keydown", { cancelable: true, ...init });
  }

  it("Cmd/Ctrl+F opens on the find field, Cmd/Ctrl+H on the replace field", () => {
    const e = k({ key: "f", metaKey: true });
    expect(handleFindKeydown(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(isFindOpen()).toBe(true);
    expect(document.activeElement).toBe(byId("find-input"));
    expect(handleFindKeydown(k({ key: "H", ctrlKey: true }))).toBe(true);
    expect(document.activeElement).toBe(byId("find-replace-input"));
  });

  it("ignores other combinations", () => {
    expect(handleFindKeydown(k({ key: "f" }))).toBe(false);
    expect(handleFindKeydown(k({ key: "f", metaKey: true, shiftKey: true }))).toBe(false);
    expect(handleFindKeydown(k({ key: "f", metaKey: true, altKey: true }))).toBe(false);
    expect(handleFindKeydown(k({ key: "g", metaKey: true }))).toBe(false);
    expect(isFindOpen()).toBe(false);
  });

  it("a document-level Escape closes an open bar but not a closed one or under a modal", () => {
    expect(handleFindKeydown(k({ key: "Escape" }))).toBe(false);
    openFind();
    const modal = appendEl(app(), { t: "div", a: { class: "bw_bccl_modal_show" } });
    expect(handleFindKeydown(k({ key: "Escape" }))).toBe(false);
    expect(isFindOpen()).toBe(true);
    modal.remove();
    const e = k({ key: "Escape" });
    expect(handleFindKeydown(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(isFindOpen()).toBe(false);
    expect(document.activeElement).toBe(textarea());
  });

  it("Escape inside the bar closes it and stops propagation", () => {
    openFind();
    const docSpy = vi.fn();
    document.addEventListener("keydown", docSpy);
    key(byId("find-input"), { key: "Escape" });
    expect(isFindOpen()).toBe(false);
    expect(docSpy).not.toHaveBeenCalled();
    document.removeEventListener("keydown", docSpy);
    byId("find-close").click(); // already closed: harmless
    expect(isFindOpen()).toBe(false);
  });
});
