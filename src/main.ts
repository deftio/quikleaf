import bw from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import "./ui/theme"; // generates and injects all CSS at import
import { isDarkMode } from "./ui/theme";
import { el } from "./ui/taco";
import { initLogPane, makeLogPanel } from "./diag/log-pane";
import { LOG_OPEN } from "./diag/perf";
import { initMenus, makeChatDrawerPull, makeMain, makeStatusbar, makeTitlebar, setStatusFile, setToggleState } from "./ui/shell";
import { initTabBar, makeTabBar } from "./ui/tabbar";
import { activeEditorMode, handlePanesKeydown, initPanes, isChatPaneOpen, isInfoPaneOpen, setActiveEditorMode, toggleChatPane, toggleInfoPane } from "./ui/panes";
import { initInfoPane, makeInfoPanel, setInfoProjectRoot } from "./ui/infopane";
import { initAbout, installCli } from "./ui/about";
import { initStats } from "./ui/stats";
import { handleOutlineKeydown, initOutline, isOutlineVisible, makeOutlinePanel, toggleOutline } from "./ui/outline";
import { handleFindKeydown, initFindBar, makeFindBar, openFind } from "./ui/findbar";
import { handleFocusKeydown, makeFocusExitPill, toggleFocusMode } from "./ui/focus";
import { exportHtml, printDocument } from "./editor/export";
import { copyToClipboard, initEditor, redo, undo } from "./editor/editor";
import { flashCopied, initEditorToolbar, makeEditorToolbar } from "./ui/editor-toolbar";
import { listTabs,
  closeDocument,
  handleKeydown,
  initDocuments,
  newDocument,
  openFileDialog,
  openLogTab,
  openPath,
  openProjectChat,
  saveActiveDocument,
  setDocumentsProjectMode,
  showTab,
} from "./editor/documents";
import { applyLiveSettings, initSettingsUI, loadSettings, openSettings, saveSettings } from "./settings/settings";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { ISSUES_URL, SITE_URL } from "./ui/about";
import { logEvent } from "./diag/perf";
import { notify } from "./ui/toast";
import { initChat, makeChatPanel } from "./chat/chat-ui";
import { exportChatHistory, importChatHistory } from "./chat/session";
import {
  hideFileTree,
  highlightFile,
  isFileTreeVisible,
  loadTree,
  makeFileTreePanel,
  setOnFileClick,
  showFileTree,
} from "./project/file-tree";
import { flushProjectSaveOnUnload, initProjectPersistence, saveProjectNow } from "./project/persist";

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
    onToggleChat: () => toggleChatPane(),
    onToggleInfo: () => toggleInfoPane(),
    onToggleFiles: () => toggleFiles(),
    onToggleOutline: () => toggleOutline(),
    onProjectChat: () => openProjectChat(),
    onEditorMode: (mode) => setActiveEditorMode(mode),
    onFocusMode: () => toggleFocusMode(),
    onFind: () => openFind(),
    onExportHtml: () => exportHtml(),
    onPrint: () => printDocument(),
    onSettings: () => openSettings(),
    onAbout: () => openAbout(),
    onInstallCli: () => installCli(),
    onOpenDocs: () => shellOpen(SITE_URL).catch(console.error),
    onReportIssue: () => shellOpen(ISSUES_URL).catch(console.error),
    onToggleTheme: () => toggleTheme(),
    state: {
      chat: isChatPaneOpen,
      info: isInfoPaneOpen,
      files: isFileTreeVisible,
      outline: isOutlineVisible,
      editorMode: activeEditorMode,
    },
  }),
  // Rows: [menus … Settings Help About] / [tabs +] / [Files Outline Chat |
  // editor controls … | Info] / the body: [files | outline | chat | editor |
  // info]. Every panel opens in the body row, under its toggle, so the rows
  // above never move. The chat is a drawer: Settings → Chat drawer side moves
  // it to the right edge (CSS order), and a pull on the editor's edge opens
  // it while it is closed.
  makeMain(
    [makeFileTreePanel(), makeOutlinePanel()],
    [
      makeTabBar({
        onSelect: (id) => showTab(id),
        onClose: (id) => closeDocument(id),
        onNew: () => newDocument(),
      }),
      // The tab's control row: panel toggles at the ends, editor controls between.
      makeEditorToolbar({
        onMode: (mode) => setActiveEditorMode(mode),
        onUndo: () => undo(),
        onRedo: () => redo(),
        onCopy: (kind) => void copyToClipboard(kind).then((ok) => ok && flashCopied(kind)),
        onToggleFiles: () => toggleFiles(),
        onToggleOutline: () => toggleOutline(),
        onToggleChat: () => toggleChatPane(),
        onToggleInfo: () => toggleInfoPane(),
      }),
      makeFindBar(),
    ],
    // The log viewer sits where the editor is and shows instead of it on the log tab.
    { left: [makeChatPanel()], right: [makeLogPanel(), makeInfoPanel()] },
    // The drawer pull hugs the editor's edge (not the outline's) while the chat is closed.
    [makeChatDrawerPull(() => toggleChatPane())],
  ),
  makeStatusbar(),
  makeFocusExitPill(),
]);

initMenus();
initEditor(el("editor-container")!);
initEditorToolbar();
initTabBar();
initStats();
initOutline();
initFindBar();
initSettingsUI();
initChat();
initInfoPane();
initPanes();
initLogPane();
applyLiveSettings(loadSettings());
openAbout = initAbout();
bw.sub(LOG_OPEN, () => void openLogTab());
setOnFileClick((path) => loadFileIntoEditor(path));
logEvent({ kind: "app", event: "start", version: __APP_VERSION__ });

function toggleFiles() {
  const show = !isFileTreeVisible();
  if (show) showFileTree();
  else hideFileTree();
  setToggleState("btn-toggle-files", show);
}

// --- Theme: the title bar toggle picks the opposite of what is showing and remembers it ---
function toggleTheme() {
  const s = { ...loadSettings(), theme: isDarkMode() ? ("light" as const) : ("dark" as const) };
  saveSettings(s);
  applyLiveSettings(s);
}

// --- Keyboard shortcuts ---
// Documents first (new/open/save/close/cycle tabs), then find (Cmd+F/H, Esc),
// outline (Cmd+Shift+O), panes (Cmd+Shift+C chat, Cmd+Shift+I info), focus
// mode (Cmd+Shift+D, Esc) and print (Cmd+P).
document.addEventListener("keydown", (e) => {
  if (handleKeydown(e) || handleFindKeydown(e) || handleOutlineKeydown(e) || handlePanesKeydown(e) || handleFocusKeydown(e)) return;
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    printDocument();
  }
});

/** The project-relative path of the active tab, for quikleaf.prj. */
function projectOpenFile(): string | null {
  const t = activeTab();
  return t?.projectRelative && t.path ? t.path : null;
}

/** Every open project tab's path, in tab order (untitled and outside-project tabs are not persisted). */
function projectOpenTabs(): string[] {
  return listTabs()
    .filter((t) => t.projectRelative && t.path)
    .map((t) => t.path as string);
}

const persistenceProviders = { openFile: projectOpenFile, openTabs: projectOpenTabs, chatHistory: exportChatHistory };

// --- Startup ---
async function init() {
  await initDocuments();

  try {
    const launchMode = await invoke<LaunchMode>("get_launch_info");

    if (launchMode.type === "Simple") {
      if (launchMode.file_path) {
        const tab = await openPath(launchMode.file_path);
        // openPath logged the reason; the user gets told instead of an empty window.
        if (!tab) notify("Could not open file", launchMode.file_path, "danger", 10000);
      }
    } else if (launchMode.type === "Project") {
      setDocumentsProjectMode(true, launchMode.project_root);
      setInfoProjectRoot(launchMode.project_root);

      if (launchMode.exists) {
        // ProjectData is serialised camelCase by the Rust side.
        const data = await invoke<{ openFile?: string | null; openTabs?: string[]; chatHistory?: unknown }>("project_load", {
          path: launchMode.project_file,
        });
        initProjectPersistence(persistenceProviders);
        // Reopen every remembered tab, then focus the one that was active.
        // A deleted file is logged by openPath and skipped.
        for (const p of data?.openTabs ?? []) await openPath(p, true);
        if (data?.openFile) await openPath(data.openFile, true);
        // The startup Untitled tab is noise once remembered files are open.
        const restored = listTabs();
        const blank = restored.find((t) => !t.path && !t.dirty);
        if (blank && restored.length > 1) await closeDocument(blank.id);
        // Each reopened file gets its chat (and pane layout) back; the project chat too.
        importChatHistory(data?.chatHistory);
      } else {
        await invoke("project_init", {
          root: launchMode.project_root,
          file: launchMode.project_file,
        });
        initProjectPersistence(persistenceProviders);
        await saveProjectNow(); // create quikleaf.prj right away
      }
      flushProjectSaveOnUnload();

      showFileTree();
      await loadTree();
      bw.removeClass("btn-toggle-files", "hidden");
      bw.removeClass("btn-toggle-files-menu", "hidden");
      bw.removeClass("btn-project-chat", "hidden");
      setToggleState("btn-toggle-files", true);
      // The tree did not exist when the remembered file was opened; sync its highlight now.
      const active = activeTab();
      if (active?.projectRelative) highlightFile(active.path);
    }
    // `quikleaf --log` (with or without a file or project): start on the log tab.
    const flags = await invoke<{ open_log?: boolean }>("get_launch_flags").catch(() => null);
    if (flags?.open_log) await openLogTab();
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
