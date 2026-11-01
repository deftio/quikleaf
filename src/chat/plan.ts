/**
 * The agent's plan card: one `.chat-msg.plan` (`#plan-card`) placed in the
 * chat log where `plan_set` was first called and updated in place by
 * `plan_update`. Pure state lives in `getPlan()`; rendering is TACO patched
 * with `bw.patch`.
 */
import bw from "bitwrench";
import type { Taco } from "bitwrench";
import { el } from "../ui/taco";

export type StepStatus = "pending" | "active" | "done" | "skipped";

export interface PlanStep {
  text: string;
  status: StepStatus;
  note?: string;
}

export interface Plan {
  title: string;
  steps: PlanStep[];
}

export const STEP_STATUSES: StepStatus[] = ["pending", "active", "done", "skipped"];
export const STEP_GLYPH: Record<StepStatus, string> = { pending: "○", active: "◐", done: "●", skipped: "⊘" };

const CARD_ID = "plan-card";
const MAX_STEPS = 50;

let plan: Plan | null = null;

export function getPlan(): Plan | null {
  return plan ? { title: plan.title, steps: plan.steps.map((s) => ({ ...s })) } : null;
}

/** Forget the plan and remove its card if one is mounted. */
export function resetPlan(): void {
  plan = null;
  const card = el(CARD_ID);
  if (card) bw.remove(card);
}

function stepTaco(step: PlanStep, i: number): Taco {
  const c: Taco[] = [
    { t: "span", a: { class: "plan-glyph", "aria-hidden": "true" }, c: STEP_GLYPH[step.status] },
    { t: "span", a: { class: "plan-text" }, c: step.text },
  ];
  if (step.note) c.push({ t: "span", a: { class: "plan-note" }, c: step.note });
  return { t: "li", a: { class: `plan-step ${step.status}`, "data-index": String(i), "data-status": step.status }, c };
}

function progress(p: Plan): string {
  const done = p.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return `${done}/${p.steps.length}`;
}

function contentTaco(p: Plan): Taco[] {
  return [
    {
      t: "div",
      a: { class: "plan-header" },
      c: [
        { t: "span", a: { class: "plan-title" }, c: p.title },
        { t: "span", a: { class: "plan-progress" }, c: progress(p) },
      ],
    },
    { t: "ol", a: { class: "plan-steps" }, c: p.steps.map(stepTaco) },
  ];
}

/** Create the card at the end of the log, or patch the existing one in place. */
function render(p: Plan): void {
  const existing = el(CARD_ID);
  if (existing) {
    bw.patch(existing, contentTaco(p));
    return;
  }
  const log = el("chat-messages");
  if (!log) return;
  bw.append(log, { t: "div", a: { id: CARD_ID, class: "chat-msg plan" }, c: contentTaco(p) });
  log.scrollTop = log.scrollHeight;
}

/** `plan_set` tool: replace the plan (title optional) and render it. */
export function planSet(args: { title?: unknown; steps?: unknown }): string {
  const raw = Array.isArray(args?.steps) ? args.steps : null;
  if (!raw || raw.length === 0) return JSON.stringify({ error: "plan_set needs a non-empty steps array" });
  const steps: PlanStep[] = raw
    .slice(0, MAX_STEPS)
    .map((s) => String(s ?? "").trim())
    .filter((s) => s.length > 0)
    .map((text) => ({ text, status: "pending" as StepStatus }));
  if (steps.length === 0) return JSON.stringify({ error: "plan_set needs at least one non-empty step" });
  const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : "Plan";
  plan = { title, steps };
  render(plan);
  return JSON.stringify({ success: true, title, steps: steps.length });
}

/** `plan_update` tool: change one step's status (and optional note). */
export function planUpdate(args: { index?: unknown; status?: unknown; note?: unknown }): string {
  if (!plan) return JSON.stringify({ error: "No plan set. Call plan_set first." });
  const index = typeof args?.index === "number" ? args.index : Number(args?.index);
  if (!Number.isInteger(index) || index < 0 || index >= plan.steps.length) {
    return JSON.stringify({ error: `index must be an integer between 0 and ${plan.steps.length - 1}` });
  }
  const status = args?.status as StepStatus;
  if (!STEP_STATUSES.includes(status)) {
    return JSON.stringify({ error: `status must be one of ${STEP_STATUSES.join(", ")}` });
  }
  const step = plan.steps[index];
  step.status = status;
  if (typeof args.note === "string") {
    const note = args.note.trim();
    if (note) step.note = note;
    else delete step.note;
  }
  render(plan);
  return JSON.stringify({ success: true, index, step: { ...step }, progress: progress(plan) });
}
