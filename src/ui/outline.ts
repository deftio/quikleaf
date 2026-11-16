/**
 * Outline side panel: the document's headings as a clickable list. Sits in
 * `#tab-body` after the file tree (left of the chat and the editor), hidden by default.
 *
 * The list is a view over `parseOutline(getMarkdown())`, reconciled with
 * `syncChildren` keyed by `line:text`. It re-parses (debounced) on every
 * editor change and on tab switches. Clicking a heading moves the caret to
 * that line and scrolls both panes there (the editor's `scrollToLine`).
 */
import bw from "bitwrench";
import type { Taco } from "bitwrench";
import { focusEditor, getMarkdown, onEditorChange, scrollToLine, setSelection } from "../editor/editor";
import { lineStartOffset, parseOutline, type Heading } from "../editor/outline";
import { TABS_CHANGED } from "../editor/tabs";
import { debounce } from "./debounce";
import { setToggleState } from "./shell";
import { syncChildren } from "./taco";

export const OUTLINE_DEBOUNCE_MS = 150;

let unsubscribe: (() => void) | null = null;
/** The headings as last rendered. */
let current: Heading[] = [];

export function makeOutlinePanel(): Taco {
  return {
    t: "div",
    a: { id: "outline", class: "hidden", "aria-label": "Document outline" },
    c: [
      { t: "div", a: { id: "outline-header" }, c: "Outline" },
      { t: "div", a: { id: "outline-list" }, c: emptyNote() },
    ],
  };
}

function emptyNote(): Taco {
  return { t: "div", a: { class: "outline-note" }, c: "No headings yet" };
}

export function showOutline(): void {
  bw.removeClass("outline", "hidden");
  setToggleState("btn-toggle-outline", true);
  renderOutline(getMarkdown());
}

export function hideOutline(): void {
  bw.addClass("outline", "hidden");
  setToggleState("btn-toggle-outline", false);
}

export function isOutlineVisible(): boolean {
  return !!bw.el("outline") && !bw.hasClass("outline", "hidden");
}

/** Flip the panel; returns true when it is now visible. */
export function toggleOutline(): boolean {
  const show = !isOutlineVisible();
  if (show) showOutline();
  else hideOutline();
  return show;
}

function keyOf(h: Heading): string {
  return `${h.line}:${h.text}`;
}

function createItem(h: Heading): Taco {
  return {
    t: "div",
    a: {
      class: `outline-item level-${h.level}`,
      role: "button",
      tabindex: "0",
      title: h.text,
      "data-line": String(h.line),
      onclick: () => jumpToHeading(h),
      onkeydown: (e: Event) => {
        const key = (e as KeyboardEvent).key;
        if (key === "Enter" || key === " ") {
          e.preventDefault();
          jumpToHeading(h);
        }
      },
    },
    c: h.text || "(untitled)",
  };
}

/** Reconcile the list with the headings of `md`. Exported for tests; `initOutline` schedules it. */
export function renderOutline(md: string): Heading[] {
  const list = bw.el("outline-list");
  current = parseOutline(md);
  if (!list) return current;
  if (current.length === 0) {
    bw.patch(list, emptyNote());
    return current;
  }
  // The empty-state note is not a keyed row; drop it before reconciling.
  if (list.querySelector(".outline-note")) bw.clear(list);
  syncChildren(list, current, { key: keyOf, create: createItem });
  return current;
}

/** Move the caret to the start of `h.line` and scroll both panes there. */
export function jumpToHeading(h: Heading): void {
  const offset = lineStartOffset(getMarkdown(), h.line);
  focusEditor();
  setSelection(offset, offset);
  scrollToLine(h.line);
}

/** Start mirroring the editor's headings into the panel. Idempotent; returns the unsubscribe function. */
export function initOutline(): () => void {
  unsubscribe?.();
  const scheduled = debounce((md: string) => {
    if (isOutlineVisible()) renderOutline(md);
  }, OUTLINE_DEBOUNCE_MS);
  const offChange = onEditorChange((md) => scheduled(md));
  const offTabs = bw.sub(TABS_CHANGED, () => scheduled(getMarkdown()));
  unsubscribe = () => {
    scheduled.cancel();
    offChange();
    offTabs();
  };
  renderOutline(getMarkdown());
  return () => {
    unsubscribe?.();
    unsubscribe = null;
  };
}

/** Cmd/Ctrl+Shift+O toggles the panel. Returns true (and prevents default) when handled. */
export function handleOutlineKeydown(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return false;
  if (e.key.toLowerCase() !== "o") return false;
  e.preventDefault();
  toggleOutline();
  return true;
}
