/**
 * Review cards: rendering, Accept/Reject, cancel-on-Stop, applied cards and
 * the diff view's collapsing/capping. Mounted into the `#chat-messages` the
 * test setup pre-creates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { appendEl } from "../ui/taco";
import {
  DIFF_CONTEXT,
  MAX_DIFF_ROWS,
  REJECTED_RESULT,
  cancelPendingReviews,
  describeTarget,
  diffViewTaco,
  pendingReviewCount,
  requestApproval,
  showAppliedDiff,
  summaryTaco,
} from "./review";

function log(): HTMLElement {
  return document.getElementById("chat-messages")!;
}
function cards(): HTMLElement[] {
  return Array.from(log().querySelectorAll(".chat-msg.review")) as HTMLElement[];
}
function lines(card: HTMLElement, cls: string): string[] {
  return Array.from(card.querySelectorAll(`.diff-view .${cls} .diff-text`)).map((n) => n.textContent ?? "");
}
function button(card: HTMLElement, which: "accept" | "reject"): HTMLButtonElement {
  return card.querySelector(`[id^="review-${which}-"]`) as HTMLButtonElement;
}
function status(card: HTMLElement): string {
  return card.querySelector(".review-status")!.textContent ?? "";
}
/** Settle microtasks so a resolved promise's `.then` has run. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  bw.clear(log());
  log().scrollTop = 0;
});

afterEach(() => {
  cancelPendingReviews();
  bw.clear(log());
});

describe("requestApproval", () => {
  it("renders a document card with header, summary, diff and both buttons", async () => {
    const p = requestApproval({ kind: "document", before: "a\nb\nc", after: "a\nB\nc" });
    const [card] = cards();
    expect(card).toBeDefined();
    expect(card.classList.contains("pending")).toBe(true);
    expect(card.querySelector(".review-header")!.textContent).toBe("QD proposes to replace the document");
    expect(card.querySelector(".diff-added")!.textContent).toBe("+1");
    expect(card.querySelector(".diff-removed")!.textContent).toBe("−1");
    expect(lines(card, "diff-same")).toEqual(["a", "c"]);
    expect(lines(card, "diff-del")).toEqual(["b"]);
    expect(lines(card, "diff-add")).toEqual(["B"]);
    expect(button(card, "accept").textContent).toBe("Accept");
    expect(button(card, "accept").classList.contains("bw_success")).toBe(true);
    expect(button(card, "reject").textContent).toBe("Reject");
    expect(button(card, "reject").classList.contains("bw_secondary")).toBe(true);
    expect(status(card)).toBe("");
    expect(pendingReviewCount()).toBe(1);

    button(card, "accept").click();
    await expect(p).resolves.toBe(true);
  });

  it("names the file in a file card", () => {
    void requestApproval({ kind: "file", path: "notes/todo.md", before: "", after: "# Todo" });
    const [card] = cards();
    expect(card.querySelector(".review-header")!.textContent).toBe("QD proposes to write notes/todo.md");
    expect(lines(card, "diff-add")).toEqual(["# Todo"]);
    expect(card.querySelector(".diff-removed")!.textContent).toBe("−0");
  });

  it("Accept resolves true, disables the buttons and marks the card accepted", async () => {
    const p = requestApproval({ kind: "document", before: "x", after: "y" });
    const [card] = cards();
    button(card, "accept").click();
    expect(await p).toBe(true);
    expect(card.classList.contains("accepted")).toBe(true);
    expect(card.classList.contains("pending")).toBe(false);
    expect(button(card, "accept").disabled).toBe(true);
    expect(button(card, "reject").disabled).toBe(true);
    expect(status(card)).toBe("Accepted — change applied");
    expect(pendingReviewCount()).toBe(0);
  });

  it("Reject resolves false and marks the card rejected", async () => {
    const p = requestApproval({ kind: "document", before: "x", after: "y" });
    const [card] = cards();
    button(card, "reject").click();
    expect(await p).toBe(false);
    expect(card.classList.contains("rejected")).toBe(true);
    expect(status(card)).toBe("Rejected — nothing changed");
  });

  it("ignores a second click once settled", async () => {
    const p = requestApproval({ kind: "document", before: "x", after: "y" });
    const [card] = cards();
    button(card, "reject").click();
    button(card, "accept").click();
    expect(await p).toBe(false);
    expect(card.classList.contains("rejected")).toBe(true);
    expect(card.classList.contains("accepted")).toBe(false);
  });

  it("gives every card unique button ids", () => {
    void requestApproval({ kind: "document", before: "1", after: "2" });
    void requestApproval({ kind: "document", before: "3", after: "4" });
    const [a, b] = cards();
    expect(a.id).not.toBe(b.id);
    expect(button(a, "accept").id).not.toBe(button(b, "accept").id);
    expect(button(a, "accept").id).toMatch(/^review-accept-\d+$/);
    expect(button(a, "reject").id).toMatch(/^review-reject-\d+$/);
  });

  it("scrolls the log to the bottom", () => {
    const l = log();
    Object.defineProperty(l, "scrollHeight", { value: 999, configurable: true });
    void requestApproval({ kind: "document", before: "x", after: "y" });
    expect(l.scrollTop).toBe(999);
  });

  it("throws when the chat log is not mounted", () => {
    const l = log();
    l.remove();
    try {
      expect(() => requestApproval({ kind: "document", before: "", after: "" })).toThrow(/not mounted/);
    } finally {
      document.body.appendChild(l);
    }
  });
});

describe("cancelPendingReviews", () => {
  it("rejects every open card with a cancelled status and reports the count", async () => {
    const p1 = requestApproval({ kind: "document", before: "a", after: "b" });
    const p2 = requestApproval({ kind: "file", path: "f", before: "a", after: "b" });
    expect(pendingReviewCount()).toBe(2);
    expect(cancelPendingReviews()).toBe(2);
    expect(await p1).toBe(false);
    expect(await p2).toBe(false);
    for (const card of cards()) {
      expect(card.classList.contains("rejected")).toBe(true);
      expect(status(card)).toBe("Cancelled — nothing changed");
      expect(button(card, "accept").disabled).toBe(true);
    }
    expect(pendingReviewCount()).toBe(0);
  });

  it("returns 0 when nothing is pending and leaves settled cards alone", async () => {
    const p = requestApproval({ kind: "document", before: "a", after: "b" });
    button(cards()[0], "accept").click();
    await p;
    expect(cancelPendingReviews()).toBe(0);
    expect(status(cards()[0])).toBe("Accepted — change applied");
  });
});

describe("showAppliedDiff", () => {
  it("renders a buttonless card marked applied", () => {
    const root = showAppliedDiff({ kind: "document", before: "a\nb", after: "a\nc" });
    expect(root.classList.contains("review")).toBe(true);
    expect(root.classList.contains("applied")).toBe(true);
    expect(root.querySelector(".review-header")!.textContent).toBe("QD replaced the document");
    expect(root.querySelector("button")).toBeNull();
    expect(status(root)).toBe("Applied");
    expect(lines(root, "diff-del")).toEqual(["b"]);
    expect(lines(root, "diff-add")).toEqual(["c"]);
    expect(pendingReviewCount()).toBe(0);
  });

  it("names the file for a file write", () => {
    const root = showAppliedDiff({ kind: "file", path: "a.md", before: "", after: "x" });
    expect(root.querySelector(".review-header")!.textContent).toBe("QD wrote a.md");
  });

  it("falls back to 'a file' when no path is given", () => {
    const root = showAppliedDiff({ kind: "file", before: "", after: "x" });
    expect(root.querySelector(".review-header")!.textContent).toBe("QD wrote a file");
    void requestApproval({ kind: "file", before: "", after: "x" });
    expect(cards()[1].querySelector(".review-header")!.textContent).toBe("QD proposes to write a file");
  });
});

describe("diffViewTaco", () => {
  function mount(before: string, after: string): HTMLElement {
    const { view } = diffViewTaco(before, after);
    return appendEl(log(), view);
  }
  function rowTexts(view: HTMLElement): string[] {
    return Array.from(view.querySelectorAll(".diff-line")).map((n) => n.textContent ?? "");
  }

  it("shows '(no changes)' for two empty documents", () => {
    const view = mount("", "");
    expect(rowTexts(view)).toEqual(["(no changes)"]);
    expect(diffViewTaco("", "").summary).toEqual({ added: 0, removed: 0 });
  });

  it("collapses unchanged context to DIFF_CONTEXT lines with a marker", () => {
    const linesArr = Array.from({ length: 30 }, (_, i) => `l${i}`);
    const edited = [...linesArr];
    edited[15] = "X";
    const view = mount(linesArr.join("\n"), edited.join("\n"));
    const skips = Array.from(view.querySelectorAll(".diff-skip")).map((n) => n.textContent);
    expect(skips).toEqual([`… ${15 - DIFF_CONTEXT} unchanged lines …`, `… ${14 - DIFF_CONTEXT} unchanged lines …`]);
    expect(view.querySelectorAll(".diff-same").length).toBe(2 * DIFF_CONTEXT);
    expect(view.querySelectorAll(".diff-del").length).toBe(1);
    expect(view.querySelectorAll(".diff-add").length).toBe(1);
  });

  it("uses the singular for one hidden line", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const view = mount(`X\n${before}\nY`, `Z\n${before}\nW`);
    expect(Array.from(view.querySelectorAll(".diff-skip")).map((n) => n.textContent)).toEqual(["… 2 unchanged lines …"]);
    const single = mount(`X\n${before}\nz\nY`, `Z\n${before}\nz\nW`);
    expect(Array.from(single.querySelectorAll(".diff-skip")).map((n) => n.textContent)).toEqual(["… 3 unchanged lines …"]);
    const one = mount("X\na\nb\nc\nd\ne\nf\ng\nY", "Z\na\nb\nc\nd\ne\nf\ng\nW");
    expect(Array.from(one.querySelectorAll(".diff-skip")).map((n) => n.textContent)).toEqual(["… 1 unchanged line …"]);
  });

  it("renders empty lines as a single space so rows keep their height", () => {
    const view = mount("a\n\nb", "a\n\nc");
    const same = Array.from(view.querySelectorAll(".diff-same .diff-text")).map((n) => n.textContent);
    expect(same).toEqual(["a", " "]);
  });

  it("caps the rendered rows and reports how many more there are", () => {
    const after = Array.from({ length: MAX_DIFF_ROWS + 25 }, (_, i) => `new ${i}`).join("\n");
    const view = mount("", after);
    const rows = view.querySelectorAll(".diff-line");
    expect(rows.length).toBe(MAX_DIFF_ROWS + 1);
    expect(rows[rows.length - 1].textContent).toBe("… 25 more lines …");
    expect(rows[rows.length - 1].classList.contains("diff-skip")).toBe(true);
  });

  it("marks the view as a labelled region", () => {
    const view = mount("a", "b");
    expect(view.getAttribute("role")).toBe("region");
    expect(view.getAttribute("aria-label")).toBe("proposed changes");
  });
});

describe("helpers", () => {
  it("summaryTaco renders +N −M", () => {
    const node = appendEl(log(), summaryTaco({ added: 4, removed: 2 }));
    expect(node.textContent).toBe("+4−2");
  });

  it("REJECTED_RESULT is the agreed JSON shape", () => {
    expect(JSON.parse(REJECTED_RESULT)).toEqual({ success: false, rejected: true, message: "User rejected the change" });
  });

  it("describeTarget names the document or the path", () => {
    expect(describeTarget({ kind: "document", before: "", after: "" })).toBe("the document");
    expect(describeTarget({ kind: "file", path: "x.md", before: "", after: "" })).toBe("x.md");
    expect(describeTarget({ kind: "file", before: "", after: "" })).toBe("a file");
  });

  it("vi is available for timing helpers", async () => {
    const spy = vi.fn();
    const p = requestApproval({ kind: "document", before: "a", after: "b" }).then(spy);
    expect(spy).not.toHaveBeenCalled();
    button(cards()[0], "accept").click();
    await p;
    await tick();
    expect(spy).toHaveBeenCalledWith(true);
  });
});
