//! Command-line help and version: the two flags that print and exit before
//! a window opens. Parsing of the launch mode itself lives in `main.rs` /
//! `lib.rs` (`parse_cli_args_from`) and of the flags in `project.rs`
//! (`launch_flags_from`); this module only knows the names, for the help
//! text and for warning about options nobody recognises.
//!
//! On Windows the release build has no console (`windows_subsystem =
//! "windows"`), so this output is only visible when quikleaf is started
//! through the npm launcher, which prints the same text itself.

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The flags the app understands, so `unknown_flags` can tell the rest apart.
pub const KNOWN_FLAGS: &[&str] = &["--project", "--watch", "--log", "-h", "--help", "-V", "--version"];

/// What `--help` prints.
pub fn help_text() -> String {
    format!(
        "quikleaf {VERSION}
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

Flags go before or after the file: `quikleaf notes.md --watch` and
`quikleaf --watch notes.md` are the same.

Docs: https://github.com/deftio/quikleaf#readme
"
    )
}

/// What `--version` prints.
pub fn version_text() -> String {
    format!("quikleaf {VERSION}\n")
}

/// A request to print something and exit instead of opening a window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EarlyExit {
    Help,
    Version,
}

impl EarlyExit {
    pub fn text(self) -> String {
        match self {
            EarlyExit::Help => help_text(),
            EarlyExit::Version => version_text(),
        }
    }
}

/// `-h`/`--help` wins over `-V`/`--version`; either may sit anywhere after the
/// program name. The value after `--project` is never read as a flag.
pub fn early_exit(args: &[String]) -> Option<EarlyExit> {
    let mut found = None;
    for (i, a) in args.iter().enumerate().skip(1) {
        if i > 1 && args[i - 1] == "--project" {
            continue;
        }
        match a.as_str() {
            "-h" | "--help" => return Some(EarlyExit::Help),
            "-V" | "--version" => found = Some(EarlyExit::Version),
            _ => {}
        }
    }
    found
}

/// Dash-prefixed arguments quikleaf does not know, in order. The app still
/// launches; `main` prints a warning per flag so a typo is not silent.
/// Single-dash arguments other than `-h`/`-V` are left alone (macOS passes
/// `-psn_…` to apps opened from Finder).
pub fn unknown_flags(args: &[String]) -> Vec<String> {
    args.iter()
        .enumerate()
        .skip(1)
        .filter(|(i, a)| a.starts_with("--") && !KNOWN_FLAGS.contains(&a.as_str()) && !(*i > 1 && args[i - 1] == "--project"))
        .map(|(_, a)| a.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn help_names_every_flag_and_the_version() {
        let h = help_text();
        for f in ["--project", "--watch", "--log", "-h, --help", "-V, --version"] {
            assert!(h.contains(f), "help lacks {f}");
        }
        assert!(h.starts_with(&format!("quikleaf {VERSION}\n")));
        assert!(!h.contains('—'), "help uses a plain hyphen, not an em dash");
    }

    #[test]
    fn version_is_the_crate_version() {
        assert_eq!(version_text(), format!("quikleaf {}\n", env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn help_and_version_flags_are_found_anywhere() {
        assert_eq!(early_exit(&a(&["quikleaf", "--help"])), Some(EarlyExit::Help));
        assert_eq!(early_exit(&a(&["quikleaf", "-h"])), Some(EarlyExit::Help));
        assert_eq!(early_exit(&a(&["quikleaf", "notes.md", "--version"])), Some(EarlyExit::Version));
        assert_eq!(early_exit(&a(&["quikleaf", "-V"])), Some(EarlyExit::Version));
        assert_eq!(early_exit(&a(&["quikleaf", "--version", "--help"])), Some(EarlyExit::Help), "help wins");
    }

    #[test]
    fn ordinary_launches_do_not_exit_early() {
        assert_eq!(early_exit(&a(&["quikleaf"])), None);
        assert_eq!(early_exit(&a(&["quikleaf", "notes.md", "--watch"])), None);
        assert_eq!(early_exit(&a(&["quikleaf", "--project", "./docs", "--log"])), None);
        // The program name and a --project value are never flags.
        assert_eq!(early_exit(&a(&["--help"])), None);
        assert_eq!(early_exit(&a(&["quikleaf", "--project", "--help"])), None);
    }

    #[test]
    fn unknown_flags_are_listed_known_ones_are_not() {
        assert_eq!(unknown_flags(&a(&["quikleaf", "notes.md", "--watch", "--log"])), Vec::<String>::new());
        assert_eq!(unknown_flags(&a(&["quikleaf", "--verbose", "notes.md", "--wtch"])), a(&["--verbose", "--wtch"]));
        assert_eq!(unknown_flags(&a(&["quikleaf", "--project", "--odd-dir-name"])), Vec::<String>::new());
        assert_eq!(unknown_flags(&a(&["quikleaf", "-psn_0_12345"])), Vec::<String>::new());
    }
}
