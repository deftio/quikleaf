/**
 * About dialog: three bitwrench tabs — About, How it works, Diagnostics.
 * Also owns the "Install Command Line Tool" action, since the Diagnostics
 * tab and the Help menu both trigger it.
 */
import bw from "bitwrench";
import type { Taco, TacoContent } from "bitwrench";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { control, el, makeModal, modalHandle, withAttrs } from "./taco";
import { notify } from "./toast";
import { describeEntry, getLogPath, isPerfLogEnabled, tailLog } from "../diag/perf";

const LINKS = [
  { text: "quikleaf", href: "https://github.com/deftio/quikleaf" },
  { text: "quikdown", href: "https://github.com/deftio/quikdown" },
  { text: "bitwrench", href: "https://github.com/deftio/bitwrench" },
  { text: "Tauri", href: "https://tauri.app" },
];

export interface CliStatus {
  supported: boolean;
  installed: boolean;
  path: string | null;
  on_path: boolean;
  note: string;
}

function externalLink(text: string, href: string): Taco {
  return {
    t: "a",
    a: {
      href,
      onclick: (e: Event) => {
        // Open in the system browser, never inside the webview.
        e.preventDefault();
        shellOpen(href).catch(console.error);
      },
    },
    c: text,
  };
}

// --- Tab 1: About ---------------------------------------------------------

function aboutTab(): Taco {
  return {
    t: "div",
    a: { class: "about-pane" },
    c: [
      { t: "img", a: { class: "about-logo", src: "/icon.png", alt: "quikleaf" } },
      { t: "div", a: { class: "about-name" }, c: "quikleaf" },
      { t: "div", a: { class: "about-version" }, c: `Version ${__APP_VERSION__}` },
      {
        t: "div",
        a: { class: "about-desc" },
        c: [
          "A cross-platform markdown editor with rich fence rendering, live preview, and LLM chat integration. Powered by ",
          { t: "strong", c: "quikdown" },
          ", ",
          { t: "strong", c: "bitwrench" },
          " and ",
          { t: "strong", c: "Tauri" },
          ".",
        ],
      },
      { t: "div", a: { class: "about-links" }, c: LINKS.map((l) => externalLink(l.text, l.href)) },
      { t: "div", a: { class: "about-copyright" }, c: "© deftio 2026" },
      { t: "div", a: { class: "about-license" }, c: "Free open source software under the BSD-2-Clause license" },
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

function howItWorksTab(): Taco {
  return {
    t: "div",
    a: { class: "about-how", id: "about-how" },
    c: [
      ...section("Three layers", [
        [{ t: "strong", c: "Rust backend (Tauri v2). " }, "Owns the window, file I/O, the project store, the performance log, and a small HTTP proxy. Nothing in the webview talks to the network directly."],
        [{ t: "strong", c: "TypeScript frontend. " }, "Runs in the platform webview and calls the backend over Tauri IPC (`invoke`). It is built once with Vite and bundled into the app."],
        [{ t: "strong", c: "Two libraries do the heavy lifting. " }, "quikdown renders markdown and every fence type (Mermaid, LaTeX, maps, 3D, charts) offline; bitwrench builds this entire interface from plain objects."],
      ]),
      ...section("The UI is data", [
        "Every element you see — title bar, this dialog, each chat bubble — is a bitwrench TACO object {t, a, c, o} mounted into one empty <div id=\"app\">. There is no hand-written HTML.",
        "Styles are generated at runtime from two seed palettes (light and dark). Dark mode is a single class toggled on the root; both themes derive from the same accent color.",
        "Updates are targeted: a streaming reply patches one bubble's body, timestamps and tool entries flip visibility with one class on the chat panel.",
      ]),
      ...section("The chat loop (QD)", [
        "Your message, the conversation, a system prompt and the tool schemas go to the backend, which streams the model's reply back as events.",
        "Every tab has its own chat, sealed to its document: the model sees that document and the conversation, nothing else, and its tools can change only that document. The project chat (View → Project Chat) is the one place that works across files, by path, under the project root.",
        "The model works on raw markdown only — it never sees rendered HTML. A document chat can read, replace, insert, undo and redo its document; the project chat can read, write, list and search files; chats of project files share the project's scratchpad and key-value notes.",
        "When the model asks for tools, quikleaf runs them locally, appends the results, and calls the model again — up to ten rounds — with a Stop button at every step.",
        "Works with any OpenAI-compatible server (Ollama, LM Studio, Docker Model Runner, OpenRouter, Groq) or Anthropic. Local servers are auto-detected on first launch.",
      ]),
      ...section("Timing and the performance log", [
        "Each request records time to first token, total time, an approximate token count and generation rate; each tool call records its duration. Turn on \"Show timestamps\" in Settings to see them under every message.",
        "When \"Write performance log\" is on, the same numbers are appended as JSON lines to a file in the OS log folder (path in the Diagnostics tab). Turn it off and nothing is written.",
      ]),
      ...section("Project mode and privacy", [
        "quikleaf --project ./dir opens a folder: a file tree, the project chat, and a quikleaf.prj file that persists the open tabs, each project file's chat and pane layout, the scratchpad and the key-value store.",
        "API keys live in the webview's local storage and are only ever sent by the backend proxy to the host you configured. Nothing is uploaded anywhere else.",
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
    c: bw.makeTabs({
      tabs: [
        { label: "About", content: aboutTab() },
        { label: "How it works", content: howItWorksTab() },
        { label: "Diagnostics", content: diagnosticsTab() },
      ],
      onTabChange: (index: number) => {
        if (index === 2) refreshDiagnostics();
      },
    }),
  };
  return withAttrs(makeModal({ content, closeButton: true }), { id: "about-overlay" });
}

/** Mount the About dialog into the app root and return an opener. */
export function initAbout(): () => void {
  const node = bw.append(control("app"), makeAboutModal());
  return () => {
    modalHandle(node)?.open();
    refreshDiagnostics();
  };
}
