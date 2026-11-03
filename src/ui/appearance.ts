/**
 * Appearance: the chrome font size (title bar, menus, tab bar, toolbars,
 * status bar), the editor's base font size (source and preview), one of a
 * few preview stylesheets, and the user's own CSS for the preview.
 *
 * The values live in Settings (`settings/settings.ts`, `appearanceOf()`);
 * this module only applies them: two CSS custom properties and one
 * `preview-<style>` class on `#app`, which `ui/theme.ts` rules read, plus a
 * `<style>` holding the user's CSS nested under the preview's selector.
 */
import bw from "bitwrench";
import { el } from "./taco";

export type PreviewStyle = "default" | "book" | "plain" | "mono";

export interface Appearance {
  /** Chrome font size in px: menus, tab bar, toolbars, status bar. */
  uiFontSize: number;
  /** Base font size of the preview in px; the source pane follows at 7/8. */
  editorFontSize: number;
  previewStyle: PreviewStyle;
  /** The user's CSS, applied inside `#editor-container .qde-preview`. */
  previewCss: string;
}

export const DEFAULT_APPEARANCE: Appearance = { uiFontSize: 14, editorFontSize: 16, previewStyle: "default", previewCss: "" };

export const UI_FONT_SIZES = [12, 13, 14, 15, 16, 18];
export const EDITOR_FONT_SIZES = [13, 14, 15, 16, 17, 18, 20, 22];

export const PREVIEW_STYLES: { value: PreviewStyle; text: string }[] = [
  { value: "default", text: "Default — quikdown's own: system sans, compact" },
  { value: "book", text: "Book — serif, a reading measure, generous leading" },
  { value: "plain", text: "Plain — system sans with ruled headings, GitHub-like" },
  { value: "mono", text: "Mono — everything in the code font" },
];

export const USER_CSS_ID = "quikleaf_user_css";

export function isPreviewStyle(v: unknown): v is PreviewStyle {
  return PREVIEW_STYLES.some((s) => s.value === v);
}

/** Apply an appearance to the mounted app. A no-op before `#app` exists. */
export function applyAppearance(a: Appearance): void {
  const app = el("app");
  if (!app) return;
  app.style.setProperty("--ui-font-size", `${a.uiFontSize}px`);
  app.style.setProperty("--editor-font-size", `${a.editorFontSize}px`);
  for (const s of PREVIEW_STYLES) bw.toggleClass(app, `preview-${s.value}`, s.value === a.previewStyle);

  let style = document.getElementById(USER_CSS_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = USER_CSS_ID;
    document.head.appendChild(style);
  }
  // CSS nesting scopes the user's rules to the preview: `h1 { … }` means the
  // preview's headings, a bare `font-family: …` the preview itself.
  const css = a.previewCss.trim();
  style.textContent = css ? `#editor-container .qde-preview {\n${css}\n}` : "";
}
