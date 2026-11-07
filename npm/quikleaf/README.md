# quikleaf

A standalone, cross-platform desktop markdown editor with rich rendering and LLM chat integration.

Built with [Tauri v2](https://tauri.app) and powered by [quikdown](https://github.com/deftio/quikdown).

## Install

```bash
npm install -g quikleaf
```

Then run:

```bash
quikleaf                    # empty editor
quikleaf document.md        # open a file
quikleaf --watch document.md  # open it and reload when it changes on disk
quikleaf --project ./mydir  # project mode: file tree, project chat, project file
quikleaf --log              # start on the log tab
quikleaf --help             # the flags; --version prints the version
```

Or use without installing:

```bash
npx quikleaf
npx quikleaf document.md
```

The package contains no binaries. On first run it downloads the portable
build for your platform (macOS arm64/x64, Linux x64, Windows x64) from the
[GitHub release](https://github.com/deftio/quikleaf/releases) of the same
version into a per-user cache and runs that; later runs start immediately.
Cache location: `~/Library/Caches/quikleaf` (macOS), `~/.cache/quikleaf`
(Linux), `%LOCALAPPDATA%\quikleaf\cache` (Windows), or `QUIKLEAF_CACHE_DIR`.
No postinstall script is used, so no `--allow-scripts` opt-in is needed.

## Features

- Rich markdown rendering (Mermaid, LaTeX, GeoJSON, STL, CSV, Vega, SVG, ABC music)
- Built-in LLM chat assistant with 20+ document tools
- Auto-detects local Ollama and LM Studio
- Supports Anthropic Claude and OpenAI-compatible APIs
- Project mode with file tree and persistent memory
- Native desktop app — fast startup, low memory

## Links

- [GitHub](https://github.com/deftio/quikleaf)
- [quikdown](https://github.com/deftio/quikdown)
- [Releases](https://github.com/deftio/quikleaf/releases)

## License

BSD-2-Clause. Copyright (c) 2026 deftio.
