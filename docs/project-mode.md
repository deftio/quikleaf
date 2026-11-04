# Project Mode

Project mode gives quikleaf folder-level awareness with a file tree sidebar, project-scoped file tools for the LLM, and persistent state.

## Launching

```bash
quikleaf --project ./mydir               # a folder
quikleaf --project ./mydir/quikleaf.prj  # or the project file itself
```

This loads the folder's project file, or creates one: `.quikleaf/quikleaf.prj` by default, so the project root stays clean (Settings → Project → Project file location can put `quikleaf.prj` in the root instead; a folder that already has either is used as is, and a file named on the command line is used as named). Add `.quikleaf/` to `.gitignore` if the chats should not travel with the repository. The file is rewritten a few hundred milliseconds after every change to the open tabs, the active file, the scratchpad or the key-value store, and flushed when the window closes. On the next launch every project tab is reopened and the active one focused.

## Features

### File Tree Sidebar

A collapsible sidebar shows the project's directory structure:

- Folders listed first, then files
- Hidden files and folders (dotfiles, including `.quikleaf/`) are filtered out
- `quikleaf.prj` is hidden from the tree
- Click a file to open it in a tab (an open tab is focused instead of duplicated); the highlight follows the active tab
- Toggle visibility with the "Files" button at the left end of the tab's control row (pressed while the tree is shown); the tree opens in the body row under it
- Cmd/Ctrl+S saves the open file back through the project-scoped file tools

### The Project Chat

Each document tab's chat sees only its own document. Cross-file work happens in the **project chat**: View → Project Chat opens a "Project" tab with no editor, just a chat whose tools work on files under the project root by path:

| Tool | Description |
|------|-------------|
| `file_read` | Read any file in the project |
| `file_write` | Create or update a file (always by path; there is no "current document" in this chat) |
| `file_list` | List directory contents |
| `file_stat` | Get file size and modification time |
| `project_search` | Find text across the project (skips `.git`, `node_modules`, `target`, `dist`, `.venv`, `__pycache__`, dotdirs) |
| `tabs_list` | Which project files are open in tabs (files from outside the root are not listed) |
| `tab_open` | Open a project file in an editor tab |

Project file writes made by QD are shown as a diff card and wait for Accept / Reject by default (Settings > Agent).

All paths are relative to the project root. Path traversal outside the project root is blocked. A document chat that asks for a file tool gets an error naming its own document; this is enforced at dispatch, not by the prompt.

### Persistent Memory

The scratchpad (`/memory` slash command) persists across sessions in the `quikleaf.prj` file. It is the project's: the project chat and the chats of files under the root share it, so QD can carry context between those conversations. A file opened from outside the root does not get the memory tools.

### Key-Value Store

Named key-value pairs persist in `quikleaf.prj`, with the same scope as the scratchpad. Useful for QD to track structured data like preferences, project metadata, or task lists.

### Chats are saved with the project

Every project file's chat (the visible transcript, that chat's model override and the tab's pane layout) and the project chat are written to `quikleaf.prj` and restored when the file is reopened on the next launch. Untitled documents and files outside the root are not saved.

## Project File Format

The project file (`.quikleaf/quikleaf.prj`, or `quikleaf.prj` in the root) is JSON with camelCase keys (written by the Rust backend):

```json
{
  "version": 1,
  "projectRoot": "/absolute/path/to/dir",
  "openFile": "docs/readme.md",
  "openTabs": ["readme.md", "docs/readme.md"],
  "chatHistory": {
    "version": 1,
    "tabs": {
      "docs/readme.md": {
        "transcript": [{ "role": "user", "text": "tighten the intro" }, { "role": "assistant", "text": "Done — QD" }],
        "model": null,
        "view": { "chat": true, "info": false, "mode": "split" }
      }
    },
    "project": null
  },
  "memory": "User prefers concise responses.",
  "kv": {
    "project_name": { "value": "My Project", "created": "2026-11-01T18:00:00Z", "modified": "2026-11-01T18:00:00Z" }
  },
  "log": [],
  "preferences": {}
}
```

`chatHistory` holds each open project file's chat by path and the project chat (see `agents.md` for the fields). `log` and `preferences` are reserved for later and written empty. quikleaf owns the file while it is running; edit it by hand only when the app is closed (see `agents.md`).

## Simple Mode vs Project Mode

| Feature | Simple Mode | Project Mode |
|---------|------------|--------------|
| File editing | Single file | Any file in project |
| File tree sidebar | No | Yes |
| Document chat per tab | Yes | Yes |
| Project chat (file tools) | No | Yes (View → Project Chat) |
| Scratchpad and KV store | Not offered | Project files and the project chat; saved to quikleaf.prj |
| Chats saved | No | Project files' chats and the project chat, in quikleaf.prj |
| CLI | `quikleaf file.md` | `quikleaf --project ./dir` |
