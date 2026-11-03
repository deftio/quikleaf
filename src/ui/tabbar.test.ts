/**
 * Tab bar: rendering from model snapshots, keyed reconciliation, click /
 * middle-click / close handlers, and the live subscription to the model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { initTabBar, makeTabBar, renderTabBar, type TabBarHandlers } from "./tabbar";
import { newUntitledTab, openTab, resetTabs, setActive, snapshot, updateContent } from "../editor/tabs";

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`test: #${id} missing`);
  return node;
}

function tabNodes(): HTMLElement[] {
  return Array.from(byId("tab-list").querySelectorAll(".editor-tab")) as HTMLElement[];
}

const handlers: TabBarHandlers = { onSelect: vi.fn(), onClose: vi.fn(), onNew: vi.fn() };
let stop: (() => void) | null = null;

beforeEach(() => {
  resetTabs();
  vi.mocked(handlers.onSelect).mockReset();
  vi.mocked(handlers.onClose).mockReset();
  vi.mocked(handlers.onNew).mockReset();
  bw.append(byId("app"), makeTabBar(handlers));
});

afterEach(() => {
  stop?.();
  stop = null;
  bw.clear(byId("app"));
});

describe("makeTabBar", () => {
  it("renders an empty tablist and a new-tab button wired to onNew", () => {
    expect(byId("tab-list").getAttribute("role")).toBe("tablist");
    expect(byId("tab-list").children).toHaveLength(0);
    const plus = byId("tab-new");
    expect(plus.textContent).toBe("+");
    expect(plus.getAttribute("aria-label")).toBe("New document");
    plus.click();
    expect(handlers.onNew).toHaveBeenCalledTimes(1);
  });

  it("holds only the tabs and the new-tab button (the tab's controls are on the row below)", () => {
    expect(Array.from(byId("tab-bar").children).map((c) => c.id)).toEqual(["tab-list", "tab-new"]);
  });
});

describe("renderTabBar", () => {
  it("is a no-op when the bar is not mounted", () => {
    bw.clear(byId("app"));
    newUntitledTab();
    expect(() => renderTabBar(snapshot())).not.toThrow();
  });

  it("renders one keyed row per tab with title, dot, close button and aria-selected", () => {
    const a = openTab("/docs/a.md", "a");
    const b = newUntitledTab();
    setActive(a.id);
    renderTabBar(snapshot());

    const rows = tabNodes();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.getAttribute("data-tab-id"))).toEqual([a.id, b.id]);
    expect(rows.map((r) => r.querySelector(".tab-title")!.textContent)).toEqual(["a.md", "Untitled"]);
    expect(rows[0].getAttribute("role")).toBe("tab");
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    expect(rows[1].getAttribute("aria-selected")).toBe("false");
    expect(rows[0].classList.contains("active")).toBe(true);
    expect(rows[1].classList.contains("active")).toBe(false);
    expect(rows[0].getAttribute("title")).toBe("/docs/a.md"); // tooltip shows the full path
    expect(rows[1].getAttribute("title")).toBe("Untitled");
    expect(rows[0].querySelector(".tab-dirty")!.textContent).toBe("●");
    expect(rows[0].classList.contains("dirty")).toBe(false);
    const close = rows[0].querySelector(".tab-close")!;
    expect(close.getAttribute("aria-label")).toBe("Close a.md");
    expect(close.textContent).toBe("×");
  });

  it("marks dirty tabs with the dirty class", () => {
    const a = openTab("/a.md", "a");
    renderTabBar(snapshot());
    expect(tabNodes()[0].classList.contains("dirty")).toBe(false);
    updateContent(a.id, "changed");
    renderTabBar(snapshot());
    expect(tabNodes()[0].classList.contains("dirty")).toBe(true);
    updateContent(a.id, "a");
    renderTabBar(snapshot());
    expect(tabNodes()[0].classList.contains("dirty")).toBe(false);
  });

  it("reuses existing nodes on re-render and updates their state in place", () => {
    const a = openTab("/a.md", "a");
    const b = openTab("/b.md", "b");
    renderTabBar(snapshot());
    const [nodeA, nodeB] = tabNodes();
    expect(nodeB.classList.contains("active")).toBe(true);

    setActive(a.id);
    renderTabBar(snapshot());
    const after = tabNodes();
    expect(after[0]).toBe(nodeA); // same DOM nodes, not recreated
    expect(after[1]).toBe(nodeB);
    expect(nodeA.classList.contains("active")).toBe(true);
    expect(nodeA.getAttribute("aria-selected")).toBe("true");
    expect(nodeB.classList.contains("active")).toBe(false);
    expect(nodeB.getAttribute("aria-selected")).toBe("false");
    void b;
  });

  it("renames a row when an untitled tab is saved under a path", async () => {
    const { markSaved } = await import("../editor/tabs");
    const t = newUntitledTab();
    renderTabBar(snapshot());
    const node = tabNodes()[0];
    markSaved(t.id, "/tmp/notes.md");
    renderTabBar(snapshot());
    expect(tabNodes()[0]).toBe(node);
    expect(node.querySelector(".tab-title")!.textContent).toBe("notes.md");
    expect(node.getAttribute("title")).toBe("/tmp/notes.md");
    expect(node.querySelector(".tab-close")!.getAttribute("aria-label")).toBe("Close notes.md");
  });

  it("removes rows for closed tabs and keeps order", async () => {
    const { closeTab } = await import("../editor/tabs");
    const a = openTab("/a.md", "a");
    const b = openTab("/b.md", "b");
    const c = openTab("/c.md", "c");
    renderTabBar(snapshot());
    closeTab(b.id);
    renderTabBar(snapshot());
    expect(tabNodes().map((r) => r.getAttribute("data-tab-id"))).toEqual([a.id, c.id]);
  });
});

describe("interaction", () => {
  it("clicking a tab reports its id; clicking × reports a close without selecting", () => {
    const a = openTab("/a.md", "a");
    newUntitledTab();
    renderTabBar(snapshot());
    const [nodeA] = tabNodes();

    nodeA.click();
    expect(handlers.onSelect).toHaveBeenCalledWith(a.id);

    (nodeA.querySelector(".tab-close") as HTMLElement).click();
    expect(handlers.onClose).toHaveBeenCalledWith(a.id);
    expect(handlers.onSelect).toHaveBeenCalledTimes(1); // stopPropagation kept the tab click out
  });

  it("middle-click closes a tab and suppresses autoscroll; other aux buttons do nothing", () => {
    const a = openTab("/a.md", "a");
    renderTabBar(snapshot());
    const node = tabNodes()[0];

    const down = new MouseEvent("mousedown", { button: 1, bubbles: true, cancelable: true });
    node.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    const leftDown = new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true });
    node.dispatchEvent(leftDown);
    expect(leftDown.defaultPrevented).toBe(false);

    const aux = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
    node.dispatchEvent(aux);
    expect(aux.defaultPrevented).toBe(true);
    expect(handlers.onClose).toHaveBeenCalledWith(a.id);

    node.dispatchEvent(new MouseEvent("auxclick", { button: 2, bubbles: true, cancelable: true }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("initTabBar", () => {
  it("re-renders on every model change until unsubscribed", () => {
    stop = initTabBar();
    const a = openTab("/a.md", "a");
    expect(tabNodes()).toHaveLength(1);
    newUntitledTab();
    expect(tabNodes()).toHaveLength(2);
    expect(tabNodes()[1].classList.contains("active")).toBe(true);
    setActive(a.id);
    expect(tabNodes()[0].classList.contains("active")).toBe(true);

    stop();
    stop = null;
    newUntitledTab();
    expect(tabNodes()).toHaveLength(2);
  });

  it("is idempotent — calling it twice does not double-render", () => {
    initTabBar();
    stop = initTabBar();
    newUntitledTab();
    expect(tabNodes()).toHaveLength(1);
  });
});
