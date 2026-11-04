# Contributing to quikleaf

Thanks for looking. quikleaf is a small project with one maintainer, so the
most useful contributions are focused: a bug with steps to reproduce, a fix
with a test, a doc correction. Larger changes are welcome too; open an issue
first so the shape is agreed before the work is done.

## Reporting a bug

Open an [issue](https://github.com/deftio/quikleaf/issues) with:

- quikleaf version (About → the version pill) and how it was installed
  (installer, npm launcher, from source)
- OS and version
- what you did, what you expected, what happened
- for anything involving the chat: the provider, the model, and whether the
  tool calls appear in the chat (Settings → Chat display → tool-call entries)
- for anything involving timing or failed file opens: the relevant lines from
  the log tab (`quikleaf --log`, or About → Diagnostics → View Log)

Security problems go to [SECURITY.md](SECURITY.md), not the issue tracker.

## Setting up

Node.js 18+ (CI uses 22), a current stable Rust toolchain, and the platform's
webview dependencies. `npm run setup` checks and prints what is missing.

```bash
git clone https://github.com/deftio/quikleaf.git && cd quikleaf
npm install && npm run setup
npm run tauri:dev            # the app, with hot reload for the frontend
```

[docs/architecture.md](docs/architecture.md) is the map of the code.
[CLAUDE.md](CLAUDE.md) holds the working conventions in detail; it is written
for an AI pair but applies to people too.

## Making a change

A few conventions that are not obvious from the code:

- **The UI is bitwrench.** Every element is a TACO object, updates go through
  bitwrench verbs (`bw.patch`, `bw.toggleClass`, `bw.clear`), never
  `innerHTML`. Styles are `bw.css()` rules over CSS custom properties in
  `src/ui/theme.ts`; use the variables, not fixed colours or pixel sizes, so
  both themes and the font-size settings keep working.
- **The tab is the unit.** A document, its chat and its pane layout travel
  together. Open, save and close go through `src/editor/documents.ts`, not
  the editor directly.
- **Chat scope is a trust boundary.** A document chat may touch only its own
  document; file, search and tab tools belong to the project chat. A new tool
  is enforced in `dispatchTool` (`src/chat/chat-ui.ts`), not just left out of
  a schema. Update the tool-count assertions, `/tools`, `agents.md` and
  `docs/llm-integration.md` with it.
- **The model sees raw markdown only.** Nothing in the chat path produces or
  consumes HTML.
- **Keyboard shortcuts** join the chain in `src/main.ts`, not a new listener.

## Tests

Every change ships with its test. The gates are the ones the release runs:

```bash
npm run check                # TypeScript
npm run test:coverage        # vitest; fails under 90% lines/statements/functions, 85% branches
npm run test:e2e             # Playwright against the Vite dev server with Tauri mocked (e2e/mocks)
cd src-tauri && cargo test   # Rust, lib and bin targets
npm run release:dry          # all of the above plus the version checks, nothing pushed
```

Unit tests mount TACO into `#app` under happy-dom and tear down with
`bw.clear`. E2E tests drive the real frontend; Tauri commands are mocked in
`e2e/mocks/tauri-core.ts` (add a `case` for any new command). A real LLM is
never needed: script the stream with `customStreamHandler` as
`e2e/agentic.spec.ts` does.

## Docs

If a change is visible to a user, it shows up in the same pull request in:

- `CHANGELOG.md`, under the unreleased version, in plain sentences
- `README.md` if it changes how the app is used
- `agents.md` for anything an agent or external tool would care about (tools,
  the project file, the log, watching files)
- `llms.txt` and `docs/` where they describe the thing

## Pull requests

- Branch from `main`. Keep a PR to one topic.
- Commits and PRs are authored by you. If you used an AI tool, say so in the
  CHANGELOG entry's "AI assistance" line, the way existing entries do; do not
  add co-author trailers.
- CI runs the same gates as above. A green CI and a short description of
  what changed and why is all that is needed.

Releases are cut by the maintainer (`npm run feature`, `npm run release`);
contributors do not bump versions or tag.

## Code of conduct

Be straightforward and kind. Assume good faith, argue about the code rather
than the person, and take it to email (deftio@deftio.com) if a thread gets
heated. The maintainer will remove comments or participants that make the
project unpleasant for others.

## License

By contributing you agree that your contribution is licensed under the
project's [BSD 2-Clause license](LICENSE).
