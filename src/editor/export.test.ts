import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import quikdown from "quikdown";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { getEditor, initEditor } from "./editor";
import * as tabs from "./tabs";
import { EXPORT_CSS, buildStandaloneHtml, exportHtml, printDocument } from "./export";

const mockSave = vi.mocked(save);
const mockWrite = vi.mocked(writeTextFile);
const mockStyles = vi.mocked((quikdown as any).emitStyles as (...a: unknown[]) => string);

describe("buildStandaloneHtml", () => {
  it("wraps the body in a complete document with the title and styles", () => {
    const html = buildStandaloneHtml("Notes", "<h1>Hi</h1>", ".x{color:red}");
    expect(html.startsWith("<!DOCTYPE html>\n")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Notes</title>");
    expect(html).toContain("<style>\n.x{color:red}\n</style>");
    expect(html).toContain("<main>\n<h1>Hi</h1>\n</main>");
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("escapes the title", () => {
    const html = buildStandaloneHtml('<b>"a" & b</b>', "", "");
    expect(html).toContain("<title>&lt;b&gt;&quot;a&quot; &amp; b&lt;/b&gt;</title>");
  });

  it("ships a print-friendly stylesheet", () => {
    expect(EXPORT_CSS).toContain("@media print");
    expect(EXPORT_CSS).toContain("break-inside: avoid");
  });
});

describe("exportHtml", () => {
  beforeEach(() => {
    tabs.resetTabs();
    mockSave.mockReset();
    mockWrite.mockReset();
    mockWrite.mockResolvedValue(undefined);
    mockStyles.mockReset();
    mockStyles.mockReturnValue(".qd{a:b}");
    const container = bw.append(document.getElementById("app")!, { t: "div", a: { id: "editor-container" } });
    initEditor(container);
    getEditor().getHTML.mockReturnValue("<h1>Rendered</h1>");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    bw.clear(document.getElementById("app")!);
    vi.restoreAllMocks();
  });

  it("asks for a path suggested from the active tab and writes the rendered document", async () => {
    tabs.openTab("/docs/notes.md", "# Rendered");
    mockSave.mockResolvedValue("/out/notes.html");
    expect(await exportHtml()).toBe(true);
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "notes.html", filters: [{ name: "HTML", extensions: ["html", "htm"] }] }),
    );
    expect(mockStyles).toHaveBeenCalledWith("", "light");
    const [path, html] = mockWrite.mock.calls[0];
    expect(path).toBe("/out/notes.html");
    expect(html).toContain("<title>notes.md</title>");
    expect(html).toContain(".qd{a:b}");
    expect(html).toContain("<h1>Rendered</h1>");
  });

  it("suggests document.html with no tab and Untitled as the title", async () => {
    mockSave.mockResolvedValue("/out/x.html");
    await exportHtml();
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "document.html" }));
    expect(mockWrite.mock.calls[0][1]).toContain("<title>Untitled</title>");
  });

  it("returns false and writes nothing when the dialog is cancelled", async () => {
    mockSave.mockResolvedValue(null);
    expect(await exportHtml()).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns false and logs when writing fails", async () => {
    mockSave.mockResolvedValue("/out/x.html");
    mockWrite.mockRejectedValue(new Error("disk full"));
    expect(await exportHtml()).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("printDocument", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls window.print", () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    printDocument();
    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("swallows a throwing window.print", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("print", () => {
      throw new Error("no printer");
    });
    expect(() => printDocument()).not.toThrow();
    expect(console.error).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
