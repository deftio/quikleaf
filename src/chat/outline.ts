/**
 * Document outline: the ATX (`#`) headings of a markdown document, skipping
 * anything inside fenced code blocks. Pure; backs the `document_outline` tool.
 */

export interface OutlineEntry {
  /** 1–6 */
  level: number;
  text: string;
  /** 1-based line number in the source. */
  line: number;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;

export function outlineOf(markdown: string): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const lines = markdown.split("\n");
  let fence: { char: string; len: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE.exec(line);
    if (f) {
      const run = f[1];
      if (!fence) {
        fence = { char: run[0], len: run.length };
        continue;
      }
      // A closing fence uses the same character and is at least as long.
      if (run[0] === fence.char && run.length >= fence.len && line.trim() === run) {
        fence = null;
        continue;
      }
    }
    if (fence) continue;

    const h = HEADING.exec(line);
    if (!h) continue;
    // "#foo" (no space) is not a heading; "#" alone is an empty heading.
    if (h[2] === undefined && line.trim() !== h[1]) continue;
    const text = (h[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
    out.push({ level: h[1].length, text, line: i + 1 });
  }
  return out;
}
