/**
 * Images in documents.
 *
 * Rendering: markdown says `![alt](images/a.png)` and the webview, served from
 * its own origin, cannot load that. After every preview render the `img`
 * elements with a relative `src` are pointed at the app's `asset://` scheme
 * (Rust serves image files only) through `convertFileSrc`, resolved against
 * the active document's folder. The original `src` is kept in a data
 * attribute; the markdown is never touched.
 *
 * Pasting: an image on the clipboard pasted into the source pane is written
 * beside the document (`images/<doc>-<stamp>.png`, Rust `image_save`) and a
 * relative link is inserted at the caret. An unsaved document has nowhere to
 * put the file, so the paste is refused with a note. A dropped image file is
 * linked where it is, relative to the document when the two share a root.
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { activeDocumentPath } from "./documents";
import { getPreviewPane, insertAtCursor, onEditorChange } from "./editor";
import { baseName, dirName, extOf, isAbsolutePath, isRelativeSrc, joinPath, relativePath } from "./paths";
import { subscribe as subscribeTabs } from "./tabs";
import { notify } from "../ui/toast";
import { loadTree } from "../project/file-tree";
import { isProjectMode } from "./documents";

export const SRC_ATTR = "data-quikleaf-src";

export interface ImageSaved {
  relative: string;
  absolute: string;
}

/** The URL the webview can load for an image file at `absolutePath`. */
export function imageUrl(absolutePath: string): string {
  return convertFileSrc(absolutePath, "asset");
}

/**
 * Point every relative image in `root` at the asset scheme, resolved against
 * `docPath`'s folder. Absolute file paths are converted as they are. Returns
 * how many were rewritten. Untitled documents (no path) leave relative images
 * alone: there is nothing to resolve them against.
 */
export function rewriteImages(root: ParentNode, docPath: string | null): number {
  let n = 0;
  for (const img of Array.from(root.querySelectorAll("img"))) {
    const original = img.getAttribute(SRC_ATTR) ?? img.getAttribute("src") ?? "";
    let target: string | null = null;
    if (isAbsolutePath(original)) target = original;
    else if (isRelativeSrc(original) && docPath) target = joinPath(dirName(docPath), original);
    if (!target) continue;
    const url = imageUrl(target);
    if (img.getAttribute("src") === url) continue;
    img.setAttribute(SRC_ATTR, original);
    img.setAttribute("src", url);
    n++;
  }
  return n;
}

let observer: MutationObserver | null = null;
let unsubscribers: Array<() => void> = [];

/** Rewrite the preview now, if there is one. */
export function refreshPreviewImages(): number {
  const pane = getPreviewPane();
  return pane ? rewriteImages(pane, activeDocumentPath()) : 0;
}

/**
 * Keep the preview's images loadable: rewrite after every render (quikdown
 * replaces the preview's children) and on tab switches.
 */
export function initPreviewImages(): () => void {
  disposePreviewImages();
  const pane = getPreviewPane();
  if (pane && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => refreshPreviewImages());
    observer.observe(pane, { childList: true, subtree: true });
  }
  unsubscribers = [onEditorChange(() => refreshPreviewImages()), subscribeTabs(() => refreshPreviewImages())];
  refreshPreviewImages();
  return disposePreviewImages;
}

export function disposePreviewImages(): void {
  observer?.disconnect();
  observer = null;
  for (const off of unsubscribers) off();
  unsubscribers = [];
}

// --- Pasting and dropping -----------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(s);
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

/** The markdown for an image file at `absolutePath`, linked relative to the document when possible. */
export function imageMarkdown(absolutePath: string, docPath: string | null, alt = ""): string {
  const href = docPath ? relativePath(dirName(docPath), absolutePath) : absolutePath;
  const label = alt || baseName(absolutePath).replace(/\.[^.]+$/, "");
  return `![${label}](${encodeHref(href)})`;
}

/** Spaces and parentheses would end the link early; encode what must be encoded and nothing else. */
function encodeHref(href: string): string {
  const map: Record<string, string> = { " ": "%20", "(": "%28", ")": "%29" };
  return href.replace(/[ ()]/g, (c) => map[c]);
}

/**
 * Save `bytes` as an image beside the active document and return where it
 * went, or null (after telling the user) when the document has no location
 * or the save failed.
 */
export async function saveImageBytes(bytes: Uint8Array, mime: string): Promise<ImageSaved | null> {
  const docPath = activeDocumentPath();
  if (!docPath) {
    notify("Save the document first", "Pasted images are stored in an images folder beside the document, so it needs a location.", "warning");
    return null;
  }
  const ext = MIME_EXT[mime] ?? extOf(`x.${mime.split("/")[1] ?? "png"}`) ?? "png";
  try {
    const saved = await invoke<ImageSaved>("image_save", { docPath, ext, data: toBase64(bytes) });
    if (isProjectMode()) void loadTree();
    return saved;
  } catch (e) {
    notify("Could not save the image", String((e as any)?.message ?? e), "danger");
    return null;
  }
}

/** The first image file on a clipboard or drag payload, or null. */
export function imageFileOf(data: DataTransfer | null | undefined): File | null {
  if (!data) return null;
  for (const f of Array.from(data.files ?? [])) if (f.type.startsWith("image/")) return f;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

/** Only pastes aimed at the source pane are ours; the chat input and dialogs keep theirs. */
function isSourceTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.classList.contains("qde-textarea");
}

/**
 * The document's paste handler. Returns true when the paste was an image for
 * the source pane and has been handled (saved and linked, or refused).
 */
export async function handlePaste(e: ClipboardEvent): Promise<boolean> {
  if (!isSourceTarget(e.target)) return false;
  const file = imageFileOf(e.clipboardData);
  if (!file) return false;
  e.preventDefault();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const saved = await saveImageBytes(bytes, file.type || "image/png");
  if (saved) insertAtCursor(imageMarkdown(saved.absolute, activeDocumentPath()));
  return true;
}

/** Listen for image pastes into the source pane. Returns the unsubscribe function. */
export function initImagePaste(target: Document = document): () => void {
  const fn = (e: Event) => void handlePaste(e as ClipboardEvent);
  target.addEventListener("paste", fn);
  return () => target.removeEventListener("paste", fn);
}

/** A dropped image file: link it at the caret (relative to the document when they share a root). */
export function insertImageFile(absolutePath: string): boolean {
  const docPath = activeDocumentPath();
  insertAtCursor(imageMarkdown(absolutePath, docPath));
  return true;
}
