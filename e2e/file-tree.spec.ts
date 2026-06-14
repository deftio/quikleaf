import { test, expect } from "@playwright/test";

test.describe("File tree", () => {
  test("project mode launch shows file tree", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_PRECONFIG__ = {
        launchInfo: {
          type: "Project",
          project_root: "/test/project",
          project_file: "/test/project/quikleaf.prj",
          exists: false,
        },
        fsStore: {
          "readme.md": "# Hello",
          "src/main.ts": "console.log('hi')",
          "docs/guide.md": "# Guide",
        },
      };
    });

    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });

    const fileTree = page.locator("#file-tree");
    await expect(fileTree).toBeVisible({ timeout: 5000 });
  });

  test("Files button shown in project mode", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_PRECONFIG__ = {
        launchInfo: {
          type: "Project",
          project_root: "/test/project",
          project_file: "/test/project/quikleaf.prj",
          exists: false,
        },
        fsStore: { "readme.md": "# Hello" },
      };
    });

    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });

    const filesBtn = page.locator("#btn-toggle-files");
    await expect(filesBtn).toBeVisible({ timeout: 5000 });
  });

  test("file entries rendered", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_PRECONFIG__ = {
        launchInfo: {
          type: "Project",
          project_root: "/test/project",
          project_file: "/test/project/quikleaf.prj",
          exists: false,
        },
        fsStore: {
          "readme.md": "# Hello",
          "notes.txt": "notes",
        },
      };
    });

    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await page.waitForSelector(".file-tree-item", { timeout: 5000 });

    const items = page.locator(".file-tree-item");
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("hidden files filtered (dotfiles excluded)", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_PRECONFIG__ = {
        launchInfo: {
          type: "Project",
          project_root: "/test/project",
          project_file: "/test/project/quikleaf.prj",
          exists: false,
        },
        fsStore: {
          "readme.md": "# Hello",
          ".hidden": "secret",
          ".git/config": "git config",
        },
      };
    });

    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await page.waitForSelector(".file-tree-item", { timeout: 5000 });

    // Only readme.md should appear (dotfiles and quikleaf.prj filtered out)
    const items = page.locator(".file-tree-item");
    const count = await items.count();
    expect(count).toBe(1);

    const text = await items.first().textContent();
    expect(text).toContain("readme.md");
  });

  test("click file sets .active class", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_PRECONFIG__ = {
        launchInfo: {
          type: "Project",
          project_root: "/test/project",
          project_file: "/test/project/quikleaf.prj",
          exists: false,
        },
        fsStore: {
          "readme.md": "# Hello",
          "notes.md": "# Notes",
        },
      };
    });

    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await page.waitForSelector(".file-tree-item", { timeout: 5000 });

    const items = page.locator(".file-tree-item");
    await items.first().click();
    await expect(items.first()).toHaveClass(/active/);
  });

  test("click file loads content into editor", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_PRECONFIG__ = {
        launchInfo: {
          type: "Project",
          project_root: "/test/project",
          project_file: "/test/project/quikleaf.prj",
          exists: false,
        },
        fsStore: {
          "readme.md": "# Hello World",
        },
      };
    });

    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await page.waitForSelector(".file-tree-item", { timeout: 5000 });

    await page.locator(".file-tree-item").first().click();

    // Wait for file_read to be invoked (async due to dynamic import)
    await expect(async () => {
      const log = await page.evaluate(() =>
        (window as any).__E2E__.invokeLog.filter(
          (l: any) => l.cmd === "file_read"
        )
      );
      expect(log.length).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });
  });
});
