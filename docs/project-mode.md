# Project Mode

Project mode gives quikleaf folder-level awareness with a file tree sidebar, project-scoped file tools for the LLM, and persistent state.

## Launching

```bash
quikleaf --project ./mydir
```

This creates (or loads) a `quikleaf.prj` file in the specified directory.

## Features

### File Tree Sidebar

A collapsible sidebar shows the project's directory structure:

- Folders listed first, then files
- Hidden files (dotfiles) are filtered out
- `quikleaf.prj` is hidden from the tree
- Click a file to open it in a tab (an open tab is focused instead of duplicated); the highlight follows the active tab
- Toggle visibility with the "Files" toggle button in the title bar (it stays highlighted while the tree is shown)
- Cmd/Ctrl+S saves the open file back through the project-scoped file tools

### File Tools for QD

In project mode, QD gains four additional tools:

| Tool | Description |
|------|-------------|
| `file_read` | Read any file in the project |
| `file_write` | Create or update files |
| `file_list` | List directory contents |
| `file_stat` | Get file size and modification time |
| `project_search` | Find text across the project (skips `.git`, `node_modules`, `target`, `dist`, dotdirs) |
| `tab_open` | Open a project file in an editor tab |

Project file writes made by QD are shown as a diff card and wait for Accept / Reject by default (Settings > Agent).

All paths are relative to the project root. Path traversal outside the project root is blocked.

### Persistent Memory

The scratchpad (`/memory` slash command) persists across sessions in the `quikleaf.prj` file. QD can use this to remember context between conversations.

### Key-Value Store

Named key-value pairs persist in `quikleaf.prj`. Useful for QD to track structured data like preferences, project metadata, or task lists.

## Project File Format

`quikleaf.prj` is a JSON file:

```json
{
  "project_root": "/absolute/path/to/dir",
  "open_file": "docs/readme.md",
  "memory": "User prefers concise responses.",
  "kv": {
    "project_name": "My Project",
    "last_task": "Refactored auth module"
  }
}
```

## Simple Mode vs Project Mode

| Feature | Simple Mode | Project Mode |
|---------|------------|--------------|
| File editing | Single file | Any file in project |
| File tree sidebar | No | Yes |
| File tools for QD | No | Yes |
| Memory persistence | Session only | Saved to quikleaf.prj |
| KV store | Session only | Saved to quikleaf.prj |
| CLI | `quikleaf file.md` | `quikleaf --project ./dir` |
