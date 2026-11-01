/**
 * Find & replace bar. Rendered above the editor (after the tab bar) inside
 * `#editor-column`, hidden until Cmd/Ctrl+F or Cmd/Ctrl+H.
 *
 * Matching is `editor/find.ts`; this module owns the controls and drives the
 * quikdown source textarea: selecting a match is `setSelectionRange`, and a
 * replacement goes through `replaceRange`, which dispatches an `input` event
 * so the preview, undo stack and onChange all see it.
 */
import bw from "bitwrench";
import type { Taco } from "bitwrench";
import { getSelection, getSourceTextarea, onEditorChange, replaceRange } from "../editor/editor";
import { findMatches, formatCount, isValidQuery, nearestMatch, replaceAll as replaceAllIn, type MatchRange } from "../editor/find";
import { lineOfOffset } from "../editor/outline";
import { control, el, isModalOpen, withAttrs } from "./taco";

const DEFAULT_LINE_HEIGHT = 21;

let matches: MatchRange[] = [];
let currentIndex = -1;
let unsubscribe: (() => void) | null = null;

function input(id: string): HTMLInputElement {
  return control<HTMLInputElement>(id);
}

function options() {
  return { matchCase: input("find-case").checked, regex: input("find-regex").checked };
}

export function makeFindBar(): Taco {
  const onFindKeydown = (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) findPrev();
      else findNext();
    }
  };
  const onReplaceKeydown = (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) findPrev();
      else replaceCurrent();
    }
  };
  return {
    t: "div",
    a: {
      id: "find-bar",
      class: "hidden",
      role: "search",
      onkeydown: (e: Event) => {
        if ((e as KeyboardEvent).key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeFind();
        }
      },
    },
    c: [
      {
        t: "div",
        a: { class: "find-row" },
        c: [
          withAttrs(bw.makeInput({ type: "text", placeholder: "Find", oninput: () => search(1, true) }), {
            id: "find-input",
            class: "find-field",
            "aria-label": "Find",
            autocomplete: "off",
            spellcheck: "false",
            onkeydown: onFindKeydown,
          }),
          { t: "span", a: { id: "find-count", class: "find-count", "aria-live": "polite" }, c: "" },
          withAttrs(bw.makeButton({ text: "↑", variant: "secondary", size: "sm", onclick: () => findPrev() }), {
            id: "find-prev",
            title: "Previous match (Shift+Enter)",
            "aria-label": "Previous match",
          }),
          withAttrs(bw.makeButton({ text: "↓", variant: "secondary", size: "sm", onclick: () => findNext() }), {
            id: "find-next",
            title: "Next match (Enter)",
            "aria-label": "Next match",
          }),
          { t: "span", a: { class: "find-switches" }, c: [
            bw.makeSwitch({ id: "find-case", label: "Aa", title: "Match case", onchange: () => search(1, true) }),
            bw.makeSwitch({ id: "find-regex", label: ".*", title: "Regular expression", onchange: () => search(1, true) }),
          ] },
          withAttrs(bw.makeButton({ text: "×", variant: "secondary", size: "sm", onclick: () => closeFind() }), {
            id: "find-close",
            title: "Close (Esc)",
            "aria-label": "Close find bar",
          }),
        ],
      },
      {
        t: "div",
        a: { class: "find-row" },
        c: [
          withAttrs(bw.makeInput({ type: "text", placeholder: "Replace" }), {
            id: "find-replace-input",
            class: "find-field",
            "aria-label": "Replace with",
            autocomplete: "off",
            spellcheck: "false",
            onkeydown: onReplaceKeydown,
          }),
          withAttrs(bw.makeButton({ text: "Replace", variant: "secondary", size: "sm", onclick: () => replaceCurrent() }), {
            id: "find-replace-one",
            title: "Replace this match (Enter in the replace field)",
          }),
          withAttrs(bw.makeButton({ text: "Replace All", variant: "secondary", size: "sm", onclick: () => replaceAll() }), {
            id: "find-replace-all",
          }),
        ],
      },
    ],
  };
}

export function isFindOpen(): boolean {
  const bar = el("find-bar");
  return !!bar && !bar.classList.contains("hidden");
}

/**
 * Show the bar and focus the find field (or the replace field), prefilling
 * the query with the editor's current selection when there is one.
 */
export function openFind(opts: { replace?: boolean } = {}): void {
  if (!el("find-bar")) return;
  bw.removeClass("find-bar", "hidden");
  const selected = getSelection();
  const find = input("find-input");
  if (selected && !selected.includes("\n")) find.value = selected;
  const target = opts.replace ? input("find-replace-input") : find;
  target.focus();
  target.select?.();
  search(1, true);
}

/** Hide the bar and hand focus back to the source textarea. */
export function closeFind(): void {
  if (!el("find-bar")) return;
  bw.addClass("find-bar", "hidden");
  getSourceTextarea()?.focus();
}

export function toggleFind(): void {
  if (isFindOpen()) closeFind();
  else openFind();
}

/** The current match list and index (tests, status). */
export function findState(): { matches: MatchRange[]; index: number } {
  return { matches, index: currentIndex };
}

function updateCount(): void {
  const query = input("find-input").value;
  const valid = isValidQuery(query, options());
  bw.patch("find-count", formatCount(matches.length, currentIndex, query, valid));
  bw.toggleClass("find-input", "invalid", !valid);
}

function selectMatch(index: number): void {
  currentIndex = index;
  const ta = getSourceTextarea();
  const m = matches[index];
  if (ta && m) {
    ta.setSelectionRange(m.start, m.end);
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || DEFAULT_LINE_HEIGHT;
    const line = lineOfOffset(ta.value, m.start);
    const top = line * lineHeight;
    const view = ta.clientHeight || 0;
    if (top < ta.scrollTop || top > ta.scrollTop + view - lineHeight) {
      ta.scrollTop = Math.max(0, top - Math.floor(view / 2));
    }
  }
  updateCount();
}

/**
 * Recompute matches from the textarea text and select the nearest one in
 * `direction` from the caret. With `fromCursor` false the current match's
 * own start is skipped so repeated Next moves on.
 */
function search(direction: 1 | -1, fromCursor: boolean): void {
  const ta = getSourceTextarea();
  const query = input("find-input").value;
  matches = ta ? findMatches(ta.value, query, options()) : [];
  if (!ta || matches.length === 0) {
    currentIndex = -1;
    updateCount();
    return;
  }
  const anchor = fromCursor
    ? direction === 1 ? ta.selectionStart : ta.selectionEnd
    : direction === 1 ? ta.selectionStart + 1 : ta.selectionEnd - 1;
  selectMatch(nearestMatch(matches, anchor, direction));
}

export function findNext(): void {
  search(1, false);
}

export function findPrev(): void {
  search(-1, false);
}

/** Replace the selected match (selecting one first if none is) and move to the next. */
export function replaceCurrent(): void {
  const ta = getSourceTextarea();
  if (!ta) return;
  if (currentIndex === -1 || !matches[currentIndex]) search(1, true);
  const m = matches[currentIndex];
  if (!m) return;
  // The selection may have moved since the match was shown; re-anchor on the match itself.
  const replacement = input("find-replace-input").value;
  replaceRange(m.start, m.end, replacement, "end");
  search(1, true);
}

/** Replace every match in one edit (a single undo step). */
export function replaceAll(): void {
  const ta = getSourceTextarea();
  if (!ta) return;
  const query = input("find-input").value;
  const all = findMatches(ta.value, query, options());
  if (all.length === 0) {
    matches = [];
    currentIndex = -1;
    updateCount();
    return;
  }
  const replacement = input("find-replace-input").value;
  const caret = ta.selectionStart;
  replaceRange(0, ta.value.length, replaceAllIn(ta.value, all, replacement), "preserve");
  ta.setSelectionRange(Math.min(caret, ta.value.length), Math.min(caret, ta.value.length));
  search(1, true);
}

/** Keep the count honest while the bar is open and the document changes underneath it. */
export function initFindBar(): () => void {
  unsubscribe?.();
  unsubscribe = onEditorChange(() => {
    if (!isFindOpen()) return;
    const ta = getSourceTextarea();
    const query = input("find-input").value;
    matches = ta ? findMatches(ta.value, query, options()) : [];
    if (currentIndex >= matches.length) currentIndex = matches.length - 1;
    updateCount();
  });
  return () => {
    unsubscribe?.();
    unsubscribe = null;
  };
}

/**
 * Cmd/Ctrl+F opens the bar on the find field, Cmd/Ctrl+H on the replace
 * field; Escape closes an open bar. Returns true (and prevents default) when handled.
 */
export function handleFindKeydown(e: KeyboardEvent): boolean {
  if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
    // Escape from the editor (the bar's own handler covers its fields) closes an open bar.
    if (!isFindOpen() || isModalOpen()) return false;
    e.preventDefault();
    closeFind();
    return true;
  }
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return false;
  const key = e.key.toLowerCase();
  if (key !== "f" && key !== "h") return false;
  e.preventDefault();
  openFind({ replace: key === "h" });
  return true;
}
