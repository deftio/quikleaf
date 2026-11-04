import { test, expect, type Page } from "@playwright/test";

/**
 * Watch: the toggle in the control row asks Rust to watch the tab's file
 * (`watch_start`), a `file-changed` event (emitted here on the e2e bus)
 * reloads the tab, unsaved edits are asked about, and `--watch` turns the
 * toggle on for the command-line file.
 */

const DOC = "/docs/watched.md";

async function launch(page: Page, flags: Record<string, unknown> = {}) {
  await page.addInitScript(
    ({ DOC, flags }) => {
      (window as any).__E2E_PRECONFIG__ = {
        launchInfo: { type: "Simple", file_path: DOC },
        launchFlags: { open_log: false, ...flags },
        fsStore: { [DOC]: "# v1\n" },
      };
    },
    { DOC, flags },
  );
  await page.goto("/");
  await page.waitForSelector("#editor-container", { state: "visible" });
  await expect(page.locator("#tab-list .editor-tab.active .tab-title")).toHaveText("watched.md");
}

const writeOnDisk = (page: Page, content: string) =>
  page.evaluate(
    ({ DOC, content }) => {
      (window as any).__E2E__.fsStore[DOC] = content;
      (window as any).__E2E_EVENTS__.emit("file-changed", { path: DOC, kind: "changed" });
    },
    { DOC, content },
  );

const watching = (page: Page) => page.evaluate(() => (window as any).__E2E__.watching ?? []);

test.describe("Watch", () => {
  test("the toggle is off by default, disabled on an untitled tab, and reloads the tab when the file changes", async ({ page }) => {
    await launch(page);
    const btn = page.locator("#tool-watch");
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await expect(btn).toBeEnabled();
    await page.locator("#tab-list .editor-tab").filter({ hasText: "Untitled" }).click();
    await expect(btn).toBeDisabled();
    await page.locator("#tab-list .editor-tab").filter({ hasText: "watched.md" }).click();

    // Not watching: a change on disk is ignored.
    await writeOnDisk(page, "# ignored\n");
    await page.waitForTimeout(300);
    await expect(page.locator(".qde-textarea")).toHaveValue("# v1\n");

    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(await watching(page)).toEqual([DOC]);
    await writeOnDisk(page, "# v2\n\nfrom outside\n");
    await expect(page.locator(".qde-textarea")).toHaveValue("# v2\n\nfrom outside\n");
    await expect(page.locator("#editor-container .qde-preview")).toContainText("from outside");
    await expect(page.locator("#tab-list .editor-tab.active")).not.toHaveClass(/dirty/);

    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(await watching(page)).toEqual([]);
  });

  test("unsaved edits are asked about; Keep mine leaves them, Reload replaces them", async ({ page }) => {
    await launch(page);
    await page.click("#tool-watch");
    await page.locator(".qde-textarea").fill("# mine\n");
    await page.evaluate(() => ((window as any).__E2E__.askResult = false));
    await writeOnDisk(page, "# theirs\n");
    await page.waitForTimeout(400);
    await expect(page.locator(".qde-textarea")).toHaveValue("# mine\n");
    await page.evaluate(() => ((window as any).__E2E__.askResult = true));
    await writeOnDisk(page, "# theirs 2\n");
    await expect(page.locator(".qde-textarea")).toHaveValue("# theirs 2\n");
  });

  test("quikleaf --watch file.md starts with the toggle on", async ({ page }) => {
    await launch(page, { watch: true });
    await expect(page.locator("#tool-watch")).toHaveAttribute("aria-pressed", "true");
    expect(await watching(page)).toEqual([DOC]);
    await writeOnDisk(page, "# changed while watching\n");
    await expect(page.locator(".qde-textarea")).toHaveValue("# changed while watching\n");
  });

  test("closing a watched tab stops the watch; the log tab hides the button", async ({ page }) => {
    await launch(page);
    await page.click("#tool-watch");
    expect(await watching(page)).toEqual([DOC]);
    await page.keyboard.press("ControlOrMeta+w");
    await expect(page.locator("#tab-list .editor-tab")).toHaveCount(1);
    await expect.poll(() => watching(page)).toEqual([]);
  });
});
