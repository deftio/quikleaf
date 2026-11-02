/**
 * install.js — postinstall: download the quikleaf binary for this platform.
 *
 * The npm package is only a launcher. The binaries live on the GitHub release
 * that matches this package's version (`vX.Y.Z`), as the archives the release
 * workflow attaches:
 *
 *   quikleaf-darwin-aarch64.tar.gz, quikleaf-darwin-x86_64.tar.gz,
 *   quikleaf-linux-x86_64.tar.gz, quikleaf-windows-x86_64.zip
 *
 * The binary is unpacked into bin-fallback/ next to this file; bin/quikleaf
 * runs it from there. A failed download is a warning, not an install error,
 * and prints the manual options.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const VERSION = require("./package.json").version;

const ASSETS = {
  "darwin-arm64": "quikleaf-darwin-aarch64.tar.gz",
  "darwin-x64": "quikleaf-darwin-x86_64.tar.gz",
  "linux-x64": "quikleaf-linux-x86_64.tar.gz",
  "win32-x64": "quikleaf-windows-x86_64.zip",
};

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function main() {
  const platformKey = `${process.platform}-${process.arch}`;
  const asset = ASSETS[platformKey];

  if (!asset) {
    // Unsupported platform — skip silently (bin/quikleaf explains at run time).
    return;
  }

  const binName = process.platform === "win32" ? "quikleaf.exe" : "quikleaf";
  const destDir = path.join(__dirname, "bin-fallback");
  const destPath = path.join(destDir, binName);

  if (fs.existsSync(destPath)) {
    return; // Already downloaded for this install
  }

  const url = `https://github.com/deftio/quikleaf/releases/download/v${VERSION}/${asset}`;

  console.log(`quikleaf: downloading binary for ${platformKey} (v${VERSION})...`);

  try {
    const data = await download(url);

    fs.mkdirSync(destDir, { recursive: true });
    const tmpFile = path.join(destDir, asset);
    fs.writeFileSync(tmpFile, data);

    if (asset.endsWith(".tar.gz")) {
      execSync(`tar xzf "${tmpFile}" -C "${destDir}"`, { stdio: "ignore" });
    } else if (process.platform === "win32") {
      execSync(`powershell -Command "Expand-Archive -Path '${tmpFile}' -DestinationPath '${destDir}' -Force"`, { stdio: "ignore" });
    } else {
      execSync(`unzip -o "${tmpFile}" -d "${destDir}"`, { stdio: "ignore" });
    }
    fs.unlinkSync(tmpFile);

    if (!fs.existsSync(destPath)) {
      throw new Error(`archive did not contain ${binName}`);
    }
    if (process.platform !== "win32") {
      fs.chmodSync(destPath, 0o755);
    }

    console.log(`quikleaf: installed ${binName} for ${platformKey}`);
  } catch (e) {
    console.warn(
      `quikleaf: failed to download binary (${e.message})\n` +
      `\n` +
      `Options:\n` +
      `  1. Download manually from: https://github.com/deftio/quikleaf/releases/tag/v${VERSION}\n` +
      `  2. Build from source:\n` +
      `     git clone https://github.com/deftio/quikleaf.git && cd quikleaf\n` +
      `     npm install && npm run setup && npm run tauri:build`
    );
  }
}

main();
