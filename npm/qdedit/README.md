# qdedit

A standalone, cross-platform desktop markdown editor with rich rendering and LLM chat integration.

Built with [Tauri v2](https://tauri.app) and powered by [quikdown](https://github.com/deftio/quikdown).

## Install

```bash
npm install -g qdedit
```

Then run:

```bash
qdedit                    # Open empty editor
qdedit document.md        # Open a file
qdedit --project ./mydir  # Open folder with project tools
```

Or use without installing:

```bash
npx qdedit
npx qdedit document.md
```

## Features

- Rich markdown rendering (Mermaid, LaTeX, GeoJSON, STL, CSV, Vega, SVG, ABC music)
- Built-in LLM chat assistant with 20+ document tools
- Auto-detects local Ollama and LM Studio
- Supports Anthropic Claude and OpenAI-compatible APIs
- Project mode with file tree and persistent memory
- Native desktop app — fast startup, low memory

## Links

- [GitHub](https://github.com/deftio/qdedit)
- [quikdown](https://github.com/deftio/quikdown)
- [Releases](https://github.com/deftio/qdedit/releases)

## License

BSD-2-Clause. Copyright (c) 2026 deftio.
