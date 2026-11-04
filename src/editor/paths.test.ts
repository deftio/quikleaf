import { describe, expect, it } from "vitest";
import { baseName, dirName, extOf, isAbsolutePath, isImagePath, isRelativeSrc, isTextDocumentPath, joinPath, relativePath } from "./paths";

describe("path pieces", () => {
  it("splits names, folders and extensions on either separator", () => {
    expect(baseName("/a/b/c.md")).toBe("c.md");
    expect(baseName("C:\\docs\\c.md")).toBe("c.md");
    expect(baseName("c.md")).toBe("c.md");
    expect(dirName("/a/b/c.md")).toBe("/a/b");
    expect(dirName("C:\\docs\\c.md")).toBe("C:\\docs");
    expect(dirName("c.md")).toBe("");
    expect(extOf("/a/b/Photo.PNG")).toBe("png");
    expect(extOf("/a/.hidden")).toBe("");
    expect(extOf("README")).toBe("");
  });

  it("knows which dropped files are images and which open as documents", () => {
    expect(isImagePath("x.png")).toBe(true);
    expect(isImagePath("x.JPEG")).toBe(true);
    expect(isImagePath("x.md")).toBe(false);
    expect(isTextDocumentPath("notes.md")).toBe(true);
    expect(isTextDocumentPath("notes.markdown")).toBe(true);
    expect(isTextDocumentPath("data.csv")).toBe(true);
    expect(isTextDocumentPath("report.pdf")).toBe(false);
    expect(isTextDocumentPath("x.png")).toBe(false);
  });

  it("tells absolute paths from relative ones on both platforms", () => {
    expect(isAbsolutePath("/Users/x/a.png")).toBe(true);
    expect(isAbsolutePath("C:\\x\\a.png")).toBe(true);
    expect(isAbsolutePath("D:/x/a.png")).toBe(true);
    expect(isAbsolutePath("images/a.png")).toBe(false);
  });
});

describe("isRelativeSrc", () => {
  it("accepts paths beside the document and rejects URLs, data URIs, anchors and absolute paths", () => {
    expect(isRelativeSrc("images/a.png")).toBe(true);
    expect(isRelativeSrc("./a.png")).toBe(true);
    expect(isRelativeSrc("../a b.png")).toBe(true);
    expect(isRelativeSrc("https://x/a.png")).toBe(false);
    expect(isRelativeSrc("data:image/png;base64,AAAA")).toBe(false);
    expect(isRelativeSrc("//cdn/a.png")).toBe(false);
    expect(isRelativeSrc("#top")).toBe(false);
    expect(isRelativeSrc("/abs/a.png")).toBe(false);
    expect(isRelativeSrc("C:\\abs\\a.png")).toBe(false);
    expect(isRelativeSrc("")).toBe(false);
  });
});

describe("joinPath", () => {
  it("resolves . and .. against the folder", () => {
    expect(joinPath("/docs/notes", "images/a.png")).toBe("/docs/notes/images/a.png");
    expect(joinPath("/docs/notes", "./a.png")).toBe("/docs/notes/a.png");
    expect(joinPath("/docs/notes", "../a.png")).toBe("/docs/a.png");
    expect(joinPath("/docs", "../../a.png")).toBe("/a.png");
    expect(joinPath("/", "a.png")).toBe("/a.png");
  });

  it("keeps Windows separators when the folder uses them", () => {
    expect(joinPath("C:\\docs\\notes", "images/a.png")).toBe("C:\\docs\\notes\\images\\a.png");
    expect(joinPath("C:\\docs\\notes", "..\\a.png")).toBe("C:\\docs\\a.png");
  });
});

describe("relativePath", () => {
  it("writes a file relative to the document's folder with forward slashes", () => {
    expect(relativePath("/docs/notes", "/docs/notes/images/a.png")).toBe("images/a.png");
    expect(relativePath("/docs/notes", "/docs/a.png")).toBe("../a.png");
    expect(relativePath("/docs/notes", "/pics/a.png")).toBe("../../pics/a.png");
    expect(relativePath("/docs/notes", "/docs/notes")).toBe(".");
    expect(relativePath("C:\\docs", "C:\\docs\\img\\a.png")).toBe("img/a.png");
  });

  it("keeps an absolute path across Windows drives", () => {
    expect(relativePath("C:\\docs", "D:\\img\\a.png")).toBe("D:\\img\\a.png");
  });
});
