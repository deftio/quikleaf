import { test, expect, type Page } from "@playwright/test";

/**
 * Links clicked in the rendered pane (quikdown's `onLinkClick`): web links go
 * to the system browser, a relative link to a markdown file opens that file in
 * a tab, and the webview never navigates away from the app.
 */

const DOC = "/docs/notes.md";

async function gotoDoc(page: Page, content: string) {
  await page.addInitScript(
    ({ path, content }) => {
      (window as any).__E2E_PRECONFIG__ = {
        launchInfo: { type: "Simple", file_path: path },
        fsStore: { [path]: content, "/docs/sub/other.md": "# Other\n" },
      };
    },
    { path: DOC, content },
  );
  await page.goto("/");
  await page.waitForSelector("#editor-container", { state: "visible" });
  await expect(page.locator("#tab-list .editor-tab.active .tab-title")).toHaveText("notes.md");
}

const shellOpened = (page: Page) => page.evaluate(() => (window as any).__E2E__.shellOpened ?? []);

test.describe("Links in the preview", () => {
  test("a web link opens in the system browser and the app stays put", async ({ page }) => {
    await gotoDoc(page, "See [the site](https://example.com/page).\n");
    const link = page.locator("#editor-container .qde-preview a", { hasText: "the site" });
    await expect(link).toBeVisible();
    await link.click();
    expect(await shellOpened(page)).toEqual(["https://example.com/page"]);
    await expect(page.locator("#editor-container")).toBeVisible();
    await expect(page.locator("#tab-list .editor-tab")).toHaveCount(2);
  });

  test("a relative link to a markdown file opens it in a tab, resolved against the document", async ({ page }) => {
    await gotoDoc(page, "Next: [other](sub/other.md) and [an image](sub/pic.png).\n");
    await page.locator("#editor-container .qde-preview a", { hasText: "other" }).click();
    await expect(page.locator("#tab-list .editor-tab.active .tab-title")).toHaveText("other.md");
    await expect(page.locator(".qde-textarea")).toHaveValue("# Other\n");
    expect(await shellOpened(page)).toEqual([]);
    // Back on the notes: a link to something that is not a text document does nothing.
    await page.locator("#tab-list .editor-tab", { hasText: "notes.md" }).click();
    await page.locator("#editor-container .qde-preview a", { hasText: "an image" }).click();
    await expect(page.locator("#tab-list .editor-tab")).toHaveCount(3);
    await expect(page.locator("#tab-list .editor-tab.active .tab-title")).toHaveText("notes.md");
  });
});
