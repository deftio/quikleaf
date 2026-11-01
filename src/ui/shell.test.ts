import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bw from "bitwrench";
import {
  closeMenus,
  makeMenu,
  initMenus,
  makeToggleButton,
  setToggleState,
  makeTitlebar,
  makeStatusbar,
  makeMain,
  setStatusFile,
  setStatusProvider,
  setStatusStats,
  setStatusTiming,
  toggleChatPanel,
  setChatDisplay,
  type ShellHandlers,
} from "./shell";

function app(): HTMLElement {
  return document.getElementById("app")!;
}

function mount(taco: any): HTMLElement {
  return bw.append(app(), taco) as HTMLElement;
}

function click(id: string): MouseEvent {
  const e = new MouseEvent("click", { bubbles: true, cancelable: true });
  document.getElementById(id)!.dispatchEvent(e);
  return e;
}

function isOpen(menuId: string): boolean {
  return document.getElementById(menuId)!.classList.contains("open");
}

afterEach(() => {
  app().innerHTML = "";
  document.removeEventListener("click", closeMenus);
});

describe("makeMenu", () => {
  const onOpen = vi.fn();
  const onSave = vi.fn();

  beforeEach(() => {
    onOpen.mockReset();
    onSave.mockReset();
    mount(
      makeMenu("btn-file-menu", "file-menu-dropdown", "File", [
        { id: "btn-open", label: "Open", shortcut: "Cmd+O", onclick: onOpen },
        { id: "btn-save", label: "Save", onclick: onSave },
      ]),
    );
    mount(makeMenu("btn-help-menu", "help-menu-dropdown", "Help", [{ id: "btn-about", label: "About", onclick: vi.fn() }]));
  });

  it("renders the trigger, the menu and items with optional shortcuts", () => {
    const btn = document.getElementById("btn-file-menu")!;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.textContent).toBe("File");
    expect(btn.getAttribute("aria-haspopup")).toBe("menu");
    expect(btn.classList.contains("titlebar-btn")).toBe(true);

    const menu = document.getElementById("file-menu-dropdown")!;
    expect(menu.classList.contains("titlebar-dropdown")).toBe(true);
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.querySelectorAll(".dropdown-item").length).toBe(2);

    const open = document.getElementById("btn-open")!;
    expect(open.getAttribute("role")).toBe("menuitem");
    expect(open.querySelector(".dropdown-label")!.textContent).toBe("Open");
    expect(open.querySelector(".dropdown-shortcut")!.textContent).toBe("Cmd+O");
    expect(document.getElementById("btn-save")!.querySelector(".dropdown-shortcut")).toBeNull();
  });

  it("toggles its own menu open and closed on trigger clicks", () => {
    expect(isOpen("file-menu-dropdown")).toBe(false);
    click("btn-file-menu");
    expect(isOpen("file-menu-dropdown")).toBe(true);
    click("btn-file-menu");
    expect(isOpen("file-menu-dropdown")).toBe(false);
  });

  it("opening one menu closes the other", () => {
    click("btn-file-menu");
    expect(isOpen("file-menu-dropdown")).toBe(true);
    click("btn-help-menu");
    expect(isOpen("file-menu-dropdown")).toBe(false);
    expect(isOpen("help-menu-dropdown")).toBe(true);
  });

  it("stops propagation so the document listener does not immediately close it", () => {
    initMenus();
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    const spy = vi.spyOn(e, "stopPropagation");
    document.getElementById("btn-file-menu")!.dispatchEvent(e);
    expect(spy).toHaveBeenCalled();
    expect(isOpen("file-menu-dropdown")).toBe(true);
  });

  it("clicking an item closes the menu and runs the item's handler", () => {
    click("btn-file-menu");
    click("btn-open");
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(isOpen("file-menu-dropdown")).toBe(false);
  });

  it("initMenus closes open menus on a document click", () => {
    click("btn-file-menu");
    expect(isOpen("file-menu-dropdown")).toBe(true);
    // Without initMenus an outside click does nothing.
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isOpen("file-menu-dropdown")).toBe(true);
    initMenus();
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isOpen("file-menu-dropdown")).toBe(false);
  });

  it("closeMenus is a no-op when nothing is open", () => {
    expect(() => closeMenus()).not.toThrow();
    expect(isOpen("file-menu-dropdown")).toBe(false);
  });
});

describe("makeToggleButton / setToggleState", () => {
  it("renders an unpressed button with a state dot, label and title", () => {
    const onclick = vi.fn();
    mount(makeToggleButton("btn-toggle-chat", "Chat", onclick));
    const btn = document.getElementById("btn-toggle-chat")!;
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.getAttribute("title")).toBe("Show or hide the chat panel");
    expect(btn.className).toBe("titlebar-btn toggle-btn");
    expect(btn.querySelector(".toggle-dot")!.getAttribute("aria-hidden")).toBe("true");
    expect(btn.textContent).toBe("Chat");
    click("btn-toggle-chat");
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it("appends the extra class", () => {
    mount(makeToggleButton("btn-toggle-files", "Files", vi.fn(), "hidden"));
    expect(document.getElementById("btn-toggle-files")!.className).toBe("titlebar-btn toggle-btn hidden");
  });

  it("setToggleState sets aria-pressed and the legacy .active class both ways", () => {
    mount(makeToggleButton("btn-toggle-chat", "Chat", vi.fn()));
    const btn = document.getElementById("btn-toggle-chat")!;
    setToggleState("btn-toggle-chat", true);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.classList.contains("active")).toBe(true);
    setToggleState("btn-toggle-chat", false);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.classList.contains("active")).toBe(false);
  });
});

describe("makeTitlebar", () => {
  it("wires every handler to its control", () => {
    const h: ShellHandlers = {
      onNew: vi.fn(),
      onOpen: vi.fn(),
      onSave: vi.fn(),
      onCloseTab: vi.fn(),
      onToggleChat: vi.fn(),
      onToggleFiles: vi.fn(),
      onToggleOutline: vi.fn(),
      onFocusMode: vi.fn(),
      onFind: vi.fn(),
      onExportHtml: vi.fn(),
      onPrint: vi.fn(),
      onSettings: vi.fn(),
      onAbout: vi.fn(),
      onInstallCli: vi.fn(),
    };
    mount(makeTitlebar(h));
    expect(document.getElementById("titlebar")).not.toBeNull();
    expect(document.getElementById("app-logo")!.getAttribute("src")).toBe("/icon.png");
    expect(document.getElementById("llm-status")!.textContent).toBe("");
    expect(document.getElementById("btn-toggle-files")!.classList.contains("hidden")).toBe(true);
    expect(document.getElementById("btn-toggle-outline")!.classList.contains("hidden")).toBe(false);
    const fileItems = Array.from(document.querySelectorAll("#file-menu-dropdown .dropdown-item")).map((i) => i.id);
    expect(fileItems).toEqual(["btn-new", "btn-open", "btn-save", "btn-close-tab", "btn-export-html", "btn-print"]);
    const viewItems = Array.from(document.querySelectorAll("#view-menu-dropdown .dropdown-item")).map((i) => i.id);
    expect(viewItems).toEqual(["btn-focus-mode", "btn-toggle-outline-menu", "btn-find"]);
    expect(document.getElementById("btn-view-menu")!.textContent).toBe("View");

    click("btn-new");
    click("btn-open");
    click("btn-save");
    click("btn-close-tab");
    click("btn-export-html");
    click("btn-print");
    click("btn-focus-mode");
    click("btn-find");
    click("btn-toggle-chat");
    click("btn-toggle-files");
    click("btn-toggle-outline");
    click("btn-settings");
    click("btn-about");
    click("btn-install-cli");
    for (const fn of Object.values(h)) expect(fn).toHaveBeenCalledTimes(1);
    // The View menu item is a second way to toggle the outline.
    click("btn-toggle-outline-menu");
    expect(h.onToggleOutline).toHaveBeenCalledTimes(2);
  });
});

describe("statusbar and main", () => {
  it("makeStatusbar renders the four slots and the setters patch them", () => {
    mount(makeStatusbar());
    expect(document.getElementById("status-file")!.textContent).toBe("No file open");
    expect(document.getElementById("status-provider")!.textContent).toBe("LLM: none");
    expect(document.getElementById("status-stats")!.textContent).toBe("");
    expect(document.getElementById("status-timing")!.textContent).toBe("");
    const ids = Array.from(document.getElementById("statusbar")!.children).map((c) => c.id);
    expect(ids).toEqual(["status-file", "status-provider", "status-stats", "status-timing"]);

    setStatusFile("notes.md");
    setStatusProvider("LLM: llama3");
    setStatusStats("12 words · 1 min");
    setStatusTiming("last: 1.2s");
    expect(document.getElementById("status-file")!.textContent).toBe("notes.md");
    expect(document.getElementById("status-provider")!.textContent).toBe("LLM: llama3");
    expect(document.getElementById("status-stats")!.textContent).toBe("12 words · 1 min");
    expect(document.getElementById("status-timing")!.textContent).toBe("last: 1.2s");
  });

  it("makeMain puts the panels before the editor column, which holds the editor container", () => {
    mount(makeMain([{ t: "div", a: { id: "p1" } }, { t: "div", a: { id: "p2" } }]));
    const main = document.getElementById("main")!;
    const ids = Array.from(main.children).map((c) => c.id);
    expect(ids).toEqual(["p1", "p2", "editor-column"]);
    const column = document.getElementById("editor-column")!;
    expect(Array.from(column.children).map((c) => c.id)).toEqual(["editor-container"]);
  });

  it("makeMain stacks the given chrome above the editor container", () => {
    mount(makeMain([], [{ t: "div", a: { id: "tab-bar" } }]));
    const column = document.getElementById("editor-column")!;
    expect(Array.from(column.children).map((c) => c.id)).toEqual(["tab-bar", "editor-container"]);
  });
});

describe("toggleChatPanel / setChatDisplay", () => {
  beforeEach(() => {
    mount({ t: "div", a: { id: "chat-panel", class: "hidden" } });
    mount(makeToggleButton("btn-toggle-chat", "Chat", vi.fn()));
  });

  it("opens the hidden panel, presses the button and reports open", () => {
    const panel = document.getElementById("chat-panel")!;
    const btn = document.getElementById("btn-toggle-chat")!;
    expect(toggleChatPanel()).toBe(true);
    expect(panel.classList.contains("hidden")).toBe(false);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.classList.contains("active")).toBe(true);
  });

  it("closes an open panel and releases the button", () => {
    toggleChatPanel();
    expect(toggleChatPanel()).toBe(false);
    expect(document.getElementById("chat-panel")!.classList.contains("hidden")).toBe(true);
    expect(document.getElementById("btn-toggle-chat")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("setChatDisplay flips the two visibility classes independently", () => {
    const panel = document.getElementById("chat-panel")!;
    setChatDisplay({ timestamps: true, tools: false });
    expect(panel.classList.contains("show-timestamps")).toBe(true);
    expect(panel.classList.contains("show-tools")).toBe(false);
    setChatDisplay({ timestamps: false, tools: true });
    expect(panel.classList.contains("show-timestamps")).toBe(false);
    expect(panel.classList.contains("show-tools")).toBe(true);
  });
});
