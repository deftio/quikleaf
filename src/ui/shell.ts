/**
 * The application shell as TACO: title bar with menus and toggle buttons,
 * main area, status bar.
 *
 * Everything here is data. Handlers live in `a:` so they survive re-renders,
 * and state changes go through bitwrench's class verbs (`bw.toggleClass`)
 * and `bw.patch` rather than touching DOM nodes.
 */
import bw from "bitwrench";
import type { Taco, TacoContent } from "bitwrench";

export interface MenuItem {
  id: string;
  label: string;
  shortcut?: string;
  onclick: () => void;
  /** A checkable item (`role="menuitemcheckbox"`): called when the menu opens to show the current state. */
  checked?: () => boolean;
  /** Start hidden (`.hidden`); e.g. project-only items that `main.ts` reveals in project mode. */
  hidden?: boolean;
}

/** A thin rule between groups of items. */
export interface MenuSeparator {
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

export type EditorModeName = "source" | "split" | "preview";

export interface ShellHandlers {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onCloseTab: () => void;
  onToggleChat: () => void;
  onToggleInfo: () => void;
  onToggleFiles: () => void;
  onToggleOutline: () => void;
  onProjectChat: () => void;
  onEditorMode: (mode: EditorModeName) => void;
  onFocusMode: () => void;
  onFind: () => void;
  onExportHtml: () => void;
  onPrint: () => void;
  onSettings: () => void;
  onAbout: () => void;
  onInstallCli: () => void;
  /** Current pane states, read when the View menu opens to tick its items. */
  state?: {
    chat: () => boolean;
    info: () => boolean;
    files: () => boolean;
    outline: () => boolean;
    editorMode: () => EditorModeName;
  };
}

const MENU_CLASS = "titlebar-dropdown";

function isSeparator(e: MenuEntry): e is MenuSeparator {
  return (e as MenuSeparator).separator === true;
}

/** Re-evaluate every checkable item of a menu (called when it opens). */
export function refreshMenuChecks(menuId: string, entries: MenuEntry[]): void {
  for (const e of entries) {
    if (isSeparator(e) || !e.checked) continue;
    const on = e.checked();
    bw.toggleClass(e.id, "checked", on);
    bw.patch(e.id, { "aria-checked": on ? "true" : "false" } as unknown as TacoContent);
  }
}

/** Close every open title bar menu. */
export function closeMenus(): void {
  bw.removeClass(bw.$(`.${MENU_CLASS}.open`), "open");
}

/**
 * A title bar menu: a flat trigger button plus a dropdown of items.
 * The trigger toggles its own menu; a document-level click closes any menu
 * (see `initMenus`). bitwrench's `makeDropdown` is close, but its items are
 * anchors without shortcut hints and its menu element cannot carry an id,
 * which the keyboard-shortcut tests rely on, so this is hand-rolled TACO.
 */
export function makeMenu(buttonId: string, menuId: string, label: string, items: MenuEntry[]): Taco {
  return {
    t: "div",
    a: { class: "titlebar-menu" },
    c: [
      {
        t: "button",
        a: {
          id: buttonId,
          class: "titlebar-btn",
          type: "button",
          "aria-haspopup": "menu",
          onclick: (e: Event) => {
            e.stopPropagation();
            const wasOpen = bw.hasClass(menuId, "open");
            closeMenus();
            if (!wasOpen) refreshMenuChecks(menuId, items);
            bw.toggleClass(menuId, "open", !wasOpen);
          },
        },
        c: label,
      },
      {
        t: "div",
        a: { id: menuId, class: MENU_CLASS, role: "menu" },
        c: items.map((item): Taco => {
          if (isSeparator(item)) return { t: "div", a: { class: "dropdown-separator", role: "separator" } };
          const classes = ["dropdown-item"];
          if (item.checked) classes.push("checkable");
          if (item.hidden) classes.push("hidden");
          // In a menu with any checkable item every item gets the check column, so labels line up.
          const hasChecks = items.some((i) => !isSeparator(i) && !!i.checked);
          return {
            t: "button",
            a: {
              id: item.id,
              class: classes,
              type: "button",
              role: item.checked ? "menuitemcheckbox" : "menuitem",
              ...(item.checked ? { "aria-checked": "false" } : {}),
              onclick: () => {
                closeMenus();
                item.onclick();
              },
            },
            c: [
              ...(hasChecks ? [{ t: "span", a: { class: "dropdown-check", "aria-hidden": "true" }, c: "✓" }] : []),
              { t: "span", a: { class: "dropdown-label" }, c: item.label },
              ...(item.shortcut ? [{ t: "span", a: { class: "dropdown-shortcut" }, c: item.shortcut }] : []),
            ],
          };
        }),
      },
    ],
  };
}

/** One document-level listener closes menus on outside clicks. */
export function initMenus(): void {
  document.addEventListener("click", closeMenus);
}

/**
 * A press-to-toggle button (`aria-pressed`), used for panels that stay open:
 * Chat and Files. Visually distinct from the menu triggers: it carries a
 * state dot and fills with the accent color while pressed.
 */
export function makeToggleButton(id: string, label: string, onclick: () => void, extraClass = ""): Taco {
  return {
    t: "button",
    a: {
      id,
      class: `titlebar-btn toggle-btn ${extraClass}`.trim(),
      type: "button",
      "aria-pressed": "false",
      title: `Show or hide the ${label.toLowerCase()} panel`,
      onclick,
    },
    c: [{ t: "span", a: { class: "toggle-dot", "aria-hidden": "true" } }, label],
  };
}

/** Reflect a toggle button's state: `aria-pressed` plus the legacy `.active` class. */
export function setToggleState(id: string, on: boolean): void {
  bw.patch(id, { "aria-pressed": on ? "true" : "false" } as unknown as TacoContent);
  bw.toggleClass(id, "active", on);
}

export function makeTitlebar(h: ShellHandlers): Taco {
  return {
    t: "div",
    a: { id: "titlebar" },
    c: [
      {
        t: "div",
        a: { id: "titlebar-left" },
        c: [
          {
            t: "span",
            a: { id: "app-title" },
            c: [{ t: "img", a: { id: "app-logo", src: "/icon.png", alt: "quikleaf" } }, "quikleaf"],
          },
          makeMenu("btn-file-menu", "file-menu-dropdown", "File", [
            { id: "btn-new", label: "New", shortcut: "Cmd+N", onclick: h.onNew },
            { id: "btn-open", label: "Open", shortcut: "Cmd+O", onclick: h.onOpen },
            { id: "btn-save", label: "Save", shortcut: "Cmd+S", onclick: h.onSave },
            { id: "btn-close-tab", label: "Close Tab", shortcut: "Cmd+W", onclick: h.onCloseTab },
            { id: "btn-export-html", label: "Export HTML…", onclick: h.onExportHtml },
            { id: "btn-print", label: "Print / PDF…", shortcut: "Cmd+P", onclick: h.onPrint },
          ]),
          makeMenu("btn-view-menu", "view-menu-dropdown", "View", [
            // Panes of the active tab: [chat | quikdown view | info]
            { id: "btn-toggle-chat-menu", label: "Chat", shortcut: "Cmd+Shift+C", onclick: h.onToggleChat, checked: h.state?.chat },
            { id: "btn-toggle-info-menu", label: "Info", shortcut: "Cmd+Shift+I", onclick: h.onToggleInfo, checked: h.state?.info },
            { separator: true },
            // Window-wide panels
            { id: "btn-toggle-files-menu", label: "Files", onclick: h.onToggleFiles, checked: h.state?.files, hidden: true },
            { id: "btn-toggle-outline-menu", label: "Outline", shortcut: "Cmd+Shift+O", onclick: h.onToggleOutline, checked: h.state?.outline },
            { id: "btn-project-chat", label: "Project Chat", onclick: h.onProjectChat, hidden: true },
            { separator: true },
            // The quikdown view of the active tab
            { id: "btn-mode-source", label: "Source", onclick: () => h.onEditorMode("source"), checked: () => h.state?.editorMode() === "source" },
            { id: "btn-mode-split", label: "Split", onclick: () => h.onEditorMode("split"), checked: () => h.state?.editorMode() === "split" },
            { id: "btn-mode-preview", label: "Preview", onclick: () => h.onEditorMode("preview"), checked: () => h.state?.editorMode() === "preview" },
            { separator: true },
            { id: "btn-focus-mode", label: "Focus Mode", shortcut: "Cmd+Shift+D", onclick: h.onFocusMode },
            { id: "btn-find", label: "Find & Replace…", shortcut: "Cmd+F", onclick: h.onFind },
          ]),
          makeToggleButton("btn-toggle-chat", "Chat", h.onToggleChat),
          makeToggleButton("btn-toggle-info", "Info", h.onToggleInfo),
          makeToggleButton("btn-toggle-files", "Files", h.onToggleFiles, "hidden"),
          makeToggleButton("btn-toggle-outline", "Outline", h.onToggleOutline),
        ],
      },
      {
        t: "div",
        a: { id: "titlebar-right" },
        c: [
          { t: "span", a: { id: "llm-status" }, c: "" },
          { t: "button", a: { id: "btn-settings", class: "titlebar-btn", type: "button", onclick: h.onSettings }, c: "Settings" },
          makeMenu("btn-help-menu", "help-menu-dropdown", "Help", [
            { id: "btn-about", label: "About quikleaf", onclick: h.onAbout },
            { id: "btn-install-cli", label: "Install Command Line Tool", onclick: h.onInstallCli },
          ]),
        ],
      },
    ],
  };
}

export function makeStatusbar(): Taco {
  return {
    t: "div",
    a: { id: "statusbar" },
    c: [
      { t: "span", a: { id: "status-file" }, c: "No file open" },
      { t: "span", a: { id: "status-provider" }, c: "LLM: none" },
      { t: "span", a: { id: "status-stats", class: "status-stats" }, c: "" },
      { t: "span", a: { id: "status-timing", class: "status-timing" }, c: "" },
    ],
  };
}

/**
 * The main row: window-wide panels (file tree, outline), then the editor
 * column — anything in `aboveEditor` (the tab bar, find bar) stacked over
 * `#tab-body`, the active tab's panes: `beside.left` (the chat), then
 * `#editor-container` (quikdown mounts into it), then `beside.right` (the
 * info pane). Putting the chat and info panes under the tab bar is what
 * makes the tab, not the window, the unit a chat belongs to.
 */
export function makeMain(
  panels: TacoContent[],
  aboveEditor: TacoContent[] = [],
  beside: { left?: TacoContent[]; right?: TacoContent[] } = {},
): Taco {
  return {
    t: "div",
    a: { id: "main" },
    c: [
      ...panels,
      {
        t: "div",
        a: { id: "editor-column" },
        c: [
          ...aboveEditor,
          { t: "div", a: { id: "tab-body" }, c: [...(beside.left ?? []), { t: "div", a: { id: "editor-container" } }, ...(beside.right ?? [])] },
        ],
      },
    ],
  };
}

/** Update the status bar's file slot. */
export function setStatusFile(text: string): void {
  bw.patch("status-file", text);
}

/** Update the status bar's provider slot. */
export function setStatusProvider(text: string): void {
  bw.patch("status-provider", text);
}

/** Update the status bar's last-request timing slot. */
export function setStatusTiming(text: string): void {
  bw.patch("status-timing", text);
}

/** Update the status bar's document statistics slot ("1,234 words · 6 min"). */
export function setStatusStats(text: string): void {
  bw.patch("status-stats", text);
}

/** Show or hide the chat pane and keep the toolbar button's pressed state in step. */
export function setChatPanelVisible(on: boolean): void {
  bw.toggleClass("chat-panel", "hidden", !on);
  setToggleState("btn-toggle-chat", on);
}

/** Show or hide the info pane and keep the toolbar button's pressed state in step. */
export function setInfoPanelVisible(on: boolean): void {
  bw.toggleClass("info-panel", "hidden", !on);
  setToggleState("btn-toggle-info", on);
}

export function isChatPanelVisible(): boolean {
  return !!bw.el("chat-panel") && !bw.hasClass("chat-panel", "hidden");
}

export function isInfoPanelVisible(): boolean {
  return !!bw.el("info-panel") && !bw.hasClass("info-panel", "hidden");
}

/**
 * Flip the chat pane's DOM visibility. `ui/panes.ts` is the normal caller:
 * it records the choice on the active tab and calls `setChatPanelVisible`.
 */
export function toggleChatPanel(): boolean {
  const open = isChatPanelVisible();
  setChatPanelVisible(!open);
  return !open;
}

export interface ChatDisplay {
  timestamps: boolean;
  tools: boolean;
}

/**
 * Show or hide per-message timestamps/timings and tool-call entries.
 * Bubbles always render both; two classes on the panel decide visibility,
 * so flipping a setting updates every existing message instantly.
 */
export function setChatDisplay(d: ChatDisplay): void {
  bw.toggleClass("chat-panel", "show-timestamps", d.timestamps);
  bw.toggleClass("chat-panel", "show-tools", d.tools);
}
