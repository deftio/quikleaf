import { test, expect } from "@playwright/test";

/**
 * quikdown 1.3.2: a fence's language is the first word of its info string, so
 * arguments after it (```js title=app.js) no longer stop the fence from being
 * highlighted, and the markdown keeps the whole info string.
 */

const DOC = "/docs/fences.md";
const MD = "```js title=app.js run #setup\nconst answer = 42;\n```\n";

test("a fence with arguments highlights as its first word", async ({ page }) => {
  await page.addInitScript(
    ({ path, content }) => {
      (window as any).__E2E_PRECONFIG__ = {
        launchInfo: { type: "Simple", file_path: path },
        fsStore: { [path]: content },
      };
    },
    { path: DOC, content: MD },
  );
  await page.goto("/");
  await page.waitForSelector("#editor-container", { state: "visible" });
  const code = page.locator("#editor-container .qde-preview pre code");
  await expect(code).toContainText("const answer = 42;");
  // highlight.js marks the keyword; plain text would have no spans.
  await expect(code.locator(".hljs-keyword").first()).toHaveText("const");
  await expect(page.locator(".qde-textarea")).toHaveValue(MD);
});
