/**
 * The quikdown editor, behind the API quikleaf uses.
 *
 * quikleaf embeds `QuikdownEditor` (the standalone build) headless and draws
 * its own controls (`ui/editor-toolbar.ts`, `ui/format-toolbar.ts`) over the
 * editor's public API. Everything the rest of the app needs from the editor
 * goes through this module and only through the API in `quikdown/edit-standalone`:
 * selection, edits, formatting, scroll, history, mode, and the callbacks
 * (change, mode, selection, render, link click, image resolution). Nothing
 * here or elsewhere reaches into the editor's panes.
 */
import QuikdownEditor, {
  type ChangeMeta,
  type EditorHistory,
  type EditorMode as QuikdownMode,
  type EditorPane,
  type EditorScroll,
  type EditorSelection,
  type FormatCommand,
  type FormatState,
  type SetMarkdownOptions,
} from "quikdown/edit-standalone";

export type { ChangeMeta, EditorHistory, EditorPane, EditorScroll, EditorSelection, FormatCommand, FormatState, SetMarkdownOptions };

export type EditorChangeListener = (md: string, html: string, meta: ChangeMeta) => void;
export type EditorMode = QuikdownMode;
export type EditorModeListener = (mode: EditorMode) => void;
/** What `onSelectionChange` reports: the selection plus the formatting at it. */
export type EditorSelectionInfo = EditorSelection & { format: FormatState };
export type EditorSelectionListener = (sel: EditorSelectionInfo) => void;
export type EditorRenderListener = (preview: HTMLElement) => void;
/** Where a clicked preview link goes. Return true to let the webview navigate. */
export type LinkHandler = (href: string, event: MouseEvent) => boolean | void;
/** The URL the preview shows for an image `src`; undefined keeps it as written. */
export type ImageResolver = (src: string, info: { alt: string; title: string }) => string | void;

export const EDITOR_MODES: EditorMode[] = ["source", "split", "preview"];

/**
 * The instance is typed `any` on purpose: the unit tests drive the mock in
 * `test-setup.ts` through `getEditor()` and poke its vi.fn() members.
 */
let editorInstance: any = null;
/** Mirror of the editor's mode, kept from `setEditorMode` and `onModeChange` so `getEditorMode()` needs no instance. */
let currentMode: EditorMode = "split";
const changeListeners = new Set<EditorChangeListener>();
const modeListeners = new Set<EditorModeListener>();
const selectionListeners = new Set<EditorSelectionListener>();
const renderListeners = new Set<EditorRenderListener>();
let linkHandler: LinkHandler | null = null;
let imageResolver: ImageResolver | null = null;

export function initEditor(container: HTMLElement): any {
  editorInstance = new QuikdownEditor(container, {
    mode: "split",
    theme: "auto",
    // Headless: quikleaf draws its own toolbars over this API, so the
    // controls share the shell's palette.
    showToolbar: false,
    showUndoRedo: false,
    // Cmd/Ctrl+B / I, Tab / Shift+Tab in lists, Cmd/Ctrl+Z / Y: the editor's own.
    shortcuts: true,
    enableComplexFences: true,
    allowExternalFetch: true,
    placeholder: "Start typing markdown or open a file...",
    onChange: notifyEditorChange,
    onModeChange: notifyEditorModeChange,
    onSelectionChange: notifyEditorSelectionChange,
    onRender: notifyEditorRender,
    onLinkClick: (href: string, event: MouseEvent) => linkHandler?.(href, event) ?? false,
    resolveImageSrc: (src: string, info: { alt: string; title: string }) => imageResolver?.(src, info),
  });
  currentMode = "split";
  return editorInstance;
}

export function getEditor(): any {
  return editorInstance;
}

// --- Mode ---------------------------------------------------------------------

/** Register for mode changes (the toolbar's Source / Split / Rendered, the shortcuts, or `setEditorMode`). */
export function onEditorModeChange(fn: EditorModeListener): () => void {
  modeListeners.add(fn);
  return () => modeListeners.delete(fn);
}

/** The editor's `onModeChange` callback; exported so tests can drive it. */
export function notifyEditorModeChange(mode: string): void {
  if (!EDITOR_MODES.includes(mode as EditorMode)) return;
  currentMode = mode as EditorMode;
  for (const fn of modeListeners) fn(currentMode);
}

export function getEditorMode(): EditorMode {
  return currentMode;
}

/** Switch Source / Split / Preview. A no-op when the editor is already in that mode. */
export function setEditorMode(mode: EditorMode): void {
  if (!editorInstance || currentMode === mode) return;
  currentMode = mode;
  editorInstance.setMode?.(mode);
}

// --- Content and change notifications ------------------------------------------

/**
 * Register for every markdown change the editor reports (typing, preview
 * edits, formatting, undo/redo, and `setMarkdown`); `meta.source` says
 * which. Returns the unsubscribe function.
 */
export function onEditorChange(fn: EditorChangeListener): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/** The editor's `onChange` callback; exported so tests can report a change through the same path. */
export function notifyEditorChange(md: string, html: string, meta: ChangeMeta = { source: "api" }): void {
  for (const fn of changeListeners) fn(md, html, meta);
}

export function getMarkdown(): string {
  return editorInstance?.getMarkdown() ?? "";
}

/**
 * Replace the document. QuikdownEditor.setMarkdown is async (it awaits its own
 * init) and reports the new text through `onChange`; await the returned
 * promise when the caller needs the change listeners to have run. Pass
 * `{ history: "reset" }` when a different document is being loaded.
 */
export function setMarkdown(md: string, options?: SetMarkdownOptions): Promise<void> {
  if (!editorInstance) return Promise.resolve();
  const call = options ? editorInstance.setMarkdown(md, options) : editorInstance.setMarkdown(md);
  return Promise.resolve(call).then(() => undefined);
}

export function getHTML(): string {
  return editorInstance?.getHTML() ?? "";
}

// --- Selection, caret, edits -----------------------------------------------------

/** Register for selection changes in either pane (the formatting bar's pressed state). */
export function onEditorSelectionChange(fn: EditorSelectionListener): () => void {
  selectionListeners.add(fn);
  return () => selectionListeners.delete(fn);
}

/** The editor's `onSelectionChange` callback; exported so tests can drive it. */
export function notifyEditorSelectionChange(sel: EditorSelectionInfo): void {
  for (const fn of selectionListeners) fn(sel);
}

/** The selection as markdown offsets, from whichever pane the user is in; null before init. */
export function getSelectionRange(): EditorSelection | null {
  return editorInstance?.getSelection?.() ?? null;
}

/** The selected markdown, or "" when nothing is selected. */
export function getSelection(): string {
  return getSelectionRange()?.text ?? "";
}

/** Select `[start, end)` of the markdown, or place the caret at `start`. */
export function setSelection(start: number, end: number = start, pane?: EditorPane): void {
  if (!editorInstance) return;
  if (pane) editorInstance.setSelection?.(start, end, pane);
  else editorInstance.setSelection?.(start, end);
}

/** Put keyboard focus in the editor (the pane the mode shows, or `pane`). */
export function focusEditor(pane?: EditorPane): void {
  editorInstance?.focus?.(pane);
}

/** The pane that has keyboard focus, or null when focus is outside the editor. */
export function getFocusedPane(): EditorPane | null {
  return editorInstance?.getFocusedPane?.() ?? null;
}

/** Insert at the caret, replacing the selection; the editor reports it through `onChange` (source `edit`). */
export function insertAtCursor(text: string): void {
  editorInstance?.insertText?.(text);
}

/**
 * Replace `[start, end)` of the markdown with `text`. `select` is the
 * resulting selection: the caret after the text (`end`, default), the new
 * text (`select`), or the caret where it was (`preserve`, clamped).
 */
export function replaceRange(start: number, end: number, text: string, select: "end" | "select" | "preserve" = "end"): void {
  if (!editorInstance) return;
  const caret = select === "preserve" ? (getSelectionRange()?.start ?? 0) : 0;
  editorInstance.replaceRange(start, end, text, select === "select");
  if (select === "preserve") {
    const n = getMarkdown().length;
    setSelection(Math.min(caret, n));
  }
}

// --- Formatting ------------------------------------------------------------------

/** Apply a formatting command to the selection in the focused pane. False when the editor is not up or the command is unknown. */
export function format(command: FormatCommand): boolean {
  return !!editorInstance?.format?.(command);
}

/** The formatting at the caret or selection, or null before init. */
export function getFormatState(): FormatState | null {
  return editorInstance?.getFormatState?.() ?? null;
}

// --- Scroll and lines ------------------------------------------------------------

export function getScroll(): EditorScroll {
  return editorInstance?.getScroll?.() ?? { source: 0, preview: 0 };
}

export function setScroll(scroll: Partial<EditorScroll>): void {
  editorInstance?.setScroll?.(scroll);
}

/** Scroll a zero-based source line into view in both panes (or `pane`). */
export function scrollToLine(line: number, pane?: EditorPane): void {
  if (!editorInstance) return;
  if (pane) editorInstance.scrollToLine?.(line, pane);
  else editorInstance.scrollToLine?.(line);
}

// --- Rendering, links, images -------------------------------------------------------

/** Register for every render of the preview pane. */
export function onEditorRender(fn: EditorRenderListener): () => void {
  renderListeners.add(fn);
  return () => renderListeners.delete(fn);
}

/** The editor's `onRender` callback; exported so tests can drive it. */
export function notifyEditorRender(preview: HTMLElement): void {
  for (const fn of renderListeners) fn(preview);
}

/** Decide what a link clicked in the preview does (`editor/links.ts`). */
export function setLinkHandler(fn: LinkHandler | null): void {
  linkHandler = fn;
}

/** Decide what the preview loads for an image `src` (`editor/images.ts`). The markdown keeps the original. */
export function setImageResolver(fn: ImageResolver | null): void {
  imageResolver = fn;
}

/** Render the current markdown again (an image resolver's inputs changed, say). Not an edit: the history is untouched. */
export function rerender(): Promise<void> {
  if (!editorInstance) return Promise.resolve();
  return setMarkdown(getMarkdown(), { history: "keep", source: "api" });
}

// --- History ---------------------------------------------------------------------

export function undo(): void {
  editorInstance?.undo();
}

export function redo(): void {
  editorInstance?.redo();
}

export function canUndo(): boolean {
  return !!editorInstance?.canUndo?.();
}

export function canRedo(): boolean {
  return !!editorInstance?.canRedo?.();
}

/** A copy of the undo and redo stacks (one per document; `documents.ts` swaps them on tab switches). */
export function getHistory(): EditorHistory {
  return editorInstance?.getHistory?.() ?? { undo: [], redo: [] };
}

export function setHistory(state: Partial<EditorHistory> | null | undefined): void {
  editorInstance?.setHistory?.(state ?? null);
}

export function clearHistory(): void {
  editorInstance?.clearHistory?.();
}

// --- Theme and clipboard ---------------------------------------------------------

/**
 * Match quikdown's own theme to the app's. Its `theme: "auto"` follows the
 * OS, not our `#app.dark`, so the toggle and Settings → Theme call this.
 */
export function setEditorTheme(dark: boolean): void {
  editorInstance?.setTheme?.(dark ? "dark" : "light");
}

/**
 * Copy the document to the clipboard as markdown, as HTML, or as rich text
 * (the rendered preview, through quikdown's `copyRendered`). Resolves true
 * when the write went through.
 */
export async function copyToClipboard(kind: "markdown" | "html" | "rendered"): Promise<boolean> {
  if (!editorInstance) return false;
  try {
    if (kind === "rendered") await editorInstance.copyRendered();
    else await navigator.clipboard.writeText(kind === "markdown" ? getMarkdown() : getHTML());
    return true;
  } catch (e) {
    console.error("Copy failed:", e);
    return false;
  }
}
