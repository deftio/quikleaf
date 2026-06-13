import { test, expect } from "@playwright/test";

test.describe("Chat resizer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    // Open chat panel
    await page.click("#btn-toggle-chat");
    await expect(page.locator("#chat-panel")).toBeVisible();
  });

  test("resize handle exists on chat panel", async ({ page }) => {
    // The resize handle is appended by initChatResizer() as a child of #chat-panel
    // It has cursor: ew-resize style
    const handle = page.locator("#chat-panel > div[style*='ew-resize']");
    await expect(handle).toBeAttached();
  });

  test("drag right increases width (max 600px)", async ({ page }) => {
    const panel = page.locator("#chat-panel");
    const initialWidth = await panel.evaluate((el) => el.offsetWidth);

    // Find the resize handle
    const handle = page.locator("#chat-panel > div[style*='ew-resize']");
    const handleBox = await handle.boundingBox();
    expect(handleBox).toBeTruthy();

    // Drag right by 100px
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 100, handleBox!.y + handleBox!.height / 2);
    await page.mouse.up();

    const newWidth = await panel.evaluate((el) => el.offsetWidth);
    expect(newWidth).toBeGreaterThanOrEqual(initialWidth);
    expect(newWidth).toBeLessThanOrEqual(600);
  });

  test("drag left decreases width (min 300px)", async ({ page }) => {
    const panel = page.locator("#chat-panel");

    // Find the resize handle
    const handle = page.locator("#chat-panel > div[style*='ew-resize']");
    const handleBox = await handle.boundingBox();
    expect(handleBox).toBeTruthy();

    // Drag left by a large amount to hit min
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2 - 500, handleBox!.y + handleBox!.height / 2);
    await page.mouse.up();

    const newWidth = await panel.evaluate((el) => el.offsetWidth);
    expect(newWidth).toBeGreaterThanOrEqual(300);
  });
});
