import { test, expect, type Page } from "@playwright/test";

/**
 * The log tab: opened from About → Diagnostics → View Log, Settings → View
 * Log, or `quikleaf --log`; shows the log file's tail and follows new
 * entries live; filter, Follow, Clear.
 */

async function gotoApp(page: Page) {
  await page.goto("/");
  await page.waitForSelector("#editor-container", { state: "visible" });
}

async function configureLLM(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem(
      "quikleaf_llm_settings",
      JSON.stringify({ provider: "openai-compatible", host: "http://localhost:11434", apiKey: "", model: "test-model" }),
    );
  });
  await page.reload();
  await page.waitForSelector("#editor-container", { state: "visible" });
}

test.describe("Log tab", () => {
  test("View Log in About → Diagnostics opens the tab, which replaces the editor and has no chat", async ({ page }) => {
    await gotoApp(page);
    await page.click("#btn-about");
    await page.locator("#about-modal").getByRole("tab", { name: "Diagnostics" }).click();
    await page.click("#diag-view-log");
    await expect(page.locator("#about-overlay")).not.toHaveClass(/bw_bccl_modal_show/);
    await expect(page.locator("#tab-list .editor-tab.active .tab-title")).toHaveText("Log");
    await expect(page.locator("#log-panel")).toBeVisible();
    await expect(page.locator("#editor-container")).toBeHidden();
    await expect(page.locator("#tool-mode-split")).toBeHidden();
    await expect(page.locator("#btn-toggle-chat")).toBeHidden();
    await expect(page.locator("#chat-drawer-pull")).toBeHidden();
    await expect(page.locator("#status-file")).toHaveText("Performance log");
    await expect(page.locator("#log-path")).toContainText("quikleaf-perf.jsonl");
    // The app's own start entry is already there.
    await expect(page.locator("#log-list .log-row[data-kind=app]").first()).toContainText("app");
    // Cmd+Shift+C does nothing here.
    await page.keyboard.press("ControlOrMeta+Shift+c");
    await expect(page.locator("#chat-panel")).toBeHidden();
    // Back on a document, the editor returns.
    await page.locator("#tab-list .editor-tab").first().click();
    await expect(page.locator("#editor-container")).toBeVisible();
    await expect(page.locator("#log-panel")).toBeHidden();
  });

  test("follows a chat turn live: llm, tool and turn rows appear as they are logged; the filter narrows them", async ({ page }) => {
    await gotoApp(page);
    await configureLLM(page);
    await page.click("#btn-settings");
    await page.click("#settings-view-log");
    await expect(page.locator("#settings-overlay")).not.toHaveClass(/bw_bccl_modal_show/);
    await expect(page.locator("#log-panel")).toBeVisible();
    const before = await page.locator("#log-list .log-row").count();

    // A chat turn on a document tab while the log tab stays open in the background.
    await page.locator("#tab-list .editor-tab").first().click();
    await page.keyboard.press("ControlOrMeta+Shift+c");
    await page.fill("#chat-input", "hello");
    await page.press("#chat-input", "Enter");
    await expect(page.locator(".chat-msg.assistant").last()).not.toContainText("…", { timeout: 10000 });
    await page.locator("#tab-list .editor-tab").filter({ hasText: "Log" }).click();
    await expect(page.locator("#log-list .log-row[data-kind=llm]")).toHaveCount(1);
    await expect(page.locator("#log-list .log-row[data-kind=turn]")).toHaveCount(1);
    expect(await page.locator("#log-list .log-row").count()).toBeGreaterThan(before);

    await page.click("#log-filter-llm");
    await expect(page.locator("#log-list")).toHaveClass(/filter-llm/);
    await expect(page.locator("#log-list .log-row[data-kind=app]").first()).toBeHidden();
    await expect(page.locator("#log-list .log-row[data-kind=llm]").first()).toBeVisible();
    await page.click("#log-filter-all");
    await expect(page.locator("#log-list .log-row[data-kind=app]").first()).toBeVisible();

    await page.click("#log-follow");
    await expect(page.locator("#log-follow")).toHaveAttribute("aria-pressed", "false");
    await page.click("#log-clear");
    await expect(page.locator("#log-list .log-row")).toHaveCount(0);
    const cleared = await page.evaluate(() => (window as any).__E2E__.invokeLog.filter((l: any) => l.cmd === "log_clear").length);
    expect(cleared).toBe(1);
  });

  test("quikleaf --log starts on the log tab", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_PRECONFIG__ = { launchFlags: { open_log: true } };
    });
    await page.goto("/");
    await page.waitForSelector("#log-panel", { state: "visible" }); // the editor is hidden on this tab
    await expect(page.locator("#tab-list .editor-tab.active .tab-title")).toHaveText("Log");
    await expect(page.locator("#log-panel")).toBeVisible();
  });
});
