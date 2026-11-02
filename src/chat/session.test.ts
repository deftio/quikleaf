/**
 * Chat sessions: one sealed chat per tab, scope by tab kind, memory scoping,
 * pruning, and the `quikleaf.prj` chat-history round trip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import * as tabs from "../editor/tabs";
import {
  CHAT_CHANGED,
  activeSession,
  clearSession,
  dropSession,
  exportChatHistory,
  importChatHistory,
  isSessionActive,
  listSessions,
  notifyChatChanged,
  peekSession,
  pruneSessions,
  resetSessions,
  scopeForTab,
  sessionFor,
  sessionHasMemory,
  sessionLabel,
  sessionTab,
  setSessionModel,
} from "./session";

beforeEach(() => {
  tabs.resetTabs();
  resetSessions();
});

afterEach(() => {
  tabs.resetTabs();
  resetSessions();
});

describe("sessions and tabs", () => {
  it("creates one session per tab lazily, scoped by the tab's kind", () => {
    expect(activeSession()).toBeNull();
    const doc = tabs.openTab("/a.md", "a");
    const s = sessionFor(doc.id);
    expect(s.scope).toBe("document");
    expect(s.tabId).toBe(doc.id);
    expect(sessionFor(doc.id)).toBe(s);
    expect(peekSession("tab-99")).toBeUndefined();
    expect(activeSession()).toBe(s);
    expect(sessionTab(s)).toMatchObject({ path: "/a.md" });
    expect(isSessionActive(s)).toBe(true);
    expect(s.log.classList.contains("chat-log")).toBe(true);
    expect(s.log.dataset.tabId).toBe(doc.id);

    const project = tabs.openProjectTab();
    expect(sessionFor(project.id).scope).toBe("project");
    expect(sessionFor(tabs.PROJECT_TAB_ID).scope).toBe("project");
    expect(isSessionActive(s)).toBe(false);
    expect(scopeForTab(null)).toBe("document");
    expect(scopeForTab(project)).toBe("project");
    expect(listSessions().length).toBe(2);
    // A session for an id with no tab is a document chat by default.
    expect(sessionFor("tab-ghost").scope).toBe("document");
  });

  it("labels chats after their document, or 'the project'", () => {
    const a = tabs.openTab("/docs/notes.md", "");
    expect(sessionLabel(sessionFor(a.id))).toBe("notes.md");
    expect(sessionLabel(sessionFor(tabs.PROJECT_TAB_ID))).toBe("the project");
    expect(sessionLabel(sessionFor("tab-ghost"))).toBe("this document");
  });

  it("offers memory only to project files and the project chat", () => {
    const outside = tabs.openTab("/elsewhere/x.md", "");
    const untitled = tabs.newUntitledTab();
    const inside = tabs.openTab("docs/g.md", "", { projectRelative: true });
    expect(sessionHasMemory(sessionFor(outside.id))).toBe(false);
    expect(sessionHasMemory(sessionFor(untitled.id))).toBe(false);
    expect(sessionHasMemory(sessionFor(inside.id))).toBe(true);
    expect(sessionHasMemory(sessionFor(tabs.PROJECT_TAB_ID))).toBe(true);
  });

  it("prunes sessions of closed tabs but keeps the project chat; dropSession removes any", () => {
    const a = tabs.openTab("/a.md", "");
    const b = tabs.openTab("/b.md", "");
    sessionFor(a.id);
    sessionFor(b.id);
    sessionFor(tabs.PROJECT_TAB_ID);
    tabs.closeTab(b.id);
    pruneSessions();
    expect(peekSession(a.id)).toBeDefined();
    expect(peekSession(b.id)).toBeUndefined();
    expect(peekSession(tabs.PROJECT_TAB_ID)).toBeDefined();
    pruneSessions([]);
    expect(peekSession(a.id)).toBeUndefined();
    expect(peekSession(tabs.PROJECT_TAB_ID)).toBeDefined();
    dropSession(tabs.PROJECT_TAB_ID);
    expect(peekSession(tabs.PROJECT_TAB_ID)).toBeUndefined();
  });

  it("clearSession empties everything but the model override", () => {
    const a = tabs.openTab("/a.md", "");
    const s = sessionFor(a.id);
    s.messages.push({ role: "user", content: "x" });
    s.transcript.push({ role: "user", text: "x" });
    s.rendered = 1;
    s.plan = { title: "p", steps: [] };
    s.stats.turns = 3;
    s.greeted = true;
    s.model = "qwen3";
    bw.append(s.log, { t: "div", c: "bubble" });
    clearSession(s);
    expect(s.messages).toEqual([]);
    expect(s.transcript).toEqual([]);
    expect(s.rendered).toBe(0);
    expect(s.plan).toBeNull();
    expect(s.stats).toEqual({ turns: 0, llmCalls: 0, toolCalls: 0 });
    expect(s.greeted).toBe(false);
    expect(s.log.children.length).toBe(0);
    expect(s.model).toBe("qwen3");
  });

  it("setSessionModel trims, clears and publishes CHAT_CHANGED only on change", () => {
    const a = tabs.openTab("/a.md", "");
    const s = sessionFor(a.id);
    const seen: any[] = [];
    const off = bw.sub(CHAT_CHANGED, (d) => seen.push(d));
    setSessionModel(s, "  qwen3 ");
    expect(s.model).toBe("qwen3");
    setSessionModel(s, "qwen3");
    setSessionModel(s, "   ");
    expect(s.model).toBeNull();
    setSessionModel(s, null);
    notifyChatChanged(s);
    expect(seen).toEqual([{ tabId: a.id }, { tabId: a.id }, { tabId: a.id }]);
    off();
  });
});

describe("chat history persistence", () => {
  it("exports project-file chats by path (with layout) and the project chat; skips untitled and outside files", () => {
    tabs.newUntitledTab();
    tabs.openTab("/outside/x.md", "");
    const g = tabs.openTab("docs/g.md", "", { projectRelative: true });
    const r = tabs.openTab("readme.md", "", { projectRelative: true });
    tabs.setView(g.id, { chat: true, mode: "preview" });
    const sg = sessionFor(g.id);
    sg.transcript.push({ role: "user", text: "q" }, { role: "assistant", text: "a" });
    sg.model = "qwen3";
    sessionFor("/outside/x.md");
    const p = sessionFor(tabs.PROJECT_TAB_ID);
    p.transcript.push({ role: "user", text: "project q" });

    const h = exportChatHistory();
    expect(h.version).toBe(1);
    expect(Object.keys(h.tabs).sort()).toEqual(["docs/g.md", "readme.md"]);
    expect(h.tabs["docs/g.md"]).toEqual({
      transcript: [{ role: "user", text: "q" }, { role: "assistant", text: "a" }],
      model: "qwen3",
      view: { chat: true, info: false, mode: "preview" },
    });
    // A tab with no chat yet still records its layout.
    expect(h.tabs["readme.md"]).toEqual({ transcript: [], model: null, view: tabs.getTab(r.id)!.view });
    expect(h.project).toEqual({ transcript: [{ role: "user", text: "project q" }], model: null });
    // Exported transcripts are copies.
    h.tabs["docs/g.md"].transcript[0].text = "changed";
    expect(sg.transcript[0].text).toBe("q");
  });

  it("exports no project entry until the project chat has anything to say", () => {
    expect(exportChatHistory()).toEqual({ version: 1, tabs: {}, project: null });
    sessionFor(tabs.PROJECT_TAB_ID);
    expect(exportChatHistory().project).toBeNull();
  });

  it("imports onto open tabs: transcript, messages, stats, model, layout, and the project chat", () => {
    const g = tabs.openTab("docs/g.md", "", { projectRelative: true });
    tabs.openTab("readme.md", "", { projectRelative: true });
    const seen: any[] = [];
    const off = bw.sub(CHAT_CHANGED, (d) => seen.push(d.tabId));
    const n = importChatHistory({
      version: 1,
      tabs: {
        "docs/g.md": {
          transcript: [{ role: "user", text: "q" }, { role: "assistant", text: "a" }, { role: "system", text: "bad" }, "junk"],
          model: " qwen3 ",
          view: { chat: true, info: true, mode: "bogus" },
        },
        "missing.md": { transcript: [{ role: "user", text: "lost" }], model: null },
        "readme.md": "not an object",
      },
      project: { transcript: [{ role: "user", text: "pq" }], model: null },
    });
    off();
    expect(n).toBe(2);
    const s = sessionFor(g.id);
    expect(s.transcript).toEqual([{ role: "user", text: "q" }, { role: "assistant", text: "a" }]);
    expect(s.messages).toEqual([{ role: "user", content: "q" }, { role: "assistant", content: "a" }]);
    expect(s.stats.turns).toBe(1);
    expect(s.model).toBe("qwen3");
    expect(s.greeted).toBe(true);
    expect(s.rendered).toBe(0);
    expect(tabs.getTab(g.id)!.view).toEqual({ chat: true, info: true, mode: "split" });
    const p = sessionFor(tabs.PROJECT_TAB_ID);
    expect(p.transcript).toEqual([{ role: "user", text: "pq" }]);
    expect(seen).toEqual([g.id, tabs.PROJECT_TAB_ID]);
    // The project chat has a session even though its tab is not open.
    expect(tabs.getTab(tabs.PROJECT_TAB_ID)).toBeNull();
  });

  it("ignores unknown shapes", () => {
    tabs.openTab("docs/g.md", "", { projectRelative: true });
    expect(importChatHistory(undefined)).toBe(0);
    expect(importChatHistory([])).toBe(0);
    expect(importChatHistory({ version: 2, tabs: {} })).toBe(0);
    expect(importChatHistory({ version: 1 })).toBe(0);
    expect(listSessions()).toEqual([]);
  });

  it("round-trips through export and import", () => {
    const g = tabs.openTab("docs/g.md", "", { projectRelative: true });
    const s = sessionFor(g.id);
    s.transcript.push({ role: "user", text: "q" }, { role: "assistant", text: "a" });
    s.model = "m";
    tabs.setView(g.id, { info: true });
    const h = JSON.parse(JSON.stringify(exportChatHistory()));
    resetSessions();
    tabs.setView(g.id, { info: false });
    expect(importChatHistory(h)).toBe(1);
    expect(sessionFor(g.id).transcript).toEqual([{ role: "user", text: "q" }, { role: "assistant", text: "a" }]);
    expect(sessionFor(g.id).model).toBe("m");
    expect(tabs.getTab(g.id)!.view.info).toBe(true);
  });
});

// Keep the spy-free bitwrench pub/sub from leaking between files.
afterEach(() => {
  vi.restoreAllMocks();
});
