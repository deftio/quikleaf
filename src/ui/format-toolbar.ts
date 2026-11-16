/**
 * The formatting row, under the tab's control row and above `#tab-body`:
 *
 *   B I S Code Link | H1 H2 H3 | • List 1. List ☐ Task Quote Code Block Table Rule | Outdent Indent
 *
 * Every button is one call to quikdown's `format()` (1.3+), which edits
 * whichever pane the caret is in, so the row works the same in Source and
 * Rendered. A button swallows its mousedown so the caret stays in the editor
 * and the command lands on the user's selection. Pressed state follows the
 * editor's `onSelectionChange` (bold at the caret, heading level, list kind,
 * …). View → Formatting Bar hides the row; Settings remembers that.
 *
 * The row is quikleaf's, drawn over the editor API like `editor-toolbar.ts`;
 * quikdown's own toolbar stays off.
 */
import bw from "bitwrench";
import type { Taco } from "bitwrench";
import { onEditorSelectionChange, type FormatCommand, type FormatState } from "../editor/editor";
import { patchAttrs } from "./taco";

export interface FormatButton {
  cmd: FormatCommand;
  label: string;
  title: string;
  /** Whether the button shows pressed for a format state. Omitted: never pressed (Table, Rule, Indent …). */
  pressed?: (s: FormatState) => boolean;
}

export const FORMAT_GROUPS: FormatButton[][] = [
  [
    { cmd: "bold", label: "B", title: "Bold (Cmd/Ctrl+B)", pressed: (s) => s.bold },
    { cmd: "italic", label: "I", title: "Italic (Cmd/Ctrl+I)", pressed: (s) => s.italic },
    { cmd: "strike", label: "S", title: "Strikethrough", pressed: (s) => s.strike },
    { cmd: "code", label: "Code", title: "Inline code", pressed: (s) => s.code },
    { cmd: "link", label: "Link", title: "Link", pressed: (s) => s.link },
  ],
  [
    { cmd: "h1", label: "H1", title: "Heading 1", pressed: (s) => s.heading === 1 },
    { cmd: "h2", label: "H2", title: "Heading 2", pressed: (s) => s.heading === 2 },
    { cmd: "h3", label: "H3", title: "Heading 3", pressed: (s) => s.heading === 3 },
  ],
  [
    { cmd: "ul", label: "• List", title: "Bulleted list", pressed: (s) => s.list === "ul" },
    { cmd: "ol", label: "1. List", title: "Numbered list", pressed: (s) => s.list === "ol" },
    { cmd: "task", label: "☐ Task", title: "Task list", pressed: (s) => s.list === "task" },
    { cmd: "quote", label: "Quote", title: "Block quote", pressed: (s) => s.quote },
    { cmd: "codeblock", label: "Code Block", title: "Fenced code block", pressed: (s) => s.codeblock },
    { cmd: "table", label: "Table", title: "Insert a table" },
    { cmd: "hr", label: "Rule", title: "Horizontal rule" },
  ],
  [
    { cmd: "outdent", label: "Outdent", title: "Outdent list item (Shift+Tab)" },
    { cmd: "indent", label: "Indent", title: "Indent list item (Tab)" },
  ],
];

/** Every button in row order. */
export const FORMAT_BUTTONS: FormatButton[] = FORMAT_GROUPS.flat();

/** Element id of a format button (`fmt-bold` …). */
export function formatButtonId(cmd: FormatCommand): string {
  return `fmt-${cmd}`;
}

export interface FormatToolbarHandlers {
  onFormat: (cmd: FormatCommand) => void;
}

function formatButton(b: FormatButton, h: FormatToolbarHandlers): Taco {
  return {
    t: "button",
    a: {
      id: formatButtonId(b.cmd),
      class: `tool-btn fmt-btn fmt-${b.cmd}`,
      type: "button",
      title: b.title,
      "aria-pressed": "false",
      // Keep the caret (and the selection) in the editor: the command applies to it.
      onmousedown: (e: Event) => e.preventDefault(),
      onclick: () => h.onFormat(b.cmd),
    },
    c: b.label,
  };
}

export function makeFormatToolbar(h: FormatToolbarHandlers, visible = true): Taco {
  const groups: Taco[] = [];
  FORMAT_GROUPS.forEach((group, i) => {
    if (i > 0) groups.push({ t: "span", a: { class: "tool-sep", "aria-hidden": "true" } });
    groups.push({ t: "div", a: { class: "tool-group" }, c: group.map((b) => formatButton(b, h)) });
  });
  return {
    t: "div",
    a: { id: "format-toolbar", class: visible ? "" : "hidden", role: "toolbar", "aria-label": "Formatting" },
    c: groups,
  };
}

/** Press the buttons that describe the state at the caret; `null` (no editor, or focus elsewhere) releases them all. */
export function setFormatToolbarState(s: FormatState | null): void {
  for (const b of FORMAT_BUTTONS) {
    const node = bw.el(formatButtonId(b.cmd));
    if (!node) continue;
    const on = !!s && !!b.pressed?.(s);
    patchAttrs(node, { "aria-pressed": on ? "true" : "false" });
  }
}

export function setFormatToolbarVisible(on: boolean): void {
  bw.toggleClass("format-toolbar", "hidden", !on);
}

export function isFormatToolbarVisible(): boolean {
  const node = bw.el("format-toolbar");
  return !!node && !node.classList.contains("hidden");
}

/** Follow the editor's selection. Idempotent; returns the unsubscribe function. */
let unsubscribe: (() => void) | null = null;
export function initFormatToolbar(): () => void {
  unsubscribe?.();
  unsubscribe = onEditorSelectionChange((sel) => setFormatToolbarState(sel.format));
  return () => {
    unsubscribe?.();
    unsubscribe = null;
  };
}
