import bw from "bitwrench";
import type { Taco } from "bitwrench";
import { invoke } from "@tauri-apps/api/core";

interface FileEntry {
  name: string;
  type: "file" | "dir";
  size: number;
}

interface FileListResponse {
  entries: FileEntry[];
}

let onFileClick: ((path: string) => void) | null = null;

/** The project sidebar as TACO. Hidden until project mode turns it on. */
export function makeFileTreePanel(): Taco {
  return {
    t: "div",
    a: { id: "file-tree", class: "hidden" },
    c: [
      { t: "div", a: { id: "file-tree-header" }, c: "Files" },
      { t: "div", a: { id: "file-tree-list" } },
    ],
  };
}

export function setOnFileClick(handler: (path: string) => void) {
  onFileClick = handler;
}

export function showFileTree() {
  bw.removeClass("file-tree", "hidden");
}

export function hideFileTree() {
  bw.addClass("file-tree", "hidden");
}

export function isFileTreeVisible(): boolean {
  return !bw.hasClass("file-tree", "hidden");
}

function note(text: string, error = false): Taco {
  return { t: "div", a: { class: `file-tree-note${error ? " error" : ""}` }, c: text };
}

function selectItem(e: Event): void {
  bw.removeClass(bw.$(".file-tree-item.active"), "active");
  bw.addClass(e.currentTarget as HTMLElement, "active");
}

/**
 * Highlight the entry for a project-relative path (e.g. when the active tab
 * changes), or clear the highlight with null. Unknown paths clear it too.
 */
export function highlightFile(path: string | null): void {
  bw.removeClass(bw.$(".file-tree-item.active"), "active");
  if (!path) return;
  for (const item of bw.$(".file-tree-item")) {
    if (item.getAttribute("title") === path && !item.classList.contains("dir")) bw.addClass(item, "active");
  }
}

function makeItem(entry: FileEntry): Taco {
  const icon = entry.type === "dir" ? "📁" : getFileIcon(entry.name);
  const isFile = entry.type === "file";
  return {
    t: "div",
    a: {
      class: `file-tree-item${isFile ? "" : " dir"}`,
      title: entry.name,
      onclick: isFile
        ? (e: Event) => {
            selectItem(e);
            onFileClick?.(entry.name);
          }
        : undefined,
    },
    c: `${icon} ${entry.name}`,
  };
}

export async function loadTree(path?: string) {
  if (!bw.el("file-tree-list")) return;
  bw.patch("file-tree-list", note("Loading..."));

  try {
    const result = await invoke<FileListResponse>("file_list", {
      path: path || null,
      recursive: true,
    });

    // Sort: dirs first, then files, alphabetical within each group
    const entries = result.entries
      .filter((e) => !e.name.startsWith(".") && e.name !== "quikleaf.prj")
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    if (entries.length === 0) {
      bw.patch("file-tree-list", note("Empty project"));
      return;
    }

    bw.patch("file-tree-list", entries.map(makeItem));
  } catch (e) {
    bw.patch("file-tree-list", note(`Failed to load: ${e}`, true));
  }
}

export function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "md":
    case "markdown":
      return "📝";
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
      return "📜";
    case "json":
      return "📋";
    case "html":
    case "css":
      return "🌐";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
      return "🖼️";
    case "rs":
      return "🦀";
    case "toml":
    case "yaml":
    case "yml":
      return "⚙️";
    default:
      return "📄";
  }
}
