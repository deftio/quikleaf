/**
 * About dialog: a masthead (logo, name, version) over three bitwrench tabs —
 * About, How it works, Diagnostics. Also owns the "Install Command Line Tool" action, since the Diagnostics
 * tab and the Help menu both trigger it.
 */
import bw from "bitwrench";
import type { Taco, TacoContent } from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { control, el, makeModal, modalHandle, withAttrs } from "./taco";
import { notify } from "./toast";
import { LOG_OPEN, describeEntry, getLogPath, isPerfLogEnabled, tailLog } from "../diag/perf";

export const REPO_URL = "https://github.com/deftio/quikleaf";
export const ISSUES_URL = "https://github.com/deftio/quikleaf/issues";
export const SITE_URL = "https://deftio.github.io/quikleaf/";
export const QUIKDOWN_URL = "https://github.com/deftio/quikdown";
export const BITWRENCH_URL = "https://github.com/deftio/bitwrench";
export const TAURI_URL = "https://tauri.app";

export interface CliStatus {
  supported: boolean;
  installed: boolean;
  path: string | null;
  on_path: boolean;
  note: string;
}

/** A link that opens in the system browser, never inside the webview. */
export function externalLink(text: string, href: string): Taco {
  return {
    t: "a",
    a: {
      href,
      onclick: (e: Event) => {
        e.preventDefault();
        shellOpen(href).catch(console.error);
      },
    },
    c: text,
  };
}

// --- Tab 1: About ---------------------------------------------------------

function fact(label: string, value: TacoContent, ddClass = ""): Taco[] {
  return [
    { t: "dt", c: label },
    { t: "dd", a: ddClass ? { class: ddClass } : {}, c: value },
  ];
}

/** A library link followed by its installed version. */
function lib(name: string, href: string, version: string): TacoContent {
  return [externalLink(name, href), { t: "span", a: { class: "about-ver" }, c: version }];
}

/** The masthead above the tabs: logo, name, version, tagline. Shared by all three panes. */
function masthead(): Taco {
  return {
    t: "div",
    a: { class: "about-head" },
    c: [
      { t: "img", a: { class: "about-logo", src: "/icon.png", alt: "quikleaf" } },
      { t: "div", a: { class: "about-name" }, c: "quikleaf" },
      { t: "div", a: { class: "about-version" }, c: `Version ${__APP_VERSION__}` },
      { t: "div", a: { class: "about-tagline" }, c: "A local markdown editor with a chat per document." },
    ],
  };
}

function aboutTab(): Taco {
  return {
    t: "div",
    a: { class: "about-pane" },
    c: [
      {
        t: "p",
        a: { class: "about-desc" },
        c: "A cross-platform markdown editor: live preview with rich fences (Mermaid, LaTeX, maps, 3D, charts) rendered offline, and an LLM chat sealed to each document. Files stay on your machine; the only network traffic is to the LLM host you configure.",
      },
      {
        t: "dl",
        a: { class: "about-facts about-links" },
        c: [
          ...fact("Source", externalLink("github.com/deftio/quikleaf", REPO_URL)),
          ...fact("Website", externalLink("deftio.github.io/quikleaf", SITE_URL)),
          ...fact("Rendering", lib("quikdown", QUIKDOWN_URL, __QUIKDOWN_VERSION__)),
          ...fact("Interface", lib("bitwrench", BITWRENCH_URL, __BITWRENCH_VERSION__)),
          ...fact("Shell", lib("Tauri", TAURI_URL, __TAURI_API_VERSION__)),
          ...fact("License", "BSD-2-Clause, free and open source", "about-license"),
        ],
      },
      { t: "div", a: { class: "about-copyright" }, c: "© deftio 2026" },
    ],
  };
}

// --- Tab 2: How it works --------------------------------------------------

function section(title: string, items: TacoContent[]): Taco[] {
  return [
    { t: "h4", c: title },
    { t: "ul", c: items.map((i): Taco => ({ t: "li", c: i })) },
  ];
}

/** One bullet: a bold lead on its own line, then one or two plain sentences. */
function point(lead: string, text: TacoContent): TacoContent {
  return [{ t: "strong", c: lead }, text];
}

function howItWorksTab(): Taco {
  return {
    t: "div",
    a: { class: "about-how", id: "about-how" },
    c: [
      ...section("Three layers", [
        point("Rust backend (Tauri v2)", "Owns the window, file I/O, the project store, the performance log and a small HTTP proxy. Nothing in the webview talks to the network directly."),
        point("TypeScript frontend", ["Runs in the platform webview and calls the backend over Tauri IPC (", { t: "code", c: "invoke" }, "). Built once with Vite, bundled into the app."]),
        point("Two libraries", "quikdown renders markdown and every fence type offline; bitwrench builds this whole interface from plain objects."),
      ]),
      ...section("The UI is data", [
        point("One object per element", ["Title bar, this dialog, each chat bubble: all bitwrench TACO objects ", { t: "code", c: "{t, a, c}" }, " mounted into one empty div. No hand-written HTML."]),
        point("Two palettes", "Styles are generated at runtime from a light and a dark seed. Dark mode is one class on the root."),
        point("Targeted updates", "A streaming reply patches one bubble; timestamps and tool entries flip with one class on the chat panel."),
      ]),
      ...section("The chat loop (QD)", [
        point("Each turn", "Your message, the conversation, a system prompt and the tool schemas go to the backend, which streams the reply back as events."),
        point("Sealed per tab", "A document chat sees that document and its own conversation, nothing else, and its tools can change only that document."),
        point("Project chat", "View → Project Chat is the one place that works across files, by path, under the project root."),
        point("Markdown only", "The model never sees rendered HTML. It can read, replace, insert, undo and redo; the project chat can also list, search and write files."),
        point("Tools run locally", "Results are appended and the model is called again, up to ten rounds, with a Stop button at every step."),
        point("Any provider", "OpenAI-compatible servers (Ollama, LM Studio, Docker Model Runner, OpenRouter, Groq) or Anthropic. Local servers are auto-detected on first launch."),
      ]),
      ...section("Timing and the performance log", [
        point("Per request", "Time to first token, total time, an approximate token count and generation rate; each tool call records its duration. Settings → Show timestamps puts them under every message."),
        point("Per file", "With the performance log on, the same numbers go to a JSON-lines file in the OS log folder (path under Diagnostics). Off means nothing is written."),
      ]),
      ...section("Project mode and privacy", [
        point("quikleaf --project ./dir", ["Opens a folder: file tree, project chat, and a ", { t: "code", c: "quikleaf.prj" }, " that remembers open tabs, each file's chat and layout, the scratchpad and the key-value store."]),
        point("API keys", "Live in the webview's local storage and are sent only by the backend proxy, only to the host you configured."),
      ]),
    ],
  };
}

// --- Tab 3: Diagnostics ---------------------------------------------------

function diagRow(label: string, value: TacoContent, id?: string): Taco[] {
  return [
    { t: "div", a: { class: "diag-label" }, c: label },
    { t: "div", a: { class: "diag-value", id }, c: value },
  ];
}

function diagnosticsTab(): Taco {
  return {
    t: "div",
    a: { class: "about-diag", id: "about-diag" },
    c: [
      {
        t: "div",
        a: { class: "diag-grid" },
        c: [
          ...diagRow("Version", __APP_VERSION__),
          ...diagRow("Platform", typeof navigator !== "undefined" ? navigator.platform || navigator.userAgent : "unknown"),
          ...diagRow("Performance log", "…", "diag-log-state"),
          ...diagRow("Log file", { t: "code", c: "…" }, "diag-log-path"),
          ...diagRow("Command line", "…", "diag-cli"),
        ],
      },
      {
        t: "div",
        a: { class: "diag-actions" },
        c: [
          withAttrs(bw.makeButton({ text: "View Log", variant: "secondary", size: "sm", onclick: viewLog }), { id: "diag-view-log" }),
          withAttrs(bw.makeButton({ text: "Open Log Folder", variant: "secondary", size: "sm", onclick: revealLog }), { id: "diag-open-log" }),
          withAttrs(bw.makeButton({ text: "Install Command Line Tool", variant: "secondary", size: "sm", onclick: installCli }), {
            id: "diag-install-cli",
          }),
        ],
      },
      { t: "h4", c: "Recent timings" },
      { t: "pre", a: { id: "diag-recent", class: "diag-recent" }, c: "…" },
    ],
  };
}

async function refreshDiagnostics(): Promise<void> {
  if (!el("about-diag")) return;
  bw.patch("diag-log-state", isPerfLogEnabled() ? "on (Settings → Diagnostics to turn off)" : "off");
  const path = await getLogPath();
  bw.patch("diag-log-path", { t: "code", c: path || "unavailable" });
  try {
    const s = await invoke<CliStatus>("cli_status");
    bw.patch("diag-cli", s ? s.note : "unknown");
  } catch (e: any) {
    bw.patch("diag-cli", `unknown (${e?.message || e})`);
  }
  const rows = await tailLog(8);
  bw.patch("diag-recent", rows.length ? rows.map(describeEntry).join("\n") : "No entries yet.");
}

function revealLog(): void {
  invoke("log_reveal").catch((e: any) => notify("Cannot open log folder", String(e?.message || e), "danger"));
}

let aboutNode: HTMLElement | null = null;

/** View Log: close this dialog and ask the app for the log tab (main.ts listens). */
function viewLog(): void {
  modalHandle(aboutNode)?.close();
  bw.pub(LOG_OPEN, {});
}

/** Install (or refresh) the `quikleaf` shell shim and tell the user where it went. */
export async function installCli(): Promise<void> {
  try {
    const s = await invoke<CliStatus>("cli_install");
    if (!s) throw new Error("no response");
    notify("Command line tool installed", s.note, s.on_path ? "success" : "warning", 10000);
    if (el("about-diag")) bw.patch("diag-cli", s.note);
  } catch (e: any) {
    notify("Could not install command line tool", String(e?.message || e), "danger", 10000);
  }
}

// --- Modal ----------------------------------------------------------------

export function makeAboutModal(): Taco {
  const content: Taco = {
    t: "div",
    a: { id: "about-modal" },
    c: [
      masthead(),
      bw.makeTabs({
        tabs: [
          { label: "About", content: aboutTab() },
          { label: "How it works", content: howItWorksTab() },
          { label: "Diagnostics", content: diagnosticsTab() },
        ],
        onTabChange: (index: number) => {
          if (index === 2) refreshDiagnostics();
        },
      }),
    ],
  };
  return withAttrs(makeModal({ content, closeButton: true }), { id: "about-overlay" });
}

/** Mount the About dialog into the app root and return an opener. */
export function initAbout(): () => void {
  const node = bw.append(control("app"), makeAboutModal());
  aboutNode = node;
  return () => {
    modalHandle(node)?.open();
    refreshDiagnostics();
  };
}
