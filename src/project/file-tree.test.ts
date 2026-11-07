import { describe, it, expect } from "vitest";
import { getFileIcon } from "./file-tree";

describe("getFileIcon", () => {
  it("markdown for .md and .markdown, whatever the case", () => {
    expect(getFileIcon("readme.md")).toBe("markdown");
    expect(getFileIcon("doc.markdown")).toBe("markdown");
    expect(getFileIcon("README.MD")).toBe("markdown");
  });

  it("code for scripts, styles, markup and config", () => {
    for (const n of ["main.ts", "App.tsx", "index.js", "Component.jsx", "package.json", "index.html", "styles.css", "main.rs", "Cargo.toml", "config.yaml", "config.yml"]) {
      expect(getFileIcon(n), n).toBe("code");
    }
  });

  it("image for raster and vector pictures", () => {
    for (const n of ["photo.png", "photo.jpg", "photo.jpeg", "anim.gif", "logo.svg"]) expect(getFileIcon(n), n).toBe("image");
  });

  it("file for anything else, including names without an extension", () => {
    expect(getFileIcon("file.xyz")).toBe("file");
    expect(getFileIcon("Makefile")).toBe("file");
    expect(getFileIcon("notes")).toBe("file");
  });
});
