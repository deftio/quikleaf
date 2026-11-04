/**
 * Files dropped onto the window. Tauri reports native drags on the webview
 * (`onDragDropEvent`); while one hovers, `#app.drag-over` shows an outline.
 * On drop, markdown and text files open as tabs (after Rust widens the fs
 * scope to them, see `allow_path`), image files are linked into the active
 * document, anything else gets a note.
 */
import bw from "bitwrench";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openPath } from "./documents";
import { insertImageFile } from "./images";
import { baseName, isImagePath, isTextDocumentPath } from "./paths";
import { activeTab } from "./tabs";
import { notify } from "../ui/toast";

export const DRAG_CLASS = "drag-over";

export type DragPayload = { type: "enter"; paths: string[] } | { type: "over" } | { type: "drop"; paths: string[] } | { type: "leave" };

function setDragging(on: boolean): void {
  if (!bw.el("app")) return;
  if (on) bw.addClass("app", DRAG_CLASS);
  else bw.removeClass("app", DRAG_CLASS);
}

/** Open or link each dropped path. Returns how many were used. */
export async function handleDroppedPaths(paths: string[]): Promise<number> {
  let used = 0;
  const skipped: string[] = [];
  for (const path of paths) {
    if (isImagePath(path)) {
      if (activeTab()?.kind === "document" && insertImageFile(path)) used++;
      else skipped.push(baseName(path));
    } else if (isTextDocumentPath(path)) {
      if (await openPath(path)) used++;
      else skipped.push(baseName(path));
    } else {
      skipped.push(baseName(path));
    }
  }
  if (skipped.length) {
    notify("Not opened", `${skipped.join(", ")}: quikleaf opens markdown and text files, and links images into the active document.`, "warning", 8000);
  }
  return used;
}

/** The webview's drag-drop callback; exported so tests can drive it. */
export function handleDragEvent(payload: DragPayload): void {
  switch (payload.type) {
    case "enter":
      setDragging(true);
      break;
    case "drop":
      setDragging(false);
      void handleDroppedPaths(payload.paths);
      break;
    case "leave":
      setDragging(false);
      break;
    default:
      break;
  }
}

/** Start listening for native file drags. Resolves to the unlisten function (a no-op outside Tauri). */
export async function initDropZone(): Promise<() => void> {
  try {
    return await getCurrentWebview().onDragDropEvent((event) => handleDragEvent(event.payload as DragPayload));
  } catch (e) {
    console.warn("drag and drop unavailable:", e);
    return () => {};
  }
}
