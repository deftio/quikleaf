import { invoke } from "@tauri-apps/api/core";

interface FileEntry {
  name: string;
  type: "file" | "dir";
  size: number;
}

interface FileListResponse {
  entries: FileEntry[];
}

let fileTreeEl: HTMLElement | null = null;
let fileTreeListEl: HTMLElement | null = null;
let onFileClick: ((path: string) => void) | null = null;

export function initFileTree() {
  fileTreeEl = document.getElementById("file-tree");
  fileTreeListEl = document.getElementById("file-tree-list");
}

export function setOnFileClick(handler: (path: string) => void) {
  onFileClick = handler;
}

export function showFileTree() {
  fileTreeEl?.classList.remove("hidden");
}

export function hideFileTree() {
  fileTreeEl?.classList.add("hidden");
}

export async function loadTree(path?: string) {
  if (!fileTreeListEl) return;
  fileTreeListEl.innerHTML = "<div style='padding:8px;color:var(--text-tertiary);font-size:12px;'>Loading...</div>";

  try {
    const result = await invoke<FileListResponse>("file_list", {
      path: path || null,
      recursive: true,
    });

    fileTreeListEl.innerHTML = "";

    // Sort: dirs first, then files, alphabetical within each group
    const entries = result.entries
      .filter(e => !e.name.startsWith(".") && e.name !== "qdedit.prj")
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    if (entries.length === 0) {
      fileTreeListEl.innerHTML = "<div style='padding:8px;color:var(--text-tertiary);font-size:12px;'>Empty project</div>";
      return;
    }

    for (const entry of entries) {
      const item = document.createElement("div");
      item.className = "file-tree-item";
      if (entry.type === "dir") {
        item.classList.add("dir");
      }

      const icon = entry.type === "dir" ? "📁" : getFileIcon(entry.name);
      const displayName = entry.name.includes("/") ? entry.name : entry.name;
      item.textContent = `${icon} ${displayName}`;
      item.title = entry.name;

      if (entry.type === "file") {
        item.addEventListener("click", () => {
          // Remove active state from siblings
          fileTreeListEl!.querySelectorAll(".file-tree-item.active").forEach(el => el.classList.remove("active"));
          item.classList.add("active");

          if (onFileClick) {
            onFileClick(entry.name);
          } else {
            // Use the loadFileIntoEditor from main.ts via dynamic import
            import("../main").then(mod => {
              mod.loadFileIntoEditor(entry.name);
            }).catch(console.error);
          }
        });
      }

      fileTreeListEl.appendChild(item);
    }
  } catch (e) {
    fileTreeListEl.innerHTML = `<div style='padding:8px;color:var(--danger);font-size:12px;'>Failed to load: ${e}</div>`;
  }
}

function getFileIcon(name: string): string {
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
