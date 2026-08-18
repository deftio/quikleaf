// @ts-ignore — standalone bundle, aliased via vite.config.ts
import QuikdownEditor from "quikdown-standalone";

let editorInstance: any = null;

export function initEditor(container: HTMLElement): any {
  editorInstance = new QuikdownEditor(container, {
    mode: "split",
    theme: "auto",
    showToolbar: true,
    showUndoRedo: true,
    enableComplexFences: true,
    allowExternalFetch: true,
    placeholder: "Start typing markdown or open a file...",
    onChange: (_md: string, _html: string) => {
      updateStatusBar();
    },
  });
  return editorInstance;
}

export function getEditor(): any {
  return editorInstance;
}

export function getMarkdown(): string {
  return editorInstance?.getMarkdown() ?? "";
}

export function setMarkdown(md: string): void {
  editorInstance?.setMarkdown(md);
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

function updateStatusBar() {
  // Status bar updates are handled by main.ts via onChange
}
