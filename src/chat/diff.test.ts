import { describe, expect, it } from "vitest";
import { MAX_LCS_LINES, collapseContext, diffLines, splitLines, summarizeDiff, type Hunk } from "./diff";

function render(hunks: Hunk[]): string[] {
  return hunks.map((h) => `${h.type === "same" ? " " : h.type === "add" ? "+" : "-"}${h.text}`);
}

/** Replay a diff: the `same` + `add` lines must rebuild `after`, `same` + `del` must rebuild `before`. */
function check(before: string, after: string): Hunk[] {
  const hunks = diffLines(before, after);
  const rebuiltAfter = hunks.filter((h) => h.type !== "del").map((h) => h.text);
  const rebuiltBefore = hunks.filter((h) => h.type !== "add").map((h) => h.text);
  expect(rebuiltAfter).toEqual(splitLines(after));
  expect(rebuiltBefore).toEqual(splitLines(before));
  return hunks;
}

describe("splitLines", () => {
  it("returns no lines for an empty document", () => {
    expect(splitLines("")).toEqual([]);
  });

  it("splits on newline and drops a single trailing terminator", () => {
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
  });

  it("keeps a lone newline as one empty line", () => {
    expect(splitLines("\n")).toEqual([""]);
  });
});

describe("diffLines", () => {
  it("marks identical texts as all unchanged", () => {
    expect(render(check("a\nb\nc", "a\nb\nc"))).toEqual([" a", " b", " c"]);
  });

  it("treats a trailing newline difference as no change", () => {
    expect(summarizeDiff(diffLines("a\nb", "a\nb\n"))).toEqual({ added: 0, removed: 0 });
  });

  it("adds every line when before is empty", () => {
    expect(render(check("", "x\ny"))).toEqual(["+x", "+y"]);
  });

  it("deletes every line when after is empty", () => {
    expect(render(check("x\ny", ""))).toEqual(["-x", "-y"]);
  });

  it("returns nothing for two empty documents", () => {
    expect(diffLines("", "")).toEqual([]);
  });

  it("reports a single changed line as a delete followed by an add", () => {
    expect(render(check("a\nb\nc", "a\nB\nc"))).toEqual([" a", "-b", "+B", " c"]);
  });

  it("detects an insertion in the middle", () => {
    expect(render(check("a\nc", "a\nb\nc"))).toEqual([" a", "+b", " c"]);
  });

  it("detects a deletion in the middle", () => {
    expect(render(check("a\nb\nc", "a\nc"))).toEqual([" a", "-b", " c"]);
  });

  it("handles appends and prepends", () => {
    expect(render(check("a", "a\nb"))).toEqual([" a", "+b"]);
    expect(render(check("b", "a\nb"))).toEqual(["+a", " b"]);
  });

  it("finds the common subsequence when lines move", () => {
    const hunks = check("a\nb\nc\nd", "b\nc\nd\na");
    expect(summarizeDiff(hunks)).toEqual({ added: 1, removed: 1 });
    expect(hunks.filter((h) => h.type === "same").map((h) => h.text)).toEqual(["b", "c", "d"]);
  });

  it("handles repeated lines", () => {
    const hunks = check("x\nx\nx", "x\ny\nx\nx");
    expect(summarizeDiff(hunks)).toEqual({ added: 1, removed: 0 });
  });

  it("handles a complete rewrite", () => {
    const hunks = check("one\ntwo", "three\nfour\nfive");
    expect(render(hunks)).toEqual(["-one", "-two", "+three", "+four", "+five"]);
  });

  it("peels common prefix and suffix off a long document", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const before = lines.join("\n");
    const edited = [...lines];
    edited[100] = "CHANGED";
    const hunks = check(before, edited.join("\n"));
    expect(summarizeDiff(hunks)).toEqual({ added: 1, removed: 1 });
    expect(hunks[100]).toEqual({ type: "del", text: "line 100" });
    expect(hunks[101]).toEqual({ type: "add", text: "CHANGED" });
    expect(hunks.length).toBe(201);
  });

  it("falls back to replace-all above the LCS limit but still rebuilds both sides", () => {
    const big = Array.from({ length: MAX_LCS_LINES + 10 }, (_, i) => `l${i}`);
    const before = ["same-top", ...big, "same-bottom"].join("\n");
    const altered = big.map((l) => `${l}!`);
    const after = ["same-top", ...altered, "same-bottom"].join("\n");
    const hunks = check(before, after);
    // Fallback: everything in the middle is deleted then added, no `same` inside.
    const middle = hunks.slice(1, -1);
    expect(middle.some((h) => h.type === "same")).toBe(false);
    expect(summarizeDiff(hunks)).toEqual({ added: big.length, removed: big.length });
    expect(hunks[0]).toEqual({ type: "same", text: "same-top" });
    expect(hunks[hunks.length - 1]).toEqual({ type: "same", text: "same-bottom" });
  });

  it("stays under the limit for a full-size LCS run", () => {
    const a = Array.from({ length: 600 }, (_, i) => `a${i}`);
    const b = a.filter((_, i) => i % 3 !== 0).map((l, i) => (i % 7 === 0 ? `${l}#` : l));
    const hunks = check(a.join("\n"), b.join("\n"));
    expect(summarizeDiff(hunks).removed).toBeGreaterThan(0);
  });
});

describe("summarizeDiff", () => {
  it("counts adds and dels and ignores same", () => {
    expect(
      summarizeDiff([
        { type: "same", text: "" },
        { type: "add", text: "" },
        { type: "add", text: "" },
        { type: "del", text: "" },
      ]),
    ).toEqual({ added: 2, removed: 1 });
    expect(summarizeDiff([])).toEqual({ added: 0, removed: 0 });
  });
});

describe("collapseContext", () => {
  const same = (n: number, prefix = "s"): Hunk[] => Array.from({ length: n }, (_, i) => ({ type: "same", text: `${prefix}${i}` }));
  const add: Hunk = { type: "add", text: "+" };
  const del: Hunk = { type: "del", text: "-" };

  it("passes through a diff with no unchanged runs", () => {
    expect(collapseContext([del, add])).toEqual([del, add]);
  });

  it("keeps short runs intact", () => {
    const hunks = [...same(3, "a"), add, ...same(3, "b")];
    expect(collapseContext(hunks)).toEqual(hunks);
  });

  it("collapses the leading run to the context before the first change", () => {
    const rows = collapseContext([...same(10), add]);
    expect(rows[0]).toEqual({ type: "skip", count: 7 });
    expect(rows.slice(1, 4).map((r) => (r as Hunk).text)).toEqual(["s7", "s8", "s9"]);
    expect(rows[4]).toEqual(add);
  });

  it("collapses the trailing run to the context after the last change", () => {
    const rows = collapseContext([del, ...same(10)]);
    expect(rows[0]).toEqual(del);
    expect(rows.slice(1, 4).map((r) => (r as Hunk).text)).toEqual(["s0", "s1", "s2"]);
    expect(rows[4]).toEqual({ type: "skip", count: 7 });
    expect(rows.length).toBe(5);
  });

  it("keeps context on both sides of a middle run and hides the rest", () => {
    const rows = collapseContext([del, ...same(20), add]);
    expect(rows.length).toBe(1 + 3 + 1 + 3 + 1);
    expect(rows[4]).toEqual({ type: "skip", count: 14 });
  });

  it("does not emit a marker for exactly 2*context unchanged lines between changes", () => {
    const hunks = [del, ...same(6), add];
    expect(collapseContext(hunks)).toEqual(hunks);
  });

  it("emits a marker when one line would be hidden", () => {
    const rows = collapseContext([del, ...same(7), add]);
    expect(rows.filter((r) => r.type === "skip")).toEqual([{ type: "skip", count: 1 }]);
  });

  it("honours a custom context width", () => {
    const rows = collapseContext([...same(5), add], 1);
    expect(rows[0]).toEqual({ type: "skip", count: 4 });
    expect(rows[1]).toEqual({ type: "same", text: "s4" });
  });

  it("collapses an all-unchanged diff into one marker", () => {
    expect(collapseContext(same(4))).toEqual([{ type: "skip", count: 4 }]);
    expect(collapseContext([])).toEqual([]);
  });
});
