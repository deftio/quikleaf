/**
 * The log viewer: live entries via onLogEvent, the file's tail merged on
 * first show, filter, Follow, Clear, Open Folder, and the ring limit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import * as tabs from "../editor/tabs";
import { logEvent } from "./perf";
import {
  MAX,
  initLogPane,
  isFollowing,
  loadFromFile,
  logCounts,
  logEntries,
  logFilter,
  makeLogPanel,
  resetLogPane,
  setFollow,
  setLogFilter,
} from "./log-pane";

const mockInvoke = vi.mocked(invoke);
const flush = () => new Promise((r) => setTimeout(r, 0));

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error(`test: #${id} missing`);
  return n as T;
}
const rows = () => Array.from(byId("log-list").querySelectorAll(".log-row")) as HTMLElement[];
const toasts = () => Array.from(document.querySelectorAll(".bw_bccl_toast"));

let stop: (() => void) | null = null;
let fileRows: any[] = [];

beforeEach(() => {
  localStorage.clear();
  tabs.resetTabs();
  resetLogPane();
  fileRows = [];
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "log_tail") return fileRows;
    if (cmd === "log_get_path") return "/logs/quikleaf-perf.jsonl";
    return null;
  });
  bw.append(byId("app"), makeLogPanel());
});

afterEach(() => {
  stop?.();
  stop = null;
  resetLogPane();
  tabs.resetTabs();
  bw.clear(byId("app"));
  for (const t of toasts()) t.remove();
});

describe("makeLogPanel", () => {
  it("renders the filter radios (All checked), Follow pressed, Clear and Open Folder", () => {
    const radios = Array.from(document.querySelectorAll("#log-panel [role=radio]")).map((r) => [r.id, r.getAttribute("aria-checked")]);
    expect(radios).toEqual([
      ["log-filter-all", "true"],
      ["log-filter-llm", "false"],
      ["log-filter-tool", "false"],
      ["log-filter-turn", "false"],
      ["log-filter-app", "false"],
    ]);
    expect(byId("log-follow").getAttribute("aria-pressed")).toBe("true");
    expect(byId("log-clear").textContent).toBe("Clear");
    expect(byId("log-open-folder").textContent).toBe("Open Folder");
    expect(byId("log-list").getAttribute("role")).toBe("log");
  });
});

describe("live entries", () => {
  it("appends a row for every logEvent, even with the file log off, and counts by kind", async () => {
    stop = initLogPane();
    localStorage.setItem("quikleaf_llm_settings", JSON.stringify({ perfLog: false }));
    await logEvent({ kind: "tool", name: "read_document", ms: 12 });
    await logEvent({ kind: "llm", model: "llama3", total_ms: 1500, ttft_ms: 200, tok_per_s: 42 });
    expect(rows().map((r) => r.getAttribute("data-kind"))).toEqual(["tool", "llm"]);
    expect(rows()[0].textContent).toContain("tool read_document 12ms");
    expect(rows()[1].textContent).toContain("llm llama3 · 1.50s · ttft 200ms · 42 tok/s");
    expect(logCounts()).toEqual({ total: 2, llm: 1, tool: 1, turn: 0, app: 0 });
    expect(mockInvoke).not.toHaveBeenCalledWith("log_append", expect.anything());
  });

  it("keeps at most MAX entries and re-renders when the ring wraps", async () => {
    stop = initLogPane();
    for (let i = 0; i < MAX + 5; i++) await logEvent({ kind: "app", event: `e${i}` });
    expect(logEntries()).toHaveLength(MAX);
    expect(rows()).toHaveLength(MAX);
    expect(rows()[0].textContent).toContain("e5");
  });

  it("initLogPane is idempotent and the unsubscribe stops the feed", async () => {
    initLogPane();
    stop = initLogPane();
    await logEvent({ kind: "app", event: "once" });
    expect(rows()).toHaveLength(1);
    stop();
    stop = null;
    await logEvent({ kind: "app", event: "twice" });
    expect(rows()).toHaveLength(1);
  });
});

describe("the file's tail", () => {
  it("is read the first time the log tab is shown and merged in front of what was seen live, without duplicates", async () => {
    stop = initLogPane();
    await logEvent({ kind: "app", event: "start" });
    const live = logEntries()[0];
    fileRows = [{ ts: "2026-01-01T09:00:00.000Z", kind: "turn", total_ms: 2000, llm_calls: 1, tool_calls: 0 }, live];
    tabs.openLogTab();
    await flush();
    await flush();
    expect(logEntries().map((e) => e.kind)).toEqual(["turn", "app"]);
    expect(rows()).toHaveLength(2);
    expect(byId("log-path").textContent).toBe("/logs/quikleaf-perf.jsonl");
    // Only once: showing the tab again does not re-read.
    tabs.newUntitledTab();
    tabs.openLogTab();
    await flush();
    expect(mockInvoke.mock.calls.filter((c) => c[0] === "log_tail")).toHaveLength(1);
  });

  it("loadFromFile copes with a missing file and an unmounted pane", async () => {
    bw.clear(byId("app"));
    mockInvoke.mockRejectedValue(new Error("nope"));
    await expect(loadFromFile()).resolves.toBeUndefined();
    expect(logEntries()).toEqual([]);
  });
});

describe("filter, Follow, Clear, Open Folder", () => {
  it("the filter marks the list and checks one radio", () => {
    stop = initLogPane();
    byId("log-filter-llm").click();
    expect(logFilter()).toBe("llm");
    expect(byId("log-list").classList.contains("filter-llm")).toBe(true);
    expect(byId("log-filter-llm").getAttribute("aria-checked")).toBe("true");
    expect(byId("log-filter-all").getAttribute("aria-checked")).toBe("false");
    setLogFilter("all");
    expect(byId("log-list").classList.contains("filter-llm")).toBe(false);
  });

  it("Follow toggles and scrolls to the end when turned on", () => {
    stop = initLogPane();
    byId("log-follow").click();
    expect(isFollowing()).toBe(false);
    expect(byId("log-follow").getAttribute("aria-pressed")).toBe("false");
    setFollow(true);
    expect(byId("log-follow").getAttribute("aria-pressed")).toBe("true");
  });

  it("Clear empties the file and the view with a toast; a failure toasts too", async () => {
    stop = initLogPane();
    await logEvent({ kind: "app", event: "x" });
    byId("log-clear").click();
    await flush();
    expect(mockInvoke).toHaveBeenCalledWith("log_clear");
    expect(rows()).toHaveLength(0);
    expect(logEntries()).toEqual([]);
    expect(toasts()[0].textContent).toContain("Performance log cleared");
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "log_clear") throw new Error("locked");
      return null;
    });
    byId("log-clear").click();
    await flush();
    expect(toasts()[1].textContent).toContain("locked");
  });

  it("Open Folder invokes log_reveal and toasts only on failure", async () => {
    stop = initLogPane();
    byId("log-open-folder").click();
    await flush();
    expect(mockInvoke).toHaveBeenCalledWith("log_reveal");
    expect(toasts()).toHaveLength(0);
    mockInvoke.mockRejectedValue(new Error("no file manager"));
    byId("log-open-folder").click();
    await flush();
    expect(toasts()[0].textContent).toContain("no file manager");
  });
});
