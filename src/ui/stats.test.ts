import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { getEditor, initEditor, notifyEditorChange } from "../editor/editor";
import { makeStatusbar } from "./shell";
import { STATS_DEBOUNCE_MS, initStats, refreshStats } from "./stats";
import { appendEl } from "./taco";

function app(): HTMLElement {
  return document.getElementById("app")!;
}

function statsText(): string {
  return document.getElementById("status-stats")!.textContent ?? "";
}

let editorText = "";
let off: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  editorText = "";
  bw.append(app(), makeStatusbar());
  const container = appendEl(app(), { t: "div", a: { id: "editor-container" } });
  initEditor(container);
  getEditor().getMarkdown.mockImplementation(() => editorText);
});

afterEach(() => {
  off?.();
  off = null;
  bw.clear(app());
  vi.useRealTimers();
});

describe("refreshStats", () => {
  it("patches the slot from the editor text by default", () => {
    editorText = "one two three";
    refreshStats();
    expect(statsText()).toBe("3 words · 1 min");
  });

  it("accepts explicit markdown", () => {
    refreshStats("");
    expect(statsText()).toBe("0 words · 0 min");
  });
});

describe("initStats", () => {
  it("renders immediately and then debounces editor changes", () => {
    editorText = "hello";
    off = initStats();
    expect(statsText()).toBe("1 word · 1 min");

    notifyEditorChange("a b", "");
    notifyEditorChange("a b c", "");
    expect(statsText()).toBe("1 word · 1 min"); // not yet
    vi.advanceTimersByTime(STATS_DEBOUNCE_MS - 1);
    expect(statsText()).toBe("1 word · 1 min");
    vi.advanceTimersByTime(1);
    expect(statsText()).toBe("3 words · 1 min");
  });

  it("is idempotent and the returned function unsubscribes", () => {
    initStats();
    off = initStats();
    notifyEditorChange("x y", "");
    vi.advanceTimersByTime(STATS_DEBOUNCE_MS);
    expect(statsText()).toBe("2 words · 1 min");

    off();
    off = null;
    notifyEditorChange("x y z w", "");
    vi.advanceTimersByTime(STATS_DEBOUNCE_MS);
    expect(statsText()).toBe("2 words · 1 min");
  });

  it("cancels a pending refresh when unsubscribed", () => {
    off = initStats();
    notifyEditorChange("pending words here", "");
    off();
    off = null;
    vi.advanceTimersByTime(STATS_DEBOUNCE_MS);
    expect(statsText()).toBe("0 words · 0 min");
  });
});
