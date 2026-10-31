import { test, expect, type Page } from "@playwright/test";

/**
 * Agentic chat features driven through the mock LLM stream:
 *   - proposed-edit review cards (Accept / Reject) around file_write
 *   - the plan card (plan_set / plan_update)
 *   - project_search against the in-memory file store
 *
 * Each test installs a `customStreamHandler` that answers the Nth LLM turn
 * with a scripted tool call (OpenAI shape) and then a plain reply.
 */

type ToolCall = { id: string; name: string; args: Record<string, unknown> };
type Turn = { toolCalls?: ToolCall[]; text?: string };

const PROJECT_PRECONFIG = {
  launchInfo: { type: "Project", project_root: "/test/project", project_file: "/test/project/quikleaf.prj", exists: false },
  fsStore: {
    "readme.md": "# Hello\n\nA markdown project.\n",
    "docs/guide.md": "# Guide\n\nMarkdown guide text.\nAnother MARKDOWN line.\n",
    "notes.txt": "plain notes\n",
  },
};

/** Script the mock stream: turn N emits `turns[N]` (tool calls or text). */
async function scriptTurns(page: Page, turns: Turn[]) {
  await page.evaluate((script) => {
    const w = window as any;
    const bus = w.__E2E_EVENTS__;
    let n = 0;
    w.__E2E__.customStreamHandler = () => {
      const turn = script[Math.min(n, script.length - 1)];
      n++;
      setTimeout(() => {
        if (turn.toolCalls && turn.toolCalls.length) {
          bus.emit("llm-done", {
            full_text: "",
            tool_calls: turn.toolCalls.map((tc: any) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: JSON.stringify(tc.args) },
            })),
            error: null,
          });
        } else {
          const text = turn.text ?? "done";
          bus.emit("llm-chunk", { token: text });
          bus.emit("llm-done", { full_text: text, tool_calls: [], error: null });
        }
      }, 20);
    };
  }, turns);
}

async function invokeLog(page: Page, cmd: string) {
  return page.evaluate((c) => (window as any).__E2E__.invokeLog.filter((l: any) => l.cmd === c), cmd);
}

async function configureLLM(page: Page, extra: Record<string, unknown> = {}) {
  await page.evaluate((x) => {
    localStorage.setItem(
      "quikleaf_llm_settings",
      JSON.stringify({ provider: "openai-compatible", host: "http://localhost:11434", apiKey: "", model: "test-model", showToolCalls: true, ...x }),
    );
  }, extra);
}

async function send(page: Page, text: string) {
  await page.fill("#chat-input", text);
  await page.click("#chat-send");
}

const idle = (page: Page) => expect(page.locator("#chat-send")).toHaveText("Send", { timeout: 5000 });

test.describe("Proposed-edit review (project mode)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((pre) => {
      (window as any).__E2E_PRECONFIG__ = pre;
    }, PROJECT_PRECONFIG);
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await expect(page.locator("#file-tree")).toBeVisible({ timeout: 5000 });
    await configureLLM(page);
    await page.click("#btn-toggle-chat");
    await expect(page.locator("#chat-panel")).toBeVisible();
  });

  test("file_write shows a diff card; Reject returns a rejected tool result and writes nothing", async ({ page }) => {
    await scriptTurns(page, [
      { toolCalls: [{ id: "c1", name: "file_write", args: { path: "readme.md", content: "# Hello\n\nA markdown project.\n\nNew closing line.\n" } }] },
      { text: "Understood, I will leave it." },
    ]);
    await send(page, "add a closing line to the readme");

    const card = page.locator(".chat-msg.review").first();
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/pending/);
    await expect(card.locator(".review-header")).toHaveText("QD proposes to write readme.md");
    await expect(card.locator(".diff-added")).toHaveText("+2");
    await expect(card.locator(".diff-removed")).toHaveText("−0");
    await expect(card.locator(".diff-view .diff-add .diff-text").last()).toHaveText("New closing line.");
    await expect(card.locator(".diff-view .diff-same")).toHaveCount(3);
    // The loop is paused on the card: the Send button still shows Stop.
    await expect(page.locator("#chat-send")).toHaveText("Stop");

    await card.locator('[id^="review-reject-"]').click();
    await expect(card).toHaveClass(/rejected/);
    await expect(card.locator(".review-status")).toContainText("Rejected");
    await expect(card.locator('[id^="review-accept-"]')).toBeDisabled();

    await idle(page);
    const tool = page.locator(".chat-msg.tool").first();
    await expect(tool).toContainText("file_write()");
    await expect(tool).toContainText('"rejected":true');
    await expect(page.locator(".chat-msg.assistant").last()).toContainText("leave it");

    expect(await invokeLog(page, "file_write")).toHaveLength(0);
    const store = await page.evaluate(() => (window as any).__E2E__.fsStore["readme.md"]);
    expect(store).toBe(PROJECT_PRECONFIG.fsStore["readme.md"]);
  });

  test("Accept applies the write and the tool result reports success", async ({ page }) => {
    await scriptTurns(page, [
      { toolCalls: [{ id: "c1", name: "file_write", args: { path: "notes/new.md", content: "# New\n" } }] },
      { text: "Created notes/new.md." },
    ]);
    await send(page, "create a new note");

    const card = page.locator(".chat-msg.review").first();
    await expect(card.locator(".review-header")).toHaveText("QD proposes to write notes/new.md");
    await expect(card.locator(".diff-added")).toHaveText("+1");
    await card.locator('[id^="review-accept-"]').click();
    await expect(card).toHaveClass(/accepted/);
    await expect(card.locator(".review-status")).toContainText("Accepted");

    await idle(page);
    const writes = await invokeLog(page, "file_write");
    expect(writes).toHaveLength(1);
    expect(writes[0].args).toEqual({ path: "notes/new.md", content: "# New\n" });
    await expect(page.locator(".chat-msg.tool").first()).toContainText('"success":true');
    const store = await page.evaluate(() => (window as any).__E2E__.fsStore["notes/new.md"]);
    expect(store).toBe("# New\n");
  });

  test("Stop cancels a pending review", async ({ page }) => {
    await scriptTurns(page, [{ toolCalls: [{ id: "c1", name: "file_write", args: { path: "readme.md", content: "x" } }] }, { text: "never" }]);
    await send(page, "rewrite");
    const card = page.locator(".chat-msg.review").first();
    await expect(card).toHaveClass(/pending/);
    await page.click("#chat-send"); // Stop
    await expect(card).toHaveClass(/rejected/);
    await expect(card.locator(".review-status")).toContainText("Cancelled");
    await idle(page);
    await expect(page.locator(".chat-msg.assistant").last()).toContainText("Stopped by user");
    expect(await invokeLog(page, "file_write")).toHaveLength(0);
  });

  test("with approval set to never, file_write applies directly without a card", async ({ page }) => {
    await configureLLM(page, { editApproval: "never" });
    await scriptTurns(page, [{ toolCalls: [{ id: "c1", name: "file_write", args: { path: "notes.txt", content: "replaced" } }] }, { text: "ok" }]);
    await send(page, "overwrite notes");
    await idle(page);
    await expect(page.locator(".chat-msg.review")).toHaveCount(0);
    expect(await invokeLog(page, "file_write")).toHaveLength(1);
  });

  test("the Agent setting is offered in Settings and persists", async ({ page }) => {
    await page.click("#btn-settings");
    const sel = page.locator("#set-edit-approval");
    await expect(sel).toHaveValue("files");
    await sel.selectOption("always");
    await page.click("#settings-save");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("quikleaf_llm_settings") || "{}"));
    expect(saved.editApproval).toBe("always");
  });

  test("project_search returns matching lines from the project files", async ({ page }) => {
    await scriptTurns(page, [
      { toolCalls: [{ id: "s1", name: "project_search", args: { query: "markdown", max_results: 1 } }] },
      { text: "Found it in the guide and the readme." },
    ]);
    await send(page, "where is markdown mentioned?");
    await idle(page);
    const calls = await invokeLog(page, "project_search");
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual({ query: "markdown", path: null, regex: false, maxResults: 1 });
    const tool = page.locator(".chat-msg.tool").first();
    await expect(tool).toContainText("project_search()");
    await expect(tool).toContainText('"path":"readme.md","line":3,"text":"A markdown project."');
    await expect(tool).toContainText('"truncated":true');
  });
});

test.describe("Plan card and document tools (simple mode)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor-container", { state: "visible" });
    await configureLLM(page);
    await page.click("#btn-toggle-chat");
    await expect(page.locator("#chat-panel")).toBeVisible();
  });

  test("plan_set renders one card that plan_update changes in place", async ({ page }) => {
    await scriptTurns(page, [
      { toolCalls: [{ id: "p1", name: "plan_set", args: { title: "Tidy the doc", steps: ["Read it", "Fix headings", "Report back"] } }] },
      { toolCalls: [{ id: "p2", name: "plan_update", args: { index: 0, status: "done" } }, { id: "p3", name: "plan_update", args: { index: 1, status: "active", note: "in progress" } }] },
      { text: "Working through the plan." },
    ]);
    await send(page, "tidy up this document");
    await idle(page);

    const card = page.locator("#plan-card");
    await expect(card).toHaveCount(1);
    await expect(card).toHaveClass(/plan/);
    await expect(card.locator(".plan-title")).toHaveText("Tidy the doc");
    await expect(card.locator(".plan-step")).toHaveCount(3);
    await expect(card.locator(".plan-step").nth(0)).toHaveClass(/done/);
    await expect(card.locator(".plan-step").nth(0).locator(".plan-glyph")).toHaveText("●");
    await expect(card.locator(".plan-step").nth(1)).toHaveClass(/active/);
    await expect(card.locator(".plan-step").nth(1).locator(".plan-note")).toHaveText("in progress");
    await expect(card.locator(".plan-step").nth(2)).toHaveClass(/pending/);
    await expect(card.locator(".plan-progress")).toHaveText("1/3");
    // The card sits where plan_set first ran: right after the user's message.
    const order = await page.locator("#chat-messages > .chat-msg").evaluateAll((els) => els.map((e) => e.className));
    expect(order.indexOf("chat-msg plan")).toBeLessThan(order.findIndex((c) => c.includes("tool")));
  });

  test("document_write with default approval applies directly and shows an applied diff card", async ({ page }) => {
    await scriptTurns(page, [
      { toolCalls: [{ id: "d1", name: "document_write", args: { content: "# Fresh\n\nBody.\n" } }] },
      { text: "Rewrote the document." },
    ]);
    await send(page, "rewrite the doc");
    await idle(page);
    const card = page.locator(".chat-msg.review").first();
    await expect(card).toHaveClass(/applied/);
    await expect(card.locator(".review-header")).toHaveText("QD replaced the document");
    await expect(card.locator("button")).toHaveCount(0);
    await expect(card.locator(".diff-added")).toHaveText("+3");
    await expect(page.locator(".chat-msg.tool").first()).toContainText('"success":true');
  });

  test("document_write with approval 'always' waits for the card", async ({ page }) => {
    await configureLLM(page, { editApproval: "always" });
    await scriptTurns(page, [
      { toolCalls: [{ id: "d1", name: "document_write", args: { content: "# Replaced\n" } }] },
      { text: "Done." },
    ]);
    await send(page, "replace everything");
    const card = page.locator(".chat-msg.review").first();
    await expect(card.locator(".review-header")).toHaveText("QD proposes to replace the document");
    await expect(card).toHaveClass(/pending/);
    await card.locator('[id^="review-accept-"]').click();
    await idle(page);
    await expect(card).toHaveClass(/accepted/);
    await expect(page.locator(".chat-msg.tool").first()).toContainText('"success":true');
  });

  test("document_outline lists the headings of the current document", async ({ page }) => {
    await page.evaluate(() => {
      const ta = document.querySelector(".qde-textarea, #editor-container textarea") as HTMLTextAreaElement | null;
      if (ta) {
        ta.value = "# Top\n\ntext\n\n## Second\n";
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await scriptTurns(page, [{ toolCalls: [{ id: "o1", name: "document_outline", args: {} }] }, { text: "Two headings." }]);
    await send(page, "what sections are there?");
    await idle(page);
    const tool = page.locator(".chat-msg.tool").first();
    await expect(tool).toContainText("document_outline()");
    await expect(tool).toContainText('"headings":[');
  });

  test("/tools lists the plan and outline tools", async ({ page }) => {
    await send(page, "/tools");
    const last = page.locator(".chat-msg.assistant").last();
    await expect(last).toContainText("Plan:");
    await expect(last).toContainText("outline");
  });
});
