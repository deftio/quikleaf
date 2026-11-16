import { describe, it, expect, vi, beforeEach } from "vitest";
import { open as shellOpen } from "@tauri-apps/plugin-shell";

vi.mock("./documents", () => ({
  activeDocumentPath: vi.fn(() => null as string | null),
  openPath: vi.fn(async () => null),
}));

vi.mock("./editor", () => ({
  setLinkHandler: vi.fn(),
}));

import { activeDocumentPath, openPath } from "./documents";
import { setLinkHandler } from "./editor";
import { handleLinkClick, initPreviewLinks, linkTarget } from "./links";

const mockDoc = vi.mocked(activeDocumentPath);
const mockOpen = vi.mocked(openPath);
const mockShell = vi.mocked(shellOpen);

beforeEach(() => {
  mockDoc.mockReset().mockReturnValue(null);
  mockOpen.mockClear();
  mockShell.mockClear();
});

describe("linkTarget", () => {
  it("resolves a relative href against the document's folder, dropping a query or fragment", () => {
    expect(linkTarget("notes/b.md", "/docs/a.md")).toBe("/docs/notes/b.md");
    expect(linkTarget("../b.md#top", "/docs/sub/a.md")).toBe("/docs/b.md");
    expect(linkTarget("./b%20c.md", "/docs/a.md")).toBe("/docs/b c.md");
  });

  it("keeps an absolute path, and gives null for URLs, anchors or an unsaved document", () => {
    expect(linkTarget("/x/y.md", null)).toBe("/x/y.md");
    expect(linkTarget("https://example.com/a.md", "/docs/a.md")).toBeNull();
    expect(linkTarget("#top", "/docs/a.md")).toBeNull();
    expect(linkTarget("b.md", null)).toBeNull();
  });
});

describe("handleLinkClick", () => {
  it("sends web and mail links to the system browser and cancels the navigation", () => {
    expect(handleLinkClick("https://example.com/page")).toBe(false);
    expect(handleLinkClick("mailto:someone@example.com")).toBe(false);
    expect(mockShell.mock.calls.map((c) => c[0])).toEqual(["https://example.com/page", "mailto:someone@example.com"]);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("opens a linked text document in a tab, relative to the active document", () => {
    mockDoc.mockReturnValue("/docs/a.md");
    expect(handleLinkClick("notes/b.md")).toBe(false);
    expect(mockOpen).toHaveBeenCalledWith("/docs/notes/b.md");
    expect(handleLinkClick("/elsewhere/c.txt")).toBe(false);
    expect(mockOpen).toHaveBeenLastCalledWith("/elsewhere/c.txt");
    expect(mockShell).not.toHaveBeenCalled();
  });

  it("cancels links to files it cannot open (images, binaries, unknown schemes) and relative ones without a document", () => {
    mockDoc.mockReturnValue("/docs/a.md");
    expect(handleLinkClick("images/a.png")).toBe(false);
    expect(handleLinkClick("ftp://host/x.md")).toBe(false);
    expect(handleLinkClick("")).toBe(false);
    mockDoc.mockReturnValue(null);
    expect(handleLinkClick("b.md")).toBe(false);
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockShell).not.toHaveBeenCalled();
  });

  it("lets in-page anchors through", () => {
    expect(handleLinkClick("#heading")).toBe(true);
  });

  it("initPreviewLinks hands the handler to the editor", () => {
    initPreviewLinks();
    expect(setLinkHandler).toHaveBeenCalledWith(handleLinkClick);
  });
});
