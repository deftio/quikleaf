/**
 * Export the rendered document: a standalone HTML file (quikdown's styles
 * inlined) or the system print dialog for PDF.
 *
 * `buildStandaloneHtml` is pure; `exportHtml` / `printDocument` do the I/O.
 */
import quikdown from "quikdown";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { getHTML } from "./editor";
import { activeTab } from "./tabs";

/** A small print-friendly sheet layered over quikdown's own styles. */
export const EXPORT_CSS = `
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  padding: 32px 24px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: #1f2937;
  background: #fff;
}
main { max-width: 800px; margin: 0 auto; }
img, svg, video { max-width: 100%; height: auto; }
pre { white-space: pre-wrap; word-wrap: break-word; }
table { border-collapse: collapse; }
@media print {
  body { padding: 0; }
  main { max-width: none; }
  a { color: inherit; text-decoration: none; }
  pre, blockquote, table, img, svg { break-inside: avoid; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; }
}
`.trim();

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Wrap rendered body HTML in a complete, self-contained document. */
export function buildStandaloneHtml(title: string, bodyHtml: string, css: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    '<meta name="generator" content="quikleaf">',
    `<style>\n${css}\n</style>`,
    "</head>",
    "<body>",
    "<main>",
    bodyHtml,
    "</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function suggestedName(): string {
  const tab = activeTab();
  const base = (tab?.title ?? "document").replace(/\.(md|markdown|txt)$/i, "");
  return `${base}.html`;
}

/**
 * File → Export HTML…: ask for a path and write the rendered document with
 * quikdown's light-theme styles inlined. Returns true when a file was written.
 */
export async function exportHtml(): Promise<boolean> {
  try {
    const path = await save({
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
      defaultPath: suggestedName(),
    });
    if (!path) return false;
    const title = activeTab()?.title ?? "Untitled";
    const css = `${quikdown.emitStyles("", "light")}\n${EXPORT_CSS}`;
    await writeTextFile(path, buildStandaloneHtml(title, getHTML(), css));
    return true;
  } catch (e) {
    console.error("Failed to export HTML:", e);
    return false;
  }
}

/**
 * File → Print / PDF…: the print stylesheet in `ui/theme.ts` shows only the
 * rendered preview pane (`#editor-container .qde-preview`).
 */
export function printDocument(): void {
  try {
    window.print();
  } catch (e) {
    console.error("Print failed:", e);
  }
}
