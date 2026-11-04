import { test, expect, type Page } from "@playwright/test";

/**
 * Files dropped on the window, images pasted into the source pane, and
 * relative images in the preview. The Tauri webview's drag-drop events come
 * through the e2e event bus ("tauri://drag-drop"); `allow_path` and
 * `image_save` are recorded by the core mock.
 */

const DOC = "/docs/notes.md";

async function gotoDoc(page: Page, content: string) {
  await page.addInitScript(
    ({ path, content }) => {
      (window as any).__E2E_PRECONFIG__ = {
        launchInfo: { type: "Simple", file_path: path },
        fsStore: { [path]: content, "/dropped/second.md": "# Second\n", "/dropped/plain.txt": "plain text" },
      };
    },
    { path: DOC, content },
  );
  await page.goto("/");
  await page.waitForSelector("#editor-container", { state: "visible" });
  await expect(page.locator("#tab-list .editor-tab.active .tab-title")).toHaveText("notes.md");
}

const drag = (page: Page, payload: Record<string, unknown>) =>
  page.evaluate((p) => (window as any).__E2E_EVENTS__.emit("tauri://drag-drop", p), payload);

const invoked = (page: Page, cmd: string) => page.evaluate((c) => (window as any).__E2E__.invokeLog.filter((l: any) => l.cmd === c), cmd);

test.describe("Dropping files", () => {
  test("outlines the window while a drag hovers; a dropped markdown file opens in a new tab", async ({ page }) => {
    await gotoDoc(page, "# Notes\n");
    await drag(page, { type: "enter", paths: ["/dropped/second.md"] });
    await expect(page.locator("#app")).toHaveClass(/drag-over/);
    await drag(page, { type: "leave" });
    await expect(page.locator("#app")).not.toHaveClass(/drag-over/);

    await drag(page, { type: "enter", paths: ["/dropped/second.md", "/dropped/plain.txt"] });
    await drag(page, { type: "drop", paths: ["/dropped/second.md", "/dropped/plain.txt"] });
    await expect(page.locator("#app")).not.toHaveClass(/drag-over/);
    // The startup Untitled tab is still there beside the command-line file.
    await expect(page.locator("#tab-list .editor-tab .tab-title")).toHaveText(["Untitled", "notes.md", "second.md", "plain.txt"]);
    await expect(page.locator("#tab-list .editor-tab.active .tab-title")).toHaveText("plain.txt");
    await expect(page.locator(".qde-textarea")).toHaveValue("plain text");
    const allowed = await invoked(page, "allow_path");
    expect(allowed.map((l: any) => l.args.path)).toEqual(expect.arrayContaining(["/dropped/second.md", "/dropped/plain.txt"]));
  });

  test("a dropped image is linked into the active document, relative to it; other files get a note", async ({ page }) => {
    await gotoDoc(page, "");
    await drag(page, { type: "drop", paths: ["/docs/pics/shot.png", "/dropped/report.pdf"] });
    await expect(page.locator(".qde-textarea")).toHaveValue("![shot](pics/shot.png)");
    await expect(page.locator("#toast-root")).toContainText("report.pdf");
    await expect(page.locator("#tab-list .editor-tab")).toHaveCount(2); // Untitled + notes.md, nothing new
  });
});

test.describe("Images in the preview", () => {
  test("relative image sources are pointed at the asset scheme beside the document; URLs stay as written", async ({ page }) => {
    await gotoDoc(page, "![a](images/a.png)\n\n![b](https://example.com/b.png)\n");
    const imgs = page.locator("#editor-container .qde-preview img");
    await expect(imgs).toHaveCount(2);
    await expect(imgs.nth(0)).toHaveAttribute("src", "asset://localhost/%2Fdocs%2Fimages%2Fa.png");
    await expect(imgs.nth(0)).toHaveAttribute("data-quikleaf-src", "images/a.png");
    await expect(imgs.nth(1)).toHaveAttribute("src", "https://example.com/b.png");
    // Editing keeps them resolved after quikdown re-renders.
    await page.locator(".qde-textarea").fill("text\n\n![c](../c.png)\n");
    await expect(imgs).toHaveCount(1);
    await expect(imgs.first()).toHaveAttribute("src", "asset://localhost/%2Fc.png");
  });
});

test.describe("Pasting an image", () => {
  async function pastePng(page: Page) {
    await page.locator(".qde-textarea").focus();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], "clip.png", { type: "image/png" }));
      const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector(".qde-textarea")!.dispatchEvent(ev);
    });
  }

  test("saves the image beside the document and inserts a relative link; the preview shows it", async ({ page }) => {
    await gotoDoc(page, "Before\n");
    await page.locator(".qde-textarea").click();
    await page.keyboard.press("End");
    await page.keyboard.press("ControlOrMeta+End");
    await pastePng(page);
    await expect(page.locator(".qde-textarea")).toHaveValue("Before\n![notes-01](images/notes-01.png)");
    const saves = await invoked(page, "image_save");
    expect(saves).toHaveLength(1);
    expect(saves[0].args).toMatchObject({ docPath: DOC, ext: "png", data: "iVBORw==" });
    await expect(page.locator("#editor-container .qde-preview img")).toHaveAttribute("src", "asset://localhost/%2Fdocs%2Fimages%2Fnotes-01.png");
  });

  test("an unsaved document refuses the paste with a note", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".qde-textarea", { state: "attached" });
    await pastePng(page);
    await expect(page.locator("#toast-root")).toContainText("Save the document first");
    await expect(page.locator(".qde-textarea")).toHaveValue("");
    expect(await invoked(page, "image_save")).toHaveLength(0);
  });
});
