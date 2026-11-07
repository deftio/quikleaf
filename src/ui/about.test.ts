/**
 * About dialog: tabs, version, external links, diagnostics refresh and the
 * command-line installer. Mounted into the pre-created `#app` root.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bw from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { initAbout, installCli, makeAboutModal } from "./about";
import { LOG_OPEN } from "../diag/perf";
import type { CliStatus } from "./about";

const mockInvoke = vi.mocked(invoke);
const mockShellOpen = vi.mocked(shellOpen);

const SHOW = "bw_bccl_modal_show";

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`test: #${id} missing`);
  return node as T;
}

function text(id: string): string {
  return byId(id).textContent ?? "";
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

function toasts(): HTMLElement[] {
  return Array.from(document.querySelectorAll("#toast-root .bw_bccl_toast")) as HTMLElement[];
}

function calls(cmd: string): unknown[][] {
  return mockInvoke.mock.calls.filter((c) => c[0] === cmd);
}

const cliOk: CliStatus = { supported: true, installed: true, path: "/usr/local/bin/quikleaf", on_path: true, note: "Installed at /usr/local/bin/quikleaf" };

/** Default backend: a log path, an installed CLI, and an empty log. */
function backend(overrides: Record<string, () => unknown> = {}) {
  mockInvoke.mockImplementation(async (cmd) => {
    if (cmd in overrides) return overrides[cmd]();
    switch (cmd) {
      case "log_get_path":
        return "/tmp/quikleaf-perf.jsonl";
      case "cli_status":
        return cliOk;
      case "log_tail":
        return [];
      default:
        return null;
    }
  });
}

beforeEach(() => {
  localStorage.clear();
  mockInvoke.mockReset();
  mockShellOpen.mockReset();
  mockShellOpen.mockImplementation(async () => {});
  backend();
});

afterEach(async () => {
  await flush();
  // bw.clear deregisters ids from bitwrench's lookup cache; innerHTML = "" would not.
  bw.clear(byId("app"));
  document.body.style.overflow = "";
});

describe("makeAboutModal", () => {
  it("renders an overlay with three tabs, the first one active", () => {
    const node = bw.append(byId("app"), makeAboutModal());
    expect(node.id).toBe("about-overlay");
    expect(node.classList.contains("bw_bccl_modal")).toBe(true);
    expect(node.querySelector("#about-modal")).not.toBeNull();

    const tabs = Array.from(node.querySelectorAll('[role="tab"]'));
    expect(tabs.map((t) => t.textContent)).toEqual(["About", "How it works", "Diagnostics"]);
    expect(tabs[0].classList.contains("active")).toBe(true);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[2].getAttribute("aria-selected")).toBe("false");
  });

  it("shows the app version from the Vite define in the About pane and Diagnostics grid", () => {
    const node = bw.append(byId("app"), makeAboutModal());
    expect(typeof __APP_VERSION__).toBe("string");
    expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+/);
    expect(node.querySelector(".about-version")?.textContent).toBe(`Version ${__APP_VERSION__}`);
    expect(node.querySelector(".about-name")?.textContent).toBe("quikleaf");
    expect(node.querySelector(".about-logo")?.getAttribute("src")).toBe("/icon.png");
    expect(node.querySelector(".about-license")?.textContent).toContain("BSD-2-Clause");

    const diag = byId("about-diag");
    const labels = Array.from(diag.querySelectorAll(".diag-label")).map((l) => l.textContent);
    expect(labels).toEqual(["Version", "Platform", "Binary", "Performance log", "Log file", "Command line"]);
    expect(diag.querySelectorAll(".diag-value")[0].textContent).toBe(__APP_VERSION__);
    expect(diag.querySelectorAll(".diag-value")[1].textContent).not.toBe("");
    expect(text("diag-recent")).toBe("…");
  });

  it("falls back to the user agent, then 'unknown', for the Platform row", () => {
    const platformRow = () => byId("about-diag").querySelectorAll(".diag-value")[1].textContent;

    vi.stubGlobal("navigator", { platform: "", userAgent: "TestAgent/1.0" });
    bw.append(byId("app"), makeAboutModal());
    expect(platformRow()).toBe("TestAgent/1.0");
    bw.clear(byId("app"));

    vi.stubGlobal("navigator", undefined);
    bw.append(byId("app"), makeAboutModal());
    expect(platformRow()).toBe("unknown");
    vi.unstubAllGlobals();
  });

  it("renders the How it works sections as headings with bullet lists", () => {
    bw.append(byId("app"), makeAboutModal());
    const how = byId("about-how");
    const headings = Array.from(how.querySelectorAll("h4")).map((h) => h.textContent);
    expect(headings).toEqual(["Three layers", "The UI is data", "The chat loop (QD)", "Timing and the performance log", "Project mode and privacy"]);
    expect(how.querySelectorAll("ul")).toHaveLength(5);
    expect(how.querySelectorAll("li").length).toBeGreaterThanOrEqual(14);
    expect(how.querySelector("li strong")?.textContent).toContain("Rust backend");
    // Every bullet opens with a bold lead, so the tab scans as a list of points.
    const items = Array.from(how.querySelectorAll("li"));
    expect(items.every((li) => li.firstElementChild?.tagName === "STRONG")).toBe(true);
  });

  it("opens project links in the system browser instead of the webview", () => {
    const node = bw.append(byId("app"), makeAboutModal());
    const links = Array.from(node.querySelectorAll(".about-links a")) as HTMLAnchorElement[];
    expect(links.map((a) => a.textContent)).toEqual(["github.com/deftio/quikleaf", "deftio.github.io/quikleaf", "quikdown", "bitwrench", "Tauri"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://github.com/deftio/quikleaf",
      "https://deftio.github.io/quikleaf/",
      "https://github.com/deftio/quikdown",
      "https://github.com/deftio/bitwrench",
      "https://tauri.app",
    ]);
    // Facts are a label/value grid; each library carries its installed version.
    const labels = Array.from(node.querySelectorAll(".about-facts dt")).map((d) => d.textContent);
    expect(labels).toEqual(["Source", "Website", "Rendering", "Interface", "Shell", "License"]);
    const versions = Array.from(node.querySelectorAll(".about-facts .about-ver")).map((v) => v.textContent);
    expect(versions).toHaveLength(3);
    for (const v of versions) expect(v).toMatch(/^\d+\.\d+\.\d+/);

    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    links[4].dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(mockShellOpen).toHaveBeenCalledTimes(1);
    expect(mockShellOpen).toHaveBeenCalledWith("https://tauri.app");
  });

  it("logs, rather than throws, when the system browser cannot be opened", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockShellOpen.mockImplementation(async () => {
      throw new Error("no browser");
    });
    const node = bw.append(byId("app"), makeAboutModal());
    (node.querySelector(".about-links a") as HTMLAnchorElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
    expect(err).toHaveBeenCalledTimes(1);
    expect((err.mock.calls[0][0] as Error).message).toBe("no browser");
    err.mockRestore();
  });

  it("does not fetch diagnostics until the Diagnostics tab is selected", () => {
    const node = bw.append(byId("app"), makeAboutModal());
    const tabs = Array.from(node.querySelectorAll('[role="tab"]')) as HTMLElement[];
    tabs[1].click();
    expect(tabs[1].classList.contains("active")).toBe(true);
    expect(calls("cli_status")).toHaveLength(0);
    expect(calls("log_get_path")).toHaveLength(0);
  });

  it("refreshes diagnostics when the Diagnostics tab is selected", async () => {
    const node = bw.append(byId("app"), makeAboutModal());
    const tabs = Array.from(node.querySelectorAll('[role="tab"]')) as HTMLElement[];
    tabs[2].click();
    await flush();

    expect(tabs[2].classList.contains("active")).toBe(true);
    expect(node.querySelectorAll(".bw_bccl_tab_pane")[2].classList.contains("active")).toBe(true);
    expect(calls("log_get_path")).toHaveLength(1);
    expect(calls("cli_status")).toHaveLength(1);
    expect(calls("log_tail")).toEqual([["log_tail", { n: 8 }]]);
    expect(text("diag-log-path")).toBe("/tmp/quikleaf-perf.jsonl");
    expect(byId("diag-log-path").querySelector("code")).not.toBeNull();
    expect(text("diag-cli")).toBe(cliOk.note);
    expect(text("diag-recent")).toBe("No entries yet.");

    // Re-clicking the already active tab does not refresh again.
    tabs[2].click();
    await flush();
    expect(calls("cli_status")).toHaveLength(1);
  });
});

describe("initAbout", () => {
  it("mounts into #app and returns an opener that shows the modal and refreshes diagnostics", async () => {
    const openAbout = initAbout();
    expect(byId("app").querySelector("#about-overlay")).not.toBeNull();
    expect(byId("about-overlay").classList.contains(SHOW)).toBe(false);
    expect(calls("cli_status")).toHaveLength(0);

    openAbout();
    await flush();
    expect(byId("about-overlay").classList.contains(SHOW)).toBe(true);
    expect(text("diag-log-state")).toBe("on (Settings → Diagnostics to turn off)");
    expect(text("diag-log-path")).toBe("/tmp/quikleaf-perf.jsonl");
    expect(text("diag-cli")).toBe(cliOk.note);
    expect(text("diag-recent")).toBe("No entries yet.");
  });

  it("renders recent log rows one per line and reflects a disabled perf log", async () => {
    localStorage.setItem("quikleaf_llm_settings", JSON.stringify({ perfLog: false }));
    backend({
      log_tail: () => [
        { kind: "llm", ts: "2026-10-31T09:15:30.000Z", model: "llama3", total_ms: 1500, ttft_ms: 200, tok_per_s: 42 },
        { kind: "tool", ts: "2026-10-31T09:15:31.000Z", name: "read_document", ms: 12, ok: true },
        { kind: "turn", ts: "2026-10-31T09:15:32.000Z", total_ms: 2000, llm_calls: 1, tool_calls: 1 },
      ],
    });
    const openAbout = initAbout();
    openAbout();
    await flush();

    expect(text("diag-log-state")).toBe("off");
    const lines = text("diag-recent").split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("09:15:30 llm llama3 · 1.50s · ttft 200ms · 42 tok/s");
    expect(lines[1]).toBe("09:15:31 tool read_document 12ms");
    expect(lines[2]).toBe("09:15:32 turn 2.00s · 1 llm · 1 tools");
  });

  it("shows 'unavailable' when the backend has no log path", async () => {
    backend({ log_get_path: () => "" });
    initAbout()();
    await flush();
    expect(text("diag-log-path")).toBe("unavailable");
  });

  it("fills the Shell, Platform and Binary rows from build_info when diagnostics refresh", async () => {
    backend({
      build_info: () => ({ tauri: "2.12.5", arch: "aarch64", os: "macos", profile: "release", exe: "/Applications/quikleaf.app/Contents/MacOS/quikleaf" }),
    });
    const node = bw.append(byId("app"), makeAboutModal());
    const tabs = Array.from(node.querySelectorAll('[role="tab"]')) as HTMLElement[];
    expect(text("diag-platform")).not.toContain("aarch64");
    expect(text("about-tauri")).toMatch(/^\d+\.\d+\.\d+/);
    expect(text("about-tauri")).not.toContain("API");
    tabs[2].click();
    await flush();
    expect(text("diag-platform")).toBe("macos aarch64, release build, Tauri 2.12.5");
    expect(text("diag-exe")).toBe("/Applications/quikleaf.app/Contents/MacOS/quikleaf");
    expect(byId("diag-exe").querySelector("code")).not.toBeNull();
    expect(text("about-tauri")).toMatch(/^2\.12\.5 \(API \d+\.\d+\.\d+/);
  });

  it("keeps the browser's platform, and warns, when build_info is missing or rejects", async () => {
    backend({ build_info: () => null });
    const node = bw.append(byId("app"), makeAboutModal());
    const tabs = Array.from(node.querySelectorAll('[role="tab"]')) as HTMLElement[];
    tabs[2].click();
    await flush();
    const before = text("diag-platform");
    expect(before).not.toContain("Tauri");
    expect(text("diag-exe")).toBe("…");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    backend({
      build_info: () => {
        throw new Error("no such command");
      },
    });
    tabs[0].click();
    tabs[2].click(); // a fresh selection refreshes again
    await flush();
    expect(text("diag-platform")).toBe(before);
    expect(warn).toHaveBeenCalledWith("build_info failed", "no such command");
    warn.mockRestore();
  });

  it("reports an unknown CLI state when cli_status returns nothing", async () => {
    backend({ cli_status: () => null });
    initAbout()();
    await flush();
    expect(text("diag-cli")).toBe("unknown");
  });

  it("reports the error when cli_status rejects", async () => {
    backend({
      cli_status: () => {
        throw new Error("not supported on this platform");
      },
    });
    initAbout()();
    await flush();
    expect(text("diag-cli")).toBe("unknown (not supported on this platform)");
    // The rest of the refresh still completes.
    expect(text("diag-recent")).toBe("No entries yet.");
  });

  it("formats a non-Error cli_status rejection", async () => {
    backend({
      cli_status: () => {
        throw "ipc down";
      },
    });
    initAbout()();
    await flush();
    expect(text("diag-cli")).toBe("unknown (ipc down)");
  });

  it("skips the diagnostics refresh when the Diagnostics pane is gone", async () => {
    const openAbout = initAbout();
    byId("about-diag").remove();
    openAbout();
    await flush();
    expect(byId("about-overlay").classList.contains(SHOW)).toBe(true);
    expect(calls("log_get_path")).toHaveLength(0);
    expect(calls("cli_status")).toHaveLength(0);
  });

  it("View Log closes the dialog and asks for the log tab", async () => {
    const seen = vi.fn();
    const off = bw.sub(LOG_OPEN, seen);
    initAbout()();
    await flush();
    expect(byId("about-overlay").classList.contains(SHOW)).toBe(true);
    byId("diag-view-log").click();
    expect(byId("about-overlay").classList.contains(SHOW)).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it("Open Log Folder invokes log_reveal and only toasts on failure", async () => {
    initAbout()();
    await flush();
    byId("diag-open-log").click();
    await flush();
    expect(calls("log_reveal")).toHaveLength(1);
    expect(toasts()).toHaveLength(0);

    backend({
      log_reveal: () => {
        throw new Error("no file manager");
      },
    });
    byId("diag-open-log").click();
    await flush();
    const t = toasts();
    expect(t).toHaveLength(1);
    expect(t[0].classList.contains("bw_danger")).toBe(true);
    expect(t[0].textContent).toContain("Cannot open log folder");
    expect(t[0].textContent).toContain("no file manager");
  });

  it("Open Log Folder stringifies a non-Error rejection", async () => {
    initAbout()();
    await flush();
    backend({
      log_reveal: () => {
        throw "ENOENT";
      },
    });
    byId("diag-open-log").click();
    await flush();
    expect(toasts()[0].textContent).toContain("ENOENT");
  });

  it("the Install Command Line Tool button runs the installer", async () => {
    initAbout()();
    await flush();
    backend({ cli_install: () => cliOk });
    bw.patch("diag-cli", "stale");
    byId("diag-install-cli").click();
    await flush();
    expect(calls("cli_install")).toHaveLength(1);
    expect(text("diag-cli")).toBe(cliOk.note);
    expect(toasts()[0].textContent).toContain("Command line tool installed");
  });
});

describe("installCli", () => {
  it("succeeds with a success toast carrying the note and patches the Diagnostics row when mounted", async () => {
    backend({ cli_install: () => cliOk });
    initAbout();
    await installCli();
    const t = toasts();
    expect(t).toHaveLength(1);
    expect(t[0].classList.contains("bw_success")).toBe(true);
    expect(t[0].textContent).toContain("Command line tool installed");
    expect(t[0].textContent).toContain(cliOk.note);
    expect(text("diag-cli")).toBe(cliOk.note);
  });

  it("warns when the shim was installed to a directory that is not on PATH", async () => {
    const offPath: CliStatus = { ...cliOk, on_path: false, path: "/Users/me/.local/bin/quikleaf", note: "Installed, but ~/.local/bin is not on your PATH" };
    backend({ cli_install: () => offPath });
    await installCli();
    const t = toasts();
    expect(t).toHaveLength(1);
    expect(t[0].classList.contains("bw_warning")).toBe(true);
    expect(t[0].classList.contains("bw_success")).toBe(false);
    expect(t[0].textContent).toContain(offPath.note);
    // Dialog not mounted: nothing to patch, and no error.
    expect(document.getElementById("diag-cli")).toBeNull();
  });

  it("reports a null response as a failure", async () => {
    backend({ cli_install: () => null });
    await installCli();
    const t = toasts();
    expect(t).toHaveLength(1);
    expect(t[0].classList.contains("bw_danger")).toBe(true);
    expect(t[0].textContent).toContain("Could not install command line tool");
    expect(t[0].textContent).toContain("no response");
  });

  it("reports a backend rejection as a failure", async () => {
    backend({
      cli_install: () => {
        throw new Error("permission denied");
      },
    });
    initAbout();
    await installCli();
    const t = toasts();
    expect(t).toHaveLength(1);
    expect(t[0].classList.contains("bw_danger")).toBe(true);
    expect(t[0].textContent).toContain("permission denied");
    expect(text("diag-cli")).toBe("…");
  });

  it("stringifies a non-Error rejection", async () => {
    backend({
      cli_install: () => {
        throw "EACCES";
      },
    });
    await installCli();
    expect(toasts()[0].textContent).toContain("EACCES");
  });
});
