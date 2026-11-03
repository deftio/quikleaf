/**
 * The tab's control row, under the tab bar and above `#tab-body`:
 *
 *   [Files] [Outline] [Chat] | Source Split Rendered · Undo Redo … Copy MD/HTML/Rendered | [Info]
 *
 * Panel toggles sit at the end their panel opens on: Files and Outline (the
 * window's left-hand panels) and the chat drawer on the left, the info pane
 * on the right. `#editor-column.chat-right` moves the Chat toggle to the
 * right end with its drawer (CSS `order`).
 *
 * The editor controls in the middle are quikleaf's; quikdown runs headless
 * (`showToolbar: false` in `editor/editor.ts`). Source / Split / Rendered
 * are the active tab's view mode (`ui/panes.ts` owns it, and the editor's
 * `onModeChange` keeps the buttons in step). Undo / Redo follow the editor's
 * history after every change. The copy buttons flash "Copied" when the
 * clipboard write went through. On the project tab (no document) the editor
 * controls are hidden and the toggles stay.
 */
import bw from "bitwrench";
import type { Taco, TacoContent } from "bitwrench";
import { EDITOR_MODES, canRedo, canUndo, onEditorChange, onEditorModeChange, type EditorMode } from "../editor/editor";
import { makeToggleButton } from "./shell";
import { patchAttrs } from "./taco";

export type CopyKind = "markdown" | "html" | "rendered";

export interface EditorToolbarHandlers {
  onMode: (mode: EditorMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: (kind: CopyKind) => void;
  /** Panel toggles at the row's ends. Omit one to leave it out. Files starts hidden (project mode reveals it). */
  onToggleFiles?: () => void;
  onToggleOutline?: () => void;
  onToggleChat?: () => void;
  onToggleInfo?: () => void;
}

const MODE_LABELS: Record<EditorMode, string> = { source: "Source", split: "Split", preview: "Rendered" };

const COPY_BUTTONS: Array<{ kind: CopyKind; id: string; label: string; title: string }> = [
  { kind: "markdown", id: "tool-copy-md", label: "Copy MD", title: "Copy the markdown source" },
  { kind: "html", id: "tool-copy-html", label: "Copy HTML", title: "Copy the rendered HTML" },
  { kind: "rendered", id: "tool-copy-rendered", label: "Copy Rendered", title: "Copy as rich text" },
];

/** Element id of a mode button (`tool-mode-source` …). */
export function modeButtonId(mode: EditorMode): string {
  return `tool-mode-${mode}`;
}

/** Element id of a copy button (`tool-copy-md` …). */
export function copyButtonId(kind: CopyKind): string {
  return COPY_BUTTONS.find((b) => b.kind === kind)!.id;
}

function toolButton(id: string, label: string, title: string, onclick: () => void, extra: Record<string, unknown> = {}): Taco {
  return { t: "button", a: { id, class: "tool-btn", type: "button", title, onclick, ...extra }, c: label };
}

function sep(): Taco {
  return { t: "span", a: { class: "tool-sep editor-only", "aria-hidden": "true" } };
}

export function makeEditorToolbar(h: EditorToolbarHandlers): Taco {
  const left: TacoContent[] = [];
  if (h.onToggleFiles) left.push(makeToggleButton("btn-toggle-files", "Files", h.onToggleFiles, "hidden", "toolbar"));
  if (h.onToggleOutline) left.push(makeToggleButton("btn-toggle-outline", "Outline", h.onToggleOutline, "", "toolbar"));
  if (h.onToggleChat) left.push(makeToggleButton("btn-toggle-chat", "Chat", h.onToggleChat, "", "toolbar"));
  const right: TacoContent[] = [];
  if (h.onToggleInfo) right.push(makeToggleButton("btn-toggle-info", "Info", h.onToggleInfo, "", "toolbar"));

  return {
    t: "div",
    a: { id: "editor-toolbar", role: "toolbar", "aria-label": "Editor" },
    c: [
      ...left,
      {
        t: "div",
        a: { class: "tool-group editor-only", role: "radiogroup", "aria-label": "View" },
        c: EDITOR_MODES.map((mode) =>
          toolButton(modeButtonId(mode), MODE_LABELS[mode], `${MODE_LABELS[mode]} view`, () => h.onMode(mode), {
            role: "radio",
            "aria-checked": mode === "split" ? "true" : "false",
          }),
        ),
      },
      sep(),
      {
        t: "div",
        a: { class: "tool-group editor-only" },
        c: [
          toolButton("tool-undo", "Undo", "Undo (Cmd/Ctrl+Z)", h.onUndo, { disabled: "" }),
          toolButton("tool-redo", "Redo", "Redo (Cmd/Ctrl+Shift+Z)", h.onRedo, { disabled: "" }),
        ],
      },
      { t: "span", a: { class: "tool-spacer", "aria-hidden": "true" } },
      {
        t: "div",
        a: { class: "tool-group editor-only" },
        c: COPY_BUTTONS.map((b) => toolButton(b.id, b.label, b.title, () => h.onCopy(b.kind))),
      },
      ...right,
    ],
  };
}

/** Mark one mode button checked. */
export function setEditorToolbarMode(mode: EditorMode): void {
  for (const m of EDITOR_MODES) {
    const node = bw.el(modeButtonId(m));
    if (!node) continue;
    patchAttrs(node, { "aria-checked": m === mode ? "true" : "false" });
  }
}

/** Enable or disable Undo / Redo. */
export function setEditorToolbarHistory(undo: boolean, redo: boolean): void {
  const u = bw.el("tool-undo") as HTMLButtonElement | null;
  const r = bw.el("tool-redo") as HTMLButtonElement | null;
  if (u) u.disabled = !undo;
  if (r) r.disabled = !redo;
}

/** Show "Copied" on a copy button for a moment, then put its label back. */
export function flashCopied(kind: CopyKind, ms = 1200): void {
  const spec = COPY_BUTTONS.find((b) => b.kind === kind)!;
  const node = bw.el(spec.id);
  if (!node) return;
  bw.patch(node, "Copied");
  bw.addClass(node, "copied");
  setTimeout(() => {
    bw.patch(node, spec.label);
    bw.removeClass(node, "copied");
  }, ms);
}

/**
 * Keep the row in step with the editor: the checked mode follows the
 * editor's `onModeChange`, Undo / Redo follow its history after each change.
 * Idempotent; returns the unsubscribe function.
 */
let unsubscribers: Array<() => void> = [];
export function initEditorToolbar(): () => void {
  for (const off of unsubscribers) off();
  unsubscribers = [
    onEditorModeChange(setEditorToolbarMode),
    onEditorChange(() => setEditorToolbarHistory(canUndo(), canRedo())),
  ];
  return () => {
    for (const off of unsubscribers) off();
    unsubscribers = [];
  };
}
