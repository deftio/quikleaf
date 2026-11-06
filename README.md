# quikleaf

[![Release](https://img.shields.io/github/v/release/deftio/quikleaf?label=release)](https://github.com/deftio/quikleaf/releases)
[![npm](https://img.shields.io/npm/v/quikleaf.svg)](https://www.npmjs.com/package/quikleaf)
[![CI](https://github.com/deftio/quikleaf/actions/workflows/ci.yml/badge.svg)](https://github.com/deftio/quikleaf/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-BSD--2--Clause-blue.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-desktop-9550bb)

A local markdown editor with two things most editors leave out: a chat that
can only see the document it belongs to, and a preview that renders
diagrams, math, maps, charts and 3D models without leaving your machine.

![A document chat proposes a Risks table as a reviewable diff; the markdown source and the rendered preview, with a Mermaid diagram and a math block, sit beside it](docs/assets/quikleaf-demo.gif)

```bash
npx quikleaf notes.md        # or grab an installer from the Releases page
```

Files stay on disk. The only network traffic is to the LLM host you pick,
which can be a local Ollama. [Website](https://deftio.github.io/quikleaf/) ·
[Releases](https://github.com/deftio/quikleaf/releases) ·
[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) ·
[Security](SECURITY.md)

## Why quikleaf

**A chat per document, sealed to it.** Every tab has its own chat. The model
is shown that file and that conversation, nothing else, and its tools can
change only that file. The seal is enforced where tools are dispatched, not
by the prompt. For work across files there is a separate project chat that
names each file by path. Nothing crosses from one chat to another unless you
carry it.

**Edits you can read before they land.** The chat's edits arrive as diff
cards. Review every edit, only project file writes (the default), or none.
Reviewed edits wait for Accept or Reject; the rest apply and show the diff.

**Rich fences, rendered offline.** The preview is [quikdown](https://github.com/deftio/quikdown):
Mermaid, LaTeX, GeoJSON maps, STL models, CSV/TSV tables, Vega and
Vega-Lite charts, ABC music notation, SVG and syntax-highlighted code, all
bundled, no CDN. This is rare in a desktop markdown editor.

**Nothing phones home.** Bring your own key or run a local model. No
telemetry, no update check. The performance log, if you turn it on, is a
file in your log folder that you can watch inside the app.

## Features

- **Writing.** Source, split and rendered views per tab; outline with
  click-to-jump; find and replace with regex; word count and reading time;
  focus mode; four preview styles plus your own CSS; export to HTML and PDF.
- **Images.** Paste an image into the source pane and it is saved in an
  `images/` folder beside the document and linked. Drop an image file to
  link it. Relative images render in the preview.
- **Files.** Open with the dialog, the command line, or by dropping files on
  the window. Tabs with dirty markers and unsaved-change prompts. The tab is
  the unit: its document, its chat and its pane layout travel together.
- **Watch.** A per-tab toggle (off by default) reloads the tab when its file
  changes on disk: files written by another editor, a build, or an agent.
  Unsaved edits are asked about first. `quikleaf --watch notes.md` starts
  with it on.
- **Chat.** Streaming replies, slash commands, a tool-calling loop with a
  Stop button, a plan card for multi-step work, per-chat model choice, and
  timings on every reply (time to first token, total, tokens per second).
  OpenAI-compatible hosts (Ollama, LM Studio, Docker Model Runner,
  OpenRouter, Groq) and Anthropic; local servers are auto-detected.
- **Projects.** `quikleaf --project ./dir` adds a file tree, the project
  chat with file tools and search, a scratchpad and key-value store shared
  by the project's chats, and a project file that remembers open tabs and
  each file's chat. The project file lives in `.quikleaf/` by default
  (Settings → Project can put it in the root).
- **Diagnostics.** A log tab that follows the app live, with a filter by
  kind; also reachable as `quikleaf --log`.
- **Desktop.** Tauri v2: native dialogs, small binary, fast start. Light and
  dark themes with a toggle in the title bar, or follow the system. macOS,
  Windows, Linux.

## Install

| Option | Command / where | Best for |
|--------|-----------------|----------|
| Installer | [Releases](https://github.com/deftio/quikleaf/releases): `.dmg`, `.msi`/`.exe`, `.deb`/`.rpm`/`.AppImage`, portable `.tar.gz`/`.zip` | Most people |
| npm launcher | `npm install -g quikleaf` or `npx quikleaf file.md` | Node users, scripts |
| From source | `npm install && npm run setup && npm run tauri:build` | Contributors |

The npm package is a launcher with no binaries inside: on first run it
downloads the portable archive for your platform from the GitHub release
of the same version into a per-user cache (`~/Library/Caches/quikleaf`,
`~/.cache/quikleaf`, `%LOCALAPPDATA%\quikleaf\cache`; override with
`QUIKLEAF_CACHE_DIR`). It needs github.com once and Node.js 18+. It is
published by npm trusted publishing (OIDC), so every version on npm carries
provenance back to this repository.

macOS builds are not yet notarized. If Gatekeeper refuses the app from the
`.dmg`:

```bash
xattr -cr /Applications/quikleaf.app
```

The npm launcher's download does not carry the quarantine flag, so that path
does not hit the prompt.

### Command line from the macOS app

Dragging `quikleaf.app` into Applications does not put `quikleaf` on your
PATH. **Help → Install Command Line Tool** writes a small shim to
`/usr/local/bin`, `/opt/homebrew/bin` or `~/.local/bin`, whichever is
writable. Windows installers register the app; the Linux packages put
`quikleaf` on PATH.

## Use

```bash
quikleaf                        # empty editor
quikleaf notes.md               # open a file
quikleaf --watch notes.md       # open it and reload the tab when it changes on disk
quikleaf --project ./docs       # a folder: file tree, project chat, project file
quikleaf --project ./x.prj      # a project file by name
quikleaf --log                  # start on the log tab
quikleaf --help                 # the flags; --version prints the version
```

Flags go before or after the file name.

### Chats and scope

| Chat | Opened by | Sees | Can change |
|------|-----------|------|------------|
| Document chat | The Chat button on any document tab | That document and its conversation | That document |
| Project chat | View → Project Chat (project mode) | Files under the project root, by path; which project files are open | Files under the root, by path |

A document chat asked for a file tool gets an error naming its document; a
project chat has no document tools. Files open from outside the project root
are never listed to the project chat. A chat keeps running on its own
document if you switch tabs mid-reply. Switch models per chat with
`/model <name>` or the info pane; `/model default` goes back to Settings.

### Layout

Three rows over the tab body. The title bar holds the File and View menus,
the LLM status, Settings, Help, About and the theme toggle. The tab bar holds
tabs. The control row belongs to the active tab:
`[Files Outline Chat | Source Split Rendered · Undo Redo … Copy MD/HTML/Rendered · Watch | Info]`.
Each panel opens under its button, so nothing above moves. The chat is a
drawer on the left edge (or the right, Settings → Chat display) with a small
pull while closed.

### Keyboard

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + N` / `O` / `S` / `W` | New, open, save, close tab |
| `Ctrl + Tab`, `Ctrl + Shift + Tab` | Next / previous tab (`Cmd + Shift + ]` / `[` on macOS) |
| `Cmd/Ctrl + F` / `H` | Find / find and replace (View → Find & Replace on macOS, where Cmd+H hides the app) |
| `Cmd/Ctrl + Shift + C` / `I` / `O` | Toggle the tab's chat / info pane / outline |
| `Cmd/Ctrl + Shift + D` | Focus mode (Esc exits) |
| `Cmd/Ctrl + P` | Print / save as PDF |
| `Enter`, `Shift + Enter` (chat) | Send, new line |

### Slash commands

`/help`, `/clear`, `/model [name|default]`, `/memory` (project scratchpad),
`/tools` (what this chat may call), `/log` (performance log location and
recent timings).

## Settings

**LLM provider.** Pick a preset (Ollama, LM Studio, Docker Model Runner,
OpenRouter, Anthropic) or type any OpenAI-compatible base URL. On first
launch quikleaf looks for a local Ollama, LM Studio or Docker Model Runner.

```
Ollama:               OpenAI-compatible · http://localhost:11434 · llama3.2
Docker Model Runner:  OpenAI-compatible · http://localhost:12434/engines/v1 · ai/smollm2
Anthropic:            Anthropic · https://api.anthropic.com · claude-sonnet-5-5 · sk-ant-…
OpenRouter:           OpenAI-compatible · https://openrouter.ai/api/v1 · meta-llama/llama-3.1-70b-instruct · sk-or-v1-…
```

**Appearance.** Theme (light, dark, system), interface and editor font
sizes, a preview style (quikdown's default, Book, Plain, Mono) and a box for
your own preview CSS written as if the preview were the page. Applies on the
spot; Cancel puts it back.

**Chat display.** Timestamps and timings, tool-call entries, which edge the
drawer opens from.

**Agent.** When edits pause for review: always, project file writes only
(default), never.

**Project.** Where a new project's file goes: a `.quikleaf` folder (default)
or `quikleaf.prj` in the root. A project that already has one keeps it where
it is. Add `.quikleaf/` to `.gitignore` if the chats should not travel with
the repository.

**Diagnostics.** The performance log: one JSON line per LLM request
(`ttft_ms`, `total_ms`, `est_tokens`, `tok_per_s`, model, host), per tool call
and per chat turn. Nothing is written while it is off. **View Log** opens it
as a tab that follows the app live.

| Platform | Log file |
|----------|----------|
| macOS | `~/Library/Logs/com.deftio.quikleaf/quikleaf-perf.jsonl` |
| Linux | `~/.local/share/com.deftio.quikleaf/logs/quikleaf-perf.jsonl` |
| Windows | `%LOCALAPPDATA%\com.deftio.quikleaf\logs\quikleaf-perf.jsonl` |

## Build from source

Node.js 18+ (CI uses 22), Rust stable 1.77+, and the platform's webview
dependencies (`npm run setup` checks and prints the install commands).

```bash
git clone https://github.com/deftio/quikleaf.git && cd quikleaf
npm install && npm run setup
npm run tauri:dev           # dev mode with hot reload
npm run tauri:build         # installer in src-tauri/target/release/bundle/
npm run check               # TypeScript
npm test                    # unit tests (vitest, 750+)
npm run test:coverage       # with the coverage gate (90/90/90 lines/statements/functions, 85 branches)
npm run test:e2e            # Playwright (140+), Tauri mocked
cd src-tauri && cargo test  # Rust (lib and bin targets)
npm run release:dry         # every release gate, nothing pushed
```

Releases are the maintainer's: `npm run feature -- "name"` starts a branch
and bumps every version file, `npm run release:dry` runs every gate without
pushing, `npm run release` opens the PR whose merge has CI tag, build the
installers and publish the npm launcher. [docs/publishing.md](docs/publishing.md)
has the trust path. [CONTRIBUTING.md](CONTRIBUTING.md) has the rest.

## How it is built

- **Rust backend (Tauri v2)**, `src-tauri/`: file I/O, the command line,
  the project store, the performance log, the file watcher, the CLI shim,
  and a small proxy that forwards LLM calls so keys never sit in the webview
  and CORS does not apply. An `asset://` handler serves image files to the
  preview.
- **TypeScript frontend**, `src/`: the whole interface is
  [bitwrench.js](https://github.com/deftio/bitwrench) TACO objects mounted
  into one empty `div`; styles are generated from two palettes. The editor is
  quikdown running headless, with quikleaf's own controls over its API.
- The model works on raw markdown only; it never sees or produces HTML. The
  tool loop is capped at ten rounds per turn with a Stop button.

[docs/architecture.md](docs/architecture.md) goes module by module;
[docs/llm-integration.md](docs/llm-integration.md) covers providers, tools
and the system prompt; [docs/project-mode.md](docs/project-mode.md) the
project file; [agents.md](agents.md) is for agents and external tools;
[llms.txt](llms.txt) is the short form for language models. The original
plan is in [dev/quikleaf-spec.md](dev/quikleaf-spec.md).

## Troubleshooting

- **The LLM does not answer.** Check the host is reachable, the key is
  right and the model name matches. For Ollama, `ollama serve` must be
  running.
- **A tool call hangs.** Click Stop, or try a different model; small models
  are uneven at tool calling.
- **A file will not open.** The fs scope allows files you picked, named on
  the command line or dropped on the window. `/log` or the log tab shows an
  `open-failed` entry with the reason.
- **An image does not show.** Paths are relative to the document's folder;
  an unsaved document has no folder yet. The `asset://` handler serves
  `png`, `jpg`, `gif`, `svg`, `webp`, `bmp` and `avif`.

## License

BSD 2-Clause. Copyright (c) 2026 deftio. See [LICENSE](LICENSE).

[quikleaf](https://github.com/deftio/quikleaf) ·
[quikdown](https://github.com/deftio/quikdown) ·
[bitwrench](https://github.com/deftio/bitwrench) ·
[Issues](https://github.com/deftio/quikleaf/issues)
