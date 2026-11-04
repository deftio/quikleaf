import { test, expect, type Page } from "@playwright/test";

/**
 * Where a new project's file goes. Rust proposes `.quikleaf/quikleaf.prj`
 * for a directory; Settings → Project → "In the project root" moves it to
 * `quikleaf.prj`; a file named on the command line (`explicit`) stays put.
 */

const ROOT = "/test/project";

async function launchProject(page: Page, launch: Record<string, unknown>, settings?: Record<string, unknown>) {
  await page.addInitScript(
    ({ launch, settings }) => {
      (window as any).__E2E_PRECONFIG__ = {
        launchInfo: { type: "Project", project_root: "/test/project", exists: false, ...launch },
        fsStore: { "readme.md": "# Hello" },
      };
      if (settings) {
        localStorage.setItem(
          "quikleaf_llm_settings",
          JSON.stringify({ provider: "openai-compatible", host: "", apiKey: "", model: "", ...settings }),
        );
      }
    },
    { launch, settings },
  );
  await page.goto("/");
  await page.waitForSelector("#file-tree", { state: "visible" });
}

const initArgs = (page: Page) => page.evaluate(() => (window as any).__E2E__.invokeLog.find((l: any) => l.cmd === "project_init")?.args);

test.describe("Project file location", () => {
  test("defaults to the .quikleaf folder Rust proposed", async ({ page }) => {
    await launchProject(page, { project_file: `${ROOT}/.quikleaf/quikleaf.prj` });
    expect(await initArgs(page)).toEqual({ root: ROOT, file: `${ROOT}/.quikleaf/quikleaf.prj` });
  });

  test("Settings → Project → root puts it beside the files", async ({ page }) => {
    await launchProject(page, { project_file: `${ROOT}/.quikleaf/quikleaf.prj` }, { projectFileLocation: "root" });
    expect(await initArgs(page)).toEqual({ root: ROOT, file: `${ROOT}/quikleaf.prj` });
  });

  test("a project file named on the command line is used as given, whatever the setting", async ({ page }) => {
    await launchProject(page, { project_file: `${ROOT}/custom.prj`, explicit: true }, { projectFileLocation: "root" });
    expect(await initArgs(page)).toEqual({ root: ROOT, file: `${ROOT}/custom.prj` });
  });

  test("the setting is in Settings under Project and is remembered", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await page.click("#btn-settings");
    const sel = page.locator("#set-project-file");
    await expect(sel).toHaveValue("dotdir");
    await sel.selectOption("root");
    await page.click("#settings-save");
    await expect(page.locator("#settings-overlay")).not.toHaveClass(/bw_bccl_modal_show/);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("quikleaf_llm_settings") || "{}"));
    expect(saved.projectFileLocation).toBe("root");
  });
});
