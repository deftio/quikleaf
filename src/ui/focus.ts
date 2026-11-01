/**
 * Focus mode: hide every panel and bar around the editor. A `focus` class on
 * `#app` drives the CSS (see `theme.ts`); a floating pill offers the way out.
 *
 * Cmd/Ctrl+Shift+D toggles; Escape exits when nothing else (a modal, the
 * find bar) would want the key.
 */
import bw from "bitwrench";
import type { Taco } from "bitwrench";
import { getSourceTextarea } from "../editor/editor";
import { isFindOpen } from "./findbar";
import { isModalOpen } from "./taco";

export function makeFocusExitPill(): Taco {
  return {
    t: "button",
    a: {
      id: "focus-exit",
      class: "focus-exit",
      type: "button",
      title: "Exit focus mode (Esc)",
      onclick: () => setFocusMode(false),
    },
    c: [{ t: "span", c: "Exit focus" }, { t: "span", a: { class: "focus-exit-key" }, c: "Esc" }],
  };
}

export function isFocusMode(): boolean {
  return bw.hasClass("app", "focus");
}

export function setFocusMode(on: boolean): void {
  bw.toggleClass("app", "focus", on);
  if (on) getSourceTextarea()?.focus();
}

/** Flip focus mode; returns true when it is now on. */
export function toggleFocusMode(): boolean {
  const on = !isFocusMode();
  setFocusMode(on);
  return on;
}

/**
 * Cmd/Ctrl+Shift+D toggles focus mode; a bare Escape leaves it when no modal
 * or find bar is open. Returns true (and prevents default) when handled.
 */
export function handleFocusKeydown(e: KeyboardEvent): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
    e.preventDefault();
    toggleFocusMode();
    return true;
  }
  if (e.key === "Escape" && !mod && !e.shiftKey && !e.altKey && isFocusMode() && !isModalOpen() && !isFindOpen()) {
    e.preventDefault();
    setFocusMode(false);
    return true;
  }
  return false;
}
