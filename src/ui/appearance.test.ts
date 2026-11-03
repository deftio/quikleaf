/**
 * Appearance: custom properties and the preview-style class on #app, and the
 * user's CSS nested under the preview's selector.
 */
import { afterEach, describe, expect, it } from "vitest";
import bw from "bitwrench";
import { applyAppearance, applyTheme, DEFAULT_APPEARANCE, isPreviewStyle, PREVIEW_STYLES, resolveDark, USER_CSS_ID } from "./appearance";
import { getEditor, initEditor } from "../editor/editor";
import { makeThemeToggle } from "./shell";

function app(): HTMLElement {
  return document.getElementById("app")!;
}

afterEach(() => {
  bw.clear(app());
  app().removeAttribute("style");
  app().className = "";
  document.getElementById(USER_CSS_ID)?.remove();
});

describe("applyAppearance", () => {
  it("writes the two font sizes as custom properties and marks the preview style", () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, uiFontSize: 15, editorFontSize: 18, previewStyle: "plain" });
    expect(app().style.getPropertyValue("--ui-font-size")).toBe("15px");
    expect(app().style.getPropertyValue("--editor-font-size")).toBe("18px");
    expect(app().classList.contains("preview-plain")).toBe(true);
    expect(app().classList.contains("preview-default")).toBe(false);
    applyAppearance(DEFAULT_APPEARANCE);
    expect(app().classList.contains("preview-plain")).toBe(false);
    expect(app().classList.contains("preview-default")).toBe(true);
  });

  it("installs the user's CSS once, nested under the preview, and empties it when cleared", () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, previewCss: "h1 { font-family: Georgia }\n" });
    const style = document.getElementById(USER_CSS_ID) as HTMLStyleElement;
    expect(style.tagName).toBe("STYLE");
    expect(style.textContent).toBe("#editor-container .qde-preview {\nh1 { font-family: Georgia }\n}");
    applyAppearance({ ...DEFAULT_APPEARANCE, previewCss: "p { margin: 0 }" });
    expect(document.querySelectorAll(`#${USER_CSS_ID}`)).toHaveLength(1);
    expect(style.textContent).toContain("p { margin: 0 }");
    applyAppearance({ ...DEFAULT_APPEARANCE, previewCss: "   " });
    expect(style.textContent).toBe("");
  });

  it("applyTheme flips #app.dark, quikdown's own theme and the toggle's label", () => {
    initEditor(document.createElement("div"));
    bw.append(app(), makeThemeToggle(() => {}));
    applyTheme("dark");
    expect(app().classList.contains("dark")).toBe(true);
    expect(getEditor().setTheme).toHaveBeenLastCalledWith("dark");
    expect(document.getElementById("btn-theme")!.getAttribute("aria-label")).toBe("Switch to light mode");
    applyTheme("light");
    expect(app().classList.contains("dark")).toBe(false);
    expect(getEditor().setTheme).toHaveBeenLastCalledWith("light");
    expect(document.getElementById("btn-theme")!.getAttribute("aria-label")).toBe("Switch to dark mode");
    // system: happy-dom has no dark preference, so light; and resolveDark agrees.
    applyTheme("system");
    expect(app().classList.contains("dark")).toBe(false);
    expect(resolveDark("system")).toBe(false);
    expect(resolveDark("dark")).toBe(true);
  });

  it("is a no-op before #app exists", () => {
    const node = app();
    node.remove();
    try {
      expect(() => applyAppearance(DEFAULT_APPEARANCE)).not.toThrow();
      expect(document.getElementById(USER_CSS_ID)).toBeNull();
    } finally {
      document.body.appendChild(node);
    }
  });

  it("offers four preview styles and recognises only those", () => {
    expect(PREVIEW_STYLES.map((s) => s.value)).toEqual(["default", "book", "plain", "mono"]);
    expect(isPreviewStyle("book")).toBe(true);
    expect(isPreviewStyle("comic")).toBe(false);
    expect(isPreviewStyle(undefined)).toBe(false);
  });
});
