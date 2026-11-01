/**
 * Line diff for proposed-edit review cards.
 *
 * `diffLines(before, after)` returns a flat list of hunks: unchanged lines
 * (`same`), lines only in `after` (`add`) and lines only in `before` (`del`),
 * in document order. It is an O(n·m) LCS over lines, which is fine for the
 * documents quikleaf edits; above `MAX_LCS_LINES` on either side the result
 * degrades to "delete everything, add everything" so the UI never stalls.
 *
 * Pure functions, no DOM.
 */

export type HunkType = "same" | "add" | "del";

export interface Hunk {
  type: HunkType;
  text: string;
}

export interface DiffSummary {
  added: number;
  removed: number;
}

/** Above this many lines (either side) the LCS is skipped. */
export const MAX_LCS_LINES = 5000;

/** Split on `\n`, keeping an empty document as zero lines rather than [""]. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  // A trailing newline produces a phantom empty last line; drop it so
  // "a\n" and "a" diff as equal content apart from the terminator.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Replace-all fallback: every `before` line deleted, every `after` line added. */
function replaceAll(a: string[], b: string[]): Hunk[] {
  const out: Hunk[] = [];
  for (const text of a) out.push({ type: "del", text });
  for (const text of b) out.push({ type: "add", text });
  return out;
}

/**
 * Diff two texts line by line.
 *
 * Common prefix and suffix are peeled off first so a one-line edit in a long
 * document only runs the LCS over the changed middle.
 */
export function diffLines(before: string, after: string): Hunk[] {
  const a = splitLines(before);
  const b = splitLines(after);

  // Common prefix.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  // Common suffix (not overlapping the prefix).
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const head: Hunk[] = a.slice(0, start).map((text) => ({ type: "same" as const, text }));
  const tail: Hunk[] = a.slice(endA).map((text) => ({ type: "same" as const, text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  let middle: Hunk[];
  if (midA.length === 0 && midB.length === 0) {
    middle = [];
  } else if (midA.length === 0) {
    middle = midB.map((text) => ({ type: "add" as const, text }));
  } else if (midB.length === 0) {
    middle = midA.map((text) => ({ type: "del" as const, text }));
  } else if (midA.length > MAX_LCS_LINES || midB.length > MAX_LCS_LINES) {
    middle = replaceAll(midA, midB);
  } else {
    middle = lcsDiff(midA, midB);
  }

  return [...head, ...middle, ...tail];
}

/** Classic LCS table walk; emits `del` before `add` within a changed run. */
function lcsDiff(a: string[], b: string[]): Hunk[] {
  const n = a.length;
  const m = b.length;
  // table[i][j] = LCS length of a[i..] and b[j..]
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const idx = i * width + j;
      if (a[i] === b[j]) {
        table[idx] = table[idx + width + 1] + 1;
      } else {
        const down = table[idx + width];
        const right = table[idx + 1];
        table[idx] = down >= right ? down : right;
      }
    }
  }

  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}

/** Count added and removed lines. */
export function summarizeDiff(hunks: Hunk[]): DiffSummary {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    if (h.type === "add") added++;
    else if (h.type === "del") removed++;
  }
  return { added, removed };
}

/** A row of the collapsed view: either a hunk or a "n unchanged lines" marker. */
export type DiffRow = Hunk | { type: "skip"; count: number };

/**
 * Collapse long runs of unchanged lines, keeping `context` lines on each side
 * of every change. Runs shorter than `2 * context + 1` are kept whole, so a
 * marker always stands for at least one hidden line.
 */
export function collapseContext(hunks: Hunk[], context = 3): DiffRow[] {
  const out: DiffRow[] = [];
  let i = 0;
  while (i < hunks.length) {
    if (hunks[i].type !== "same") {
      out.push(hunks[i]);
      i++;
      continue;
    }
    // Measure the run of unchanged lines.
    let end = i;
    while (end < hunks.length && hunks[end].type === "same") end++;
    const run = end - i;
    const leading = i === 0 ? 0 : context; // context after a change
    const trailing = end === hunks.length ? 0 : context; // context before a change
    if (run <= leading + trailing) {
      for (let k = i; k < end; k++) out.push(hunks[k]);
    } else {
      for (let k = i; k < i + leading; k++) out.push(hunks[k]);
      out.push({ type: "skip", count: run - leading - trailing });
      for (let k = end - trailing; k < end; k++) out.push(hunks[k]);
    }
    i = end;
  }
  return out;
}
