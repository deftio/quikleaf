import { test, expect } from "@playwright/test";

test.describe("Chat panel", () => {
  test.beforeEach(async ({ page }) => {
    // Configure LLM so sends work
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await page.evaluate(() => {
      localStorage.setItem(
        "qudown_llm_settings",
        JSON.stringify({
          provider: "openai-compatible",
          host: "http://localhost:11434",
          apiKey: "",
          model: "test-model",
        })
      );
    });
    // Open chat panel
    await page.click("#btn-toggle-chat");
    await expect(page.locator("#chat-panel")).toBeVisible();
  });

  test("Chat button toggles panel visible/hidden", async ({ page }) => {
    const panel = page.locator("#chat-panel");
    await expect(panel).toBeVisible();

    await page.click("#btn-toggle-chat");
    await expect(panel).toBeHidden();

    await page.click("#btn-toggle-chat");
    await expect(panel).toBeVisible();
  });

  test("Chat button .active class tracks panel state", async ({ page }) => {
    const btn = page.locator("#btn-toggle-chat");
    // Panel is open (from beforeEach)
    await expect(btn).toHaveClass(/active/);

    await page.click("#btn-toggle-chat");
    await expect(btn).not.toHaveClass(/active/);
  });

  test("welcome bubble present", async ({ page }) => {
    const welcome = page.locator(".chat-msg.assistant").first();
    await expect(welcome).toBeVisible();
    await expect(welcome).toContainText("QD");
  });

  test("type and click Send creates user bubble", async ({ page }) => {
    await page.fill("#chat-input", "Hello there");
    await page.click("#chat-send");

    const userBubble = page.locator(".chat-msg.user").first();
    await expect(userBubble).toBeVisible();
    await expect(userBubble).toHaveText("Hello there");
  });

  test("Enter sends message", async ({ page }) => {
    await page.fill("#chat-input", "Test enter");
    await page.press("#chat-input", "Enter");

    const userBubble = page.locator(".chat-msg.user").first();
    await expect(userBubble).toBeVisible();
    await expect(userBubble).toHaveText("Test enter");
  });

  test("Shift+Enter inserts newline, does not send", async ({ page }) => {
    await page.fill("#chat-input", "Line 1");
    await page.press("#chat-input", "Shift+Enter");
    await page.keyboard.type("Line 2");

    // No user message should appear yet
    const userBubbles = page.locator(".chat-msg.user");
    await expect(userBubbles).toHaveCount(0);

    // Input should contain both lines
    const value = await page.locator("#chat-input").inputValue();
    expect(value).toContain("Line 1");
    expect(value).toContain("Line 2");
  });

  test("Send button becomes Stop with .stop-mode during send", async ({
    page,
  }) => {
    const sendBtn = page.locator("#chat-send");

    // Use a delayed response to catch the stop state
    await page.evaluate(() => {
      const bus = (window as any).__E2E_EVENTS__;
      const orig = (window as any).__E2E__.llmChatResponse;
      // Override: make the stream delay longer so we can observe Stop state
      // We'll manually fire events after a longer delay
      (window as any).__E2E__._customStream = true;
    });

    await page.fill("#chat-input", "trigger send");
    await page.click("#chat-send");

    // Should briefly show "Stop" (the stream mock fires after 50ms)
    await expect(sendBtn).toHaveText("Stop", { timeout: 2000 });
    await expect(sendBtn).toHaveClass(/stop-mode/);

    // Wait for stream to complete and button to revert
    await expect(sendBtn).toHaveText("Send", { timeout: 5000 });
    await expect(sendBtn).not.toHaveClass(/stop-mode/);
  });

  test("mock LLM response creates assistant bubble", async ({ page }) => {
    await page.fill("#chat-input", "Hello");
    await page.click("#chat-send");

    // Wait for the assistant response bubble
    // The mock stream sends "Mock streamed response"
    const assistantBubbles = page.locator(".chat-msg.assistant");
    // First is welcome, second+ is response
    await expect(assistantBubbles.nth(1)).toBeVisible({ timeout: 5000 });
    await expect(assistantBubbles.nth(1)).toContainText("Mock streamed response");
  });

  test("button reverts to Send after response", async ({ page }) => {
    await page.fill("#chat-input", "Hello");
    await page.click("#chat-send");

    // Wait for response to complete
    await expect(page.locator("#chat-send")).toHaveText("Send", {
      timeout: 5000,
    });
    await expect(page.locator("#chat-send")).not.toHaveClass(/stop-mode/);
  });

  test("empty input does nothing", async ({ page }) => {
    const initialBubbles = await page.locator(".chat-msg.user").count();
    await page.click("#chat-send");
    const afterBubbles = await page.locator(".chat-msg.user").count();
    expect(afterBubbles).toBe(initialBubbles);
  });

  test("no LLM configured shows config prompt", async ({ page }) => {
    // Clear settings
    await page.evaluate(() => localStorage.removeItem("qudown_llm_settings"));
    // Need to re-navigate so settings are cleared when send() reads them
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await page.click("#btn-toggle-chat");

    await page.fill("#chat-input", "Hello");
    await page.click("#chat-send");

    // Should get a "No LLM configured" message
    const messages = page.locator(".chat-msg.assistant");
    const lastMsg = messages.last();
    await expect(lastMsg).toContainText("No LLM configured");
  });

  test("input focused after response", async ({ page }) => {
    await page.fill("#chat-input", "Hello");
    await page.click("#chat-send");

    // Wait for response to complete
    await expect(page.locator("#chat-send")).toHaveText("Send", {
      timeout: 5000,
    });

    // Input should be focused
    const focused = await page.evaluate(
      () => document.activeElement?.id === "chat-input"
    );
    expect(focused).toBe(true);
  });
});
