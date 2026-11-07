# Security

## Reporting a vulnerability

Email **deftio@deftio.com** with "quikleaf security" in the subject. Please
do not open a public issue for anything that could be exploited before it is
fixed. Include the version (About → version pill), the platform, and steps
to reproduce. You will get an acknowledgement within a few days and a fix or
a plan as soon as the problem is understood. Credit in the changelog is
yours if you want it.

Supported: the latest release. Older versions are not patched; upgrade.

## What quikleaf does with your data

[PRIVACY.md](PRIVACY.md) is the fuller statement of what leaves the machine
and what is stored where. The short version:

- **Files stay local.** Documents are read and written by the app on your
  machine. There is no sync, no telemetry, no update check.
- **The only network traffic is to the LLM host you configure**, and it goes
  through the Rust backend, not the webview. The request carries the
  document the chat belongs to (a document chat) or the project files the
  chat asked for (the project chat), the conversation, and the system prompt.
  Nothing is sent until you send a message. A local host (Ollama, LM Studio,
  Docker Model Runner) keeps everything on the machine.
- **API keys** are stored in the webview's localStorage for the app, in
  plain text, under the user's profile, alongside the other settings. They are sent only to the host you
  set. Treat the settings store like a config file: do not share screenshots
  of Settings, and rotate a key if a machine is shared.
- **The performance log** (`quikleaf-perf.jsonl` in the OS log folder) holds
  timings, model and host names, tool names, and the paths of files that
  failed to open or were reloaded. It never holds document text or keys. It
  can be turned off in Settings → Diagnostics.
- **The project file** (`.quikleaf/quikleaf.prj`) holds the open tabs, each
  project file's chat transcript, the scratchpad and the key-value store.
  Chat transcripts can contain whatever you and the model wrote. Add
  `.quikleaf/` to `.gitignore` if that should not travel with a repository.

## Boundaries that are enforced in code

- **Chat scope.** A document chat can read and change only its own document;
  the project chat can touch only files under the project root, by path.
  Out-of-scope tool calls are refused where tools are dispatched, not merely
  left out of the schema, so a model cannot talk its way across.
- **Project paths** are resolved and checked against the root; `..` and
  symlinks that escape are refused.
- **Webview file access** is the Tauri fs plugin's scope: files you picked in
  a dialog, named on the command line, or dropped on the window. The app's
  `asset://` scheme serves image files only.
- **The model never sees or produces HTML.** Rendering is quikdown's, with
  its sanitizer; raw HTML in markdown is off unless you turn it on.
- **The command line tool installer** writes a shim only from a release
  build; a development build refuses, since its shim would point at a
  binary that needs the Vite dev server.
- **Edits can be reviewed.** By default the model's writes to project files
  wait for Accept; Settings → Agent can require review for every edit.

## Known gaps

- macOS builds are not signed or notarized yet. Gatekeeper warns on the
  `.dmg`; the npm launcher's download does not carry the quarantine flag.
  Verify what you run: releases are built by GitHub Actions from tagged
  commits in this repository, and the npm package is published with
  provenance (OIDC trusted publishing) from the same workflow.
- Keys in localStorage are not encrypted at rest. Using the OS keychain is
  on the list.
- The LLM proxy trusts the host you configure, including plain `http://`
  for local servers. Do not point it at a remote host over plain HTTP.

## Dependencies

Rust dependencies are pinned by `Cargo.lock`, npm dependencies by
`package-lock.json`. The rendering bundle is quikdown, the UI library is
bitwrench, both maintained by the same author under the same policy. Report
a problem in either to its own repository, or here if you are unsure.
