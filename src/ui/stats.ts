/**
 * Status bar document statistics: word count and reading time for the text
 * in the editor, refreshed (debounced) on every editor change.
 */
import { getMarkdown, onEditorChange } from "../editor/editor";
import { computeStats, formatStats } from "../editor/stats";
import { setStatusStats } from "./shell";
import { debounce } from "./debounce";

export const STATS_DEBOUNCE_MS = 150;

let unsubscribe: (() => void) | null = null;

/** Recompute from `md` (or the editor's current text) and patch `#status-stats` now. */
export function refreshStats(md: string = getMarkdown()): void {
  setStatusStats(formatStats(computeStats(md)));
}

/** Start keeping `#status-stats` current. Idempotent; returns the unsubscribe function. */
export function initStats(): () => void {
  unsubscribe?.();
  const scheduled = debounce((md: string) => refreshStats(md), STATS_DEBOUNCE_MS);
  const off = onEditorChange((md) => scheduled(md));
  unsubscribe = () => {
    scheduled.cancel();
    off();
  };
  refreshStats();
  return () => {
    unsubscribe?.();
    unsubscribe = null;
  };
}
