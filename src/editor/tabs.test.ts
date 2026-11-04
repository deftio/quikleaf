import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TABS_CHANGED,
  activeTab,
  closeTab,
  fileName,
  getTab,
  listTabs,
  markSaved,
  newUntitledTab,
  nextTab,
  openTab,
  prevTab,
  resetTabs,
  setActive,
  snapshot,
  subscribe,
  updateContent,
  openProjectTab,
  setView,
  LOG_TAB_ID,
  PROJECT_TAB_ID,
  openLogTab,
  type TabsSnapshot,
} from "./tabs";

beforeEach(() => resetTabs());

describe("fileName", () => {
  it("extracts the last segment of unix and forward-slash windows paths", () => {
    expect(fileName("/home/user/docs/readme.md")).toBe("readme.md");
    expect(fileName("C:/Users/u/readme.md")).toBe("readme.md");
    expect(fileName("readme.md")).toBe("readme.md");
  });

  it("falls back to the whole string when there is nothing after the separators", () => {
    expect(fileName("")).toBe("");
    expect(fileName("/path/to/dir/")).toBe("/path/to/dir/");
    expect(fileName("C:\\Users\\u\\readme.md")).toBe("C:\\Users\\u\\readme.md");
  });
});

describe("empty state", () => {
  it("starts with no tabs and no active tab", () => {
    expect(listTabs()).toEqual([]);
    expect(activeTab()).toBeNull();
    expect(snapshot()).toEqual({ tabs: [], active: null });
    expect(getTab("nope")).toBeNull();
    expect(nextTab()).toBeNull();
    expect(prevTab()).toBeNull();
  });
});

describe("openTab", () => {
  it("creates a clean, active tab titled after the file name", () => {
    const t = openTab("/docs/notes.md", "# Notes");
    expect(t).toEqual({
      id: "tab-1",
      kind: "document",
      path: "/docs/notes.md",
      title: "notes.md",
      content: "# Notes",
      dirty: false,
      projectRelative: false,
      view: { chat: false, info: false, mode: "split" },
    });
    expect(activeTab()).toEqual(t);
    expect(listTabs()).toHaveLength(1);
  });

  it("records project-relative paths", () => {
    const t = openTab("docs/guide.md", "# Guide", { projectRelative: true });
    expect(t.projectRelative).toBe(true);
    expect(t.title).toBe("guide.md");
  });

  it("appends tabs in opening order and focuses the newest", () => {
    openTab("/a.md", "a");
    const b = openTab("/b.md", "b");
    expect(listTabs().map((t) => t.path)).toEqual(["/a.md", "/b.md"]);
    expect(activeTab()?.id).toBe(b.id);
  });

  it("focuses an existing tab for the same path instead of duplicating it", () => {
    const a = openTab("/a.md", "a");
    openTab("/b.md", "b");
    const again = openTab("/a.md", "a");
    expect(again.id).toBe(a.id);
    expect(listTabs()).toHaveLength(2);
    expect(activeTab()?.id).toBe(a.id);
  });

  it("refreshes the content of a clean existing tab from disk", () => {
    const a = openTab("/a.md", "old");
    openTab("/a.md", "new");
    expect(getTab(a.id)?.content).toBe("new");
    expect(getTab(a.id)?.dirty).toBe(false);
  });

  it("keeps the edits of a dirty existing tab", () => {
    const a = openTab("/a.md", "old");
    updateContent(a.id, "edited");
    openTab("/a.md", "new on disk");
    expect(getTab(a.id)?.content).toBe("edited");
    expect(getTab(a.id)?.dirty).toBe(true);
  });

  it("treats the same string as different tabs when one is project-relative", () => {
    openTab("readme.md", "abs");
    openTab("readme.md", "rel", { projectRelative: true });
    expect(listTabs()).toHaveLength(2);
  });

  it("returns a copy — mutating it does not change the model", () => {
    const t = openTab("/a.md", "a");
    t.content = "hacked";
    expect(getTab(t.id)?.content).toBe("a");
  });
});

describe("newUntitledTab", () => {
  it("creates an active, clean, pathless tab", () => {
    const t = newUntitledTab();
    expect(t).toEqual({
      id: "tab-1",
      kind: "document",
      path: null,
      title: "Untitled",
      content: "",
      dirty: false,
      projectRelative: false,
      view: { chat: false, info: false, mode: "split" },
    });
    expect(activeTab()?.id).toBe(t.id);
  });

  it("numbers further untitled tabs and reuses freed names", () => {
    newUntitledTab();
    const second = newUntitledTab();
    expect(second.title).toBe("Untitled 2");
    expect(newUntitledTab().title).toBe("Untitled 3");
    closeTab(second.id);
    expect(newUntitledTab().title).toBe("Untitled 2");
  });

  it("accepts initial content", () => {
    expect(newUntitledTab("# Draft").content).toBe("# Draft");
  });
});

describe("setActive", () => {
  it("switches the active tab and returns it", () => {
    const a = openTab("/a.md", "a");
    openTab("/b.md", "b");
    expect(setActive(a.id)?.id).toBe(a.id);
    expect(activeTab()?.id).toBe(a.id);
  });

  it("returns null and changes nothing for an unknown id", () => {
    const a = openTab("/a.md", "a");
    expect(setActive("tab-99")).toBeNull();
    expect(activeTab()?.id).toBe(a.id);
  });
});

describe("updateContent / markSaved", () => {
  it("marks a tab dirty when the content differs from the saved text and clean when it matches again", () => {
    const t = openTab("/a.md", "a");
    updateContent(t.id, "ab");
    expect(getTab(t.id)).toMatchObject({ content: "ab", dirty: true });
    updateContent(t.id, "a");
    expect(getTab(t.id)).toMatchObject({ content: "a", dirty: false });
  });

  it("markSaved clears dirty and keeps the current content as the new baseline", () => {
    const t = openTab("/a.md", "a");
    updateContent(t.id, "ab");
    markSaved(t.id);
    expect(getTab(t.id)).toMatchObject({ content: "ab", dirty: false, path: "/a.md", title: "a.md" });
    updateContent(t.id, "a");
    expect(getTab(t.id)?.dirty).toBe(true);
  });

  it("markSaved with a path names an untitled tab", () => {
    const t = newUntitledTab();
    updateContent(t.id, "# Hi");
    markSaved(t.id, "/tmp/hi.md");
    expect(getTab(t.id)).toMatchObject({ path: "/tmp/hi.md", title: "hi.md", dirty: false, projectRelative: false });
  });

  it("markSaved with a project-relative path records that", () => {
    const t = newUntitledTab();
    markSaved(t.id, "notes/hi.md", { projectRelative: true });
    expect(getTab(t.id)).toMatchObject({ path: "notes/hi.md", projectRelative: true });
  });

  it("ignore unknown ids", () => {
    openTab("/a.md", "a");
    expect(() => updateContent("tab-99", "x")).not.toThrow();
    expect(() => markSaved("tab-99")).not.toThrow();
    expect(getTab("tab-1")?.content).toBe("a");
  });
});

describe("closeTab", () => {
  it("closing the active tab activates its right-hand neighbour", () => {
    const a = openTab("/a.md", "a");
    const b = openTab("/b.md", "b");
    const c = openTab("/c.md", "c");
    setActive(b.id);
    expect(closeTab(b.id)?.id).toBe(c.id);
    expect(listTabs().map((t) => t.id)).toEqual([a.id, c.id]);
  });

  it("closing the last (right-most) active tab activates the left-hand neighbour", () => {
    const a = openTab("/a.md", "a");
    const b = openTab("/b.md", "b");
    expect(closeTab(b.id)?.id).toBe(a.id);
  });

  it("closing a background tab leaves the active tab alone", () => {
    const a = openTab("/a.md", "a");
    const b = openTab("/b.md", "b");
    expect(closeTab(a.id)?.id).toBe(b.id);
    expect(activeTab()?.id).toBe(b.id);
  });

  it("closing the only tab replaces it with a fresh untitled tab", () => {
    const a = openTab("/a.md", "a");
    const next = closeTab(a.id);
    expect(next).toMatchObject({ path: null, title: "Untitled", content: "" });
    expect(listTabs()).toHaveLength(1);
    expect(activeTab()?.id).toBe(next!.id);
  });

  it("returns null for an unknown id", () => {
    openTab("/a.md", "a");
    expect(closeTab("tab-99")).toBeNull();
    expect(listTabs()).toHaveLength(1);
  });
});

describe("nextTab / prevTab", () => {
  it("cycle through tabs in both directions, wrapping at the ends", () => {
    const a = openTab("/a.md", "a");
    const b = openTab("/b.md", "b");
    const c = openTab("/c.md", "c");
    expect(nextTab()?.id).toBe(a.id); // from c wraps to a
    expect(nextTab()?.id).toBe(b.id);
    expect(prevTab()?.id).toBe(a.id);
    expect(prevTab()?.id).toBe(c.id); // from a wraps to c
  });

  it("stay put with a single tab", () => {
    const a = newUntitledTab();
    expect(nextTab()?.id).toBe(a.id);
    expect(prevTab()?.id).toBe(a.id);
  });
});

describe("subscribe", () => {
  it("delivers a snapshot on every change and stops after unsubscribe", () => {
    const fn = vi.fn();
    const off = subscribe(fn);

    const a = openTab("/a.md", "a");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.lastCall![0]).toEqual({ tabs: [a], active: a });

    updateContent(a.id, "aa"); // content changed → notify
    updateContent(a.id, "aa"); // no-op → no notify
    expect(fn).toHaveBeenCalledTimes(2);

    setActive(a.id); // already active → no notify
    expect(fn).toHaveBeenCalledTimes(2);

    const b = newUntitledTab();
    setActive(a.id);
    markSaved(a.id);
    closeTab(b.id);
    expect(fn).toHaveBeenCalledTimes(6);

    off();
    newUntitledTab();
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it("publishes on the bitwrench topic so other modules can bw.sub directly", async () => {
    const bw = (await import("bitwrench")).default;
    const fn = vi.fn();
    const off = bw.sub(TABS_CHANGED, fn);
    newUntitledTab();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].active.title).toBe("Untitled");
    off();
  });

  it("closing the last tab notifies exactly once (for the replacement untitled tab)", () => {
    const a = openTab("/a.md", "a");
    const fn = vi.fn();
    const off = subscribe(fn);
    closeTab(a.id);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });
});

describe("views and the project tab", () => {
  beforeEach(() => resetTabs());

  it("new tabs inherit the active tab's layout; setView patches and notifies only on change", () => {
    const a = openTab("/a.md", "");
    expect(a.view).toEqual({ chat: false, info: false, mode: "split" });
    expect(setView(a.id, { chat: true, mode: "preview" })!.view).toEqual({ chat: true, info: false, mode: "preview" });
    const b = newUntitledTab();
    expect(b.view).toEqual({ chat: true, info: false, mode: "preview" });
    const c = openTab("/c.md", "");
    expect(c.view).toEqual({ chat: true, info: false, mode: "preview" });
    expect(setView("tab-99", { chat: true })).toBeNull();

    const seen: TabsSnapshot[] = [];
    const off = subscribe((s) => seen.push(s));
    setView(c.id, { chat: true }); // no change
    expect(seen.length).toBe(0);
    setView(c.id, { info: true });
    expect(seen.length).toBe(1);
    off();
    // The published tab is a copy: mutating it does not reach the model.
    const pub = getTab(c.id)!;
    pub.view.chat = false;
    expect(getTab(c.id)!.view.chat).toBe(true);
  });

  it("openLogTab creates one log tab with no chat, focuses it on repeat calls, and closes like any tab", () => {
    openTab("/a.md", "");
    setView(activeTab()!.id, { chat: true });
    const l = openLogTab();
    expect(l).toMatchObject({ id: LOG_TAB_ID, kind: "log", path: null, title: "Log", projectRelative: false, dirty: false });
    expect(l.view.chat).toBe(false);
    expect(activeTab()!.id).toBe(LOG_TAB_ID);
    expect(openLogTab().id).toBe(LOG_TAB_ID);
    expect(listTabs().filter((t) => t.kind === "log")).toHaveLength(1);
    expect(setView(LOG_TAB_ID, { chat: true, info: true })!.view).toEqual({ chat: false, info: true, mode: "split" });
    closeTab(LOG_TAB_ID);
    expect(getTab(LOG_TAB_ID)).toBeNull();
  });

  it("openProjectTab creates one project tab, focuses it on repeat calls and keeps its chat open", () => {
    openTab("/a.md", "");
    const p = openProjectTab();
    expect(p).toMatchObject({ id: PROJECT_TAB_ID, kind: "project", path: null, title: "Project", projectRelative: false, dirty: false });
    expect(p.view.chat).toBe(true);
    expect(activeTab()!.id).toBe(PROJECT_TAB_ID);
    openTab("/b.md", "");
    expect(openProjectTab().id).toBe(PROJECT_TAB_ID);
    expect(listTabs().filter((t) => t.kind === "project")).toHaveLength(1);
    expect(setView(PROJECT_TAB_ID, { chat: false, info: true })!.view).toEqual({ chat: true, info: true, mode: "split" });
    closeTab(PROJECT_TAB_ID);
    expect(getTab(PROJECT_TAB_ID)).toBeNull();
    expect(listTabs().every((t) => t.kind === "document")).toBe(true);
  });
});
