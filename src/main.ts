import bw from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import "./ui/theme"; // generates and injects all CSS at import
import { setDarkMode } from "./ui/theme";
import { el } from "./ui/taco";
import { initMenus, makeMain, makeStatusbar, makeTitlebar, setChatDisplay, setStatusFile, setToggleState, toggleChatPanel } from "./ui/shell";
import { initTabBar, makeTabBar } from "./ui/tabbar";
import { initAbout, installCli } from "./ui/about";
import { initStats } from "./ui/stats";
import { handleOutlineKeydown, initOutline, makeOutlinePanel, toggleOutline } from "./ui/outline";
import { handleFindKeydown, initFindBar, makeFindBar, openFind } from "./ui/findbar";
import { handleFocusKeydown, makeFocusExitPill, toggleFocusMode } from "./ui/focus";
import { exportHtml, printDocument } from "./editor/export";
import { initEditor } from "./editor/editor";
import {
  closeDocument,
  handleKeydown,
  initDocuments,
  newDocument,
  openFileDialog,
  openPath,
  saveActiveDocument,
  setDocumentsProjectMode,
  showTab,
} from "./editor/documents";
import { chatDisplayOf, initSettingsUI, loadSettings, openSettings } from "./settings/settings";
import { logEvent } from "./diag/perf";
import { initChat, makeChatPanel, setProjectMode } from "./chat/chat-ui";
import {
  hideFileTree,
  highlightFile,
  isFileTreeVisible,
  loadTree,
  makeFileTreePanel,
  setOnFileClick,
  showFileTree,
} from "./project/file-tree";

import { activeTab } from "./editor/tabs";

export { fileName } from "./editor/tabs";

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
let openAbout: () => void = () => {};

// --- Shell ---
// The whole UI is TACO. Mounting replaces #app's children with the three
// rows; dialogs are appended to #app afterwards by their own modules.
bw.mount("#app", [
  makeTitlebar({
    onNew: () => newDocument(),
    onOpen: () => openFileDialog(),
    onSave: () => saveActiveDocument(),
    onCloseTab: () => closeDocument(),
    onToggleChat: () => toggleChatPanel(),
    onToggleFiles: () => toggleFiles(),
    onToggleOutline: () => toggleOutline(),
    onFocusMode: () => toggleFocusMode(),
    onFind: () => openFind(),
    onExportHtml: () => exportHtml(),
    onPrint: () => printDocument(),
    onSettings: () => openSettings(),
    onAbout: () => openAbout(),
    onInstallCli: () => installCli(),
  }),
  makeMain(
    [makeFileTreePanel(), makeOutlinePanel(), makeChatPanel()],
    [
      makeTabBar({
        onSelect: (id) => showTab(id),
        onClose: (id) => closeDocument(id),
        onNew: () => newDocument(),
      }),
      makeFindBar(),
    ],
  ),
  makeStatusbar(),
  makeFocusExitPill(),
]);

initMenus();
initEditor(el("editor-container")!);
initTabBar();
initStats();
initOutline();
initFindBar();
initSettingsUI();
initChat();
setChatDisplay(chatDisplayOf(loadSettings()));
openAbout = initAbout();
setOnFileClick((path) => loadFileIntoEditor(path));
logEvent({ kind: "app", event: "start", version: __APP_VERSION__ });

function toggleFiles() {
  const show = !isFileTreeVisible();
  if (show) showFileTree();
  else hideFileTree();
  setToggleState("btn-toggle-files", show);
}

// --- Dark mode follows the OS ---
function initDarkMode() {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = (e: MediaQueryList | MediaQueryListEvent) => setDarkMode(e.matches);
  apply(query);
  query.addEventListener("change", apply);
}

// --- Keyboard shortcuts ---
// Documents first (new/open/save/close/cycle tabs), then find (Cmd+F/H, Esc),
// outline (Cmd+Shift+O), focus mode (Cmd+Shift+D, Esc) and print (Cmd+P).
document.addEventListener("keydown", (e) => {
  if (handleKeydown(e) || handleFindKeydown(e) || handleOutlineKeydown(e) || handleFocusKeydown(e)) return;
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    printDocument();
  }
});

// --- Startup ---
async function init() {
  initDarkMode();
  await initDocuments();

  try {
    const launchMode = await invoke<LaunchMode>("get_launch_info");

    if (launchMode.type === "Simple") {
      if (launchMode.file_path) await openPath(launchMode.file_path);
    } else if (launchMode.type === "Project") {
      setDocumentsProjectMode(true, launchMode.project_root);
      setProjectMode(true);

      if (launchMode.exists) {
        const data = await invoke<any>("project_load", { path: launchMode.project_file });
        if (data.open_file) {
          // File may have been deleted; openPath logs and leaves the untitled tab.
          await openPath(data.open_file, true);
        }
      } else {
        await invoke("project_init", {
          root: launchMode.project_root,
          file: launchMode.project_file,
        });
      }

      showFileTree();
      await loadTree();
      bw.removeClass("btn-toggle-files", "hidden");
      setToggleState("btn-toggle-files", true);
      // The tree did not exist when the remembered file was opened; sync its highlight now.
      const active = activeTab();
      if (active?.projectRelative) highlightFile(active.path);
    }
  } catch (e) {
    console.error("Startup failed:", e);
    setStatusFile("No file open");
    // Fall back to the older get_cli_file command
    try {
      const cliFile = await invoke<string | null>("get_cli_file");
      if (cliFile) await openPath(cliFile);
    } catch {}
  }
}

/** Open a project file in a tab (used by file tree clicks). */
export async function loadFileIntoEditor(relativePath: string) {
  await openPath(relativePath, true);
}

init();
