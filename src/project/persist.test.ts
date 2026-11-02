import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  SAVE_DEBOUNCE_MS,
  disableProjectPersistence,
  flushProjectSaveOnUnload,
  hasPendingSave,
  initProjectPersistence,
  isProjectPersistenceEnabled,
  saveProjectNow,
  scheduleProjectSave,
} from "./persist";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

describe("project persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
    disableProjectPersistence();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing until initialised", async () => {
    expect(isProjectPersistenceEnabled()).toBe(false);
    scheduleProjectSave();
    expect(hasPendingSave()).toBe(false);
    expect(await saveProjectNow()).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("saves the open file plus empty history and preferences", async () => {
    initProjectPersistence({ openFile: () => "docs/readme.md", openTabs: () => ["a.md", "docs/readme.md"] });
    expect(await saveProjectNow()).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("project_save", { openFile: "docs/readme.md", openTabs: ["a.md", "docs/readme.md"], chatHistory: {}, preferences: {} });
  });

  it("defaults open tabs to an empty list", async () => {
    initProjectPersistence({ openFile: () => null });
    await saveProjectNow();
    expect(invokeMock).toHaveBeenCalledWith("project_save", expect.objectContaining({ openTabs: [] }));
  });

  it("debounces a burst of changes into one write", async () => {
    initProjectPersistence({ openFile: () => null });
    scheduleProjectSave();
    scheduleProjectSave();
    scheduleProjectSave();
    expect(hasPendingSave()).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 5);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(hasPendingSave()).toBe(false);
  });

  it("an immediate save cancels the pending debounced one", async () => {
    initProjectPersistence({ openFile: () => null });
    scheduleProjectSave();
    await saveProjectNow();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("reports failure without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    initProjectPersistence({ openFile: () => null });
    expect(await saveProjectNow()).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("disable drops a pending save", async () => {
    initProjectPersistence({ openFile: () => null });
    scheduleProjectSave();
    disableProjectPersistence();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("flushes a pending save on pagehide, and ignores pagehide when idle", async () => {
    initProjectPersistence({ openFile: () => "a.md" });
    const target = new EventTarget() as unknown as Window;
    flushProjectSaveOnUnload(target);
    target.dispatchEvent(new Event("pagehide"));
    expect(invokeMock).not.toHaveBeenCalled();
    scheduleProjectSave();
    target.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
