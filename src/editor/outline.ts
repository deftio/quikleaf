/**
 * Heading outline of a markdown document. Pure: no DOM.
 *
 * ATX headings only (`#` … `######`, up to three leading spaces, a space after
 * the hashes). Lines inside fenced code blocks are skipped. Trailing closing
 * hashes and the inline markers `*`, `_` and `` ` `` are stripped from the
 * text, and `[text](url)` links collapse to their text.
 */

export interface Heading {
  /** 1–6 */
  level: number;
  text: string;
  /** 0-based line index in the source. */
  line: number;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const TRAILING_HASHES = /(?:^|\s+)#+\s*$/;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const MARKERS = /[*_`]/g;

/** Heading text with closing hashes, link targets and emphasis markers removed. */
export function cleanHeadingText(raw: string): string {
  return raw.replace(TRAILING_HASHES, "").replace(LINK, "$1").replace(MARKERS, "").trim();
}

export function parseOutline(md: string): Heading[] {
  const out: Heading[] = [];
  let fence: { char: string; len: number } | null = null;
  const lines = md.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    const f = FENCE.exec(line);
    if (f) {
      const run = f[1];
      if (!fence) {
        fence = { char: run[0], len: run.length };
        continue;
      }
      if (run[0] === fence.char && run.length >= fence.len && line.trim() === run) {
        fence = null;
        continue;
      }
    }
    if (fence) continue;

    const h = HEADING.exec(line);
    if (!h) continue;
    out.push({ level: h[1].length, text: cleanHeadingText(h[2] ?? ""), line: i });
  }
  return out;
}

/** Character offset of the start of `line` (0-based) in `md`; clamps to the text. */
export function lineStartOffset(md: string, line: number): number {
  if (line <= 0) return 0;
  let offset = 0;
  let n = 0;
  while (n < line) {
    const nl = md.indexOf("\n", offset);
    if (nl === -1) return md.length;
    offset = nl + 1;
    n++;
  }
  return offset;
}

/** 0-based line index containing character `offset`. */
export function lineOfOffset(md: string, offset: number): number {
  const end = Math.max(0, Math.min(offset, md.length));
  let line = 0;
  for (let i = 0; i < end; i++) if (md.charCodeAt(i) === 10) line++;
  return line;
}
