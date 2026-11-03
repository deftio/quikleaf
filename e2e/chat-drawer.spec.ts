import { test, expect, type Page } from "@playwright/test";

/**
 * The chat is a drawer: it slides out of one edge of the tab body, a pull on
 * that edge opens it while it is closed, and Settings → Chat display → Chat
 * drawer side moves it (and the pull, and the resize handle) to the other edge.
 */

async function gotoSimple(page: Page) {
  await page.goto("/");
  await page.waitForSelector("#editor-container", { state: "visible" });
}

async function setSide(page: Page, side: "left" | "right") {
  await page.click("#btn-settings");
  await page.selectOption("#set-chat-side", side);
  await page.click("#settings-save");
  await expect(page.locator("#settings-overlay")).not.toHaveClass(/bw_bccl_modal_show/);
}

/** Open the drawer with the pull and wait for the slide-in to finish before measuring. */
async function pullOpen(page: Page) {
  await page.click("#chat-drawer-pull");
  await expect(page.locator("#chat-panel")).toBeVisible();
  await page.locator("#chat-panel").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

const left = (box: { x: number } | null) => box!.x;
const right = (box: { x: number; width: number } | null) => box!.x + box!.width;

test.describe("Chat drawer", () => {
  test("the pull shows while the chat is closed and opens it; it hides once the drawer is out", async ({ page }) => {
    await gotoSimple(page);
    const pull = page.locator("#chat-drawer-pull");
    const panel = page.locator("#chat-panel");
    await expect(panel).toBeHidden();
    await expect(pull).toBeVisible();
    await expect(pull).toHaveAttribute("aria-label", "Open chat");
    await expect(page.locator("#tab-body")).toHaveClass(/chat-closed/);

    await pull.click();
    await expect(panel).toBeVisible();
    await expect(pull).toBeHidden();
    await expect(page.locator("#tab-body")).not.toHaveClass(/chat-closed/);
    await expect(page.locator("#btn-toggle-chat")).toHaveAttribute("aria-pressed", "true");

    // Closing it again (keyboard) brings the pull back.
    await page.keyboard.press("ControlOrMeta+Shift+c");
    await expect(panel).toBeHidden();
    await expect(pull).toBeVisible();
  });

  test("defaults to the left: pull on the left edge, drawer left of the editor, handle on its right", async ({ page }) => {
    await gotoSimple(page);
    const body = await page.locator("#tab-body").boundingBox();
    const pull = await page.locator("#chat-drawer-pull").boundingBox();
    expect(Math.abs(left(pull) - left(body))).toBeLessThan(2);

    // The control row: [Outline Chat | editor controls … | Info]; the tab bar and title bar hold no toggles.
    const bar = await page.locator("#editor-toolbar").boundingBox();
    const outlineBtn = await page.locator("#editor-toolbar #btn-toggle-outline").boundingBox();
    const chatBtn = await page.locator("#editor-toolbar #btn-toggle-chat").boundingBox();
    const infoBtn = await page.locator("#editor-toolbar #btn-toggle-info").boundingBox();
    expect(Math.abs(left(outlineBtn) - left(bar))).toBeLessThan(2);
    expect(Math.abs(left(chatBtn) - right(outlineBtn))).toBeLessThan(2);
    expect(Math.abs(right(infoBtn) - right(bar))).toBeLessThan(2);
    await expect(page.locator("#titlebar .toggle-btn, #tab-bar .toggle-btn")).toHaveCount(0);

    await pullOpen(page);
    const panel = await page.locator("#chat-panel").boundingBox();
    const editor = await page.locator("#editor-container").boundingBox();
    expect(Math.abs(left(panel) - left(body))).toBeLessThan(2);
    expect(right(panel)).toBeLessThanOrEqual(left(editor) + 1);
    const handle = await page.locator("#chat-panel .chat-resize-handle").boundingBox();
    expect(Math.abs(left(handle) + handle!.width / 2 - right(panel))).toBeLessThan(2);
  });

  test("Settings moves the drawer to the right edge and the setting survives a reload", async ({ page }) => {
    await gotoSimple(page);
    await setSide(page, "right");
    await expect(page.locator("#tab-body")).toHaveClass(/chat-right/);

    const body = await page.locator("#tab-body").boundingBox();
    const pull = await page.locator("#chat-drawer-pull").boundingBox();
    expect(Math.abs(right(pull) - right(body))).toBeLessThan(2);

    // The Chat toggle moves to the right end with its drawer, just inside Info; Outline stays left.
    const bar = await page.locator("#editor-toolbar").boundingBox();
    const chatBtn = await page.locator("#btn-toggle-chat").boundingBox();
    const infoBtn = await page.locator("#btn-toggle-info").boundingBox();
    expect(Math.abs(right(chatBtn) - left(infoBtn))).toBeLessThan(2);
    expect(Math.abs(right(infoBtn) - right(bar))).toBeLessThan(2);
    expect(Math.abs(left(await page.locator("#btn-toggle-outline").boundingBox()) - left(bar))).toBeLessThan(2);

    await pullOpen(page);
    const panel = await page.locator("#chat-panel").boundingBox();
    const editor = await page.locator("#editor-container").boundingBox();
    expect(left(panel)).toBeGreaterThanOrEqual(right(editor) - 1);
    expect(Math.abs(right(panel) - right(body))).toBeLessThan(2);

    // Resize handle sits on the drawer's left (inner) edge and drag-left widens it.
    const handle = page.locator("#chat-panel .chat-resize-handle");
    const hb = await handle.boundingBox();
    expect(Math.abs(hb!.x + hb!.width / 2 - left(panel))).toBeLessThan(2);
    const before = panel!.width;
    await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb!.x + hb!.width / 2 - 120, hb!.y + hb!.height / 2);
    await page.mouse.up();
    const after = await page.locator("#chat-panel").evaluate((el) => el.offsetWidth);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(600);

    // The info pane crosses to the left when the chat is on the right.
    await page.keyboard.press("ControlOrMeta+Shift+i");
    const info = await page.locator("#info-panel").boundingBox();
    expect(right(info)).toBeLessThanOrEqual(left(await page.locator("#editor-container").boundingBox()) + 1);

    await page.reload();
    await page.waitForSelector("#editor-container", { state: "visible" });
    await expect(page.locator("#tab-body")).toHaveClass(/chat-right/);
    await page.click("#btn-settings"); // the form is filled from storage when it opens
    await expect(page.locator("#set-chat-side")).toHaveValue("right");
  });

  test("the drawer side previews live in Settings and Cancel puts it back", async ({ page }) => {
    await gotoSimple(page);
    await page.click("#btn-settings");
    await page.selectOption("#set-chat-side", "right");
    await expect(page.locator("#tab-body")).toHaveClass(/chat-right/);
    await page.click("#settings-cancel");
    await expect(page.locator("#tab-body")).not.toHaveClass(/chat-right/);
  });

  test("the project tab pins its chat open with no pull", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_PRECONFIG__ = {
        launchInfo: { type: "Project", project_root: "/test/project", project_file: "/test/project/quikleaf.prj", exists: false },
        fsStore: { "readme.md": "# Hello" },
      };
    });
    await gotoSimple(page);
    await page.waitForSelector(".file-tree-item");
    await page.click("#btn-view-menu");
    await page.click("#btn-project-chat");
    await expect(page.locator("#chat-panel")).toBeVisible();
    await expect(page.locator("#chat-drawer-pull")).toBeHidden();
  });
});
