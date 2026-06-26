import { test, expect } from "@playwright/test";

test.describe("About modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
  });

  test("About button opens overlay", async ({ page }) => {
    await page.click("#btn-help-menu");
    await page.click("#btn-about");
    const overlay = page.locator("#about-overlay");
    await expect(overlay).toHaveClass(/open/);
  });

  test("version and description visible", async ({ page }) => {
    await page.click("#btn-help-menu");
    await page.click("#btn-about");
    const modal = page.locator("#about-modal");
    await expect(modal.locator(".about-version")).toContainText(/\d+\.\d+\.\d+/);
    await expect(modal.locator(".about-desc")).toContainText("markdown editor");
  });

  test("Escape closes about modal", async ({ page }) => {
    await page.click("#btn-help-menu");
    await page.click("#btn-about");
    const overlay = page.locator("#about-overlay");
    await expect(overlay).toHaveClass(/open/);

    await page.keyboard.press("Escape");
    await expect(overlay).not.toHaveClass(/open/);
  });

  test("Backdrop click closes about modal", async ({ page }) => {
    await page.click("#btn-help-menu");
    await page.click("#btn-about");
    const overlay = page.locator("#about-overlay");
    await expect(overlay).toHaveClass(/open/);

    await overlay.click({ position: { x: 10, y: 10 } });
    await expect(overlay).not.toHaveClass(/open/);
  });

  test("links recorded in shell mock", async ({ page }) => {
    await page.click("#btn-help-menu");
    await page.click("#btn-about");

    // Click the first link in about modal
    const link = page.locator("#about-modal .about-links a").first();
    await link.click();

    const shellOpened = await page.evaluate(
      () => (window as any).__E2E__.shellOpened
    );
    expect(shellOpened.length).toBeGreaterThan(0);
    expect(shellOpened[0]).toContain("github.com");
  });
});
