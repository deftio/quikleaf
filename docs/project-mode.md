# Project Mode

Project mode gives qdedit folder-level awareness with a file tree sidebar, project-scoped file tools for the LLM, and persistent state.

## Launching

```bash
qdedit --project ./mydir
```

This creates (or loads) a `qdedit.prj` file in the specified directory.

## Features

### File Tree Sidebar

A collapsible sidebar shows the project's directory structure:

- Folders listed first, then files
- Hidden files (dotfiles) are filtered out
- `qdedit.prj` is hidden from the tree
- Click a file to open it in the editor
- Toggle visibility with the "Files" button in the title bar

### File Tools for QD

In project mode, QD gains four additional tools:

| Tool | Description |
|------|-------------|
| `file_read` | Read any file in the project |
| `file_write` | Create or update files |
| `file_list` | List directory contents |
| `file_stat` | Get file size and modification time |

All paths are relative to the project root. Path traversal outside the project root is blocked.

### Persistent Memory

The scratchpad (`/memory` slash command) persists across sessions in the `qdedit.prj` file. QD can use this to remember context between conversations.

### Key-Value Store

Named key-value pairs persist in `qdedit.prj`. Useful for QD to track structured data like preferences, project metadata, or task lists.

## Project File Format

`qdedit.prj` is a JSON file:

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
| Memory persistence | Session only | Saved to qdedit.prj |
| KV store | Session only | Saved to qdedit.prj |
| CLI | `qdedit file.md` | `qdedit --project ./dir` |
