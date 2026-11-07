# Privacy

quikleaf is a desktop editor. Your documents are files on your disk, and
the app has no account, no sync, no telemetry and no update check. This
page lists everything that leaves the machine and everything the app
stores, so you can decide what to point it at.

## What leaves the machine

**Chat requests, to the LLM host you configured.** Nothing is sent until
you send a message. A request carries the system prompt, the conversation
of that one chat, the tool definitions, and whatever the model asked to
read through tools: the chat's own document in a document chat, or the
project files it asked for by path in the project chat. The chat's scope
is enforced in the dispatcher, so a document chat cannot send another tab's
text. Requests go through the Rust backend, not the webview, with the API
key as a header. If the host is local (Ollama, LM Studio, Docker Model
Runner), nothing leaves the machine at all. If the host is a service, that
service's privacy terms apply to what you send it.

**Fetch Models**, in Settings, asks the configured host for its model list.

**One download by the npm launcher.** `npx quikleaf` or `npm install -g
quikleaf` installs a small launcher with no binaries inside. On first run it
downloads the release archive for your platform from this repository's
GitHub release of the same version into a per-user cache, and nothing
after that.

**Preview content you put in a document.** Map fences fetch tiles from
OpenStreetMap, and a Vega or Vega-Lite spec can name an external data URL;
those requests happen when the preview renders. Everything else in the
preview (Mermaid, math, charts, 3D, highlighting, the offline basemap) is
bundled and renders without a network.

**Links you click** open in your system browser.

That is the whole list. There is no crash reporting, no usage analytics
and no "check for updates" call.

## What is stored on the machine

| What | Where | Holds |
|------|-------|-------|
| Settings | the webview's localStorage for the app, under your user profile | provider, host, model, API key (plain text), display and appearance switches, edit-approval policy |
| Project file | `.quikleaf/quikleaf.prj` in the project folder, or `quikleaf.prj` in its root per Settings → Project | open tabs, the active file, each project file's chat transcript and model override, the project chat, the scratchpad, the key-value store |
| Performance log | the OS log folder (`~/Library/Logs/com.deftio.quikleaf/`, `~/.local/share/com.deftio.quikleaf/logs/`, `%LOCALAPPDATA%\com.deftio.quikleaf\logs\`) | timings, provider, model and host names, tool names, and the paths of files that failed to open or were reloaded. Never document text, never keys. Off with Settings → Diagnostics. |
| Pasted images | an `images/` folder beside the document | the image you pasted |
| Launcher cache | `~/Library/Caches/quikleaf`, `~/.cache/quikleaf`, `%LOCALAPPDATA%\quikleaf\cache` (or `QUIKLEAF_CACHE_DIR`) | the downloaded release binary |

Chat transcripts in the project file can contain whatever you and the model
wrote. Add `.quikleaf/` to `.gitignore` if that should not travel with a
repository. The API key is not encrypted at rest; treat Settings like a
config file, and rotate the key if the machine is shared (see
[SECURITY.md](SECURITY.md)).

## The website

[deftio.github.io/quikleaf](https://deftio.github.io/quikleaf/) is a static
page on GitHub Pages. It asks the GitHub API for the latest release tag to
label the download buttons, and it uses GoatCounter for a page-view count
without cookies or personal identifiers. GitHub's own terms cover the Pages
hosting and the release downloads.

## Questions

Email deftio@deftio.com. Security reports go the same way; see
[SECURITY.md](SECURITY.md).
