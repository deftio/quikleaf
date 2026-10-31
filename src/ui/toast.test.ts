import { describe, it, expect, afterEach } from "vitest";
import { notify } from "./toast";

afterEach(() => {
  document.getElementById("toast-root")?.remove();
  // test-setup created #app; make sure it is back for the next test.
  if (!document.getElementById("app")) {
    const app = document.createElement("div");
    app.id = "app";
    document.body.appendChild(app);
  }
});

describe("notify", () => {
  it("creates the toast container inside #app on first use", () => {
    expect(document.getElementById("toast-root")).toBeNull();
    notify("Saved", "File written");
    const root = document.getElementById("toast-root")!;
    expect(root).not.toBeNull();
    expect(root.parentElement).toBe(document.getElementById("app"));
    expect(root.classList.contains("bw_bccl_toast_container")).toBe(true);
    expect(root.classList.contains("bw_bccl_toast_bottom_right")).toBe(true);
    expect(root.getAttribute("aria-live")).toBe("polite");
  });

  it("reuses the container for later toasts", () => {
    const first = notify("One", "a");
    const second = notify("Two", "b");
    const roots = document.querySelectorAll("#toast-root");
    expect(roots.length).toBe(1);
    expect(roots[0].children.length).toBe(2);
    expect(roots[0].children[0]).toBe(first);
    expect(roots[0].children[1]).toBe(second);
  });

  it("returns the toast element with the variant class, title and content", () => {
    const toast = notify("Oops", "Something broke", "danger");
    expect(toast.classList.contains("bw_bccl_toast")).toBe(true);
    expect(toast.classList.contains("bw_danger")).toBe(true);
    expect(toast.classList.contains("bw_bccl_toast_bottom_right")).toBe(true);
    expect(toast.getAttribute("role")).toBe("alert");
    expect(toast.textContent).toContain("Oops");
    expect(toast.textContent).toContain("Something broke");
  });

  it("defaults to the info variant", () => {
    const toast = notify("Note", "fyi");
    expect(toast.classList.contains("bw_info")).toBe(true);
  });

  it("applies the success and warning variants", () => {
    expect(notify("ok", "x", "success").classList.contains("bw_success")).toBe(true);
    expect(notify("hm", "y", "warning").classList.contains("bw_warning")).toBe(true);
  });

  it("throws when #app is not mounted", () => {
    const app = document.getElementById("app")!;
    app.remove();
    expect(() => notify("t", "c")).toThrow("quikleaf: #app is not mounted");
    document.body.appendChild(app);
  });
});
