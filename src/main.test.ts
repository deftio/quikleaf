import { describe, it, expect } from "vitest";
// main.ts has heavy side effects at module load (initEditor, initChat, etc.)
// We test fileName by importing it — the module-level side effects run with
// the mocked DOM and Tauri stubs from test-setup.ts.
import { fileName } from "./main";

describe("fileName", () => {
  it("extracts filename from Unix path", () => {
    expect(fileName("/home/user/documents/readme.md")).toBe("readme.md");
  });

  it("returns full string for Windows-only path (no forward slashes)", () => {
    // On non-Windows, split("/") doesn't split backslashes, so the whole
    // string is returned as the "last segment". This matches actual behavior.
    const result = fileName("C:\\Users\\user\\readme.md");
    // split("/") returns ["C:\\Users\\user\\readme.md"], pop() is truthy
    expect(result).toBe("C:\\Users\\user\\readme.md");
  });

  it("extracts filename from mixed-slash path", () => {
    // A path with forward slashes works regardless of OS
    expect(fileName("C:/Users/user/readme.md")).toBe("readme.md");
  });

  it("returns bare filename as-is", () => {
    expect(fileName("readme.md")).toBe("readme.md");
  });

  it("handles nested Unix path", () => {
    expect(fileName("/a/b/c/d/file.txt")).toBe("file.txt");
  });

  it("returns path itself for empty string", () => {
    expect(fileName("")).toBe("");
  });

  it("handles path ending with slash", () => {
    // split("/").pop() returns "" (falsy)
    // split("\\").pop() returns "/path/to/dir/" (truthy)
    const result = fileName("/path/to/dir/");
    expect(result).toBe("/path/to/dir/");
  });
});
