import { test, expect, type Page } from "@playwright/test";

const source = (page: Page) => page.locator(".qde-textarea");

async function gotoApp(page: Page) {
  await page.goto("/");
  await page.waitForSelector("#editor-container", { state: "visible" });
  await page.waitForSelector(".qde-textarea", { state: "attached" });
}

async function selectionOf(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const ta = document.querySelector(".qde-textarea") as HTMLTextAreaElement;
    return [ta.selectionStart, ta.selectionEnd];
  });
}

test.describe("Document stats", () => {
  test("the status bar shows word count and reading time and updates as you type", async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator("#status-stats")).toHaveText("0 words · 0 min");

    await source(page).fill("# Title\n\nOne two three four five.");
    await expect(page.locator("#status-stats")).toHaveText("6 words · 1 min");

    await source(page).fill("```js\nconst notCounted = 1;\n```\n\nonly these words");
    await expect(page.locator("#status-stats")).toHaveText("3 words · 1 min");
  });
});

test.describe("Outline panel", () => {
  test("starts hidden, lists headings when toggled, and clicking one moves the caret", async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator("#outline")).toBeHidden();

    await source(page).fill("intro\n\n# A\n\nbody text\n\n## B\n\ntail");
    await page.click("#btn-toggle-outline");
    await expect(page.locator("#outline")).toBeVisible();
    await expect(page.locator("#btn-toggle-outline")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#outline-header")).toHaveText("Outline");

    const items = page.locator("#outline-list .outline-item");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveText("A");
    await expect(items.nth(0)).toHaveClass(/level-1/);
    await expect(items.nth(1)).toHaveText("B");
    await expect(items.nth(1)).toHaveClass(/level-2/);

    await items.nth(1).click(); // "## B" starts at offset 23
    expect(await selectionOf(page)).toEqual([23, 23]);
    await expect(source(page)).toBeFocused();

    await items.nth(0).click();
    expect(await selectionOf(page)).toEqual([7, 7]);
  });

  test("re-parses as the document changes and shows the empty state", async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press("ControlOrMeta+Shift+o");
    await expect(page.locator("#outline")).toBeVisible();
    await expect(page.locator("#outline-list .outline-note")).toHaveText("No headings yet");

    await source(page).fill("# One\n## Two\n### Three");
    await expect(page.locator("#outline-list .outline-item")).toHaveCount(3);

    await source(page).fill("plain");
    await expect(page.locator("#outline-list .outline-note")).toHaveText("No headings yet");

    await page.keyboard.press("ControlOrMeta+Shift+o");
    await expect(page.locator("#outline")).toBeHidden();
    await expect(page.locator("#btn-toggle-outline")).toHaveAttribute("aria-pressed", "false");
  });

  test("the View menu toggles the outline too", async ({ page }) => {
    await gotoApp(page);
    await page.click("#btn-view-menu");
    await expect(page.locator("#view-menu-dropdown")).toHaveClass(/open/);
    await page.click("#btn-toggle-outline-menu");
    await expect(page.locator("#outline")).toBeVisible();
    await expect(page.locator("#view-menu-dropdown")).not.toHaveClass(/open/);
  });
});

test.describe("Find & replace", () => {
  const TEXT = "The cat sat.\nthe Cat ran; THE dog slept.";

  test("Cmd/Ctrl+F opens the bar, counts matches, and next/prev cycle", async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator("#find-bar")).toBeHidden();
    await source(page).fill(TEXT);
    await source(page).evaluate((ta: HTMLTextAreaElement) => ta.setSelectionRange(0, 0));

    await page.keyboard.press("ControlOrMeta+f");
    await expect(page.locator("#find-bar")).toBeVisible();
    await expect(page.locator("#find-input")).toBeFocused();

    await page.locator("#find-input").fill("the");
    await expect(page.locator("#find-count")).toHaveText("1 of 3");
    expect(await selectionOf(page)).toEqual([0, 3]);

    await page.keyboard.press("Enter");
    await expect(page.locator("#find-count")).toHaveText("2 of 3");
    expect(await selectionOf(page)).toEqual([13, 16]);

    await page.click("#find-next");
    await expect(page.locator("#find-count")).toHaveText("3 of 3");
    await page.click("#find-next");
    await expect(page.locator("#find-count")).toHaveText("1 of 3");

    await page.locator("#find-input").focus();
    await page.keyboard.press("Shift+Enter");
    await expect(page.locator("#find-count")).toHaveText("3 of 3");
    await page.click("#find-prev");
    await expect(page.locator("#find-count")).toHaveText("2 of 3");

    // Match case narrows the set.
    await page.locator("#find-bar label[for='find-case']").click();
    await expect(page.locator("#find-count")).toHaveText("1 of 1");

    await page.locator("#find-input").fill("zebra");
    await expect(page.locator("#find-count")).toHaveText("No results");

    await page.locator("#find-input").focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("#find-bar")).toBeHidden();
    await expect(source(page)).toBeFocused();
  });

  test("replace one and replace all change the source", async ({ page }) => {
    await gotoApp(page);
    await source(page).fill(TEXT);
    await source(page).evaluate((ta: HTMLTextAreaElement) => ta.setSelectionRange(0, 0));

    await page.keyboard.press("ControlOrMeta+h");
    await expect(page.locator("#find-bar")).toBeVisible();
    await expect(page.locator("#find-replace-input")).toBeFocused();

    await page.locator("#find-input").fill("cat");
    await page.locator("#find-replace-input").fill("dog");
    await expect(page.locator("#find-count")).toHaveText("1 of 2");

    await page.click("#find-replace-one");
    await expect(source(page)).toHaveValue("The dog sat.\nthe Cat ran; THE dog slept.");
    await expect(page.locator("#find-count")).toHaveText("1 of 1");

    await page.locator("#find-input").fill("the");
    await page.locator("#find-replace-input").fill("a");
    await page.click("#find-replace-all");
    await expect(source(page)).toHaveValue("a dog sat.\na Cat ran; a dog slept.");
    await expect(page.locator("#find-count")).toHaveText("No results");
    // The edit went through the editor: the tab is dirty and the preview re-rendered.
    await expect(page.locator("#tab-list .editor-tab.active")).toHaveClass(/dirty/);
    await expect(page.locator("#editor-container .qde-preview")).toContainText("a dog sat.");
  });

  test("the selection prefills the query and the regex switch works", async ({ page }) => {
    await gotoApp(page);
    await source(page).fill("cat cot cut");
    await source(page).evaluate((ta: HTMLTextAreaElement) => ta.setSelectionRange(4, 7));
    await page.keyboard.press("ControlOrMeta+f");
    await expect(page.locator("#find-input")).toHaveValue("cot");
    await expect(page.locator("#find-count")).toHaveText("1 of 1");

    await page.locator("#find-input").fill("c.t");
    await expect(page.locator("#find-count")).toHaveText("No results");
    await page.locator("#find-bar label[for='find-regex']").click();
    // Three matches; the caret sits on "cot", so that is the current one.
    await expect(page.locator("#find-count")).toHaveText("2 of 3");

    await page.locator("#find-input").fill("(");
    await expect(page.locator("#find-count")).toHaveText("Invalid regex");
    await page.click("#find-close");
    await expect(page.locator("#find-bar")).toBeHidden();
  });
});

test.describe("Focus mode", () => {
  test("Cmd/Ctrl+Shift+D hides the chrome; Escape and the pill restore it", async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator("#titlebar")).toBeVisible();
    await expect(page.locator("#focus-exit")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+Shift+d");
    await expect(page.locator("#app")).toHaveClass(/focus/);
    await expect(page.locator("#titlebar")).toBeHidden();
    await expect(page.locator("#statusbar")).toBeHidden();
    await expect(page.locator("#tab-bar")).toBeHidden();
    await expect(page.locator("#editor-container")).toBeVisible();
    await expect(page.locator("#focus-exit")).toBeVisible();
    await expect(page.locator("#focus-exit")).toContainText("Exit focus");

    await page.keyboard.press("Escape");
    await expect(page.locator("#app")).not.toHaveClass(/focus/);
    await expect(page.locator("#titlebar")).toBeVisible();

    await page.click("#btn-view-menu");
    await page.click("#btn-focus-mode");
    await expect(page.locator("#titlebar")).toBeHidden();
    await page.click("#focus-exit");
    await expect(page.locator("#titlebar")).toBeVisible();
  });

  test("Escape closes the find bar first, then leaves focus mode", async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press("ControlOrMeta+Shift+d");
    await page.keyboard.press("ControlOrMeta+f");
    await expect(page.locator("#find-bar")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#find-bar")).toBeHidden();
    await expect(page.locator("#app")).toHaveClass(/focus/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#app")).not.toHaveClass(/focus/);
  });
});

test.describe("Export", () => {
  test("Export HTML… writes a standalone document through the save dialog", async ({ page }) => {
    await gotoApp(page);
    await source(page).fill("# Exported\n\nSome **bold** text.");
    await page.evaluate(() => ((window as any).__E2E__.saveResult = "/tmp/exported.html"));

    await page.click("#btn-file-menu");
    await page.click("#btn-export-html");

    await expect
      .poll(async () => page.evaluate(() => (window as any).__E2E__.fsStore["/tmp/exported.html"] ?? null))
      .not.toBeNull();
    const html: string = await page.evaluate(() => (window as any).__E2E__.fsStore["/tmp/exported.html"]);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>Untitled</title>");
    expect(html).toContain("<style>");
    expect(html).toMatch(/<h1[^>]*>Exported<\/h1>/);
    expect(html).toMatch(/<strong[^>]*>bold<\/strong>/);
  });

  test("a cancelled export writes nothing", async ({ page }) => {
    await gotoApp(page);
    await page.click("#btn-file-menu");
    await page.click("#btn-export-html");
    await page.waitForTimeout(100);
    const keys = await page.evaluate(() => Object.keys((window as any).__E2E__.fsStore));
    expect(keys).toEqual([]);
  });

  test("Print / PDF… calls window.print", async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        (window as any).__E2E__.printed = true;
      };
    });
    await gotoApp(page);
    await page.click("#btn-file-menu");
    await page.click("#btn-print");
    await expect.poll(() => page.evaluate(() => (window as any).__E2E__.printed === true)).toBe(true);
  });

  test("Cmd/Ctrl+P prints", async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        (window as any).__E2E__.printed = true;
      };
    });
    await gotoApp(page);
    await page.keyboard.press("ControlOrMeta+p");
    await expect.poll(() => page.evaluate(() => (window as any).__E2E__.printed === true)).toBe(true);
  });
});
