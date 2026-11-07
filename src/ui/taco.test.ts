import { describe, it, expect, afterEach, vi } from "vitest";
import bw from "bitwrench";
import type { Taco } from "bitwrench";
import { appendEl, control, el, makeModal, modalHandle, withAttrs } from "./taco";

const added: HTMLElement[] = [];
function mount(tag: string, id: string): HTMLElement {
  const node = document.createElement(tag);
  node.id = id;
  document.body.appendChild(node);
  added.push(node);
  return node;
}

afterEach(() => {
  for (const n of added.splice(0)) n.remove();
});

describe("withAttrs", () => {
  it("adds attributes to a TACO that has none and returns the same object", () => {
    const taco: Taco = { t: "button", c: "Send" };
    const out = withAttrs(taco, { id: "chat-send", "aria-label": "Send" });
    expect(out).toBe(taco);
    expect(out.a).toEqual({ id: "chat-send", "aria-label": "Send" });
  });

  it("overrides non-class attributes and keeps the ones not mentioned", () => {
    const taco: Taco = { t: "input", a: { type: "text", placeholder: "old", disabled: true } };
    withAttrs(taco, { placeholder: "new", id: "x" });
    expect(taco.a).toEqual({ type: "text", placeholder: "new", disabled: true, id: "x" });
  });

  it("merges string classes additively (factory class survives)", () => {
    const taco: Taco = { t: "button", a: { class: "bw_bccl_btn bw_primary" } };
    withAttrs(taco, { class: "titlebar-btn" });
    expect(taco.a!.class).toBe("bw_bccl_btn bw_primary titlebar-btn");
  });

  it("merges array classes on both sides", () => {
    const taco: Taco = { t: "div", a: { class: ["a", "b"] } };
    withAttrs(taco, { class: ["c", "d"] });
    expect(taco.a!.class).toBe("a b c d");
  });

  it("merges a string existing class with an array new class", () => {
    const taco: Taco = { t: "div", a: { class: "base" } };
    withAttrs(taco, { class: ["extra", "more"] });
    expect(taco.a!.class).toBe("base extra more");
  });

  it("keeps the existing class when the new attrs have none", () => {
    const taco: Taco = { t: "div", a: { class: "keep" } };
    withAttrs(taco, { id: "only-id" });
    expect(taco.a).toEqual({ class: "keep", id: "only-id" });
  });

  it("uses the new class verbatim when there was no existing class", () => {
    const taco: Taco = { t: "div", a: { id: "k" } };
    withAttrs(taco, { class: ["fresh", "set"] });
    // No merge path: the array is kept as given.
    expect(taco.a!.class).toEqual(["fresh", "set"]);
  });
});

describe("modalHandle", () => {
  it("returns null for a null element", () => {
    expect(modalHandle(null)).toBeNull();
  });

  it("returns null for an element without a bw handle", () => {
    expect(modalHandle(document.createElement("div"))).toBeNull();
  });

  it("returns null when the handle lacks an open() function", () => {
    const node = document.createElement("div") as any;
    node.bw = { close: () => {} };
    expect(modalHandle(node)).toBeNull();
  });

  it("returns the handle when open() is a function", () => {
    const node = document.createElement("div") as any;
    const handle = { open: () => {}, close: () => {} };
    node.bw = handle;
    expect(modalHandle(node)).toBe(handle);
  });
});

describe("makeModal", () => {
  it("returns a bitwrench modal TACO carrying the given title", () => {
    const taco = makeModal({ title: "Settings", content: "body", size: "lg" });
    expect(taco.t).toBe("div");
    expect(JSON.stringify(taco)).toContain("Settings");
    expect(JSON.stringify(taco)).toContain("body");
  });
});

describe("el / control", () => {
  it("el resolves a mounted element by bare id and null otherwise", () => {
    const node = mount("span", "taco-el-probe");
    expect(el("taco-el-probe")).toBe(node);
    expect(el("taco-el-missing")).toBeNull();
  });

  it("control returns the element when mounted", () => {
    const node = mount("input", "taco-control-probe");
    expect(control<HTMLInputElement>("taco-control-probe")).toBe(node);
  });

  it("control throws a clear error naming the id when missing", () => {
    expect(() => control("taco-nope")).toThrow("quikleaf: #taco-nope is not mounted");
  });
});

describe("appendEl", () => {
  it("returns the appended element", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const node = appendEl(host, { t: "span", a: { id: "append-el-child" }, c: "hi" });
    expect(node.tagName).toBe("SPAN");
    expect(node.textContent).toBe("hi");
    bw.clear(host);
    host.remove();
  });

  it("throws when bitwrench cannot resolve the target instead of returning null", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => appendEl("no-such-id-anywhere", { t: "div" })).toThrow(/#no-such-id-anywhere/);
    warn.mockRestore();
  });
});
