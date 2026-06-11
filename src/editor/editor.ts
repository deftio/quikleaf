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

export function insertAtCursor(text: string): void {
  editorInstance?.insertText(text);
}

export function getSelection(): string {
  return editorInstance?.getSelection() ?? "";
}

function updateStatusBar() {
  // Status bar updates are handled by main.ts via onChange
}
