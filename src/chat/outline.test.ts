import { describe, expect, it } from "vitest";
import { outlineOf } from "./outline";

describe("outlineOf", () => {
  it("returns nothing for an empty or heading-less document", () => {
    expect(outlineOf("")).toEqual([]);
    expect(outlineOf("just text\n\nmore text")).toEqual([]);
  });

  it("lists headings with level, text and 1-based line", () => {
    const md = "# Title\n\nintro\n\n## Section A\ntext\n### Sub\n\n## Section B";
    expect(outlineOf(md)).toEqual([
      { level: 1, text: "Title", line: 1 },
      { level: 2, text: "Section A", line: 5 },
      { level: 3, text: "Sub", line: 7 },
      { level: 2, text: "Section B", line: 9 },
    ]);
  });

  it("supports all six levels and ignores seven hashes", () => {
    const md = "# 1\n## 2\n### 3\n#### 4\n##### 5\n###### 6\n####### 7";
    expect(outlineOf(md).map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("requires a space after the hashes except for an empty heading", () => {
    expect(outlineOf("#hashtag\n#\n##  Spaced  ")).toEqual([
      { level: 1, text: "", line: 2 },
      { level: 2, text: "Spaced", line: 3 },
    ]);
  });

  it("strips closing hashes and allows up to three leading spaces", () => {
    expect(outlineOf("   ## Closed ##\n    # Indented code")).toEqual([{ level: 2, text: "Closed", line: 1 }]);
    expect(outlineOf("# Keep #inline # tag")).toEqual([{ level: 1, text: "Keep #inline # tag", line: 1 }]);
  });

  it("ignores headings inside backtick and tilde fences", () => {
    const md = ["# Real", "```md", "# Not a heading", "```", "~~~", "## Also not", "~~~", "## Real 2"].join("\n");
    expect(outlineOf(md)).toEqual([
      { level: 1, text: "Real", line: 1 },
      { level: 2, text: "Real 2", line: 8 },
    ]);
  });

  it("only closes a fence with the same character and at least the same length", () => {
    const md = ["````", "# in", "```", "# still in", "~~~", "# still in 2", "`````", "# out"].join("\n");
    expect(outlineOf(md)).toEqual([{ level: 1, text: "out", line: 8 }]);
  });

  it("treats an unterminated fence as running to the end", () => {
    expect(outlineOf("# a\n```\n# b\n# c")).toEqual([{ level: 1, text: "a", line: 1 }]);
  });

  it("does not treat a fence line with an info string as a closer", () => {
    const md = ["```js", "# x", "```js", "# y", "```", "# z"].join("\n");
    expect(outlineOf(md)).toEqual([{ level: 1, text: "z", line: 6 }]);
  });
});
