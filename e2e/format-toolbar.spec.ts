import { test, expect, type Page } from "@playwright/test";

/**
 * The formatting row: quikleaf's buttons over quikdown's `format()` API, so
 * the same button works on the source pane and on the rendered one. Also the
 * editor's own Cmd/Ctrl+B / I, which quikdown 1.3 binds itself (Mac WebKit
 * has no built-in handling for them).
 */

const source = (page: Page) => page.locator(".qde-textarea");

async function gotoApp(page: Page) {
  await page.goto("/");
  await page.waitForSelector("#editor-container", { state: "visible" });
  await page.waitForSelector(".qde-textarea", { state: "attached" });
}

async function selectInSource(page: Page, start: number, end: number) {
  await source(page).focus();
  await page.evaluate(
    ([s, e]) => {
      const ta = document.querySelector(".qde-textarea") as HTMLTextAreaElement;
      ta.setSelectionRange(s, e);
      document.dispatchEvent(new Event("selectionchange"));
    },
    [start, end],
  );
}

test.describe("Formatting bar", () => {
  test("shows under the control row with every group, and Bold wraps the source selection", async ({ page }) => {
    await gotoApp(page);
    const bar = page.locator("#format-toolbar");
    await expect(bar).toBeVisible();
    await expect(bar.locator("button")).toHaveCount(17);
    const control = await page.locator("#editor-toolbar").boundingBox();
    const fmt = await bar.boundingBox();
    expect(fmt!.y).toBeGreaterThanOrEqual(control!.y + control!.height - 1);

    await source(page).fill("hello world");
    await selectInSource(page, 6, 11);
    await page.click("#fmt-bold");
    await expect(source(page)).toHaveValue("hello **world**");
    // The caret stayed in the editor (the button swallowed its mousedown) and the state shows.
    await expect(source(page)).toBeFocused();
    await expect(page.locator("#fmt-bold")).toHaveAttribute("aria-pressed", "true");
    await page.click("#fmt-bold");
    await expect(source(page)).toHaveValue("hello world");
    await expect(page.locator("#fmt-bold")).toHaveAttribute("aria-pressed", "false");
  });

  test("block commands: heading, list and quote on the caret's line, with the pressed state following", async ({ page }) => {
    await gotoApp(page);
    await source(page).fill("Title\n\nitem");
    await selectInSource(page, 0, 0);
    await page.click("#fmt-h1");
    await expect(source(page)).toHaveValue("# Title\n\nitem");
    await expect(page.locator("#fmt-h1")).toHaveAttribute("aria-pressed", "true");
    await selectInSource(page, 9, 9);
    await expect(page.locator("#fmt-h1")).toHaveAttribute("aria-pressed", "false");
    await page.click("#fmt-ul");
    await expect(source(page)).toHaveValue("# Title\n\n- item");
    await expect(page.locator("#fmt-ul")).toHaveAttribute("aria-pressed", "true");
    await page.click("#fmt-indent");
    await expect(source(page)).toHaveValue(/# Title\n\n\s+- item/);
    await page.click("#fmt-outdent");
    await expect(source(page)).toHaveValue("# Title\n\n- item");
    await page.click("#fmt-quote");
    await expect(source(page)).toHaveValue("# Title\n\n> - item");
  });

  test("works on the rendered pane too, and so do Cmd+B / Cmd+I", async ({ page }) => {
    await gotoApp(page);
    await source(page).fill("hello world");
    await page.click("#tool-mode-preview");
    const p = page.locator("#editor-container .qde-preview p");
    await expect(p).toHaveText("hello world");
    await p.click();
    await page.evaluate(() => {
      const node = document.querySelector("#editor-container .qde-preview p")!.firstChild!;
      const range = document.createRange();
      range.setStart(node, 6);
      range.setEnd(node, 11);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.click("#fmt-italic");
    await expect(source(page)).toHaveValue(/hello [*_]world[*_]/);

    await page.click("#tool-mode-source");
    await source(page).fill("plain text");
    await selectInSource(page, 0, 5);
    await page.keyboard.press("ControlOrMeta+b");
    await expect(source(page)).toHaveValue("**plain** text");
  });

  test("View → Formatting Bar hides the row and the choice survives a reload", async ({ page }) => {
    await gotoApp(page);
    await page.click("#btn-view-menu");
    await expect(page.locator("#btn-toggle-format-menu")).toHaveAttribute("aria-checked", "true");
    await page.click("#btn-toggle-format-menu");
    await expect(page.locator("#format-toolbar")).toBeHidden();
    await page.reload();
    await page.waitForSelector(".qde-textarea", { state: "attached" });
    await expect(page.locator("#format-toolbar")).toBeHidden();
    await page.click("#btn-view-menu");
    await expect(page.locator("#btn-toggle-format-menu")).toHaveAttribute("aria-checked", "false");
    await page.click("#btn-toggle-format-menu");
    await expect(page.locator("#format-toolbar")).toBeVisible();
  });

  test("goes away on the project tab and in focus mode", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_PRECONFIG__ = {
        launchInfo: { type: "Project", project_root: "/test/project", project_file: "/test/project/quikleaf.prj", exists: false },
        fsStore: { "readme.md": "# Hello" },
      };
    });
    await gotoApp(page);
    await page.waitForSelector(".file-tree-item");
    await expect(page.locator("#format-toolbar")).toBeVisible();
    await page.click("#btn-view-menu");
    await page.click("#btn-project-chat");
    await expect(page.locator("#format-toolbar")).toBeHidden();
    await page.locator("#tab-list .editor-tab").first().click();
    await expect(page.locator("#format-toolbar")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Shift+d");
    await expect(page.locator("#format-toolbar")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.locator("#format-toolbar")).toBeVisible();
  });
});
