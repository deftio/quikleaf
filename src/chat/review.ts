/**
 * Proposed-edit review cards.
 *
 * When the model wants to replace the document or write a project file, the
 * tool loop can pause and show the change as a diff card in the chat log with
 * Accept / Reject buttons. `requestApproval()` resolves with the user's
 * decision; `showAppliedDiff()` renders the same card without buttons for
 * edits that were applied directly; `cancelPendingReviews()` rejects every
 * open card (the Stop button).
 *
 * Everything here is bitwrench TACO appended to `#chat-messages`.
 */
import bw from "bitwrench";
import type { Taco } from "bitwrench";
import { el, withAttrs } from "../ui/taco";
import { collapseContext, diffLines, summarizeDiff, type DiffRow, type DiffSummary } from "./diff";

export interface ReviewRequest {
  kind: "document" | "file";
  /** Project-relative path, for `kind: "file"`. */
  path?: string;
  before: string;
  after: string;
}

export type ReviewOutcome = "accepted" | "rejected" | "cancelled";

/** Rows rendered per card before the view is cut off with a marker. */
export const MAX_DIFF_ROWS = 500;
/** Unchanged lines kept around each change. */
export const DIFF_CONTEXT = 3;

interface Pending {
  root: HTMLElement;
  resolve: (ok: boolean) => void;
}

let counter = 0;
const pending = new Map<number, Pending>();

function logEl(): HTMLElement {
  const log = el("chat-messages");
  if (!log) throw new Error("quikleaf: #chat-messages is not mounted");
  return log;
}

function scrollToBottom(log: HTMLElement) {
  log.scrollTop = log.scrollHeight;
}

/** "the document" or the file path, for headers and status lines. */
function target(req: ReviewRequest): string {
  return req.kind === "document" ? "the document" : (req.path ?? "a file");
}

function headerText(req: ReviewRequest, mode: "proposed" | "applied"): string {
  if (mode === "applied") return req.kind === "document" ? "QD replaced the document" : `QD wrote ${req.path ?? "a file"}`;
  return req.kind === "document" ? "QD proposes to replace the document" : `QD proposes to write ${req.path ?? "a file"}`;
}

export function summaryTaco(summary: DiffSummary): Taco {
  return {
    t: "div",
    a: { class: "review-summary" },
    c: [
      { t: "span", a: { class: "diff-added" }, c: `+${summary.added}` },
      { t: "span", a: { class: "diff-removed" }, c: `−${summary.removed}` },
    ],
  };
}

function rowTaco(row: DiffRow): Taco {
  if (row.type === "skip") {
    return { t: "div", a: { class: "diff-line diff-skip" }, c: `… ${row.count} unchanged line${row.count === 1 ? "" : "s"} …` };
  }
  const sign = row.type === "add" ? "+" : row.type === "del" ? "−" : " ";
  return {
    t: "div",
    a: { class: `diff-line diff-${row.type}` },
    c: [
      { t: "span", a: { class: "diff-sign" }, c: sign },
      { t: "span", a: { class: "diff-text" }, c: row.text === "" ? " " : row.text },
    ],
  };
}

/** The scrollable diff view: collapsed context, capped row count. */
export function diffViewTaco(before: string, after: string): { view: Taco; summary: DiffSummary } {
  const hunks = diffLines(before, after);
  const summary = summarizeDiff(hunks);
  let rows: Taco[];
  if (hunks.length === 0) {
    rows = [{ t: "div", a: { class: "diff-line diff-skip" }, c: "(no changes)" }];
  } else {
    const collapsed = collapseContext(hunks, DIFF_CONTEXT);
    rows = collapsed.slice(0, MAX_DIFF_ROWS).map(rowTaco);
    if (collapsed.length > MAX_DIFF_ROWS) {
      rows.push({ t: "div", a: { class: "diff-line diff-skip" }, c: `… ${collapsed.length - MAX_DIFF_ROWS} more lines …` });
    }
  }
  return { view: { t: "div", a: { class: "diff-view", role: "region", "aria-label": "proposed changes" }, c: rows }, summary };
}

function cardTaco(req: ReviewRequest, mode: "proposed" | "applied", n: number, extra: Taco[]): Taco {
  const { view, summary } = diffViewTaco(req.before, req.after);
  return {
    t: "div",
    a: { id: `review-card-${n}`, class: `chat-msg review ${mode === "applied" ? "applied" : "pending"}` },
    c: [
      { t: "div", a: { class: "review-header" }, c: headerText(req, mode) },
      summaryTaco(summary),
      view,
      ...extra,
      { t: "div", a: { id: `review-status-${n}`, class: "review-status" }, c: mode === "applied" ? "Applied" : "" },
    ],
  };
}

function settle(n: number, outcome: ReviewOutcome) {
  const p = pending.get(n);
  if (!p) return;
  pending.delete(n);
  for (const b of Array.from(p.root.querySelectorAll("button"))) (b as HTMLButtonElement).disabled = true;
  bw.removeClass(p.root, "pending");
  bw.addClass(p.root, outcome === "accepted" ? "accepted" : "rejected");
  const status = outcome === "accepted" ? "Accepted — change applied" : outcome === "rejected" ? "Rejected — nothing changed" : "Cancelled — nothing changed";
  bw.patch(`review-status-${n}`, status);
  p.resolve(outcome === "accepted");
}

/**
 * Show a review card and wait for Accept or Reject. Resolves `true` when the
 * user accepts; `false` on Reject or when `cancelPendingReviews()` runs.
 */
export function requestApproval(req: ReviewRequest): Promise<boolean> {
  const log = logEl();
  const n = ++counter;
  const actions: Taco = {
    t: "div",
    a: { class: "review-actions" },
    c: [
      withAttrs(bw.makeButton({ text: "Accept", variant: "success", size: "sm", onclick: () => settle(n, "accepted") }), {
        id: `review-accept-${n}`,
      }),
      withAttrs(bw.makeButton({ text: "Reject", variant: "secondary", size: "sm", onclick: () => settle(n, "rejected") }), {
        id: `review-reject-${n}`,
      }),
    ],
  };
  return new Promise<boolean>((resolve) => {
    const root = bw.append(log, cardTaco(req, "proposed", n, [actions]));
    pending.set(n, { root, resolve });
    scrollToBottom(log);
  });
}

/** Show what an already-applied edit changed (no buttons). */
export function showAppliedDiff(req: ReviewRequest): HTMLElement {
  const log = logEl();
  const n = ++counter;
  const root = bw.append(log, cardTaco(req, "applied", n, []));
  scrollToBottom(log);
  return root;
}

/** Reject every open review (user pressed Stop). Returns how many were cancelled. */
export function cancelPendingReviews(): number {
  const ids = Array.from(pending.keys());
  for (const n of ids) settle(n, "cancelled");
  return ids.length;
}

/** Number of cards still waiting for a decision. */
export function pendingReviewCount(): number {
  return pending.size;
}

/** The result string a tool returns when the user declines a change. */
export const REJECTED_RESULT = JSON.stringify({ success: false, rejected: true, message: "User rejected the change" });

/** Describe `target()` for callers that build messages around a review. */
export function describeTarget(req: ReviewRequest): string {
  return target(req);
}
