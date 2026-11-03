# Changelog

All notable changes to quikleaf are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.3] - 2026-11-02

AI assistance: the chat drawer, the site changes and this entry were drafted
with Claude Code under the maintainer's direction; reviewed and released by
the maintainer.

### Changed
- **The chat is a drawer.** It slides out of the left edge of the tab instead
  of appearing in place, and while it is closed a small "Chat" pull sits on
  that edge to open it (the Chat button and Cmd/Ctrl+Shift+C still work).
  Settings → Chat display → **Chat drawer side** moves it to the right edge;
  the info pane crosses to the other side and the resize handle follows. The
  choice previews live in Settings and is remembered. The slide respects
  `prefers-reduced-motion`.
- **Three rows, each with one job.** The title bar holds the File and View
  menus and, on the right, Settings, Help and About. The tab bar holds only
  tabs. Under it, a control row for the active tab: `[Files Outline Chat |
  Source Split Rendered · Undo Redo … Copy MD/HTML/Rendered | Info]`. Each
  panel's toggle sits at the end its panel opens on, and the Chat toggle moves
  to the right end with its drawer. A pressed toggle now inverts (text and
  background swap) instead of filling with the accent colour, and the state
  dots are gone. The title bar is a little shorter.
- **quikdown runs headless.** The editor controls on that row (Source / Split
  / Rendered, Undo / Redo, Copy MD / HTML / Rendered) are drawn by quikleaf in
  the app's palette instead of quikdown's built-in toolbar, so they match the
  rest of the shell in both themes. Same functions, same keyboard shortcuts.
- **About is its own button**, not a Help item, and the dialog is laid out to
  be read: logo, name, version and a one-line tagline; one short paragraph;
  then a facts grid with clickable links to the source, the website, and the
  three libraries with their installed versions (quikdown, bitwrench, Tauri).
  "How it works" is now bold-lead bullets instead of blocks of text. Help
  holds Documentation, Report an Issue and Install Command Line Tool.
- **Readable chrome.** Menu and toolbar text is the primary text colour (it
  was a light grey) and one size up (14 px). Settings → **Appearance** adds
  the interface font size (12–18 px), the editor font size (13–22 px), a
  choice of four preview styles for the rendered markdown (quikdown's
  Default, Book, Plain, Mono) and a box for your own preview CSS. All preview
  live and Cancel puts them back.
- **Contrast.** The secondary and tertiary text colours were below 4.5:1 on
  most backgrounds in the light theme (tertiary was 2.3:1) and the tertiary
  colour was in the dark theme too. Both are now at or above 4.5:1 on every
  background in both themes, and the status bar and LLM pill use the
  secondary colour.
- **Light / dark toggle.** A sun/moon button at the far right of the title
  bar switches themes and remembers the choice. Settings → Appearance →
  Theme offers Light, Dark or Follow the system (the default, as before).
- **Dark mode fixes.** The editor followed the OS, not the app, so with the
  OS light and the app dark the panes kept light-theme text on a dark
  background; quikdown's theme is now set with the app's. Its dark greys are
  replaced by the app's palette so the panes sit flush, native controls
  (selects, scrollbars) follow the theme (`color-scheme`), and the info
  pane's model picker is styled.
- **Panels open under their buttons.** The file tree and the outline now
  open inside the body row, `[files | outline | chat | editor | info]`,
  instead of beside the whole editor column, so toggling them no longer
  shifts the control row; the mouse can stay on the button. The chat pull
  sits on the editor's edge, to the right of an open outline.

### Added
- **A log tab.** About → Diagnostics → View Log, Settings → Diagnostics →
  View Log, or `quikleaf --log` opens the performance log in a tab: one line
  per entry (as `/log` prints them), a filter by kind (llm, tool, turn,
  app), Follow to keep the newest in view, Clear, Open Folder. It follows the
  running app live, in-process, so new entries appear the instant they are
  logged, even while the log file is switched off; the file's tail is read
  the first time the tab is shown. The info pane counts the entries in view.
- GitHub Pages site: left-justified, more compact layout with the install
  strip above the fold; the hero shows a real screenshot of the app (document
  chat proposing a reviewed diff, source, rendered preview) instead of the
  mock SVG; the platform tiles are now actual download links for the current
  release (retargeted to the latest tag at runtime); social-card image is the
  screenshot; `docs/publishing.md` documents the release and npm trust path.

### Fixed
- `quikleaf notes.md` opened an empty window. The file named on the command
  line was read through the Tauri fs plugin, whose default scope allows only
  the app's own directories, so the read was refused ("forbidden path") and
  the failure was logged to the console only. The path is now added to the
  fs scope at startup (the same thing the Open dialog does for files picked
  there), so it opens and saves. A file that still cannot be opened shows a
  toast, and every failed open is written to the diagnostics log
  (About → Diagnostics, `/log`) with the reason.

## [1.2.2] - 2026-11-02

AI assistance: the publishing fix and this entry were drafted with Claude
Code under the maintainer's direction; reviewed, tested and released by the
maintainer.

### Fixed
- npm publishing. 1.2.1's `npm publish` was refused with "OIDC permission
  denied for this action" because the new trusted-publisher configuration on
  npmjs.com had been created stage-only (npm's current default). The
  configuration now allows direct `npm publish`, and `publish.yml` documents
  that requirement, checks the launcher version against the tag and the four
  release archives before publishing, and accepts a `tag` input so any
  existing release can be (re)published from `main`.
- npm launcher under npm 12. npm 12 blocks install-time lifecycle scripts for
  `npm install -g` and `npx` by default, which would have left the launcher
  with no binary. The launcher no longer has a postinstall script: `bin/quikleaf`
  downloads the platform archive from the matching GitHub release on first run
  into a per-user cache (`~/Library/Caches/quikleaf`, `~/.cache/quikleaf`,
  `%LOCALAPPDATA%\quikleaf\cache`, or `QUIKLEAF_CACHE_DIR`) and runs it from
  there. `node install.js` still pre-fetches it explicitly.

## [1.2.1] - 2026-11-02

AI assistance: the publishing change and this entry were drafted with Claude
Code under the maintainer's direction; reviewed, tested and released by the
maintainer.

### Changed
- npm publishing moved to trusted publishing (OIDC) in a dedicated
  `.github/workflows/publish.yml`, dispatched by the release workflow after the
  installers and portable archives are on the GitHub release, or by hand for an
  existing release. No npm token anywhere; every published version carries
  provenance.
- Only the `quikleaf` launcher is published to npm. The four
  `@deftio/quikleaf-<platform>` packages were never published and are gone;
  the launcher downloads the portable archive for its platform from the GitHub
  release of the same version at install time (as 1.0.3 already did), so
  everything stays downloadable from the release and the site. v1.1.0 and
  v1.2.0 never reached npm because the old job expected an `NPM_TOKEN` secret
  that was not set.

## [1.2.0] - 2026-11-01

AI assistance: the per-tab chat and pane model, the project-persistence fix,
the bitwrench site rebuild, the documentation audit and corrections, the
markdown-rt design documents and this entry were drafted with Claude Code under
the maintainer's direction; reviewed, tested and released by the maintainer.

### Changed — the tab is the unit
- **A chat per tab, sealed to its document.** Each document tab now has its own
  QD chat. The model is shown that document and the conversation and nothing
  else: no other tab's name or content, no file reads, no project search. Its
  tools can change only that document, and keep doing so if you switch tabs
  mid-reply. The chat header names the document (`Document chat · notes.md`),
  the welcome and `/help` say so, and tool results carry the document name.
  This is a trust boundary enforced in the dispatcher, not a prompt hint: files
  from unrelated projects open side by side can no longer leak into each
  other's model calls.
- **Project chat.** Cross-file work moved to one explicit scope: View → Project
  Chat opens a "Project" tab whose chat has the file tools (`file_read`,
  `file_write`, `file_list`, `file_stat`, `project_search`), `tabs_list`
  (project files only) and `tab_open`, and no `document_*` tools. Every edit it
  makes names its path. It survives its tab being closed.
- **Memory and KV are project state.** The scratchpad and key-value tools are
  offered to the project chat and to chats of files under the project root
  only; an untitled document, a file from outside the root, or any document in
  simple mode does not get them.
- **Three panes per tab: `[chat | quikdown view | info]`.** The chat and the
  new info pane live under the tab bar, inside the tab column, and each tab
  remembers which panes it shows and whether the editor is in Source, Split or
  Preview (View menu, quikdown's toolbar, Cmd/Ctrl+Shift+C / I). A new tab
  inherits the layout of the tab it was opened from.
- **Info pane.** Document facts (name, location, saved state, words,
  characters, lines, reading time, headings) and chat facts (scope, turns, tool
  calls, memory availability, provider and host, a per-chat Model picker,
  Clear chat). On the project tab it describes the project.
- **A model per chat.** `/model <name>` or the info pane picker switches the
  model for that chat only, on the Settings host and provider; `/model
  default` goes back. The chat header shows the model in use.
- **Chats are saved with the project.** `quikleaf.prj`'s `chatHistory` now
  holds each open project file's transcript, model override and pane layout
  (by path) plus the project chat, and restores them when the files are
  reopened. Tool traffic is not persisted; untitled and outside-project tabs
  are never written.
- **View menu** reorganised: Chat, Info, Files, Outline and Project Chat as
  checkable items, Source / Split / Preview, then Focus Mode and Find. Toggle
  buttons: Chat, Info, Files, Outline.
- Removed `tab_switch` (a document chat has no business switching tabs; the
  project chat's `tab_open` focuses an open file). Tool counts are now per
  scope: document chat 10 (18 for a project file), project chat 17.

### Fixed
- Project mode never wrote `quikleaf.prj`: `project_save` existed in Rust but was
  never called, so the scratchpad, key-value store and open file were lost on
  quit. A debounced writer (`src/project/persist.ts`) now saves after every
  change, creates the file on first launch and flushes on window close. Open
  project tabs are saved too (`openTabs`) and reopened on the next launch.
- Restoring the remembered open file read `open_file` while the file is written
  camelCase (`openFile`), so it never restored. Fixed, with e2e coverage.
- `/tools` omitted the tab tools.

### Added
- GitHub Pages site rebuilt as a bitwrench.js page (`docs/scripts/site.js`):
  palette from `bw.loadStyles()`, light/dark/auto via `bw.setThemeMode()`,
  GoatCounter analytics, version badge that follows the latest GitHub release.
  The hand-written CSS file is gone. `npm run feature` now bumps the site
  version too.
- `dev/markdown-rt-spec.md`: draft 0.1 of markdown-rt, a profile of Markdown
  whose fences carry pragmas (`#id`, `run`, `in`, `out`, `hidden`, …) and can
  execute in a sandboxed browser realm; includes the race-free incremental
  rendering design for quikdown. Design only, no code.
- `dev/markdown-rt-comparison.md`: markdown-rt against executable-Markdown
  grammars and notebook systems (Jupyter, Wolfram, Observable, Pluto, Marimo,
  Livebook, …), with the lessons taken and avoided.

### Changed
- Documentation audit against the code: removed the "60-second timeout per
  call" claim (there is none; the loop is capped at 10 rounds with Stop), fixed
  `document_replace` / `file_list` / `kv_list` signatures in `agents.md`, the
  real camelCase `quikleaf.prj` schema, tool counts (26, 20 outside project
  mode), test counts, `.rpm` and portable archives in the install tables, the
  `--project path/to/quikleaf.prj` form, Docker Model Runner in auto-detect
  lists, and `llm_chat_stream` as the chat command.
- `CLAUDE.md`: new "Authorship and AI disclosure" and "GitHub Pages site"
  sections; release steps no longer tell you to tag by hand (CI tags and
  dispatches the release).
- `CHANGELOG.md` 1.1.0 entry gained its AI-assistance disclosure.

## [1.1.0] - 2026-10-31

AI assistance: the bitwrench UI rebuild, the release-pipeline fix, the
timing/performance log, tabs, the agentic tools (review cards, plan, search),
the writing tools, the unit/e2e test suites and the documentation refresh were
drafted with Claude Code under the maintainer's direction, then reviewed,
tested and released by the maintainer, who is accountable for the result.

### Added
- Editor tabs: several documents open at once, dirty indicators, unsaved-changes
  prompt, File > New / Close Tab, Cmd/Ctrl+N / W, Ctrl+Tab cycling; the file tree
  follows the active tab.
- Reviewable agent edits: `document_write`, `document_replace` and `file_write`
  render diff cards; Settings > Agent > Edit approval (always / files = default /
  never) decides which wait for Accept / Reject. Stop rejects pending reviews.
- Plan card: `plan_set` / `plan_update` tools render and update a step list in
  the chat.
- New tools: `document_outline`, `project_search` (Rust, substring or regex,
  skips VCS/build dirs), `tabs_list`, `tab_switch`, `tab_open`.
- Writing tools: outline panel (Cmd/Ctrl+Shift+O, click to jump), find & replace
  with match case and regex (Cmd/Ctrl+F / H), word count and reading time in the
  status bar, focus mode (Cmd/Ctrl+Shift+D), File > Export HTML and Print / PDF.
- Timestamps under every chat message and a timing line under replies (time to
  first token, total, ≈tokens, tok/s); tool calls show their duration. Both are
  toggles in Settings → Chat display and apply to existing messages instantly.
- Performance log: JSON lines per LLM request, tool call and chat turn in the OS
  log folder (macOS `~/Library/Logs/com.deftio.quikleaf/quikleaf-perf.jsonl`).
  Settings → Diagnostics turns it off, opens the folder, or clears it; `/log`
  shows the tail.
- About dialog now has "How it works" and "Diagnostics" tabs (version, log path,
  CLI status, recent timings).
- Help → Install Command Line Tool writes a `quikleaf` shim so the drag-installed
  macOS app works from a terminal.
- Provider presets in Settings, including Docker Model Runner
  (`http://localhost:12434/engines/v1`); Docker Model Runner is also auto-detected.
- Chat and Files are proper toggle buttons (`aria-pressed`).
- Unit test coverage raised from 51% to 97% of lines (601 tests; 99 e2e) with a coverage
  gate in `vitest.config.ts`; `npm run release:dry` runs every release gate
  without pushing.

### Changed
- UI rebuilt on [bitwrench.js](https://github.com/deftio/bitwrench).
- Dependency updates: Tauri 2.12 (plus dialog/fs/shell plugins), vite 6.4.5, vitest 4.1.12, happy-dom 21.
- Docs refreshed.

### Fixed
- Release pipeline: CI pushed tags with `GITHUB_TOKEN`, which never triggers the
  tag-push release workflow, so no installers or npm platform binaries were ever
  built. CI now dispatches the release workflow explicitly and releases are
  published (not drafts) so `npm install -g quikleaf` can download binaries.
- Project mode: Cmd+S on a file opened from the file tree now saves through the
  project-scoped `file_write` command instead of a relative path on disk.
- About dialog version is read from package.json at build time (was hard-coded
  to 1.0.3).

## [1.0.4] - 2026-08-28

### Changed
- Split the streaming `max_tokens` ceiling from the non-streaming one.
- Dependency updates.

## [1.0.3] - 2026-06-25

### Added
- First public release.

### Known issues
- Installers and npm platform binaries for this version were never published
  because of the CI tag-trigger bug fixed in 1.1.0; `quikleaf@1.0.3` on npm is
  a wrapper with no working binary.

[1.1.0]: https://github.com/deftio/quikleaf/compare/v1.0.4...v1.1.0
[1.0.4]: https://github.com/deftio/quikleaf/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/deftio/quikleaf/releases/tag/v1.0.3
