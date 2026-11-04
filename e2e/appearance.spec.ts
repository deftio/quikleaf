import { test, expect } from "@playwright/test";

/** Settings → Appearance: chrome font size, editor font size, preview style and the user's CSS. */

test.describe("Appearance settings", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await page.locator(".qde-textarea").fill("# Title\n\nSome text.\n");
  });

  test("defaults: 14 px chrome, 16 px preview, quikdown's own style", async ({ page }) => {
    await expect(page.locator("#btn-file-menu")).toHaveCSS("font-size", "14px");
    await expect(page.locator("#editor-container .qde-preview")).toHaveCSS("font-size", "16px");
    await expect(page.locator("#app")).toHaveClass(/preview-default/);
    await page.click("#btn-settings");
    await expect(page.locator("#set-ui-font")).toHaveValue("14");
    await expect(page.locator("#set-editor-font")).toHaveValue("16");
    await expect(page.locator("#set-preview-style")).toHaveValue("default");
    await expect(page.locator("#set-preview-css")).toHaveValue("");
  });

  test("the pickers preview live, Save keeps them across a reload, Cancel puts them back", async ({ page }) => {
    await page.click("#btn-settings");
    await page.selectOption("#set-ui-font", "16");
    await page.selectOption("#set-editor-font", "20");
    await page.selectOption("#set-preview-style", "book");
    await expect(page.locator("#btn-file-menu")).toHaveCSS("font-size", "16px");
    await expect(page.locator("#editor-container .qde-preview")).toHaveCSS("font-size", "20px");
    await expect(page.locator("#app")).toHaveClass(/preview-book/);
    await page.click("#settings-save");

    await page.reload();
    await page.waitForSelector("#editor-container", { state: "visible" });
    await expect(page.locator("#btn-file-menu")).toHaveCSS("font-size", "16px");
    await expect(page.locator("#app")).toHaveClass(/preview-book/);

    await page.click("#btn-settings");
    await page.selectOption("#set-preview-style", "mono");
    await expect(page.locator("#app")).toHaveClass(/preview-mono/);
    await page.click("#settings-cancel");
    await expect(page.locator("#app")).toHaveClass(/preview-book/);
    await expect(page.locator("#app")).not.toHaveClass(/preview-mono/);
  });

  test("the user's CSS applies inside the preview as it is typed", async ({ page }) => {
    await page.click("#btn-settings");
    await page.fill("#set-preview-css", "h1 { color: rgb(200, 0, 0); }");
    await expect(page.locator("#editor-container .qde-preview h1")).toHaveCSS("color", "rgb(200, 0, 0)");
    await page.click("#settings-save");
    await expect(page.locator("#editor-container .qde-preview h1")).toHaveCSS("color", "rgb(200, 0, 0)");
    await page.click("#btn-settings");
    await page.fill("#set-preview-css", "");
    await expect(page.locator("#editor-container .qde-preview h1")).not.toHaveCSS("color", "rgb(200, 0, 0)");
  });
});

test.describe("Theme toggle", () => {
  test("the sun/moon button at the far right flips dark mode, remembers it, and Settings can hand it back to the OS", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    const btn = page.locator("#titlebar-right #btn-theme");
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute("aria-label", "Switch to dark mode");
    await btn.click();
    await expect(page.locator("#app")).toHaveClass(/dark/);
    await expect(btn).toHaveAttribute("aria-label", "Switch to light mode");
    await page.reload();
    await page.waitForSelector("#editor-container", { state: "visible" });
    await expect(page.locator("#app")).toHaveClass(/dark/);
    await page.click("#btn-settings");
    await expect(page.locator("#set-theme")).toHaveValue("dark");
    await page.selectOption("#set-theme", "system");
    await expect(page.locator("#app")).not.toHaveClass(/dark/); // the test browser prefers light
    await page.click("#settings-save");
    await btn.click();
    await expect(page.locator("#app")).toHaveClass(/dark/);
  });
});
