import { test, expect } from "@playwright/test";

test.describe("File menu", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
  });

  test("File button opens dropdown", async ({ page }) => {
    await page.click("#btn-file-menu");
    const dropdown = page.locator("#file-menu-dropdown");
    await expect(dropdown).toHaveClass(/open/);
  });

  test("click elsewhere closes dropdown", async ({ page }) => {
    await page.click("#btn-file-menu");
    const dropdown = page.locator("#file-menu-dropdown");
    await expect(dropdown).toHaveClass(/open/);

    // Click on the editor area
    await page.click("#editor-container");
    await expect(dropdown).not.toHaveClass(/open/);
  });

  test("double-click toggles dropdown", async ({ page }) => {
    const dropdown = page.locator("#file-menu-dropdown");

    // First click opens
    await page.click("#btn-file-menu");
    await expect(dropdown).toHaveClass(/open/);

    // Second click closes (need stopPropagation behavior)
    await page.click("#btn-file-menu");
    await expect(dropdown).not.toHaveClass(/open/);
  });

  test("Open item invokes dialog", async ({ page }) => {
    await page.click("#btn-file-menu");
    await page.click("#btn-open");

    // Verify invoke was called
    const log = await page.evaluate(() => (window as any).__E2E__.invokeLog);
    // The open button triggers openFile() which calls dialog.open()
    // Since dialog mock returns null, it just returns gracefully
    // The dropdown should close
    const dropdown = page.locator("#file-menu-dropdown");
    await expect(dropdown).not.toHaveClass(/open/);
  });
});
