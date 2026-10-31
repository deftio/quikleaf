// @ts-ignore — standalone bundle, aliased via vite.config.ts
import QuikdownEditor from "quikdown-standalone";

export type EditorChangeListener = (md: string, html: string) => void;

let editorInstance: any = null;
const changeListeners = new Set<EditorChangeListener>();

export function initEditor(container: HTMLElement): any {
  editorInstance = new QuikdownEditor(container, {
    mode: "split",
    theme: "auto",
    showToolbar: true,
    showUndoRedo: true,
    enableComplexFences: true,
    allowExternalFetch: true,
    placeholder: "Start typing markdown or open a file...",
    onChange: notifyEditorChange,
  });
  return editorInstance;
}

/**
 * Register for every markdown change the editor reports (typing, preview
 * edits, undo/redo, and `setMarkdown`). Returns the unsubscribe function.
 */
export function onEditorChange(fn: EditorChangeListener): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/**
 * Fan an editor change out to the listeners. This is the editor's `onChange`
 * callback; it is exported so tests and code that drives the source textarea
 * directly can report a change through the same path.
 */
export function notifyEditorChange(md: string, html: string): void {
  for (const fn of changeListeners) fn(md, html);
}

export function getEditor(): any {
  return editorInstance;
}

export function getMarkdown(): string {
  return editorInstance?.getMarkdown() ?? "";
}

/**
 * Replace the document. QuikdownEditor.setMarkdown is async (it awaits its own
 * init) and reports the new text through `onChange`; await the returned
 * promise when the caller needs the change listeners to have run.
 */
export function setMarkdown(md: string): Promise<void> {
  return Promise.resolve(editorInstance?.setMarkdown(md)).then(() => undefined);
}

export function getHTML(): string {
  return editorInstance?.getHTML() ?? "";
}

export function undo(): void {
  editorInstance?.undo();
}

export function redo(): void {
  editorInstance?.redo();
}

/**
 * QuikdownEditor exposes no cursor API, so both of the functions below work
 * against its source textarea (`sourceTextarea`) directly. Do not swap these
 * for `editorInstance.insertText()` / `.getSelection()` — those methods do not
 * exist on the editor and calling them throws.
 */
function sourceTextarea(): HTMLTextAreaElement | null {
  return (editorInstance?.sourceTextarea as HTMLTextAreaElement) ?? null;
}

/** The editor's source `<textarea>` (find, outline navigation), or null before init. */
export function getSourceTextarea(): HTMLTextAreaElement | null {
  return sourceTextarea();
}

/** The editor's rendered preview pane (`.qde-preview`), or null before init. */
export function getPreviewPane(): HTMLElement | null {
  return (editorInstance?.previewPanel as HTMLElement) ?? null;
}

/**
 * Replace `[start, end)` of the source with `text` and report it as an input
 * event, so the preview, undo stack and onChange all see the edit (the same
 * path `insertAtCursor` uses). `select` controls the resulting selection.
 */
export function replaceRange(start: number, end: number, text: string, select: SelectionMode = "end"): void {
  const ta = sourceTextarea();
  if (!ta) return;
  ta.setRangeText(text, start, end, select);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

export function insertAtCursor(text: string): void {
  const ta = sourceTextarea();
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  ta.setRangeText(text, start, end, "end");
  // Drive the editor's own input handler so the preview, undo stack, and
  // onChange callback all see the edit.
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The selected markdown in the source pane, or "" when nothing is selected. */
export function getSelection(): string {
  const ta = sourceTextarea();
  if (!ta) return "";
  return ta.value.slice(ta.selectionStart ?? 0, ta.selectionEnd ?? 0);
}
