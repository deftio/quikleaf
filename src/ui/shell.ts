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
}

export interface ShellHandlers {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onCloseTab: () => void;
  onToggleChat: () => void;
  onToggleFiles: () => void;
  onToggleOutline: () => void;
  onFocusMode: () => void;
  onFind: () => void;
  onExportHtml: () => void;
  onPrint: () => void;
  onSettings: () => void;
  onAbout: () => void;
  onInstallCli: () => void;
}

const MENU_CLASS = "titlebar-dropdown";

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
export function makeMenu(buttonId: string, menuId: string, label: string, items: MenuItem[]): Taco {
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
            bw.toggleClass(menuId, "open", !wasOpen);
          },
        },
        c: label,
      },
      {
        t: "div",
        a: { id: menuId, class: MENU_CLASS, role: "menu" },
        c: items.map((item): Taco => ({
          t: "button",
          a: {
            id: item.id,
            class: "dropdown-item",
            type: "button",
            role: "menuitem",
            onclick: () => {
              closeMenus();
              item.onclick();
            },
          },
          c: [
            { t: "span", a: { class: "dropdown-label" }, c: item.label },
            ...(item.shortcut ? [{ t: "span", a: { class: "dropdown-shortcut" }, c: item.shortcut }] : []),
          ],
        })),
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
            { id: "btn-focus-mode", label: "Focus Mode", shortcut: "Cmd+Shift+D", onclick: h.onFocusMode },
            { id: "btn-toggle-outline-menu", label: "Outline", shortcut: "Cmd+Shift+O", onclick: h.onToggleOutline },
            { id: "btn-find", label: "Find & Replace…", shortcut: "Cmd+F", onclick: h.onFind },
          ]),
          makeToggleButton("btn-toggle-chat", "Chat", h.onToggleChat),
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
 * The main row: optional file tree, optional chat panel, then the editor
 * column — anything in `aboveEditor` (the tab bar) stacked over
 * `#editor-container`, which quikdown mounts into.
 */
export function makeMain(panels: TacoContent[], aboveEditor: TacoContent[] = []): Taco {
  return {
    t: "div",
    a: { id: "main" },
    c: [
      ...panels,
      { t: "div", a: { id: "editor-column" }, c: [...aboveEditor, { t: "div", a: { id: "editor-container" } }] },
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

/** Toggle the chat panel and keep the toolbar button's pressed state in step. */
export function toggleChatPanel(): boolean {
  const open = !bw.hasClass("chat-panel", "hidden");
  bw.toggleClass("chat-panel", "hidden", open);
  setToggleState("btn-toggle-chat", !open);
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
