import { test, expect, type Page } from "@playwright/test";

/**
 * The tab as the unit: [chat | quikdown view | info]. Each tab has its own
 * chat and pane layout; the project chat is a tab of its own; chats of
 * project files are written to quikleaf.prj and come back on relaunch.
 */

const PROJECT = {
  launchInfo: { type: "Project", project_root: "/test/project", project_file: "/test/project/quikleaf.prj", exists: false },
  fsStore: { "readme.md": "# Hello World", "notes.md": "# Notes\n\nSome words here." },
};

async function gotoSimple(page: Page) {
  await page.goto("/");
  await page.waitForSelector("#editor-container", { state: "visible" });
}

async function gotoProject(page: Page, preconfig: any = PROJECT) {
  await page.addInitScript((cfg) => {
    (window as any).__E2E_PRECONFIG__ = cfg;
  }, preconfig);
  await page.goto("/");
  await page.waitForSelector("#editor-container", { state: "visible" });
  await page.waitForSelector(".file-tree-item", { timeout: 5000 });
}

async function configureLLM(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem(
      "quikleaf_llm_settings",
      JSON.stringify({ provider: "openai-compatible", host: "http://localhost:11434", apiKey: "", model: "test-model" }),
    );
  });
}

const activeTab = (page: Page) => page.locator("#tab-list .editor-tab.active");
const source = (page: Page) => page.locator(".qde-textarea");
const infoRow = (page: Page, key: string) => page.locator("#info-body .info-row").filter({ has: page.locator(".info-key", { hasText: key }) }).locator(".info-val");

test.describe("Per-tab chat", () => {
  test("each tab has its own chat; the header names the document", async ({ page }) => {
    await gotoSimple(page);
    await configureLLM(page);
    await page.click("#btn-toggle-chat");
    await expect(page.locator("#chat-panel")).toBeVisible();
    await expect(page.locator("#chat-scope")).toHaveText("Document chat");
    await expect(page.locator("#chat-target")).toHaveText("Untitled");
    await expect(page.locator("#chat-input")).toHaveAttribute("placeholder", "Ask about Untitled…");
    await expect(page.locator(".chat-msg.assistant").first()).toContainText("Untitled");

    await page.fill("#chat-input", "hello first");
    await page.press("#chat-input", "Enter");
    await expect(page.locator("#chat-send")).toHaveText("Send", { timeout: 5000 });
    await expect(page.locator(".chat-msg.user")).toHaveCount(1);
    await page.fill("#chat-input", "unsent draft");

    // A new tab inherits the open chat pane but starts its own conversation.
    await page.keyboard.press("ControlOrMeta+n");
    await expect(activeTab(page).locator(".tab-title")).toHaveText("Untitled 2");
    await expect(page.locator("#chat-panel")).toBeVisible();
    await expect(page.locator("#chat-target")).toHaveText("Untitled 2");
    await expect(page.locator(".chat-msg.user")).toHaveCount(0);
    await expect(page.locator("#chat-input")).toHaveValue("");

    // Back on the first tab: its conversation and draft are intact.
    await page.locator("#tab-list .editor-tab").first().click();
    await expect(page.locator("#chat-target")).toHaveText("Untitled");
    await expect(page.locator(".chat-msg.user")).toHaveCount(1);
    await expect(page.locator(".chat-msg.user .chat-body")).toHaveText("hello first");
    await expect(page.locator("#chat-input")).toHaveValue("unsent draft");
  });

  test("the chat pane is per tab and the View menu ticks the active tab's panes", async ({ page }) => {
    await gotoSimple(page);
    await page.click("#btn-toggle-chat");
    await expect(page.locator("#chat-panel")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+n");
    // The new tab inherited the open chat; close it there only.
    await page.keyboard.press("ControlOrMeta+Shift+c");
    await expect(page.locator("#chat-panel")).toBeHidden();
    await expect(page.locator("#btn-toggle-chat")).toHaveAttribute("aria-pressed", "false");

    await page.click("#btn-view-menu");
    await expect(page.locator("#btn-toggle-chat-menu")).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("#btn-mode-split")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#btn-project-chat")).toBeHidden(); // simple mode
    await page.click("#btn-mode-preview");
    await expect(page.locator("#editor-container .qde-source")).toBeHidden();

    await page.locator("#tab-list .editor-tab").first().click();
    await expect(page.locator("#chat-panel")).toBeVisible();
    await expect(page.locator("#btn-toggle-chat")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#editor-container .qde-source")).toBeVisible(); // first tab is still split
    await page.click("#btn-view-menu");
    await expect(page.locator("#btn-toggle-chat-menu")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#btn-mode-split")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
  });

  test("/model sets a model for this chat only", async ({ page }) => {
    await gotoSimple(page);
    await configureLLM(page);
    await page.click("#btn-toggle-chat");
    await expect(page.locator("#chat-model")).toHaveText("test-model");
    await page.fill("#chat-input", "/model other-model");
    await page.press("#chat-input", "Enter");
    await expect(page.locator("#chat-model")).toHaveText("other-model");
    await expect(page.locator("#chat-model")).toHaveClass(/override/);
    await page.keyboard.press("ControlOrMeta+n");
    await expect(page.locator("#chat-model")).toHaveText("test-model");
    await expect(page.locator("#chat-model")).not.toHaveClass(/override/);
  });
});

test.describe("Info pane", () => {
  test("shows document facts and chat facts for the active tab and follows edits", async ({ page }) => {
    await gotoSimple(page);
    await configureLLM(page);
    await page.click("#btn-toggle-info");
    await expect(page.locator("#info-panel")).toBeVisible();
    await expect(page.locator("#btn-toggle-info")).toHaveAttribute("aria-pressed", "true");
    await expect(infoRow(page, "Name")).toHaveText("Untitled");
    await expect(infoRow(page, "Location")).toHaveText("Unsaved");
    await expect(infoRow(page, "Words")).toHaveText("0");
    await expect(infoRow(page, "Scope")).toHaveText("This document only (Untitled)");
    await expect(infoRow(page, "Memory tools")).toHaveText("Off (not a project file)");
    await expect(infoRow(page, "Provider")).toHaveText("Ollama · localhost:11434");
    await expect(page.locator("#info-model option").first()).toHaveText("Default (test-model)");

    await source(page).fill("# Title\n\nfour more words here");
    await expect(infoRow(page, "Words")).toHaveText("5");
    await expect(infoRow(page, "Headings")).toHaveText("1");
    await expect(infoRow(page, "State")).toHaveText("Unsaved changes");

    // Turns count this chat's messages; Clear resets them.
    await page.click("#btn-toggle-chat");
    await page.fill("#chat-input", "hi");
    await page.press("#chat-input", "Enter");
    await expect(page.locator("#chat-send")).toHaveText("Send", { timeout: 5000 });
    await expect(infoRow(page, "Turns")).toHaveText("1");
    await page.click("#info-clear-chat");
    await expect(infoRow(page, "Turns")).toHaveText("0");
    await expect(page.locator(".chat-msg.user")).toHaveCount(0);
    await expect(page.locator(".chat-msg.assistant")).toHaveCount(1); // welcome again

    await page.keyboard.press("ControlOrMeta+Shift+i");
    await expect(page.locator("#info-panel")).toBeHidden();
  });
});

test.describe("Project chat", () => {
  test("View → Project Chat opens a project tab whose chat has the project's files", async ({ page }) => {
    await gotoProject(page);
    await configureLLM(page);
    await page.click("#btn-view-menu");
    await expect(page.locator("#btn-project-chat")).toBeVisible();
    await page.click("#btn-project-chat");

    await expect(activeTab(page).locator(".tab-title")).toHaveText("Project");
    await expect(page.locator("#chat-panel")).toBeVisible();
    await expect(page.locator("#chat-scope")).toHaveText("Project chat");
    await expect(page.locator("#chat-panel")).toHaveClass(/project-scope/);
    await expect(page.locator("#editor-container")).toBeHidden();
    await expect(page.locator("#status-file")).toContainText("project chat");
    await expect(page.locator("#chat-input")).toHaveAttribute("placeholder", "Ask about the project…");

    await page.fill("#chat-input", "/tools");
    await page.press("#chat-input", "Enter");
    const last = page.locator(".chat-msg.assistant").last();
    await expect(last).toContainText("project chat");
    await expect(last).toContainText("File:");
    await expect(last).not.toContainText("Document:");

    // The chat pane cannot be closed on the project tab.
    await page.click("#btn-toggle-chat");
    await expect(page.locator("#chat-panel")).toBeVisible();

    // Opening a file from the tree leaves the project tab in place; coming back finds the same chat.
    await page.locator(".file-tree-item").first().click();
    await expect(page.locator("#editor-container")).toBeVisible();
    await expect(page.locator("#chat-scope")).toHaveText("Document chat");
    await page.locator("#tab-list .editor-tab").filter({ hasText: "Project" }).click();
    await expect(page.locator(".chat-msg.assistant").last()).toContainText("File:");

    // Only one project tab ever.
    await page.click("#btn-view-menu");
    await page.click("#btn-project-chat");
    await expect(page.locator("#tab-list .editor-tab").filter({ hasText: "Project" })).toHaveCount(1);
  });

  test("the info pane describes the project on the project tab", async ({ page }) => {
    await gotoProject(page);
    await page.click("#btn-view-menu");
    await page.click("#btn-project-chat");
    await page.click("#btn-toggle-info");
    await expect(infoRow(page, "Root")).toHaveText("/test/project");
    await expect(infoRow(page, "Scope")).toHaveText("Project: files under the root");
    await expect(infoRow(page, "Memory tools")).toHaveText("Project scratchpad");
  });
});

test.describe("Chat history in quikleaf.prj", () => {
  test("a project file's chat and layout are saved with the project", async ({ page }) => {
    await gotoProject(page);
    await configureLLM(page);
    await page.locator(".file-tree-item").filter({ hasText: "notes.md" }).click();
    await page.click("#btn-toggle-chat");
    await page.fill("#chat-input", "remember me");
    await page.press("#chat-input", "Enter");
    await expect(page.locator("#chat-send")).toHaveText("Send", { timeout: 5000 });
    await expect
      .poll(() => page.evaluate(() => (window as any).__E2E__.projectSaves.at(-1)?.chatHistory?.tabs?.["notes.md"]))
      .toMatchObject({
        transcript: [
          { role: "user", text: "remember me" },
          { role: "assistant", text: "Mock streamed response" },
        ],
        model: null,
        view: { chat: true, info: false, mode: "split" },
      });
  });

  test("chats come back on relaunch for the files that are reopened", async ({ page }) => {
    await gotoProject(page, {
      launchInfo: { type: "Project", project_root: "/test/project", project_file: "/test/project/quikleaf.prj", exists: true },
      projectData: {
        openFile: "notes.md",
        openTabs: ["readme.md", "notes.md"],
        chatHistory: {
          version: 1,
          tabs: {
            "notes.md": {
              transcript: [{ role: "user", text: "old question" }, { role: "assistant", text: "old answer" }],
              model: "saved-model",
              view: { chat: true, info: true, mode: "preview" },
            },
            "gone.md": { transcript: [{ role: "user", text: "lost" }], model: null },
          },
          project: { transcript: [{ role: "user", text: "project memory" }], model: null },
        },
      },
      fsStore: { "readme.md": "# Hello World", "notes.md": "# Notes" },
    });
    await configureLLM(page);
    await expect(activeTab(page).locator(".tab-title")).toHaveText("notes.md");
    await expect(page.locator("#chat-panel")).toBeVisible();
    await expect(page.locator("#info-panel")).toBeVisible();
    await expect(page.locator("#editor-container .qde-source")).toBeHidden(); // preview
    await expect(page.locator(".chat-msg.user .chat-body")).toHaveText("old question");
    await expect(page.locator(".chat-msg.assistant").last()).toContainText("old answer");
    await expect(page.locator("#chat-model")).toHaveText("saved-model");
    await expect(infoRow(page, "Turns")).toHaveText("1");

    // readme.md had no saved chat: fresh welcome, default layout, no leak from notes.md.
    await page.locator("#tab-list .editor-tab").filter({ hasText: "readme.md" }).click();
    await expect(page.locator("#chat-panel")).toBeHidden();
    await page.click("#btn-toggle-chat");
    await expect(page.locator(".chat-msg.user")).toHaveCount(0);
    await expect(page.locator("#chat-model")).toHaveText("test-model");

    // The project chat's history is there once its tab is opened.
    await page.click("#btn-view-menu");
    await page.click("#btn-project-chat");
    await expect(page.locator(".chat-msg.user .chat-body")).toHaveText("project memory");
  });
});
