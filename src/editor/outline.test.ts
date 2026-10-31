import { describe, expect, it } from "vitest";
import { cleanHeadingText, lineOfOffset, lineStartOffset, parseOutline } from "./outline";

describe("parseOutline", () => {
  it("returns no headings for an empty or heading-less document", () => {
    expect(parseOutline("")).toEqual([]);
    expect(parseOutline("just text\n\nmore text")).toEqual([]);
  });

  it("parses ATX headings at every level with 0-based line numbers", () => {
    const md = "# One\ntext\n## Two\n### Three\n#### Four\n##### Five\n###### Six";
    expect(parseOutline(md)).toEqual([
      { level: 1, text: "One", line: 0 },
      { level: 2, text: "Two", line: 2 },
      { level: 3, text: "Three", line: 3 },
      { level: 4, text: "Four", line: 4 },
      { level: 5, text: "Five", line: 5 },
      { level: 6, text: "Six", line: 6 },
    ]);
  });

  it("ignores seven hashes, hashes without a following space, and indented code", () => {
    expect(parseOutline("####### nope")).toEqual([]);
    expect(parseOutline("#nope")).toEqual([]);
    expect(parseOutline("    # code")).toEqual([]);
    expect(parseOutline("   # three spaces ok")).toEqual([{ level: 1, text: "three spaces ok", line: 0 }]);
  });

  it("accepts an empty heading", () => {
    expect(parseOutline("#")).toEqual([{ level: 1, text: "", line: 0 }]);
    expect(parseOutline("## ")).toEqual([{ level: 2, text: "", line: 0 }]);
  });

  it("skips headings inside fenced code blocks", () => {
    const md = "# Real\n```md\n# Not a heading\n```\n~~~\n## Nor this\n~~~\n## Real too";
    expect(parseOutline(md).map((h) => h.text)).toEqual(["Real", "Real too"]);
  });

  it("treats an unclosed fence as running to the end", () => {
    expect(parseOutline("```\n# hidden\n# still hidden")).toEqual([]);
  });

  it("only closes a fence with the same character and at least the same length", () => {
    expect(parseOutline("````\n```\n# hidden\n````\n# shown").map((h) => h.text)).toEqual(["shown"]);
    expect(parseOutline("```\n~~~\n# hidden\n```\n# shown").map((h) => h.text)).toEqual(["shown"]);
  });

  it("strips trailing closing hashes and inline markers", () => {
    expect(parseOutline("## Title ##")[0].text).toBe("Title");
    expect(parseOutline("## Title ##   ")[0].text).toBe("Title");
    expect(parseOutline("# *Bold* _and_ `code`")[0].text).toBe("Bold and code");
    expect(parseOutline("# C# ##")[0].text).toBe("C#");
  });

  it("collapses links to their text", () => {
    expect(cleanHeadingText("See [the docs](https://x.y/z) now")).toBe("See the docs now");
  });

  it("handles CRLF line endings", () => {
    expect(parseOutline("# A\r\n## B\r\n").map((h) => [h.text, h.line])).toEqual([
      ["A", 0],
      ["B", 1],
    ]);
  });
});

describe("lineStartOffset / lineOfOffset", () => {
  const md = "ab\ncd\n\nef";

  it("maps line indexes to character offsets", () => {
    expect(lineStartOffset(md, 0)).toBe(0);
    expect(lineStartOffset(md, 1)).toBe(3);
    expect(lineStartOffset(md, 2)).toBe(6);
    expect(lineStartOffset(md, 3)).toBe(7);
  });

  it("clamps past the last line and treats negatives as the start", () => {
    expect(lineStartOffset(md, 99)).toBe(md.length);
    expect(lineStartOffset(md, -1)).toBe(0);
  });

  it("maps character offsets back to line indexes", () => {
    expect(lineOfOffset(md, 0)).toBe(0);
    expect(lineOfOffset(md, 2)).toBe(0);
    expect(lineOfOffset(md, 3)).toBe(1);
    expect(lineOfOffset(md, 7)).toBe(3);
    expect(lineOfOffset(md, 999)).toBe(3);
    expect(lineOfOffset(md, -5)).toBe(0);
  });
});
