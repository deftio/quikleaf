import { describe, expect, it } from "vitest";
import {
  MAX_MATCHES,
  compileQuery,
  findMatches,
  formatCount,
  isValidQuery,
  nearestMatch,
  replaceAll,
  replaceOne,
} from "./find";

const TEXT = "The cat sat.\nthe Cat ran; THE dog slept.";

describe("findMatches", () => {
  it("returns nothing for an empty query", () => {
    expect(findMatches(TEXT, "")).toEqual([]);
  });

  it("is case-insensitive by default", () => {
    expect(findMatches(TEXT, "the")).toEqual([
      { start: 0, end: 3 },
      { start: 13, end: 16 },
      { start: 26, end: 29 },
    ]);
  });

  it("honours matchCase", () => {
    expect(findMatches(TEXT, "the", { matchCase: true })).toEqual([{ start: 13, end: 16 }]);
    expect(findMatches(TEXT, "Cat", { matchCase: true })).toEqual([{ start: 17, end: 20 }]);
  });

  it("treats the query literally unless regex is on", () => {
    expect(findMatches("a.c abc", ".")).toEqual([{ start: 1, end: 2 }]);
    expect(findMatches("a.c abc", ".", { regex: true })).toHaveLength(7);
    expect(findMatches("x (1) y", "(1)")).toEqual([{ start: 2, end: 5 }]);
  });

  it("supports regex queries, including unicode", () => {
    expect(findMatches("cat cot cut", "c[aou]t", { regex: true })).toHaveLength(3);
    expect(findMatches("naïve café", "\\p{L}+", { regex: true })).toHaveLength(2);
  });

  it("returns nothing for an invalid regex", () => {
    expect(findMatches(TEXT, "(", { regex: true })).toEqual([]);
    expect(compileQuery("[", { regex: true })).toBeNull();
  });

  it("skips zero-width matches instead of looping forever", () => {
    expect(findMatches("aab", "a*", { regex: true })).toEqual([{ start: 0, end: 2 }]);
    expect(findMatches("bbb", "a*", { regex: true })).toEqual([]);
  });

  it("caps the number of matches", () => {
    expect(findMatches("a".repeat(MAX_MATCHES + 50), "a")).toHaveLength(MAX_MATCHES);
  });
});

describe("isValidQuery", () => {
  it("is always true outside regex mode and for the empty query", () => {
    expect(isValidQuery("(")).toBe(true);
    expect(isValidQuery("", { regex: true })).toBe(true);
  });

  it("reports malformed regexes", () => {
    expect(isValidQuery("(", { regex: true })).toBe(false);
    expect(isValidQuery("a+", { regex: true })).toBe(true);
  });
});

describe("nearestMatch", () => {
  const m = [
    { start: 0, end: 3 },
    { start: 13, end: 16 },
    { start: 26, end: 29 },
  ];

  it("returns -1 when there are no matches", () => {
    expect(nearestMatch([], 5)).toBe(-1);
  });

  it("finds the first match at or after the cursor, wrapping to the start", () => {
    expect(nearestMatch(m, 0)).toBe(0);
    expect(nearestMatch(m, 1)).toBe(1);
    expect(nearestMatch(m, 13)).toBe(1);
    expect(nearestMatch(m, 27)).toBe(0);
  });

  it("finds the last match ending at or before the cursor going backwards, wrapping to the end", () => {
    expect(nearestMatch(m, 30, -1)).toBe(2);
    expect(nearestMatch(m, 16, -1)).toBe(1);
    expect(nearestMatch(m, 15, -1)).toBe(0);
    expect(nearestMatch(m, 2, -1)).toBe(2);
  });
});

describe("replaceOne / replaceAll", () => {
  it("replaces a single range", () => {
    expect(replaceOne("the cat", { start: 4, end: 7 }, "dog")).toBe("the dog");
    expect(replaceOne("abc", { start: 1, end: 2 }, "")).toBe("ac");
  });

  it("replaces every match regardless of input order", () => {
    const matches = findMatches(TEXT, "the");
    expect(replaceAll(TEXT, matches, "a")).toBe("a cat sat.\na Cat ran; a dog slept.");
    expect(replaceAll(TEXT, [...matches].reverse(), "a")).toBe("a cat sat.\na Cat ran; a dog slept.");
  });

  it("returns the text unchanged with no matches", () => {
    expect(replaceAll(TEXT, [], "x")).toBe(TEXT);
  });

  it("handles replacements longer and shorter than the match", () => {
    expect(replaceAll("a-a-a", findMatches("a-a-a", "a"), "bbb")).toBe("bbb-bbb-bbb");
    expect(replaceAll("aa-aa", findMatches("aa-aa", "aa"), "")).toBe("-");
  });
});

describe("formatCount", () => {
  it("renders the current position, empty states and errors", () => {
    expect(formatCount(12, 2, "x")).toBe("3 of 12");
    expect(formatCount(0, -1, "x")).toBe("No results");
    expect(formatCount(0, -1, "")).toBe("");
    expect(formatCount(0, -1, "(", false)).toBe("Invalid regex");
  });
});
