/**
 * Editor tab bar as TACO. Sits above `#editor-container` inside
 * `#editor-column`.
 *
 * The bar is a dumb view over the tab model (`editor/tabs.ts`): it renders a
 * snapshot with `bw.syncChildren` keyed by tab id and reports clicks through
 * the handlers given to `makeTabBar`. Switching, closing and creating tabs is
 * the job of `editor/documents.ts`, which owns the editor instance.
 */
import bw from "bitwrench";
import type { Taco } from "bitwrench";
import { subscribe, type Tab, type TabsSnapshot } from "../editor/tabs";
import { patchAttrs, syncChildren } from "./taco";

export interface TabBarHandlers {
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

let handlers: TabBarHandlers = { onSelect: () => {}, onClose: () => {}, onNew: () => {} };
let unsubscribe: (() => void) | null = null;

/** Tabs and the new-tab button, nothing else: the tab's controls are on the row below (`ui/editor-toolbar.ts`). */
export function makeTabBar(h: TabBarHandlers): Taco {
  handlers = h;
  return {
    t: "div",
    a: { id: "tab-bar" },
    c: [
      { t: "div", a: { id: "tab-list", role: "tablist", "aria-label": "Open documents" } },
      {
        t: "button",
        a: {
          id: "tab-new",
          class: "tab-new",
          type: "button",
          title: "New document (Cmd+N)",
          "aria-label": "New document",
          onclick: () => handlers.onNew(),
        },
        c: "+",
      },
    ],
  };
}

/**
 * Start mirroring the tab model into the bar. Idempotent; returns the
 * unsubscribe function. Call after the bar is mounted.
 */
export function initTabBar(): () => void {
  unsubscribe?.();
  unsubscribe = subscribe(renderTabBar);
  return () => {
    unsubscribe?.();
    unsubscribe = null;
  };
}

/** A tab plus whether it is the active one — what the view needs per row. */
interface TabRow {
  tab: Tab;
  active: boolean;
}

function tabLabel(tab: Tab): string {
  return tab.path ?? tab.title;
}

function createTab({ tab, active }: TabRow): Taco {
  const classes = ["editor-tab"];
  if (active) classes.push("active");
  if (tab.dirty) classes.push("dirty");
  return {
    t: "div",
    a: {
      class: classes,
      role: "tab",
      "aria-selected": active ? "true" : "false",
      "data-tab-id": tab.id,
      title: tabLabel(tab),
      onclick: () => handlers.onSelect(tab.id),
      onauxclick: (e: MouseEvent) => {
        if (e.button === 1) {
          e.preventDefault();
          handlers.onClose(tab.id);
        }
      },
      // Middle-button autoscroll would otherwise start on mousedown.
      onmousedown: (e: MouseEvent) => {
        if (e.button === 1) e.preventDefault();
      },
    },
    c: [
      { t: "span", a: { class: "tab-title" }, c: tab.title },
      { t: "span", a: { class: "tab-dirty", "aria-hidden": "true" }, c: "●" },
      {
        t: "button",
        a: {
          class: "tab-close",
          type: "button",
          "aria-label": `Close ${tab.title}`,
          title: "Close (Cmd+W)",
          onclick: (e: Event) => {
            e.stopPropagation();
            handlers.onClose(tab.id);
          },
        },
        c: "×",
      },
    ],
  };
}

function updateTab(node: HTMLElement, { tab, active }: TabRow): void {
  bw.toggleClass(node, "dirty", tab.dirty);
  bw.toggleClass(node, "active", active);
  patchAttrs(node, { "aria-selected": active ? "true" : "false", title: tabLabel(tab) });
  const title = node.querySelector(".tab-title") as HTMLElement | null;
  if (title && title.textContent !== tab.title) bw.patch(title, tab.title);
  const close = node.querySelector(".tab-close") as HTMLElement | null;
  if (close) patchAttrs(close, { "aria-label": `Close ${tab.title}` });
}

/** Reconcile the bar with a model snapshot. Exported for tests; `initTabBar` wires it to the model. */
export function renderTabBar(s: TabsSnapshot): void {
  const list = bw.el("tab-list");
  if (!list) return;
  const activeId = s.active?.id ?? null;
  const rows: TabRow[] = s.tabs.map((tab) => ({ tab, active: tab.id === activeId }));
  syncChildren(list, rows, { key: (r) => r.tab.id, create: createTab, update: updateTab });
  if (activeId) {
    const node = list.querySelector(`[data-tab-id="${activeId}"]`) as HTMLElement | null;
    node?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }
}
