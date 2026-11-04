/**
 * Mock for @tauri-apps/api/webview
 *
 * `getCurrentWebview().onDragDropEvent(handler)` subscribes `handler` to the
 * e2e event bus under "tauri://drag-drop", so a test drops files with
 *   window.__E2E_EVENTS__.emit("tauri://drag-drop", { type: "drop", paths: [...] })
 */
import { listen } from "./tauri-event";

export const DRAG_DROP_EVENT = "tauri://drag-drop";

export function getCurrentWebview() {
  return {
    onDragDropEvent(handler: (event: { payload: any }) => void): Promise<() => void> {
      return listen(DRAG_DROP_EVENT, handler);
    },
  };
}
