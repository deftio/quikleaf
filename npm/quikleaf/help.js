/**
 * `--help` / `--version` for the launcher. Printed here, before the binary is
 * looked up or downloaded, so they work on a fresh machine and on Windows,
 * where the app itself has no console to print to. Keep the wording in step
 * with src-tauri/src/commands/cli.rs.
 */

function helpText(version) {
  return `quikleaf ${version}
A local markdown editor with a chat per document.

Usage:
  quikleaf [options] [file]
  quikleaf --project <dir|file.prj> [options]

Arguments:
  file                 A markdown file to open.

Options:
  --project <path>     Project mode. A folder gives a file tree, the project
                       chat and a project file; a .prj file names the project.
  --watch              Reload the opened file when it changes on disk
                       (the Watch toggle; off by default).
  --log                Start on the log tab.
  -h, --help           Print this help and exit.
  -V, --version        Print the version and exit.

Flags go before or after the file: \`quikleaf notes.md --watch\` and
\`quikleaf --watch notes.md\` are the same.

Docs: https://github.com/deftio/quikleaf#readme
`;
}

function versionText(version) {
  return `quikleaf ${version}\n`;
}

/**
 * The text to print and exit with, or null to launch the app. `--help` wins
 * over `--version`; the value after `--project` is never read as a flag.
 */
function earlyExit(argv, version) {
  let found = null;
  for (let i = 0; i < argv.length; i++) {
    if (i > 0 && argv[i - 1] === "--project") continue;
    const a = argv[i];
    if (a === "-h" || a === "--help") return helpText(version);
    if (a === "-V" || a === "--version") found = versionText(version);
  }
  return found;
}

module.exports = { helpText, versionText, earlyExit };
