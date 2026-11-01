import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { getEditor, initEditor } from "../editor/editor";
import { makeFindBar, openFind } from "./findbar";
import { handleFocusKeydown, isFocusMode, makeFocusExitPill, setFocusMode, toggleFocusMode } from "./focus";

function app(): HTMLElement {
  return document.getElementById("app")!;
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { cancelable: true, ...init });
}

beforeEach(() => {
  bw.append(app(), makeFocusExitPill());
  bw.append(app(), makeFindBar());
  const container = bw.append(app(), { t: "div", a: { id: "editor-container" } });
  initEditor(container);
});

afterEach(() => {
  app().classList.remove("focus");
  bw.clear(app());
});

describe("focus mode", () => {
  it("starts off; toggling adds the class and focuses the source textarea", () => {
    expect(isFocusMode()).toBe(false);
    const focus = vi.spyOn(getEditor().sourceTextarea as HTMLTextAreaElement, "focus");
    expect(toggleFocusMode()).toBe(true);
    expect(app().classList.contains("focus")).toBe(true);
    expect(focus).toHaveBeenCalled();
    expect(toggleFocusMode()).toBe(false);
    expect(isFocusMode()).toBe(false);
  });

  it("the exit pill leaves focus mode", () => {
    setFocusMode(true);
    const pill = document.getElementById("focus-exit")!;
    expect(pill.textContent).toBe("Exit focusEsc");
    expect(pill.getAttribute("type")).toBe("button");
    pill.click();
    expect(isFocusMode()).toBe(false);
  });
});

describe("handleFocusKeydown", () => {
  it("Cmd/Ctrl+Shift+D toggles and prevents default", () => {
    const e = key({ key: "D", metaKey: true, shiftKey: true });
    expect(handleFocusKeydown(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(isFocusMode()).toBe(true);
    expect(handleFocusKeydown(key({ key: "d", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isFocusMode()).toBe(false);
  });

  it("Escape exits focus mode only when it is on", () => {
    expect(handleFocusKeydown(key({ key: "Escape" }))).toBe(false);
    setFocusMode(true);
    const e = key({ key: "Escape" });
    expect(handleFocusKeydown(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(isFocusMode()).toBe(false);
  });

  it("Escape is left alone while a modal or the find bar is open", () => {
    setFocusMode(true);
    const modal = bw.append(app(), { t: "div", a: { class: "bw_bccl_modal bw_bccl_modal_show" } });
    expect(handleFocusKeydown(key({ key: "Escape" }))).toBe(false);
    expect(isFocusMode()).toBe(true);
    modal.remove();

    openFind();
    expect(handleFocusKeydown(key({ key: "Escape" }))).toBe(false);
    expect(isFocusMode()).toBe(true);
  });

  it("ignores unrelated keys and modified Escape", () => {
    setFocusMode(true);
    expect(handleFocusKeydown(key({ key: "Escape", shiftKey: true }))).toBe(false);
    expect(handleFocusKeydown(key({ key: "d", metaKey: true }))).toBe(false);
    expect(handleFocusKeydown(key({ key: "d", metaKey: true, shiftKey: true, altKey: true }))).toBe(false);
    expect(handleFocusKeydown(key({ key: "x" }))).toBe(false);
    expect(isFocusMode()).toBe(true);
  });
});
