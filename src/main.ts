import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { initEditor, getMarkdown, setMarkdown } from "./editor/editor";
import { initSettingsUI } from "./settings/settings";
import { initChat, setProjectMode } from "./chat/chat-ui";
import { initFileTree, loadTree, showFileTree, hideFileTree } from "./project/file-tree";

// --- Types ---
interface LaunchModeSimple {
  type: "Simple";
  file_path: string | null;
}
interface LaunchModeProject {
  type: "Project";
  project_root: string;
  project_file: string;
  exists: boolean;
}
type LaunchMode = LaunchModeSimple | LaunchModeProject;

// --- State ---
let currentFilePath: string | null = null;
let isProjectMode = false;

// --- DOM refs ---
const editorContainer = document.getElementById("editor-container")!;
const btnFileMenu = document.getElementById("btn-file-menu") as HTMLButtonElement;
const fileMenuDropdown = document.getElementById("file-menu-dropdown")!;
const btnOpen = document.getElementById("btn-open") as HTMLButtonElement;
const btnSave = document.getElementById("btn-save") as HTMLButtonElement;
const btnToggleChat = document.getElementById("btn-toggle-chat") as HTMLButtonElement;
const btnToggleFiles = document.getElementById("btn-toggle-files") as HTMLButtonElement | null;
const chatPanel = document.getElementById("chat-panel")!;
const statusFile = document.getElementById("status-file")!;

// --- Editor init ---
initEditor(editorContainer);

// --- Settings + Chat init ---
initSettingsUI();
initChat();
initFileTree();

// --- File operations ---
async function openFile() {
  try {
    const selected = await openDialog({
      multiple: false,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "txt"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (selected) {
      const path = typeof selected === "string" ? selected : (Array.isArray(selected) ? selected[0] : null);
      if (path) {
        const content = await readTextFile(path);
        currentFilePath = path;
        setMarkdown(content);
        statusFile.textContent = currentFilePath;
        document.title = `quikleaf — ${fileName(currentFilePath)}`;
      }
    }
  } catch (e) {
    console.error("Failed to open file:", e);
  }
}

async function saveFile() {
  const md = getMarkdown();
  try {
    if (currentFilePath) {
      await writeTextFile(currentFilePath, md);
    } else {
      const path = await save({
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
        defaultPath: "untitled.md",
      });
      if (path) {
        currentFilePath = path;
        await writeTextFile(currentFilePath, md);
        statusFile.textContent = currentFilePath;
        document.title = `quikleaf — ${fileName(currentFilePath)}`;
      }
    }
  } catch (e) {
    console.error("Failed to save file:", e);
  }
}

export function fileName(path: string): string {
  return path.split("/").pop() || path.split("\\").pop() || path;
}

// --- Dark mode detection ---
function initDarkMode() {
  const app = document.getElementById("app")!;
  const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function updateDarkMode(e: MediaQueryList | MediaQueryListEvent) {
    if (e.matches) {
      app.classList.add("dark");
    } else {
      app.classList.remove("dark");
    }
  }

  updateDarkMode(darkModeQuery);
  darkModeQuery.addEventListener("change", updateDarkMode);
}

// --- Chat panel toggle ---
function toggleChat() {
  chatPanel.classList.toggle("hidden");
  btnToggleChat.classList.toggle("active", !chatPanel.classList.contains("hidden"));
}

// --- File tree toggle ---
function toggleFiles() {
  const fileTree = document.getElementById("file-tree");
  if (!fileTree) return;
  if (fileTree.classList.contains("hidden")) {
    showFileTree();
  } else {
    hideFileTree();
  }
}

// --- Chat panel resizing ---
function initChatResizer() {
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  const resizeHandle = document.createElement("div");
  resizeHandle.style.cssText = `
    position: absolute;
    right: -4px;
    top: 0;
    bottom: 0;
    width: 8px;
    cursor: ew-resize;
    z-index: 10;
    transition: background 0.15s ease;
  `;

  resizeHandle.addEventListener("mouseenter", () => {
    if (!isResizing) {
      resizeHandle.style.background = "var(--accent-primary)";
    }
  });

  resizeHandle.addEventListener("mouseleave", () => {
    if (!isResizing) {
      resizeHandle.style.background = "transparent";
    }
  });

  chatPanel.style.position = "relative";
  chatPanel.appendChild(resizeHandle);

  resizeHandle.addEventListener("mousedown", (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = chatPanel.offsetWidth;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    resizeHandle.style.background = "var(--accent-primary)";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const delta = e.clientX - startX;
    const newWidth = Math.max(300, Math.min(600, startWidth + delta));
    chatPanel.style.width = `${newWidth}px`;
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      resizeHandle.style.background = "transparent";
    }
  });
}

// --- About modal ---
function initAbout() {
  const overlay = document.getElementById("about-overlay")!;
  const modal = document.getElementById("about-modal")!;
  const btnAbout = document.getElementById("btn-about")!;

  btnAbout.addEventListener("click", () => {
    overlay.classList.add("open");
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("open");
  });

  // Open links in system browser via shell plugin
  modal.querySelectorAll("a[href]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const href = (link as HTMLAnchorElement).href;
      shellOpen(href).catch(console.error);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) {
      overlay.classList.remove("open");
    }
  });
}

// --- Keyboard shortcuts ---
document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === "o") {
    e.preventDefault();
    openFile();
  } else if (mod && e.key === "s") {
    e.preventDefault();
    saveFile();
  }
});

// --- File menu dropdown ---
function closeFileMenu() {
  fileMenuDropdown.classList.remove("open");
}

btnFileMenu.addEventListener("click", (e) => {
  e.stopPropagation();
  fileMenuDropdown.classList.toggle("open");
});

document.addEventListener("click", () => {
  closeFileMenu();
});

// --- Button handlers ---
btnOpen.addEventListener("click", () => { closeFileMenu(); openFile(); });
btnSave.addEventListener("click", () => { closeFileMenu(); saveFile(); });
btnToggleChat.addEventListener("click", toggleChat);
if (btnToggleFiles) {
  btnToggleFiles.addEventListener("click", toggleFiles);
}

// --- Startup ---
async function init() {
  initDarkMode();
  initChatResizer();
  initAbout();

  try {
    const launchMode = await invoke<LaunchMode>("get_launch_info");

    if (launchMode.type === "Simple") {
      // Simple mode: load file if provided
      if (launchMode.file_path) {
        const content = await readTextFile(launchMode.file_path);
        currentFilePath = launchMode.file_path;
        setMarkdown(content);
        statusFile.textContent = currentFilePath;
        document.title = `quikleaf — ${fileName(currentFilePath)}`;
      }
    } else if (launchMode.type === "Project") {
      // Project mode
      isProjectMode = true;
      setProjectMode(true);

      if (launchMode.exists) {
        // Load existing project
        const data = await invoke<any>("project_load", { path: launchMode.project_file });
        if (data.open_file) {
          // Read and display the last-open file
          try {
            const openFile: string = data.open_file;
            const content = await invoke<string>("file_read", { path: openFile });
            currentFilePath = openFile;
            setMarkdown(content);
            statusFile.textContent = `[Project] ${openFile}`;
            document.title = `quikleaf — ${fileName(openFile)}`;
          } catch {
            // File may have been deleted
          }
        }
      } else {
        // Initialize new project
        await invoke("project_init", {
          root: launchMode.project_root,
          file: launchMode.project_file,
        });
      }

      // Show file tree and project indicator
      statusFile.textContent = `[Project] ${launchMode.project_root}`;
      showFileTree();
      loadTree();

      // Show the Files button
      if (btnToggleFiles) {
        btnToggleFiles.style.display = "";
      }
    }
  } catch (e) {
    console.error("Startup failed:", e);
    // Fall back to trying the old get_cli_file command
    try {
      const cliFile = await invoke<string | null>("get_cli_file");
      if (cliFile) {
        const content = await readTextFile(cliFile);
        currentFilePath = cliFile;
        setMarkdown(content);
        statusFile.textContent = currentFilePath;
        document.title = `quikleaf — ${fileName(currentFilePath)}`;
      }
    } catch {}
  }
}

/** Load a file into the editor (used by file tree clicks) */
export async function loadFileIntoEditor(relativePath: string) {
  try {
    const content = await invoke<string>("file_read", { path: relativePath });
    currentFilePath = relativePath;
    setMarkdown(content);
    await invoke("set_open_file", { path: relativePath });
    statusFile.textContent = `[Project] ${relativePath}`;
    document.title = `quikleaf — ${fileName(relativePath)}`;
  } catch (e) {
    console.error("Failed to load file:", e);
  }
}

init();
