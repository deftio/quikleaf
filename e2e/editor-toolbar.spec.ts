import { test, expect, type Page } from "@playwright/test";

/**
 * quikdown runs headless; quikleaf draws the editor toolbar itself:
 * Source / Split / Rendered, Undo / Redo, Copy MD / HTML / Rendered.
 */

const source = (page: Page) => page.locator(".qde-textarea");

async function gotoApp(page: Page) {
  await page.goto("/");
  await page.waitForSelector("#editor-container", { state: "visible" });
  await page.waitForSelector(".qde-textarea", { state: "attached" });
}

test.describe("Editor toolbar", () => {
  test("replaces quikdown's toolbar and switches the view, in step with the View menu", async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator("#editor-container .qde-toolbar")).toHaveCount(0);
    const bar = page.locator("#editor-toolbar");
    await expect(bar).toBeVisible();
    await expect(bar.locator("[role=radio]")).toHaveText(["Source", "Split", "Rendered"]);
    await expect(page.locator("#tool-mode-split")).toHaveAttribute("aria-checked", "true");

    await page.click("#tool-mode-preview");
    await expect(page.locator("#tool-mode-preview")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#tool-mode-split")).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("#editor-container .qde-source")).toBeHidden();
    await page.click("#btn-view-menu");
    await expect(page.locator("#btn-mode-preview")).toHaveAttribute("aria-checked", "true");
    // And the other way round: the menu moves the toolbar's check.
    await page.click("#btn-mode-source");
    await expect(page.locator("#tool-mode-source")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#editor-container .qde-preview")).toBeHidden();
  });

  test("the view mode is per tab (a new tab starts with the active tab's)", async ({ page }) => {
    await gotoApp(page);
    await page.click("#tool-mode-source");
    await page.keyboard.press("ControlOrMeta+n");
    await expect(page.locator("#tool-mode-source")).toHaveAttribute("aria-checked", "true");
    await page.click("#tool-mode-split");
    await expect(page.locator("#tool-mode-split")).toHaveAttribute("aria-checked", "true");
    await page.locator("#tab-list .editor-tab").first().click();
    await expect(page.locator("#tool-mode-source")).toHaveAttribute("aria-checked", "true");
    await page.locator("#tab-list .editor-tab").nth(1).click();
    await expect(page.locator("#tool-mode-split")).toHaveAttribute("aria-checked", "true");
  });

  test("Undo wakes up after an edit and takes it back", async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator("#tool-undo")).toBeDisabled();
    await expect(page.locator("#tool-redo")).toBeDisabled();
    await source(page).fill("one");
    await page.waitForTimeout(600); // quikdown debounces history
    await source(page).fill("one two");
    await expect(page.locator("#tool-undo")).toBeEnabled();
    await page.click("#tool-undo");
    await expect(source(page)).not.toHaveValue("one two");
    await expect(page.locator("#tool-redo")).toBeEnabled();
  });

  test("Copy MD puts the markdown on the clipboard and says so briefly", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__copied = null;
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async (t: string) => void ((window as any).__copied = t) },
        configurable: true,
      });
    });
    await gotoApp(page);
    await source(page).fill("# Title\n\nbody");
    await page.click("#tool-copy-md");
    await expect(page.locator("#tool-copy-md")).toHaveText("Copied");
    expect(await page.evaluate(() => (window as any).__copied)).toBe("# Title\n\nbody");
    await expect(page.locator("#tool-copy-md")).toHaveText("Copy MD");
    await page.click("#tool-copy-html");
    expect(await page.evaluate(() => (window as any).__copied)).toContain("<h1");
  });

  test("the editor controls go away on the project tab (the toggles stay) and the whole row hides in focus mode", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_PRECONFIG__ = {
        launchInfo: { type: "Project", project_root: "/test/project", project_file: "/test/project/quikleaf.prj", exists: false },
        fsStore: { "readme.md": "# Hello" },
      };
    });
    await gotoApp(page);
    await page.waitForSelector(".file-tree-item");
    await page.click("#btn-view-menu");
    await page.click("#btn-project-chat");
    await expect(page.locator("#editor-toolbar")).toBeVisible();
    await expect(page.locator("#tool-mode-split")).toBeHidden();
    await expect(page.locator("#tool-copy-md")).toBeHidden();
    await expect(page.locator("#btn-toggle-chat")).toBeHidden(); // the project chat is pinned open
    await expect(page.locator("#btn-toggle-info")).toBeVisible();
    await expect(page.locator("#btn-toggle-files")).toBeVisible();
    await page.locator("#tab-list .editor-tab").first().click();
    await expect(page.locator("#tool-mode-split")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Shift+d");
    await expect(page.locator("#editor-toolbar")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.locator("#editor-toolbar")).toBeVisible();
  });
});
