import { test, expect, type Page } from "@playwright/test";

/**
 * `quikleaf --view source|split|rendered`: the view every tab starts in. The
 * Rust side canonicalises the value (`rendered` arrives as `preview`); the
 * frontend sets the tab model's default before the first tab exists.
 */

async function launchWithView(page: Page, view: string) {
  await page.addInitScript((v) => {
    (window as any).__E2E_PRECONFIG__ = { launchFlags: { open_log: false, view: v } };
  }, view);
  await page.goto("/");
  await page.waitForSelector("#editor-container", { state: "visible" });
  await page.waitForSelector(".qde-textarea", { state: "attached" });
}

test.describe("--view", () => {
  test("source: the startup tab opens in Source and the toolbar radio agrees", async ({ page }) => {
    await launchWithView(page, "source");
    await expect(page.locator("#editor-container")).toHaveClass(/qde-mode-source/);
    await expect(page.locator("#tool-mode-source")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#tool-mode-split")).toHaveAttribute("aria-checked", "false");
  });

  test("rendered: a new tab inherits the view, and Split still switches back", async ({ page }) => {
    await launchWithView(page, "preview");
    const container = page.locator("#editor-container");
    await expect(container).toHaveClass(/qde-mode-preview/);
    await expect(page.locator("#tool-mode-preview")).toHaveAttribute("aria-checked", "true");

    await page.click("#tab-new");
    await expect(page.locator("#tab-list .editor-tab")).toHaveCount(2);
    await expect(container).toHaveClass(/qde-mode-preview/);

    // The 1.2.6 adapter always thought the editor was in Split, so this was a no-op.
    await page.click("#tool-mode-split");
    await expect(container).toHaveClass(/qde-mode-split/);
    await expect(page.locator("#tool-mode-split")).toHaveAttribute("aria-checked", "true");
  });

  test("absent: the default stays Split", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".qde-textarea", { state: "attached" });
    await expect(page.locator("#editor-container")).toHaveClass(/qde-mode-split/);
  });
});
