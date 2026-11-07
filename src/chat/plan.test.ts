/**
 * The plan card: `plan_set` / `plan_update` state and the single in-place
 * rendered card in `#chat-messages`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import bw from "bitwrench";
import { appendEl } from "../ui/taco";
import {
  STEP_GLYPH,
  STEP_STATUSES,
  getPlan as getPlanOf,
  makePlanHost,
  planSet as planSetOn,
  planUpdate as planUpdateOn,
  resetPlan as resetPlanOf,
  type PlanHost,
} from "./plan";

function log(): HTMLElement {
  return document.getElementById("chat-messages")!;
}

// Plans belong to a chat (its session is the host); these tests use one host over the shared log.
let host: PlanHost = makePlanHost(document.getElementById("chat-messages")!);
const planSet = (args: any) => planSetOn(args, host);
const planUpdate = (args: any) => planUpdateOn(args, host);
const getPlan = () => getPlanOf(host);
const resetPlan = () => resetPlanOf(host);
function card(): HTMLElement | null {
  return document.getElementById("plan-card");
}
function steps(): HTMLElement[] {
  return Array.from(card()!.querySelectorAll(".plan-step")) as HTMLElement[];
}
function glyphs(): string[] {
  return steps().map((s) => s.querySelector(".plan-glyph")!.textContent ?? "");
}

beforeEach(() => {
  resetPlan();
  bw.clear(log());
  host = makePlanHost(log());
});

afterEach(() => {
  resetPlan();
  bw.clear(log());
});

describe("planSet", () => {
  it("rejects a missing, empty or all-blank steps array", () => {
    expect(JSON.parse(planSet({}))).toEqual({ error: "plan_set needs a non-empty steps array" });
    expect(JSON.parse(planSet({ steps: [] }))).toEqual({ error: "plan_set needs a non-empty steps array" });
    expect(JSON.parse(planSet({ steps: "a,b" }))).toEqual({ error: "plan_set needs a non-empty steps array" });
    expect(JSON.parse(planSet({ steps: ["", "   ", null] }))).toEqual({ error: "plan_set needs at least one non-empty step" });
    expect(getPlan()).toBeNull();
    expect(card()).toBeNull();
  });

  it("creates the plan with pending steps and a default title", () => {
    const res = JSON.parse(planSet({ steps: ["Read the doc", " Fix typos ", 42] }));
    expect(res).toEqual({ success: true, title: "Plan", steps: 3 });
    expect(getPlan()).toEqual({
      title: "Plan",
      steps: [
        { text: "Read the doc", status: "pending" },
        { text: "Fix typos", status: "pending" },
        { text: "42", status: "pending" },
      ],
    });
  });

  it("renders one card with title, progress and glyphs", () => {
    planSet({ title: "  Tidy up  ", steps: ["a", "b"] });
    const c = card()!;
    expect(c.classList.contains("chat-msg")).toBe(true);
    expect(c.classList.contains("plan")).toBe(true);
    expect(c.querySelector(".plan-title")!.textContent).toBe("Tidy up");
    expect(c.querySelector(".plan-progress")!.textContent).toBe("0/2");
    expect(steps().map((s) => s.querySelector(".plan-text")!.textContent)).toEqual(["a", "b"]);
    expect(glyphs()).toEqual([STEP_GLYPH.pending, STEP_GLYPH.pending]);
    expect(steps().map((s) => s.dataset.index)).toEqual(["0", "1"]);
    expect(steps().every((s) => s.classList.contains("pending"))).toBe(true);
  });

  it("replaces the steps in the same card when called again", () => {
    planSet({ steps: ["a", "b", "c"] });
    const first = card()!;
    bw.append(log(), { t: "div", a: { class: "chat-msg user" }, c: "later message" });
    planSet({ title: "v2", steps: ["x"] });
    expect(card()).toBe(first);
    expect(document.querySelectorAll("#plan-card").length).toBe(1);
    expect(steps().map((s) => s.querySelector(".plan-text")!.textContent)).toEqual(["x"]);
    // Card stays where it was first placed, before the later message.
    expect(log().firstElementChild).toBe(first);
  });

  it("caps the plan at 50 steps", () => {
    const res = JSON.parse(planSet({ steps: Array.from({ length: 60 }, (_, i) => `s${i}`) }));
    expect(res.steps).toBe(50);
    expect(getPlan()!.steps.length).toBe(50);
  });

  it("renders into a detached log (a background chat) and shows up once the log is mounted", () => {
    const l = log();
    l.remove();
    try {
      expect(JSON.parse(planSet({ steps: ["a"] })).success).toBe(true);
      expect(getPlan()!.steps.length).toBe(1);
      expect(card()).toBeNull(); // not in the document yet
      expect(host.planCard).not.toBeNull();
      expect(l.contains(host.planCard)).toBe(true);
    } finally {
      document.body.appendChild(l);
    }
    // The card is still the same element; updates patch it in place.
    planUpdate({ index: 0, status: "done" });
    expect(card()).toBe(host.planCard);
    expect(glyphs()).toEqual([STEP_GLYPH.done]);
  });

  it("two hosts keep separate plans and cards", () => {
    const other = makePlanHost(appendEl(document.body, { t: "div", a: { id: "other-log" } }));
    planSet({ steps: ["mine"] });
    planSetOn({ steps: ["theirs", "too"] }, other);
    expect(getPlan()!.steps.map((s) => s.text)).toEqual(["mine"]);
    expect(getPlanOf(other)!.steps.map((s) => s.text)).toEqual(["theirs", "too"]);
    expect(log().querySelectorAll("#plan-card").length).toBe(1);
    expect(other.log.querySelectorAll("#plan-card").length).toBe(1);
    resetPlanOf(other);
    expect(other.log.children.length).toBe(0);
    expect(card()).not.toBeNull();
    other.log.remove();
  });

  it("re-creates the card after the log was cleared", () => {
    planSet({ steps: ["a"] });
    bw.clear(log());
    expect(card()).toBeNull();
    planUpdate({ index: 0, status: "active" });
    expect(card()).not.toBeNull();
    expect(steps()[0].classList.contains("active")).toBe(true);
  });
});

describe("planUpdate", () => {
  it("errors when there is no plan", () => {
    expect(JSON.parse(planUpdate({ index: 0, status: "done" }))).toEqual({ error: "No plan set. Call plan_set first." });
  });

  it("validates index and status", () => {
    planSet({ steps: ["a", "b"] });
    expect(JSON.parse(planUpdate({ index: 2, status: "done" })).error).toBe("index must be an integer between 0 and 1");
    expect(JSON.parse(planUpdate({ index: -1, status: "done" })).error).toMatch(/^index must be/);
    expect(JSON.parse(planUpdate({ index: 0.5, status: "done" })).error).toMatch(/^index must be/);
    expect(JSON.parse(planUpdate({ index: "nope", status: "done" })).error).toMatch(/^index must be/);
    expect(JSON.parse(planUpdate({ index: 0, status: "finished" })).error).toBe(`status must be one of ${STEP_STATUSES.join(", ")}`);
    expect(getPlan()!.steps.every((s) => s.status === "pending")).toBe(true);
  });

  it("accepts a numeric string index", () => {
    planSet({ steps: ["a", "b"] });
    expect(JSON.parse(planUpdate({ index: "1", status: "done" }))).toMatchObject({ success: true, index: 1 });
    expect(getPlan()!.steps[1].status).toBe("done");
  });

  it("updates status, glyph, classes and progress in place", () => {
    planSet({ steps: ["a", "b", "c"] });
    const c = card()!;
    let res = JSON.parse(planUpdate({ index: 0, status: "active" }));
    expect(res).toEqual({ success: true, index: 0, step: { text: "a", status: "active" }, progress: "0/3" });
    expect(card()).toBe(c);
    expect(glyphs()).toEqual([STEP_GLYPH.active, STEP_GLYPH.pending, STEP_GLYPH.pending]);
    expect(steps()[0].classList.contains("active")).toBe(true);
    expect(steps()[0].dataset.status).toBe("active");

    planUpdate({ index: 0, status: "done" });
    planUpdate({ index: 1, status: "skipped" });
    res = JSON.parse(planUpdate({ index: 2, status: "active" }));
    expect(res.progress).toBe("2/3");
    expect(glyphs()).toEqual([STEP_GLYPH.done, STEP_GLYPH.skipped, STEP_GLYPH.active]);
    expect(c.querySelector(".plan-progress")!.textContent).toBe("2/3");
  });

  it("sets, keeps and clears a note", () => {
    planSet({ steps: ["a"] });
    planUpdate({ index: 0, status: "active", note: " working " });
    expect(getPlan()!.steps[0].note).toBe("working");
    expect(steps()[0].querySelector(".plan-note")!.textContent).toBe("working");

    // No note argument: keep it.
    planUpdate({ index: 0, status: "done" });
    expect(getPlan()!.steps[0].note).toBe("working");

    // Blank note: clear it.
    planUpdate({ index: 0, status: "done", note: "  " });
    expect(getPlan()!.steps[0].note).toBeUndefined();
    expect(steps()[0].querySelector(".plan-note")).toBeNull();
  });
});

describe("getPlan / resetPlan", () => {
  it("returns a copy that does not alias internal state", () => {
    planSet({ steps: ["a"] });
    const copy = getPlan()!;
    copy.steps[0].status = "done";
    copy.title = "changed";
    expect(getPlan()).toEqual({ title: "Plan", steps: [{ text: "a", status: "pending" }] });
  });

  it("resetPlan clears the state and removes the card", () => {
    planSet({ steps: ["a"] });
    expect(card()).not.toBeNull();
    resetPlan();
    expect(getPlan()).toBeNull();
    expect(card()).toBeNull();
    expect(() => resetPlan()).not.toThrow();
  });
});
