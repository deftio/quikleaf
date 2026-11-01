/**
 * Document statistics for the status bar. Pure: no DOM.
 *
 * Words are unicode-aware runs of letters/digits (an apostrophe inside a word
 * joins it: "don't" is one word). Fenced code blocks are left out of the word
 * count but their lines still count as lines.
 */

export interface DocStats {
  words: number;
  chars: number;
  lines: number;
  /** Ceil(words / 200), at least 1 when there is any text; 0 for an empty document. */
  readingMinutes: number;
}

const WORDS_PER_MINUTE = 200;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** The lines of `md` that are not inside a fenced code block (fence lines excluded too). */
export function proseLines(md: string): string[] {
  const out: string[] = [];
  let fence: { char: string; len: number } | null = null;
  for (const line of md.split("\n")) {
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
    if (!fence) out.push(line);
  }
  return out;
}

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

export function computeStats(md: string): DocStats {
  const chars = md.length;
  const lines = md === "" ? 0 : md.split("\n").length;
  const words = countWords(proseLines(md).join("\n"));
  const readingMinutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
  return { words, chars, lines, readingMinutes };
}

/** "1,234 words · 6 min" — the status bar text. */
export function formatStats(s: DocStats): string {
  const words = `${s.words.toLocaleString("en-US")} ${s.words === 1 ? "word" : "words"}`;
  return `${words} · ${s.readingMinutes} min`;
}
