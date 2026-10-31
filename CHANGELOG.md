# Changelog

All notable changes to quikleaf are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-31

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
