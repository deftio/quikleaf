import { test, expect } from "@playwright/test";

test.describe("Settings modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
  });

  test("Settings button opens overlay", async ({ page }) => {
    await page.click("#btn-settings");
    const overlay = page.locator("#settings-overlay");
    await expect(overlay).toHaveClass(/open/);
  });

  test("form fields populated from saved settings", async ({ page }) => {
    // Save settings to localStorage
    await page.evaluate(() => {
      localStorage.setItem(
        "quikleaf_llm_settings",
        JSON.stringify({
          provider: "openai-compatible",
          host: "http://testhost:1234",
          apiKey: "sk-test",
          model: "test-model",
        })
      );
    });
    // Re-navigate to pick up saved settings
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await page.click("#btn-settings");

    await expect(page.locator("#set-host")).toHaveValue("http://testhost:1234");
    await expect(page.locator("#set-api-key")).toHaveValue("sk-test");
    await expect(page.locator("#set-model")).toHaveValue("test-model");
  });

  test("Save updates localStorage and LLM status", async ({ page }) => {
    await page.click("#btn-settings");
    await page.fill("#set-host", "http://myhost:8080");
    await page.fill("#set-model", "my-model");
    await page.click("#settings-save");

    // Overlay should close
    const overlay = page.locator("#settings-overlay");
    await expect(overlay).not.toHaveClass(/open/);

    // LLM status should update
    const status = page.locator("#llm-status");
    await expect(status).toContainText("my-model");

    // localStorage should be updated
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("quikleaf_llm_settings") || "{}")
    );
    expect(saved.model).toBe("my-model");
    expect(saved.host).toBe("http://myhost:8080");
  });

  test("Cancel closes without saving", async ({ page }) => {
    await page.click("#btn-settings");
    await page.fill("#set-model", "should-not-save");
    await page.click("#settings-cancel");

    const overlay = page.locator("#settings-overlay");
    await expect(overlay).not.toHaveClass(/open/);

    // localStorage should not have the value
    const saved = await page.evaluate(() =>
      localStorage.getItem("quikleaf_llm_settings")
    );
    // It's either null or doesn't contain "should-not-save"
    if (saved) {
      expect(saved).not.toContain("should-not-save");
    }
  });

  test("Escape closes settings", async ({ page }) => {
    await page.click("#btn-settings");
    const overlay = page.locator("#settings-overlay");
    await expect(overlay).toHaveClass(/open/);

    await page.keyboard.press("Escape");
    await expect(overlay).not.toHaveClass(/open/);
  });

  test("Backdrop click closes settings", async ({ page }) => {
    await page.click("#btn-settings");
    const overlay = page.locator("#settings-overlay");
    await expect(overlay).toHaveClass(/open/);

    // Click on the overlay backdrop (outside the modal)
    await overlay.click({ position: { x: 10, y: 10 } });
    await expect(overlay).not.toHaveClass(/open/);
  });

  test("Fetch Models populates model list", async ({ page }) => {
    // Configure mock to return models
    await page.evaluate(() => {
      (window as any).__E2E__.llmModels = {
        data: [
          { id: "model-a", name: "model-a" },
          { id: "model-b", name: "model-b" },
        ],
      };
    });

    await page.click("#btn-settings");
    await page.fill("#set-host", "http://localhost:11434");
    await page.click("#settings-fetch-models");

    // Wait for model list to populate
    const modelsList = page.locator("#models-list");
    await expect(modelsList.locator("a")).toHaveCount(2);
    await expect(modelsList.locator("a").first()).toContainText("model-a");
  });

  test("Click model name fills model input", async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__E2E__.llmModels = {
        data: [{ id: "picked-model", name: "picked-model" }],
      };
    });

    await page.click("#btn-settings");
    await page.fill("#set-host", "http://localhost:11434");
    await page.click("#settings-fetch-models");

    const modelsList = page.locator("#models-list");
    await modelsList.locator("a").first().click();

    await expect(page.locator("#set-model")).toHaveValue("picked-model");
  });

  test("Status text format: model @ host", async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem(
        "quikleaf_llm_settings",
        JSON.stringify({
          provider: "openai-compatible",
          host: "http://localhost:11434",
          apiKey: "",
          model: "llama3",
        })
      );
    });
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });

    const status = page.locator("#llm-status");
    await expect(status).toHaveText("llama3 @ localhost:11434");
  });

  test("Auto-detect on first load with no saved settings", async ({
    page,
  }) => {
    // Clear any saved settings before navigation
    await page.evaluate(() => localStorage.removeItem("quikleaf_llm_settings"));

    // Configure mock models BEFORE page load via addInitScript
    await page.addInitScript(() => {
      (window as any).__E2E_PRECONFIG__ = {
        llmModels: {
          data: [{ id: "auto-model", name: "auto-model" }],
        },
      };
    });

    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });

    // Wait for auto-detect to run (it's async)
    await page.waitForFunction(
      () => {
        const status = document.getElementById("llm-status");
        return status && status.textContent !== "No LLM configured";
      },
      { timeout: 5000 }
    );

    const status = page.locator("#llm-status");
    await expect(status).toContainText("auto-model");
  });
});
