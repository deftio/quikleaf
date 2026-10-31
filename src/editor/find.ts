/**
 * Find & replace over plain text. Pure: no DOM.
 *
 * Case-insensitive by default; `matchCase` and `regex` opt in. Matches are
 * `[start, end)` character ranges. Replacements are literal (no `$1` group
 * substitution) so the same text goes in regardless of mode.
 */

export interface FindOptions {
  matchCase?: boolean;
  regex?: boolean;
}

export interface MatchRange {
  start: number;
  end: number;
}

/** Safety cap so a one-character search over a huge document stays snappy. */
export const MAX_MATCHES = 10_000;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The RegExp a query compiles to, or null when the query is empty or (in
 * regex mode) invalid. Always global so it can walk every match.
 */
export function compileQuery(query: string, opts: FindOptions = {}): RegExp | null {
  if (!query) return null;
  const flags = `gu${opts.matchCase ? "" : "i"}`;
  try {
    return new RegExp(opts.regex ? query : escapeRegex(query), flags);
  } catch {
    return null;
  }
}

/** True when `query` is a well-formed regular expression (or regex mode is off). */
export function isValidQuery(query: string, opts: FindOptions = {}): boolean {
  return !opts.regex || query === "" || compileQuery(query, opts) !== null;
}

export function findMatches(text: string, query: string, opts: FindOptions = {}): MatchRange[] {
  const re = compileQuery(query, opts);
  if (!re) return [];
  const out: MatchRange[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      // Zero-width match (e.g. /a*/): step past it rather than loop forever.
      re.lastIndex++;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length });
    if (out.length >= MAX_MATCHES) break;
  }
  return out;
}

/**
 * Index of the match to show next: with `direction` 1, the first match that
 * starts at or after `cursor` (wrapping to 0); with -1, the last match that
 * ends at or before `cursor` (wrapping to the end). -1 when there are none.
 */
export function nearestMatch(matches: MatchRange[], cursor: number, direction: 1 | -1 = 1): number {
  if (matches.length === 0) return -1;
  if (direction === 1) {
    const i = matches.findIndex((m) => m.start >= cursor);
    return i === -1 ? 0 : i;
  }
  for (let i = matches.length - 1; i >= 0; i--) if (matches[i].end <= cursor) return i;
  return matches.length - 1;
}

export function replaceOne(text: string, range: MatchRange, replacement: string): string {
  return text.slice(0, range.start) + replacement + text.slice(range.end);
}

/** Replace every range (any order, assumed non-overlapping) with `replacement`. */
export function replaceAll(text: string, matches: MatchRange[], replacement: string): string {
  if (matches.length === 0) return text;
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;
  for (const m of sorted) {
    out += text.slice(pos, m.start) + replacement;
    pos = m.end;
  }
  return out + text.slice(pos);
}

/** "3 of 12" / "No results" / "" (empty query) / "Invalid regex". */
export function formatCount(total: number, current: number, query: string, valid = true): string {
  if (!query) return "";
  if (!valid) return "Invalid regex";
  if (total === 0) return "No results";
  return `${current + 1} of ${total}`;
}
