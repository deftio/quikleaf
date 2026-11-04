/**
 * Performance instrumentation for the chat loop.
 *
 * Pure helpers (timing math, formatting) live here so they are unit-testable;
 * the only side effect is `logEvent()`, which appends a JSON line to the
 * performance log through the Rust `log_append` command when the user has
 * "Write performance log" enabled in Settings.
 *
 * Log location (resolved by the backend, shown in About → Diagnostics):
 *   macOS   ~/Library/Logs/com.deftio.quikleaf/quikleaf-perf.jsonl
 *   Linux   ~/.local/share/com.deftio.quikleaf/logs/quikleaf-perf.jsonl
 *   Windows %LOCALAPPDATA%\com.deftio.quikleaf\logs\quikleaf-perf.jsonl
 */
import { invoke } from "@tauri-apps/api/core";
import { loadSettings } from "../settings/settings";

export interface LlmTiming {
  /** Time to first streamed token, or null when nothing streamed. */
  ttftMs: number | null;
  /** Wall time from request to completion. */
  totalMs: number;
  /** Characters of assistant text received. */
  chars: number;
  /** Rough token estimate (chars / 4); providers rarely report usage over SSE. */
  estTokens: number;
  /** Generation rate after the first token, when measurable. */
  tokPerSec: number | null;
}

export interface PerfEntry {
  kind: "llm" | "tool" | "turn" | "app";
  ts?: string;
  [key: string]: unknown;
}

/** A monotonic stopwatch; `performance.now()` when available, Date otherwise. */
export class Stopwatch {
  private readonly t0: number;
  constructor() {
    this.t0 = nowMs();
  }
  elapsed(): number {
    return nowMs() - this.t0;
  }
}

export function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
}

/** Build an LlmTiming from raw marks. `firstTokenAt` is elapsed ms, or null. */
export function computeTiming(totalMs: number, firstTokenAt: number | null, text: string): LlmTiming {
  const chars = text.length;
  const estTokens = estimateTokens(text);
  let tokPerSec: number | null = null;
  if (firstTokenAt !== null && totalMs > firstTokenAt && estTokens > 1) {
    const genSeconds = (totalMs - firstTokenAt) / 1000;
    if (genSeconds >= 0.05) tokPerSec = Math.round(estTokens / genSeconds);
  }
  return { ttftMs: firstTokenAt, totalMs: Math.round(totalMs), chars, estTokens, tokPerSec };
}

export function formatMs(ms: number): string {
  if (!isFinite(ms) || ms < 0) return "–";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/** Short summary shown under an assistant bubble when timestamps are on. */
export function summarizeTiming(t: LlmTiming): string {
  const parts = [formatMs(t.totalMs)];
  if (t.ttftMs !== null) parts.push(`first token ${formatMs(t.ttftMs)}`);
  if (t.estTokens > 0) parts.push(`≈${t.estTokens} tok`);
  if (t.tokPerSec !== null) parts.push(`${t.tokPerSec} tok/s`);
  return parts.join(" · ");
}

export function formatClock(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function isPerfLogEnabled(): boolean {
  return loadSettings().perfLog !== false;
}

/** A log entry as recorded: the caller's fields plus the timestamp. */
export type LoggedEntry = PerfEntry & { ts: string };

/** Topic published (bitwrench pub/sub) to ask the app to open the log tab. */
export const LOG_OPEN = "log:open";

const listeners = new Set<(e: LoggedEntry) => void>();

/**
 * Watch the log in-process: every entry passes through here before it is
 * written, whether or not writing is on. The log tab follows live this way.
 * Returns the unsubscribe function.
 */
export function onLogEvent(fn: (e: LoggedEntry) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Append an entry to the performance log. Never throws; logging must not break chat. */
export async function logEvent(entry: PerfEntry): Promise<void> {
  const logged: LoggedEntry = { ts: new Date().toISOString(), ...entry };
  for (const fn of listeners) {
    try {
      fn(logged);
    } catch (e) {
      console.warn("log listener failed:", e);
    }
  }
  if (!isPerfLogEnabled()) return;
  try {
    await invoke("log_append", { entry: logged });
  } catch (e) {
    console.warn("perf log write failed:", e);
  }
}

export async function getLogPath(): Promise<string> {
  try {
    return (await invoke<string>("log_get_path")) || "";
  } catch {
    return "";
  }
}

export async function tailLog(n = 10): Promise<PerfEntry[]> {
  try {
    const rows = await invoke<PerfEntry[]>("log_tail", { n });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** One-line rendering of a log row, for `/log` and the Diagnostics tab. */
export function describeEntry(e: PerfEntry): string {
  const when = e.ts ? String(e.ts).replace("T", " ").slice(11, 19) : "--:--:--";
  switch (e.kind) {
    case "llm": {
      const t = e as unknown as { model?: string; total_ms?: number; ttft_ms?: number | null; est_tokens?: number; tok_per_s?: number | null; error?: string };
      const bits = [t.model ?? "?", formatMs(Number(t.total_ms ?? 0))];
      if (t.ttft_ms != null) bits.push(`ttft ${formatMs(Number(t.ttft_ms))}`);
      if (t.tok_per_s != null) bits.push(`${t.tok_per_s} tok/s`);
      if (t.error) bits.push(`error: ${t.error}`);
      return `${when} llm ${bits.join(" · ")}`;
    }
    case "tool": {
      const t = e as unknown as { name?: string; ms?: number; ok?: boolean };
      return `${when} tool ${t.name ?? "?"} ${formatMs(Number(t.ms ?? 0))}${t.ok === false ? " (error)" : ""}`;
    }
    case "turn": {
      const t = e as unknown as { total_ms?: number; llm_calls?: number; tool_calls?: number };
      return `${when} turn ${formatMs(Number(t.total_ms ?? 0))} · ${t.llm_calls ?? 0} llm · ${t.tool_calls ?? 0} tools`;
    }
    default:
      return `${when} ${e.kind} ${JSON.stringify({ ...e, ts: undefined, kind: undefined })}`;
  }
}
