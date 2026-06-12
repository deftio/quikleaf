import { describe, it, expect } from "vitest";
import { getFileIcon } from "./file-tree";

describe("getFileIcon", () => {
  it("returns markdown icon for .md", () => {
    expect(getFileIcon("readme.md")).toBe("📝");
  });

  it("returns markdown icon for .markdown", () => {
    expect(getFileIcon("doc.markdown")).toBe("📝");
  });

  it("returns script icon for .ts", () => {
    expect(getFileIcon("main.ts")).toBe("📜");
  });

  it("returns script icon for .tsx", () => {
    expect(getFileIcon("App.tsx")).toBe("📜");
  });

  it("returns script icon for .js", () => {
    expect(getFileIcon("index.js")).toBe("📜");
  });

  it("returns script icon for .jsx", () => {
    expect(getFileIcon("Component.jsx")).toBe("📜");
  });

  it("returns clipboard icon for .json", () => {
    expect(getFileIcon("package.json")).toBe("📋");
  });

  it("returns globe icon for .html", () => {
    expect(getFileIcon("index.html")).toBe("🌐");
  });

  it("returns globe icon for .css", () => {
    expect(getFileIcon("styles.css")).toBe("🌐");
  });

  it("returns image icon for .png", () => {
    expect(getFileIcon("photo.png")).toBe("🖼️");
  });

  it("returns image icon for .jpg", () => {
    expect(getFileIcon("photo.jpg")).toBe("🖼️");
  });

  it("returns image icon for .jpeg", () => {
    expect(getFileIcon("photo.jpeg")).toBe("🖼️");
  });

  it("returns image icon for .gif", () => {
    expect(getFileIcon("anim.gif")).toBe("🖼️");
  });

  it("returns image icon for .svg", () => {
    expect(getFileIcon("logo.svg")).toBe("🖼️");
  });

  it("returns crab icon for .rs", () => {
    expect(getFileIcon("main.rs")).toBe("🦀");
  });

  it("returns gear icon for .toml", () => {
    expect(getFileIcon("Cargo.toml")).toBe("⚙️");
  });

  it("returns gear icon for .yaml", () => {
    expect(getFileIcon("config.yaml")).toBe("⚙️");
  });

  it("returns gear icon for .yml", () => {
    expect(getFileIcon("config.yml")).toBe("⚙️");
  });

  it("returns default icon for unknown extension", () => {
    expect(getFileIcon("file.xyz")).toBe("📄");
  });

  it("returns default icon for no extension", () => {
    expect(getFileIcon("Makefile")).toBe("📄");
  });

  it("handles case-insensitive matching via lowercase", () => {
    // The function lowercases the extension
    expect(getFileIcon("README.MD")).toBe("📝");
  });
});
