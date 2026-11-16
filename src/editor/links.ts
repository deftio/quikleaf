/**
 * Links clicked in the rendered pane.
 *
 * A webview follows a link like a browser does, and in a Tauri window that
 * replaces the whole app with the page. quikdown (1.3+) asks `onLinkClick`
 * first and cancels the navigation unless the handler returns true:
 *
 *   - `http(s)://` and `mailto:` open in the system browser (plugin-shell),
 *     as the About dialog's links do.
 *   - A relative or absolute path to a text document (`notes/b.md`) opens in
 *     a tab, resolved against the active document's folder: wiki-style
 *     navigation between files.
 *   - `#anchor` is left to the webview (it stays on the page).
 *   - Anything else is cancelled.
 */
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { activeDocumentPath, openPath } from "./documents";
import { setLinkHandler } from "./editor";
import { dirName, isAbsolutePath, isRelativeSrc, isTextDocumentPath, joinPath } from "./paths";

const EXTERNAL = /^(https?:|mailto:)/i;

/** Where a relative or absolute `href` points, against the active document's folder; null when it cannot be resolved. */
export function linkTarget(href: string, docPath: string | null): string | null {
  const h = decodeURI(href.trim());
  if (isAbsolutePath(h)) return h;
  if (isRelativeSrc(h) && docPath) return joinPath(dirName(docPath), h.replace(/[?#].*$/, ""));
  return null;
}

/**
 * Decide what a clicked link does. Returns true only when the webview should
 * navigate (in-page anchors). Exported for tests.
 */
export function handleLinkClick(href: string): boolean {
  if (!href) return false;
  if (EXTERNAL.test(href)) {
    shellOpen(href).catch(console.error);
    return false;
  }
  if (href.startsWith("#")) return true;
  const target = linkTarget(href, activeDocumentPath());
  if (target && isTextDocumentPath(target)) void openPath(target);
  return false;
}

/** Route the preview's link clicks through `handleLinkClick`. */
export function initPreviewLinks(): void {
  setLinkHandler(handleLinkClick);
}
