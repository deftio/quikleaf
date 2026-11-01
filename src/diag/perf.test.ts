import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  computeTiming,
  describeEntry,
  estimateTokens,
  formatClock,
  formatMs,
  logEvent,
  summarizeTiming,
  tailLog,
} from "./perf";
import { saveSettings, loadSettings } from "../settings/settings";

describe("estimateTokens", () => {
  it("returns 0 for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });
  it("estimates ~4 chars per token with a floor of 1", () => {
    expect(estimateTokens("ab")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("computeTiming", () => {
  it("computes tokens per second after the first token", () => {
    const text = "x".repeat(800); // ≈200 tokens
    const t = computeTiming(2200, 200, text); // 2s of generation
    expect(t.ttftMs).toBe(200);
    expect(t.totalMs).toBe(2200);
    expect(t.estTokens).toBe(200);
    expect(t.tokPerSec).toBe(100);
  });
  it("leaves rate null when nothing streamed or window is too short", () => {
    expect(computeTiming(500, null, "hello").tokPerSec).toBeNull();
    expect(computeTiming(210, 200, "x".repeat(40)).tokPerSec).toBeNull();
  });
});

describe("formatMs", () => {
  it("formats sub-second, seconds and minutes", () => {
    expect(formatMs(42)).toBe("42ms");
    expect(formatMs(1234)).toBe("1.23s");
    expect(formatMs(12_345)).toBe("12.3s");
    expect(formatMs(61_000)).toBe("1m 1s");
  });
  it("handles junk", () => {
    expect(formatMs(-1)).toBe("–");
    expect(formatMs(NaN)).toBe("–");
  });
});

describe("summarizeTiming", () => {
  it("joins the available parts", () => {
    const s = summarizeTiming({ ttftMs: 180, totalMs: 1800, chars: 400, estTokens: 100, tokPerSec: 62 });
    expect(s).toBe("1.80s · first token 180ms · ≈100 tok · 62 tok/s");
  });
  it("omits missing parts", () => {
    const s = summarizeTiming({ ttftMs: null, totalMs: 900, chars: 0, estTokens: 0, tokPerSec: null });
    expect(s).toBe("900ms");
  });
});

describe("formatClock", () => {
  it("zero-pads HH:MM:SS", () => {
    expect(formatClock(new Date(2026, 0, 1, 9, 5, 3))).toBe("09:05:03");
  });
});

describe("describeEntry", () => {
  it("describes llm, tool and turn rows", () => {
    expect(describeEntry({ kind: "llm", ts: "2026-01-01T10:20:30Z", model: "m", total_ms: 1500, ttft_ms: 100, tok_per_s: 40 })).toBe(
      "10:20:30 llm m · 1.50s · ttft 100ms · 40 tok/s",
    );
    expect(describeEntry({ kind: "tool", ts: "2026-01-01T10:20:31Z", name: "document_read", ms: 3, ok: true })).toBe(
      "10:20:31 tool document_read 3ms",
    );
    expect(describeEntry({ kind: "turn", ts: "2026-01-01T10:20:32Z", total_ms: 4000, llm_calls: 2, tool_calls: 1 })).toBe(
      "10:20:32 turn 4.00s · 2 llm · 1 tools",
    );
  });
});

describe("logEvent / tailLog", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("writes through log_append with a timestamp when logging is on", async () => {
    await logEvent({ kind: "tool", name: "x", ms: 1 });
    expect(invoke).toHaveBeenCalledTimes(1);
    const [cmd, args] = vi.mocked(invoke).mock.calls[0] as [string, any];
    expect(cmd).toBe("log_append");
    expect(args.entry.kind).toBe("tool");
    expect(typeof args.entry.ts).toBe("string");
  });

  it("is a no-op when the user turned the log off", async () => {
    saveSettings({ ...loadSettings(), perfLog: false });
    await logEvent({ kind: "tool", name: "x", ms: 1 });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("swallows backend errors", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("disk full"));
    await expect(logEvent({ kind: "app", event: "start" })).resolves.toBeUndefined();
  });

  it("tailLog returns an array even on failure", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("nope"));
    expect(await tailLog(5)).toEqual([]);
    vi.mocked(invoke).mockResolvedValue([{ kind: "llm" }]);
    expect(await tailLog(5)).toEqual([{ kind: "llm" }]);
  });
});
