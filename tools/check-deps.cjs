/**
 * check-deps.cjs — Cross-platform dependency checker for quikleaf (Tauri v2).
 *
 * Detects the current platform, checks for required build dependencies, and
 * prints clear install instructions when anything is missing.
 *
 * Exit codes:
 *   0 — all critical deps found (or SKIP_SETUP=1)
 *   1 — one or more critical deps missing
 *
 * Set SKIP_SETUP=1 to bypass all checks (useful in CI or for experienced devs).
 */
const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Color helpers (TTY-aware)
// ---------------------------------------------------------------------------
const isTTY = process.stdout.isTTY;
const RED    = isTTY ? '\x1b[31m' : '';
const GREEN  = isTTY ? '\x1b[32m' : '';
const YELLOW = isTTY ? '\x1b[33m' : '';
const BOLD   = isTTY ? '\x1b[1m'  : '';
const RESET  = isTTY ? '\x1b[0m'  : '';

const CHECK = `${GREEN}OK${RESET}`;
const CROSS = `${RED}MISSING${RESET}`;
const WARN  = `${YELLOW}MISSING (optional)${RESET}`;

// ---------------------------------------------------------------------------
// Skip guard
// ---------------------------------------------------------------------------
if (process.env.SKIP_SETUP === '1') {
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Platform / distro detection
// ---------------------------------------------------------------------------
const platform = os.platform(); // 'linux' | 'darwin' | 'win32'

/** Parse /etc/os-release into a key-value map. */
function getLinuxDistro() {
  try {
    const raw = fs.readFileSync('/etc/os-release', 'utf8');
    const map = {};
    for (const line of raw.split('\n')) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq);
      let val = line.slice(eq + 1);
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      map[key] = val;
    }
    return map;
  } catch (_e) {
    return {};
  }
}

/** Map os-release ID to a distro family. */
function distroFamily(osRelease) {
  const id = (osRelease.ID || '').toLowerCase();
  const idLike = (osRelease.ID_LIKE || '').toLowerCase();

  if (['ubuntu', 'debian', 'linuxmint', 'pop', 'elementary', 'zorin', 'raspbian'].includes(id)) return 'debian';
  if (['fedora', 'rhel', 'centos', 'rocky', 'alma'].includes(id)) return 'fedora';
  if (['arch', 'manjaro', 'endeavouros'].includes(id)) return 'arch';
  if (['opensuse', 'opensuse-tumbleweed', 'opensuse-leap', 'sles'].includes(id)) return 'suse';

  // Fallback to ID_LIKE
  if (idLike.includes('debian') || idLike.includes('ubuntu')) return 'debian';
  if (idLike.includes('fedora') || idLike.includes('rhel')) return 'fedora';
  if (idLike.includes('arch')) return 'arch';
  if (idLike.includes('suse')) return 'suse';

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Probe helpers
// ---------------------------------------------------------------------------

/** Return true if a command exits successfully. */
function hasCommand(cmd) {
  try {
    execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 });
    return true;
  } catch (_e) {
    return false;
  }
}

/** Return true if `pkg-config --exists <lib>` succeeds. */
function hasPkgConfig(lib) {
  return hasCommand(`pkg-config --exists ${lib}`);
}

/** Get version string from a command, or null. */
function getVersion(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }).trim().split('\n')[0];
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dependency definitions per platform
// ---------------------------------------------------------------------------

/**
 * Each entry: { name, check(), critical, detail? }
 *   check() — returns truthy (string = version info) if found, falsy if missing
 *   critical — if true, missing means exit 1
 */

function linuxDeps() {
  return [
    // Build toolchain
    { name: 'rustc',       check: () => getVersion('rustc --version'),       critical: true  },
    { name: 'cargo',       check: () => getVersion('cargo --version'),       critical: true  },
    { name: 'node',        check: () => getVersion('node --version'),        critical: true  },
    { name: 'gcc',         check: () => hasCommand('gcc --version'),         critical: true  },
    { name: 'pkg-config',  check: () => hasCommand('pkg-config --version'),  critical: true  },
    { name: 'patchelf',    check: () => hasCommand('patchelf --version'),    critical: false },
    { name: 'curl',        check: () => hasCommand('curl --version'),        critical: false },
    { name: 'wget',        check: () => hasCommand('wget --version'),        critical: false },

    // Libraries (via pkg-config)
    { name: 'webkit2gtk-4.1', check: () => hasPkgConfig('webkit2gtk-4.1'), critical: true  },
    { name: 'openssl',        check: () => hasPkgConfig('openssl'),        critical: true  },
    { name: 'librsvg-2.0',    check: () => hasPkgConfig('librsvg-2.0'),    critical: true  },
    { name: 'ayatana-appindicator3-0.1', check: () => hasPkgConfig('ayatana-appindicator3-0.1'), critical: false },
  ];
}

function darwinDeps() {
  return [
    { name: 'Xcode CLT',  check: () => hasCommand('xcode-select -p'),      critical: true  },
    { name: 'rustc',       check: () => getVersion('rustc --version'),      critical: true  },
    { name: 'cargo',       check: () => getVersion('cargo --version'),      critical: true  },
    { name: 'node',        check: () => getVersion('node --version'),       critical: true  },
  ];
}

function win32Deps() {
  const vsWherePaths = [
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',
    'C:\\Program Files\\Microsoft Visual Studio\\Installer\\vswhere.exe',
  ];
  function hasVS() {
    for (const p of vsWherePaths) {
      try {
        if (fs.existsSync(p)) {
          const out = execSync(`"${p}" -latest -property displayName`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }).trim();
          return out || true;
        }
      } catch (_e) { /* continue */ }
    }
    return false;
  }
  function hasWebView2() {
    try {
      execSync('reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv', {
        stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
      });
      return true;
    } catch (_e) {
      return false;
    }
  }

  return [
    { name: 'Visual Studio Build Tools', check: hasVS,       critical: true  },
    { name: 'WebView2 Runtime',          check: hasWebView2,  critical: true  },
    { name: 'rustc',  check: () => getVersion('rustc --version'), critical: true  },
    { name: 'cargo',  check: () => getVersion('cargo --version'), critical: true  },
    { name: 'node',   check: () => getVersion('node --version'),  critical: true  },
  ];
}

// ---------------------------------------------------------------------------
// Install instructions per distro family
// ---------------------------------------------------------------------------

const LINUX_PACKAGES = {
  debian: {
    // command deps
    'gcc':         'build-essential',
    'pkg-config':  'pkg-config',
    'patchelf':    'patchelf',
    'curl':        'curl',
    'wget':        'wget',
    // libraries
    'webkit2gtk-4.1': 'libwebkit2gtk-4.1-dev',
    'openssl':        'libssl-dev',
    'librsvg-2.0':    'librsvg2-dev',
    'ayatana-appindicator3-0.1': 'libayatana-appindicator3-dev',
  },
  fedora: {
    'gcc':         'gcc-c++',
    'pkg-config':  'pkg-config',
    'patchelf':    'patchelf',
    'curl':        'curl',
    'wget':        'wget',
    'webkit2gtk-4.1': 'webkit2gtk4.1-devel',
    'openssl':        'openssl-devel',
    'librsvg-2.0':    'librsvg2-devel',
    'ayatana-appindicator3-0.1': 'libappindicator-gtk3-devel',
  },
  arch: {
    'gcc':         'base-devel',
    'pkg-config':  'pkgconf',
    'patchelf':    'patchelf',
    'curl':        'curl',
    'wget':        'wget',
    'webkit2gtk-4.1': 'webkit2gtk-4.1',
    'openssl':        'openssl',
    'librsvg-2.0':    'librsvg',
    'ayatana-appindicator3-0.1': 'libayatana-appindicator',
  },
  suse: {
    'gcc':         'gcc-c++',
    'pkg-config':  'pkg-config',
    'patchelf':    'patchelf',
    'curl':        'curl',
    'wget':        'wget',
    'webkit2gtk-4.1': 'webkit2gtk3-devel',
    'openssl':        'libopenssl-devel',
    'librsvg-2.0':    'librsvg-devel',
    'ayatana-appindicator3-0.1': 'libayatana-appindicator3-1',
  },
};

function buildInstallCmd(family, missingNames) {
  const pkgMap = LINUX_PACKAGES[family];
  if (!pkgMap) return null;

  const packages = [];
  for (const name of missingNames) {
    const pkg = pkgMap[name];
    if (pkg) packages.push(pkg);
  }
  if (packages.length === 0) return null;

  const cmds = {
    debian: `sudo apt install ${packages.join(' ')}`,
    fedora: `sudo dnf install ${packages.join(' ')}`,
    arch:   `sudo pacman -S ${packages.join(' ')}`,
    suse:   `sudo zypper install ${packages.join(' ')}`,
  };
  return cmds[family] || null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`${BOLD}quikleaf: checking build dependencies...${RESET}\n`);

let deps;
let family = null;
let osRelease = {};

if (platform === 'linux') {
  osRelease = getLinuxDistro();
  family = distroFamily(osRelease);
  const distroName = osRelease.PRETTY_NAME || osRelease.ID || 'Linux';
  console.log(`  Platform:  Linux (${distroName})`);
  if (family === 'unknown') {
    console.log(`  ${YELLOW}Warning: unrecognized distro — falling back to Debian package names${RESET}`);
    family = 'debian';
  }
  deps = linuxDeps();
} else if (platform === 'darwin') {
  console.log('  Platform:  macOS');
  deps = darwinDeps();
} else if (platform === 'win32') {
  console.log('  Platform:  Windows');
  deps = win32Deps();
} else {
  console.log(`  ${YELLOW}Unsupported platform: ${platform} — skipping dependency check${RESET}`);
  process.exit(0);
}

console.log('');

const missing = [];
const missingOptional = [];

for (const dep of deps) {
  const result = dep.check();
  if (result) {
    const info = typeof result === 'string' ? ` (${result})` : '';
    console.log(`  ${CHECK}  ${dep.name}${info}`);
  } else if (dep.critical) {
    console.log(`  ${CROSS}  ${dep.name}`);
    missing.push(dep.name);
  } else {
    console.log(`  ${WARN}  ${dep.name}`);
    missingOptional.push(dep.name);
  }
}

console.log('');

// --- Print install instructions if anything is missing ---

if (missing.length > 0 || missingOptional.length > 0) {
  const allMissing = [...missing, ...missingOptional];

  if (platform === 'linux') {
    const installCmd = buildInstallCmd(family, allMissing);
    if (installCmd) {
      console.log(`  Install missing packages:`);
      console.log(`  ${BOLD}${installCmd}${RESET}`);
      console.log('');
    }

    // rustc/cargo need special instruction
    if (missing.includes('rustc') || missing.includes('cargo')) {
      console.log(`  Install Rust:`);
      console.log(`  ${BOLD}curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh${RESET}`);
      console.log('');
    }
  } else if (platform === 'darwin') {
    if (missing.includes('Xcode CLT')) {
      console.log(`  Install Xcode Command Line Tools:`);
      console.log(`  ${BOLD}xcode-select --install${RESET}`);
      console.log('');
    }
    if (missing.includes('rustc') || missing.includes('cargo')) {
      console.log(`  Install Rust:`);
      console.log(`  ${BOLD}curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh${RESET}`);
      console.log('');
    }
    if (missing.includes('node')) {
      console.log(`  Install Node.js: https://nodejs.org/`);
      console.log('');
    }
  } else if (platform === 'win32') {
    if (missing.includes('Visual Studio Build Tools')) {
      console.log(`  Install Visual Studio Build Tools:`);
      console.log(`  ${BOLD}https://visualstudio.microsoft.com/visual-cpp-build-tools/${RESET}`);
      console.log(`  Select "Desktop development with C++" workload`);
      console.log('');
    }
    if (missing.includes('WebView2 Runtime')) {
      console.log(`  Install WebView2 Runtime:`);
      console.log(`  ${BOLD}https://developer.microsoft.com/en-us/microsoft-edge/webview2/${RESET}`);
      console.log('');
    }
    if (missing.includes('rustc') || missing.includes('cargo')) {
      console.log(`  Install Rust:`);
      console.log(`  ${BOLD}https://www.rust-lang.org/tools/install${RESET}`);
      console.log('');
    }
    if (missing.includes('node')) {
      console.log(`  Install Node.js: https://nodejs.org/`);
      console.log('');
    }
  }
}

// --- Summary ---

if (missing.length > 0) {
  console.log(`${RED}${BOLD}${missing.length} critical dependency(ies) missing. Please install them before building.${RESET}`);
  console.log(`Set ${BOLD}SKIP_SETUP=1${RESET} to bypass this check.\n`);
  process.exit(1);
} else if (missingOptional.length > 0) {
  console.log(`${YELLOW}All critical dependencies found. ${missingOptional.length} optional dependency(ies) missing.${RESET}\n`);
} else {
  console.log(`${GREEN}All dependencies found. Ready to build.${RESET}\n`);
}
