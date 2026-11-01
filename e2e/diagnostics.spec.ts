import { test, expect, type Page } from "@playwright/test";

/**
 * bitwrench switches are styled checkboxes; flip them through the element
 * (same as a user click on the control) so the `change` handler runs.
 */
async function setSwitch(page: Page, id: string, on: boolean) {
  const cb = page.locator(`#${id}`);
  if ((await cb.isChecked()) !== on) {
    await cb.evaluate((el) => (el as HTMLInputElement).click());
  }
  await expect(cb).toBeChecked({ checked: on });
}

/**
 * Timestamps, tool-call visibility, the performance log, the tabbed About
 * dialog and the command-line installer.
 */
test.describe("Diagnostics and display toggles", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await page.evaluate(() => {
      localStorage.setItem(
        "quikleaf_llm_settings",
        JSON.stringify({ provider: "openai-compatible", host: "http://localhost:11434", apiKey: "", model: "test-model" }),
      );
    });
    await page.click("#btn-toggle-chat");
    await expect(page.locator("#chat-panel")).toBeVisible();
  });

  test("Chat and Files buttons are toggle buttons (aria-pressed)", async ({ page }) => {
    const chat = page.locator("#btn-toggle-chat");
    await expect(chat).toHaveAttribute("aria-pressed", "true");
    await chat.click();
    await expect(chat).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#chat-panel")).toBeHidden();
  });

  test("every bubble carries a timestamp; timestamps show by default", async ({ page }) => {
    await expect(page.locator("#chat-panel")).toHaveClass(/show-timestamps/);
    const meta = page.locator(".chat-msg.assistant .chat-meta time").first();
    await expect(meta).toBeVisible();
    await expect(meta).toHaveText(/^\d\d:\d\d:\d\d$/);
  });

  test("toggling timestamps in Settings updates existing messages live", async ({ page }) => {
    const meta = page.locator(".chat-msg.assistant .chat-meta").first();
    await expect(meta).toBeVisible();

    await page.click("#btn-settings");
    await setSwitch(page, "set-show-timestamps", false);
    // Live preview: panel class flips before Save
    await expect(page.locator("#chat-panel")).not.toHaveClass(/show-timestamps/);
    await expect(meta).toBeHidden();

    // Cancel reverts the preview
    await page.click("#settings-cancel");
    await expect(page.locator("#chat-panel")).toHaveClass(/show-timestamps/);
    await expect(meta).toBeVisible();

    // Save persists it
    await page.click("#btn-settings");
    await setSwitch(page, "set-show-timestamps", false);
    await page.click("#settings-save");
    await expect(meta).toBeHidden();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("quikleaf_llm_settings") || "{}"));
    expect(saved.showTimestamps).toBe(false);
  });

  test("assistant reply shows a timing summary and writes llm + turn log entries", async ({ page }) => {
    await page.fill("#chat-input", "Hello");
    await page.click("#chat-send");
    await expect(page.locator("#chat-send")).toHaveText("Send", { timeout: 5000 });

    const timing = page.locator(".chat-msg.assistant").nth(1).locator(".chat-timing");
    await expect(timing).toContainText(/ms|s/);
    await expect(page.locator("#status-timing")).toContainText("last:");

    const kinds = await page.evaluate(() => (window as any).__E2E__.perfLog.map((e: any) => e.kind));
    expect(kinds).toContain("llm");
    expect(kinds).toContain("turn");
    const llm = await page.evaluate(() => (window as any).__E2E__.perfLog.find((e: any) => e.kind === "llm"));
    expect(llm.model).toBe("test-model");
    expect(typeof llm.total_ms).toBe("number");
    expect(typeof llm.ts).toBe("string");
  });

  test("performance log can be turned off", async ({ page }) => {
    await page.click("#btn-settings");
    await setSwitch(page, "set-perf-log", false);
    await page.click("#settings-save");
    await page.evaluate(() => ((window as any).__E2E__.perfLog = []));

    await page.fill("#chat-input", "Hello");
    await page.click("#chat-send");
    await expect(page.locator("#chat-send")).toHaveText("Send", { timeout: 5000 });

    const count = await page.evaluate(() => (window as any).__E2E__.perfLog.length);
    expect(count).toBe(0);
  });

  test("/log reports the log file and state", async ({ page }) => {
    await page.fill("#chat-input", "/log");
    await page.click("#chat-send");
    const last = page.locator(".chat-msg.assistant").last();
    await expect(last).toContainText("Performance log");
    await expect(last).toContainText("quikleaf-perf.jsonl");
  });

  test("tool-call entries follow the Show tool calls switch", async ({ page }) => {
    // Make the mock stream return a tool call first, then a plain reply.
    await page.evaluate(() => {
      const w = window as any;
      const bus = w.__E2E_EVENTS__;
      let calls = 0;
      const orig = w.__E2E__.llmChatResponse;
      w.__E2E__.customStreamHandler = () => {
        calls++;
        setTimeout(() => {
          if (calls === 1) {
            bus.emit("llm-done", {
              full_text: "",
              tool_calls: [{ id: "c1", type: "function", function: { name: "document_read", arguments: "{}" } }],
              error: null,
            });
          } else {
            bus.emit("llm-chunk", { token: "done" });
            bus.emit("llm-done", { full_text: "done", tool_calls: [], error: null });
          }
        }, 30);
      };
      void orig;
    });
    await page.fill("#chat-input", "read it");
    await page.click("#chat-send");
    await expect(page.locator("#chat-send")).toHaveText("Send", { timeout: 5000 });

    const tool = page.locator(".chat-msg.tool").first();
    await expect(tool).toBeAttached();
    await expect(tool).toBeHidden(); // default: tool calls hidden

    await page.click("#btn-settings");
    await setSwitch(page, "set-show-tools", true);
    await expect(tool).toBeVisible(); // live preview, before Save
    await expect(tool).toContainText("document_read()");
    await page.click("#settings-save");
    await expect(tool).toBeVisible();

    const toolLog = await page.evaluate(() => (window as any).__E2E__.perfLog.filter((e: any) => e.kind === "tool"));
    expect(toolLog.length).toBeGreaterThan(0);
    expect(toolLog[0].name).toBe("document_read");
  });

  test("Docker Model Runner is auto-detected when it is the only server", async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem("quikleaf_llm_settings"));
    await page.addInitScript(() => {
      (window as any).__E2E_PRECONFIG__ = {
        llmModelsByUrl: { "http://localhost:12434/engines/v1/models": { data: [{ id: "ai/smollm2" }] } },
        llmModels: { data: [] },
      };
    });
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await expect(page.locator("#llm-status")).toContainText("Docker Model Runner", { timeout: 5000 });
    await expect(page.locator("#llm-status")).toContainText("ai/smollm2");
  });
});

test.describe("About dialog tabs and CLI install", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
  });

  test("About has How it works and Diagnostics tabs", async ({ page }) => {
    await page.click("#btn-help-menu");
    await page.click("#btn-about");
    const modal = page.locator("#about-modal");
    await expect(modal.locator('[role="tab"]')).toHaveCount(3);

    await modal.getByRole("tab", { name: "How it works" }).click();
    await expect(page.locator("#about-how")).toBeVisible();
    await expect(page.locator("#about-how")).toContainText("bitwrench");
    await expect(page.locator("#about-how")).toContainText("quikdown");

    await modal.getByRole("tab", { name: "Diagnostics" }).click();
    await expect(page.locator("#about-diag")).toBeVisible();
    await expect(page.locator("#diag-log-path")).toContainText("quikleaf-perf.jsonl");
    await expect(page.locator("#diag-cli")).toContainText("Not installed");
  });

  test("Help → Install Command Line Tool installs and reports", async ({ page }) => {
    await page.click("#btn-help-menu");
    await page.click("#btn-install-cli");
    const toast = page.locator(".bw_bccl_toast").first();
    await expect(toast).toContainText("/usr/local/bin/quikleaf");
    const log = await page.evaluate(() => (window as any).__E2E__.invokeLog.filter((l: any) => l.cmd === "cli_install"));
    expect(log.length).toBe(1);
  });
});
