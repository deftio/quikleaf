import { test, expect } from "@playwright/test";

test.describe("About modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
  });

  test("the About button in the title bar (its own, not a Help item) opens the overlay", async ({ page }) => {
    await expect(page.locator("#titlebar-right #btn-about")).toBeVisible();
    await expect(page.locator("#help-menu-dropdown #btn-about")).toHaveCount(0);
    await page.click("#btn-about");
    const overlay = page.locator("#about-overlay");
    await expect(overlay).toHaveClass(/bw_bccl_modal_show/);
  });

  test("version, description and the library versions are visible", async ({ page }) => {
    await page.click("#btn-about");
    const modal = page.locator("#about-modal");
    await expect(modal.locator(".about-version")).toContainText(/\d+\.\d+\.\d+/);
    await expect(modal.locator(".about-desc")).toContainText("markdown editor");
    await expect(modal.locator(".about-facts dt")).toHaveText(["Source", "Website", "Rendering", "Interface", "Shell", "License"]);
    await expect(modal.locator(".about-facts .about-ver")).toHaveCount(3);
  });

  test("Help holds Documentation and Report an Issue, which open in the system browser", async ({ page }) => {
    await page.click("#btn-help-menu");
    await page.click("#btn-docs");
    await page.click("#btn-help-menu");
    await page.click("#btn-report-issue");
    const opened = await page.evaluate(() => (window as any).__E2E__.shellOpened);
    expect(opened).toEqual(["https://deftio.github.io/quikleaf/", "https://github.com/deftio/quikleaf/issues"]);
  });

  test("Escape closes about modal", async ({ page }) => {
    await page.click("#btn-about");
    const overlay = page.locator("#about-overlay");
    await expect(overlay).toHaveClass(/bw_bccl_modal_show/);

    await page.keyboard.press("Escape");
    await expect(overlay).not.toHaveClass(/bw_bccl_modal_show/);
  });

  test("Backdrop click closes about modal", async ({ page }) => {
    await page.click("#btn-about");
    const overlay = page.locator("#about-overlay");
    await expect(overlay).toHaveClass(/bw_bccl_modal_show/);

    await overlay.click({ position: { x: 10, y: 10 } });
    await expect(overlay).not.toHaveClass(/bw_bccl_modal_show/);
  });

  test("links recorded in shell mock", async ({ page }) => {
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
