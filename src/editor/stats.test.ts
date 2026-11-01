import { describe, expect, it } from "vitest";
import { computeStats, countWords, formatStats, proseLines } from "./stats";

describe("computeStats", () => {
  it("returns zeros for an empty document", () => {
    expect(computeStats("")).toEqual({ words: 0, chars: 0, lines: 0, readingMinutes: 0 });
  });

  it("counts words, characters and lines", () => {
    const s = computeStats("Hello world\nsecond line");
    expect(s.words).toBe(4);
    expect(s.chars).toBe(23);
    expect(s.lines).toBe(2);
    expect(s.readingMinutes).toBe(1);
  });

  it("counts a trailing newline as an extra (empty) line", () => {
    expect(computeStats("a\n").lines).toBe(2);
  });

  it("is unicode-aware and ignores punctuation", () => {
    expect(countWords("héllo wörld — ça va? 日本語 123")).toBe(6);
    expect(countWords("...!!! ---")).toBe(0);
  });

  it("keeps an apostrophe inside a word", () => {
    expect(countWords("don't stop")).toBe(2);
    expect(countWords("it’s fine")).toBe(2);
  });

  it("does not count words inside fenced code blocks but counts their lines", () => {
    const md = "# Title\n\n```js\nconst a = 1;\nconsole.log(a);\n```\n\ntail word";
    const s = computeStats(md);
    expect(s.words).toBe(3); // Title, tail, word
    expect(s.lines).toBe(8);
  });

  it("handles tilde fences and an unclosed fence", () => {
    expect(computeStats("~~~\ncode here\n~~~\nafter").words).toBe(1);
    expect(computeStats("```\nnever closed\nstill code").words).toBe(0);
  });

  it("requires the closing fence to match the opening character and length", () => {
    // A shorter run or a different character does not close the block.
    expect(proseLines("````\n```\nx\n````\ny")).toEqual(["y"]);
    expect(proseLines("```\n~~~\nx\n```\ny")).toEqual(["y"]);
  });

  it("estimates reading time at 200 words per minute, rounding up", () => {
    expect(computeStats("w ".repeat(200)).readingMinutes).toBe(1);
    expect(computeStats("w ".repeat(201)).readingMinutes).toBe(2);
    expect(computeStats("w ".repeat(1200)).readingMinutes).toBe(6);
    expect(computeStats("one").readingMinutes).toBe(1);
  });
});

describe("formatStats", () => {
  it("formats with a thousands separator and the reading time", () => {
    expect(formatStats({ words: 1234, chars: 0, lines: 0, readingMinutes: 6 })).toBe("1,234 words · 6 min");
  });

  it("uses the singular for one word", () => {
    expect(formatStats({ words: 1, chars: 1, lines: 1, readingMinutes: 1 })).toBe("1 word · 1 min");
  });

  it("renders the empty document", () => {
    expect(formatStats(computeStats(""))).toBe("0 words · 0 min");
  });
});
