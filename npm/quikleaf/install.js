/**
 * install.js — fetch the quikleaf binary for this platform, on first run.
 *
 * The npm package is only a launcher. The binaries live on the GitHub release
 * that matches this package's version (`vX.Y.Z`), as the archives the release
 * workflow attaches:
 *
 *   quikleaf-darwin-aarch64.tar.gz, quikleaf-darwin-x86_64.tar.gz,
 *   quikleaf-linux-x86_64.tar.gz, quikleaf-windows-x86_64.zip
 *
 * This is deliberately NOT a postinstall script. npm 12 blocks install-time
 * lifecycle scripts for `npm install -g` and `npx` unless the user opts in,
 * so bin/quikleaf calls `ensureBinary()` the first time it runs instead. The
 * binary is unpacked into a per-user cache directory keyed by version, so
 * `npx quikleaf`, a global install and an upgrade all find or fetch the right
 * one without writing into node_modules.
 */

const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const VERSION = require("./package.json").version;

const ASSETS = {
  "darwin-arm64": "quikleaf-darwin-aarch64.tar.gz",
  "darwin-x64": "quikleaf-darwin-x86_64.tar.gz",
  "linux-x64": "quikleaf-linux-x86_64.tar.gz",
  "win32-x64": "quikleaf-windows-x86_64.zip",
};

const SUPPORTED = Object.keys(ASSETS);
const RELEASE_URL = `https://github.com/deftio/quikleaf/releases/tag/v${VERSION}`;

function platformKey() {
  return `${process.platform}-${process.arch}`;
}

function binName() {
  return process.platform === "win32" ? "quikleaf.exe" : "quikleaf";
}

/** Per-user cache dir for this version's binary. */
function cacheDir() {
  let base;
  if (process.env.QUIKLEAF_CACHE_DIR) base = process.env.QUIKLEAF_CACHE_DIR;
  else if (process.platform === "darwin") base = path.join(os.homedir(), "Library", "Caches", "quikleaf");
  else if (process.platform === "win32") base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "quikleaf", "cache");
  else base = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "quikleaf");
  return path.join(base, `v${VERSION}`);
}

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("too many redirects"));
    https.get(url, { headers: { "User-Agent": `quikleaf-launcher/${VERSION}` } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function extract(archive, destDir) {
  if (archive.endsWith(".tar.gz")) {
    execSync(`tar xzf "${archive}" -C "${destDir}"`, { stdio: "ignore" });
  } else if (process.platform === "win32") {
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${archive}' -DestinationPath '${destDir}' -Force"`, { stdio: "ignore" });
  } else {
    execSync(`unzip -o "${archive}" -d "${destDir}"`, { stdio: "ignore" });
  }
}

/**
 * Return the path of the binary for this platform, downloading it from the
 * GitHub release of this package's version if it is not cached yet.
 * Throws with a readable message on an unsupported platform or a failed
 * download; bin/quikleaf prints it.
 */
async function ensureBinary(log = console.error) {
  const key = platformKey();
  const asset = ASSETS[key];
  if (!asset) {
    throw new Error(
      `unsupported platform ${key}\n` +
      `Supported: ${SUPPORTED.join(", ")}\n` +
      `Download manually: ${RELEASE_URL}`
    );
  }

  const dir = cacheDir();
  const dest = path.join(dir, binName());
  if (fs.existsSync(dest)) return dest;

  const url = `https://github.com/deftio/quikleaf/releases/download/v${VERSION}/${asset}`;
  log(`quikleaf: first run, downloading v${VERSION} for ${key} ...`);

  let data;
  try {
    data = await download(url);
  } catch (e) {
    throw new Error(
      `failed to download ${url} (${e.message})\n` +
      `\n` +
      `Options:\n` +
      `  1. Download manually from: ${RELEASE_URL}\n` +
      `  2. Build from source:\n` +
      `     git clone https://github.com/deftio/quikleaf.git && cd quikleaf\n` +
      `     npm install && npm run setup && npm run tauri:build`
    );
  }

  fs.mkdirSync(dir, { recursive: true });
  const archive = path.join(dir, asset);
  fs.writeFileSync(archive, data);
  try {
    extract(archive, dir);
  } finally {
    try { fs.unlinkSync(archive); } catch (_) { /* best effort */ }
  }

  if (!fs.existsSync(dest)) {
    throw new Error(`archive ${asset} did not contain ${binName()}; see ${RELEASE_URL}`);
  }
  if (process.platform !== "win32") fs.chmodSync(dest, 0o755);
  log(`quikleaf: installed to ${dest}`);
  return dest;
}

module.exports = { ensureBinary, cacheDir, platformKey, SUPPORTED, VERSION };

// `node install.js` still works as an explicit pre-fetch (for example in a
// Dockerfile), it is just no longer wired to postinstall.
if (require.main === module) {
  ensureBinary().then(
    (p) => console.log(p),
    (e) => { console.error(`quikleaf: ${e.message}`); process.exit(1); }
  );
}
