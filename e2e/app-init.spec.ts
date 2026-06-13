import { test, expect } from "@playwright/test";

test.describe("App initialization", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for the editor to initialize (quikdown creates elements inside #editor-container)
    await page.waitForSelector("#editor-container", { state: "visible" });
  });

  test("loads without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    // Re-navigate to capture errors from page load
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    // Filter out known acceptable warnings (quikdown eval warning, etc)
    const real = errors.filter(
      (e) => !e.includes("eval") && !e.includes("Unhandled")
    );
    expect(real).toHaveLength(0);
  });

  test("editor container is visible", async ({ page }) => {
    const editor = page.locator("#editor-container");
    await expect(editor).toBeVisible();
  });

  test("status bar shows 'No file open'", async ({ page }) => {
    const statusFile = page.locator("#status-file");
    await expect(statusFile).toHaveText("No file open");
  });

  test("chat panel starts hidden", async ({ page }) => {
    const chatPanel = page.locator("#chat-panel");
    await expect(chatPanel).toBeHidden();
  });

  test("file tree starts hidden", async ({ page }) => {
    const fileTree = page.locator("#file-tree");
    await expect(fileTree).toBeHidden();
  });

  test("LLM status shows 'No LLM configured'", async ({ page }) => {
    const status = page.locator("#llm-status");
    await expect(status).toHaveText("No LLM configured");
  });

  test("welcome message visible when chat opened", async ({ page }) => {
    // Open chat
    await page.click("#btn-toggle-chat");
    const chatPanel = page.locator("#chat-panel");
    await expect(chatPanel).toBeVisible();
    // Welcome bubble should be the first assistant message
    const welcome = page.locator(".chat-msg.assistant").first();
    await expect(welcome).toBeVisible();
    await expect(welcome).toContainText("QD");
  });

  test("dark mode class applied when prefers-color-scheme: dark", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      colorScheme: "dark",
    });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    const app = page.locator("#app");
    await expect(app).toHaveClass(/dark/);
    await context.close();
  });
});
