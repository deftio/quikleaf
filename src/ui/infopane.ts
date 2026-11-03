/**
 * The info pane: the third pane of a tab, `[chat | quikdown view | info]`.
 *
 * Shows the active tab's document facts (name, location, words, characters,
 * lines, reading time, headings) and its chat (scope, turns, tool calls, the
 * model this chat uses — changeable per chat — and a Clear button). For the
 * project tab it describes the project instead of a document.
 *
 * Everything is TACO patched into `#info-body`; refreshes come from tab
 * changes, (debounced) editor changes and `CHAT_CHANGED`.
 */
import bw from "bitwrench";
import type { Taco, TacoContent } from "bitwrench";
import { getMarkdown, onEditorChange } from "../editor/editor";
import { activeTab, subscribe as subscribeTabs, type Tab } from "../editor/tabs";
import { computeStats } from "../editor/stats";
import { outlineOf } from "../chat/outline";
import { CHAT_CHANGED, CHAT_CLEAR, activeSession, sessionHasMemory, setSessionModel, type ChatSession } from "../chat/session";
import { listModels } from "../chat/providers";
import { isConfigured, loadSettings, presetFor } from "../settings/settings";
import { scheduleProjectSave } from "../project/persist";
import { logCounts } from "../diag/log-pane";
import { isPerfLogEnabled } from "../diag/perf";
import { debounce } from "./debounce";
import { control, el, withAttrs } from "./taco";

export const INFO_DEBOUNCE_MS = 200;

let unsubscribers: Array<() => void> = [];
/** Models offered in the per-chat picker, fetched once per host. */
let knownModels: { host: string; models: string[] } | null = null;
let fetching: Promise<void> | null = null;
let projectRoot: string | null = null;

export function makeInfoPanel(): Taco {
  return {
    t: "div",
    a: { id: "info-panel", class: "hidden", "aria-label": "Info" },
    c: [
      { t: "div", a: { id: "info-header" }, c: "Info" },
      { t: "div", a: { id: "info-body" } },
    ],
  };
}

/** The project root shown on the project tab (set by `main.ts` in project mode). */
export function setInfoProjectRoot(root: string | null): void {
  projectRoot = root;
}

function isVisible(): boolean {
  return !!el("info-panel") && !bw.hasClass("info-panel", "hidden");
}

function row(key: string, value: TacoContent, cls = ""): Taco {
  return {
    t: "div",
    a: { class: `info-row ${cls}`.trim() },
    c: [
      { t: "span", a: { class: "info-key" }, c: key },
      { t: "span", a: { class: "info-val" }, c: value },
    ],
  };
}

function section(title: string, rows: TacoContent[]): Taco {
  return { t: "section", a: { class: "info-section" }, c: [{ t: "h3", a: { class: "info-title" }, c: title }, ...rows] };
}

const n = (v: number) => v.toLocaleString("en-US");

function documentSection(tab: Tab, md: string): Taco {
  const st = computeStats(md);
  const headings = outlineOf(md).length;
  const location = tab.path ? (tab.projectRelative ? `[Project] ${tab.path}` : tab.path) : "Unsaved";
  return section("Document", [
    row("Name", tab.title),
    row("Location", { t: "span", a: { title: location }, c: location }, "info-path"),
    row("State", tab.dirty ? "Unsaved changes" : "Saved"),
    row("Words", n(st.words)),
    row("Characters", n(st.chars)),
    row("Lines", n(st.lines)),
    row("Reading time", st.readingMinutes ? `${st.readingMinutes} min` : "—"),
    row("Headings", n(headings)),
  ]);
}

function logSection(): Taco {
  const c = logCounts();
  return section("Performance log", [
    row("Entries", `${c.total} in view`),
    row("LLM requests", String(c.llm)),
    row("Tool calls", String(c.tool)),
    row("Turns", String(c.turn)),
    row("Writing", isPerfLogEnabled() ? "on" : "off (Settings → Diagnostics)"),
  ]);
}

function projectSection(): Taco {
  return section("Project", [
    row("Root", { t: "span", a: { title: projectRoot ?? "" }, c: projectRoot ?? "—" }, "info-path"),
    row("Files", "All under the root, by path"),
  ]);
}

function modelPicker(session: ChatSession, settings: ReturnType<typeof loadSettings>): Taco {
  const options: Taco[] = [{ t: "option", a: { value: "" }, c: `Default (${settings.model || "none"})` }];
  const names = new Set(knownModels?.host === settings.host ? knownModels.models : []);
  if (session.model) names.add(session.model);
  for (const name of Array.from(names).sort()) {
    options.push({ t: "option", a: { value: name, ...(session.model === name ? { selected: true } : {}) }, c: name });
  }
  return withAttrs(
    {
      t: "select",
      a: {
        class: "bw_form_control bw_form_control_sm",
        "aria-label": "Model for this chat",
        onchange: (e: Event) => {
          const value = (e.target as HTMLSelectElement).value;
          const s = activeSession();
          if (!s) return;
          setSessionModel(s, value || null);
          scheduleProjectSave();
        },
      },
      c: options,
    },
    { id: "info-model" },
  );
}

function chatSection(tab: Tab, session: ChatSession): Taco {
  const settings = loadSettings();
  const project = tab.kind === "project";
  const scope = project ? "Project: files under the root" : `This document only (${tab.title})`;
  const provider = isConfigured(settings) ? `${presetFor(settings.host)?.label ?? settings.provider}` : "Not configured";
  let host = settings.host;
  try {
    host = new URL(settings.host).host;
  } catch {}
  return section("Chat", [
    row("Scope", scope),
    row("Turns", n(session.stats.turns)),
    row("Tool calls", n(session.stats.toolCalls)),
    row("Memory tools", sessionHasMemory(session) ? "Project scratchpad" : "Off (not a project file)"),
    row("Provider", isConfigured(settings) ? `${provider} · ${host}` : provider),
    { t: "div", a: { class: "info-row info-model-row" }, c: [{ t: "span", a: { class: "info-key" }, c: "Model" }, modelPicker(session, settings)] },
    {
      t: "div",
      a: { class: "info-actions" },
      c: withAttrs(
        bw.makeButton({
          text: "Clear chat",
          variant: "secondary",
          size: "sm",
          onclick: () => {
            const s = activeSession();
            if (s) bw.pub(CHAT_CLEAR, { tabId: s.tabId });
          },
        }),
        { id: "info-clear-chat" },
      ),
    },
  ]);
}

/** Fetch the host's model list once (for the per-chat picker); re-renders when it arrives. */
function ensureModels(): void {
  const settings = loadSettings();
  if (!isConfigured(settings) || knownModels?.host === settings.host || fetching) return;
  fetching = listModels(settings)
    .then((models) => {
      knownModels = { host: settings.host, models: Array.isArray(models) ? models : [] };
    })
    .catch(() => {
      knownModels = { host: settings.host, models: [] };
    })
    .finally(() => {
      fetching = null;
      if (isVisible()) refreshInfo();
    });
}

/** Rebuild the pane for the active tab. Cheap; skipped while hidden. */
export function refreshInfo(md?: string): void {
  if (!isVisible()) return;
  const body = el("info-body");
  const tab = activeTab();
  const session = activeSession();
  if (!body || !tab || !session) return;
  const parts: Taco[] = tab.kind === "project" ? [projectSection()] : tab.kind === "log" ? [logSection()] : [documentSection(tab, md ?? getMarkdown())];
  if (tab.kind !== "log") parts.push(chatSection(tab, session));
  bw.patch(body, parts);
  // The option's `selected` attribute is not reliable once the select is live; set the value directly.
  const select = el<HTMLSelectElement>("info-model");
  if (select) select.value = session.model ?? "";
  ensureModels();
}

/** Start keeping the pane current. Idempotent; returns the unsubscribe function. */
export function initInfoPane(): () => void {
  for (const off of unsubscribers) off();
  const scheduled = debounce((md: string) => refreshInfo(md), INFO_DEBOUNCE_MS);
  unsubscribers = [
    subscribeTabs(() => refreshInfo()),
    onEditorChange((md) => scheduled(md)),
    bw.sub(CHAT_CHANGED, () => refreshInfo()),
    () => scheduled.cancel(),
  ];
  refreshInfo();
  return () => {
    for (const off of unsubscribers) off();
    unsubscribers = [];
  };
}

/** The model `<select>` of the pane (tests). */
export function infoModelSelect(): HTMLSelectElement | null {
  return el("info-model") ? control<HTMLSelectElement>("info-model") : null;
}
