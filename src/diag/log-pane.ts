/**
 * The log viewer: the body of the `log` tab (`editor/tabs.ts`, `openLogTab`).
 *
 *   [All] [llm] [tool] [turn] [app]   path…   [Follow] [Clear] [Open Folder]
 *   09:15:30 llm llama3 · 1.50s · ttft 200ms · 42 tok/s
 *   …
 *
 * Entries arrive two ways. Live: every `logEvent()` call reaches `onLogEvent`
 * before it is written, whether or not writing is on, so the view follows
 * the running app with no file watching. From disk: the first time the tab
 * is shown, the file's tail is read and merged in front of what was seen
 * live (deduplicated by timestamp and kind). A ring of the last `MAX`
 * entries is kept; Follow keeps the newest in view.
 */
import bw from "bitwrench";
import type { Taco } from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import { LOG_TAB_ID, subscribe as subscribeTabs, type TabsSnapshot } from "../editor/tabs";
import { el } from "../ui/taco";
import { notify } from "../ui/toast";
import { describeEntry, getLogPath, onLogEvent, tailLog, type LoggedEntry } from "./perf";

export const MAX = 500;
export const KINDS = ["llm", "tool", "turn", "app"] as const;
export type LogFilter = "all" | (typeof KINDS)[number];

let entries: LoggedEntry[] = [];
let filter: LogFilter = "all";
let follow = true;
let loadedFromFile = false;
let unsubscribers: Array<() => void> = [];

const key = (e: LoggedEntry) => `${e.ts}|${e.kind}`;

function makeRow(e: LoggedEntry): Taco {
  return { t: "div", a: { class: "log-row", "data-kind": e.kind }, c: describeEntry(e) };
}

function list(): HTMLElement | null {
  return el("log-list");
}

function scrollToEnd(): void {
  const l = list();
  if (l) l.scrollTop = l.scrollHeight;
}

function renderAll(): void {
  const l = list();
  if (!l) return;
  bw.patch(l, entries.map(makeRow));
  if (follow) scrollToEnd();
}

function append(e: LoggedEntry): void {
  entries.push(e);
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  const l = list();
  if (!l) return;
  if (entries.length === MAX) {
    renderAll();
    return;
  }
  bw.append(l, makeRow(e));
  if (follow) scrollToEnd();
}

/** Counts for the info pane. */
export function logCounts(): { total: number; llm: number; tool: number; turn: number; app: number } {
  const c = { total: entries.length, llm: 0, tool: 0, turn: 0, app: 0 };
  for (const e of entries) if (e.kind in c) c[e.kind as keyof typeof c]++;
  return c;
}

/** The entries in view (a copy). */
export function logEntries(): LoggedEntry[] {
  return entries.slice();
}

export function setLogFilter(f: LogFilter): void {
  filter = f;
  const l = list();
  if (l) for (const k of KINDS) bw.toggleClass(l, `filter-${k}`, f === k);
  for (const k of ["all", ...KINDS] as LogFilter[]) {
    const btn = el(`log-filter-${k}`);
    if (btn) btn.setAttribute("aria-checked", k === f ? "true" : "false");
  }
}

export function logFilter(): LogFilter {
  return filter;
}

export function setFollow(on: boolean): void {
  follow = on;
  const btn = el("log-follow");
  if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
  if (on) scrollToEnd();
}

export function isFollowing(): boolean {
  return follow;
}

/** Read the file's tail once and merge it in front of what was seen live. */
export async function loadFromFile(n = 200): Promise<void> {
  const seen = new Set(entries.map(key));
  const rows = (await tailLog(n)) as LoggedEntry[];
  const older = rows.filter((r) => r && r.ts && !seen.has(key(r)));
  if (older.length) {
    entries = [...older, ...entries];
    if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  }
  loadedFromFile = true;
  renderAll();
  bw.patch("log-path", (await getLogPath()) || "log file unavailable");
}

async function clearLog(): Promise<void> {
  try {
    await invoke("log_clear");
    entries = [];
    renderAll();
    notify("Performance log cleared", "New entries will start a fresh file.", "success");
  } catch (e: any) {
    notify("Could not clear log", String(e?.message || e), "danger");
  }
}

function revealLog(): void {
  invoke("log_reveal").catch((e: any) => notify("Cannot open log folder", String(e?.message || e), "danger"));
}

function filterButton(k: LogFilter, label: string): Taco {
  return {
    t: "button",
    a: {
      id: `log-filter-${k}`,
      class: "tool-btn",
      type: "button",
      role: "radio",
      "aria-checked": k === filter ? "true" : "false",
      onclick: () => setLogFilter(k),
    },
    c: label,
  };
}

/** The log pane TACO. Hidden unless `#editor-column.log-tab` (CSS). */
export function makeLogPanel(): Taco {
  return {
    t: "div",
    a: { id: "log-panel", class: "log-panel" },
    c: [
      {
        t: "div",
        a: { class: "log-head" },
        c: [
          {
            t: "div",
            a: { class: "tool-group", role: "radiogroup", "aria-label": "Show" },
            c: [filterButton("all", "All"), ...KINDS.map((k) => filterButton(k, k))],
          },
          { t: "span", a: { id: "log-path", class: "log-path", title: "Log file" }, c: "" },
          { t: "span", a: { class: "tool-spacer" } },
          {
            t: "button",
            a: {
              id: "log-follow",
              class: "tool-btn",
              type: "button",
              "aria-pressed": follow ? "true" : "false",
              title: "Keep the newest entries in view as they arrive",
              onclick: () => setFollow(!follow),
            },
            c: "Follow",
          },
          { t: "button", a: { id: "log-clear", class: "tool-btn", type: "button", title: "Empty the log file", onclick: clearLog }, c: "Clear" },
          { t: "button", a: { id: "log-open-folder", class: "tool-btn", type: "button", title: "Show the log file", onclick: revealLog }, c: "Open Folder" },
        ],
      },
      { t: "div", a: { id: "log-list", class: "log-list", role: "log", "aria-label": "Performance log" } },
    ],
  };
}

/**
 * Start watching: live entries from `logEvent`, and the file's tail the first
 * time the log tab is shown. Idempotent; returns the unsubscribe function.
 */
export function initLogPane(): () => void {
  for (const off of unsubscribers) off();
  unsubscribers = [
    onLogEvent(append),
    subscribeTabs((s: TabsSnapshot) => {
      if (s.active?.id === LOG_TAB_ID && !loadedFromFile) void loadFromFile();
    }),
  ];
  const l = list();
  if (l) {
    renderAll();
    setLogFilter(filter);
  }
  return () => {
    for (const off of unsubscribers) off();
    unsubscribers = [];
  };
}

/** Tests only: forget everything. */
export function resetLogPane(): void {
  for (const off of unsubscribers) off();
  unsubscribers = [];
  entries = [];
  filter = "all";
  follow = true;
  loadedFromFile = false;
}
