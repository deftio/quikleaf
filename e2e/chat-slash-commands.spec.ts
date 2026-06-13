import { test, expect } from "@playwright/test";

test.describe("Chat slash commands", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    // Open chat panel
    await page.click("#btn-toggle-chat");
    await expect(page.locator("#chat-panel")).toBeVisible();
  });

  test("/help renders help table", async ({ page }) => {
    await page.fill("#chat-input", "/help");
    await page.click("#chat-send");

    const messages = page.locator(".chat-msg.assistant");
    const helpMsg = messages.last();
    await expect(helpMsg).toContainText("/help");
    await expect(helpMsg).toContainText("/clear");
    // Should render a table
    await expect(helpMsg.locator("table")).toBeVisible();
  });

  test("/clear clears chat and re-shows welcome", async ({ page }) => {
    // First send a message to add some content
    await page.fill("#chat-input", "/help");
    await page.click("#chat-send");

    // Verify there are multiple messages
    const beforeCount = await page.locator(".chat-msg").count();
    expect(beforeCount).toBeGreaterThan(1);

    // Now clear
    await page.fill("#chat-input", "/clear");
    await page.click("#chat-send");

    // Should have only the welcome message
    const messages = page.locator(".chat-msg.assistant");
    await expect(messages).toHaveCount(1);
    await expect(messages.first()).toContainText("QD");
  });

  test("/model shows 'No LLM configured' when unconfigured", async ({
    page,
  }) => {
    await page.evaluate(() => localStorage.removeItem("qudown_llm_settings"));
    // Re-navigate to clear any in-memory settings
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await page.click("#btn-toggle-chat");

    await page.fill("#chat-input", "/model");
    await page.click("#chat-send");

    const messages = page.locator(".chat-msg.assistant");
    const lastMsg = messages.last();
    await expect(lastMsg).toContainText("No LLM configured");
  });

  test("/tools shows tool list", async ({ page }) => {
    await page.fill("#chat-input", "/tools");
    await page.click("#chat-send");

    const messages = page.locator(".chat-msg.assistant");
    const lastMsg = messages.last();
    await expect(lastMsg).toContainText("Document");
    await expect(lastMsg).toContainText("Memory");
    await expect(lastMsg).toContainText("Key-Value");
  });

  test("unknown command shows error", async ({ page }) => {
    await page.fill("#chat-input", "/nonexistent");
    await page.click("#chat-send");

    const messages = page.locator(".chat-msg.assistant");
    const lastMsg = messages.last();
    await expect(lastMsg).toContainText("Unknown command");
  });

  test("case insensitive - /HELP works", async ({ page }) => {
    await page.fill("#chat-input", "/HELP");
    await page.click("#chat-send");

    const messages = page.locator(".chat-msg.assistant");
    const lastMsg = messages.last();
    // /help handler is checked against .toLowerCase() so /HELP should work
    await expect(lastMsg).toContainText("/help");
  });
});
