import { test, expect, type Page } from "@playwright/test";

const PROJECT = {
  launchInfo: {
    type: "Project",
    project_root: "/test/project",
    project_file: "/test/project/quikleaf.prj",
    exists: false,
  },
  // The tree sorts alphabetically: notes.md, readme.md.
  fsStore: {
    "readme.md": "# Hello World",
    "notes.md": "# Notes",
  },
};

async function gotoProject(page: Page) {
  await page.addInitScript((cfg) => {
    (window as any).__E2E_PRECONFIG__ = cfg;
  }, PROJECT);
  await page.goto("/");
  await page.waitForSelector("#editor-container", { state: "visible" });
  await page.waitForSelector(".file-tree-item", { timeout: 5000 });
}

const tabs = (page: Page) => page.locator("#tab-list .editor-tab");
const activeTab = (page: Page) => page.locator("#tab-list .editor-tab.active");
const source = (page: Page) => page.locator(".qde-textarea");

test.describe("Editor tabs", () => {
  test("starts with a single clean untitled tab", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });

    await expect(page.locator("#tab-bar")).toBeVisible();
    await expect(tabs(page)).toHaveCount(1);
    await expect(activeTab(page).locator(".tab-title")).toHaveText("Untitled");
    await expect(activeTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(activeTab(page)).not.toHaveClass(/dirty/);
    await expect(page.locator("#status-file")).toHaveText("No file open");
    await expect(page).toHaveTitle("quikleaf — Untitled");
  });

  test("clicking a file in the tree opens a tab and focuses it", async ({ page }) => {
    await gotoProject(page);

    await page.locator(".file-tree-item").first().click(); // notes.md
    await expect(tabs(page)).toHaveCount(2);
    await expect(activeTab(page).locator(".tab-title")).toHaveText("notes.md");
    await expect(activeTab(page)).toHaveAttribute("title", "notes.md");
    await expect(page.locator("#status-file")).toHaveText("[Project] notes.md");
    await expect(source(page)).toHaveValue("# Notes");
    await expect(page).toHaveTitle("quikleaf — notes.md");
  });

  test("a second file opens a second tab; re-clicking the first focuses its existing tab", async ({ page }) => {
    await gotoProject(page);
    const items = page.locator(".file-tree-item");

    await items.nth(0).click();
    await items.nth(1).click();
    await expect(tabs(page)).toHaveCount(3);
    await expect(activeTab(page).locator(".tab-title")).toHaveText("readme.md");
    await expect(source(page)).toHaveValue("# Hello World");

    await items.nth(0).click();
    await expect(tabs(page)).toHaveCount(3); // no duplicate
    await expect(activeTab(page).locator(".tab-title")).toHaveText("notes.md");
    await expect(items.nth(0)).toHaveClass(/active/);
  });

  test("switching tabs preserves each document's content", async ({ page }) => {
    await gotoProject(page);
    const items = page.locator(".file-tree-item");
    await items.nth(0).click(); // notes.md
    await items.nth(1).click(); // readme.md
    await expect(source(page)).toHaveValue("# Hello World");

    // Edit readme, switch away and back: the edit must survive the round trip.
    await source(page).fill("# Hello World\n\nedited here");
    await expect(activeTab(page)).toHaveClass(/dirty/);

    await tabs(page).filter({ hasText: "notes.md" }).click();
    await expect(activeTab(page).locator(".tab-title")).toHaveText("notes.md");
    await expect(source(page)).toHaveValue("# Notes");
    await expect(activeTab(page)).not.toHaveClass(/dirty/);
    await expect(page.locator(".file-tree-item").nth(0)).toHaveClass(/active/);

    await tabs(page).filter({ hasText: "readme.md" }).click();
    await expect(source(page)).toHaveValue("# Hello World\n\nedited here");
    await expect(activeTab(page)).toHaveClass(/dirty/);
    await expect(page).toHaveTitle("• quikleaf — readme.md");
  });

  test("the × button closes a clean tab and activates its neighbour", async ({ page }) => {
    await gotoProject(page);
    const items = page.locator(".file-tree-item");
    await items.nth(0).click();
    await items.nth(1).click();
    await expect(tabs(page)).toHaveCount(3);

    await activeTab(page).locator(".tab-close").click(); // closes readme.md (right-most)
    await expect(tabs(page)).toHaveCount(2);
    await expect(activeTab(page).locator(".tab-title")).toHaveText("notes.md");
    await expect(source(page)).toHaveValue("# Notes");
    await expect(page.locator("#status-file")).toHaveText("[Project] notes.md");
  });

  test("closing a dirty tab asks first and keeps it when declined", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await source(page).fill("unsaved");
    await expect(activeTab(page)).toHaveClass(/dirty/);

    await page.evaluate(() => ((window as any).__E2E__.askResult = false));
    await activeTab(page).locator(".tab-close").click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(source(page)).toHaveValue("unsaved");

    await page.evaluate(() => ((window as any).__E2E__.askResult = true));
    await activeTab(page).locator(".tab-close").click();
    // The last tab is replaced by a fresh untitled one.
    await expect(tabs(page)).toHaveCount(1);
    await expect(activeTab(page)).not.toHaveClass(/dirty/);
    await expect(source(page)).toHaveValue("");
  });

  test("Cmd/Ctrl+N and the + button create untitled tabs", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });

    await page.keyboard.press("ControlOrMeta+n");
    await expect(tabs(page)).toHaveCount(2);
    await expect(activeTab(page).locator(".tab-title")).toHaveText("Untitled 2");

    await page.click("#tab-new");
    await expect(tabs(page)).toHaveCount(3);
    await expect(activeTab(page).locator(".tab-title")).toHaveText("Untitled 3");
  });

  test("File → New and File → Close Tab menu items work", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });

    await page.click("#btn-file-menu");
    await page.click("#btn-new");
    await expect(tabs(page)).toHaveCount(2);

    await page.click("#btn-file-menu");
    await page.click("#btn-close-tab");
    await expect(tabs(page)).toHaveCount(1);
  });

  test("typing shows the dirty dot and the title bullet; saving clears them", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });

    await source(page).fill("# Draft");
    await expect(activeTab(page)).toHaveClass(/dirty/);
    await expect(activeTab(page).locator(".tab-dirty")).toBeVisible();
    await expect(page).toHaveTitle("• quikleaf — Untitled");

    await page.evaluate(() => ((window as any).__E2E__.saveResult = "/tmp/draft.md"));
    await page.keyboard.press("ControlOrMeta+s");
    await expect(activeTab(page)).not.toHaveClass(/dirty/);
    await expect(activeTab(page).locator(".tab-title")).toHaveText("draft.md");
    await expect(page.locator("#status-file")).toHaveText("/tmp/draft.md");
    await expect(page).toHaveTitle("quikleaf — draft.md");
    const saved = await page.evaluate(() => (window as any).__E2E__.fsStore["/tmp/draft.md"]);
    expect(saved).toBe("# Draft");
  });

  test("Ctrl+Tab cycles through tabs", async ({ page }) => {
    await gotoProject(page);
    const items = page.locator(".file-tree-item");
    await items.nth(0).click();
    await items.nth(1).click();
    await expect(activeTab(page).locator(".tab-title")).toHaveText("readme.md");

    await page.keyboard.press("Control+Tab"); // wraps to Untitled
    await expect(activeTab(page).locator(".tab-title")).toHaveText("Untitled");
    await page.keyboard.press("Control+Shift+Tab"); // back to readme.md
    await expect(activeTab(page).locator(".tab-title")).toHaveText("readme.md");
  });

  test("middle-click closes a tab", async ({ page }) => {
    await gotoProject(page);
    await page.locator(".file-tree-item").nth(0).click();
    await expect(tabs(page)).toHaveCount(2);
    await activeTab(page).click({ button: "middle" });
    await expect(tabs(page)).toHaveCount(1);
    await expect(activeTab(page).locator(".tab-title")).toHaveText("Untitled");
  });
});
