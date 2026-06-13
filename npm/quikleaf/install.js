/**
 * install.js — postinstall fallback for when optionalDependencies are disabled.
 *
 * Checks if the platform binary was installed via optionalDependencies.
 * If not, downloads it from the GitHub release.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execSync } = require("child_process");

const VERSION = require("./package.json").version;

const PLATFORMS = {
  "darwin-arm64":  { pkg: "@deftio/quikleaf-darwin-arm64", asset: "quikleaf-darwin-aarch64.tar.gz" },
  "darwin-x64":    { pkg: "@deftio/quikleaf-darwin-x64",   asset: "quikleaf-darwin-x86_64.tar.gz" },
  "linux-x64":     { pkg: "@deftio/quikleaf-linux-x64",    asset: "quikleaf-linux-x86_64.tar.gz" },
  "win32-x64":     { pkg: "@deftio/quikleaf-win32-x64",    asset: "quikleaf-windows-x86_64.zip" },
};

function alreadyInstalled(pkg, binName) {
  try {
    const pkgDir = path.dirname(require.resolve(`${pkg}/package.json`));
    return fs.existsSync(path.join(pkgDir, "bin", binName));
  } catch (_e) {
    return false;
  }
}

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
  const info = PLATFORMS[platformKey];

  if (!info) {
    // Unsupported platform — skip silently (user will get error at runtime)
    return;
  }

  const binName = process.platform === "win32" ? "quikleaf.exe" : "quikleaf";

  // Check if optionalDependencies already provided the binary
  if (alreadyInstalled(info.pkg, binName)) {
    return;
  }

  const destDir = path.join(__dirname, "bin-fallback");
  const destPath = path.join(destDir, binName);

  if (fs.existsSync(destPath)) {
    return; // Already downloaded
  }

  const url = `https://github.com/deftio/quikleaf/releases/download/v${VERSION}/${info.asset}`;

  console.log(`quikleaf: downloading binary for ${platformKey}...`);

  try {
    const data = await download(url);

    fs.mkdirSync(destDir, { recursive: true });

    if (info.asset.endsWith(".tar.gz")) {
      // Write tar.gz, extract with tar
      const tmpFile = path.join(destDir, info.asset);
      fs.writeFileSync(tmpFile, data);
      execSync(`tar xzf "${tmpFile}" -C "${destDir}"`, { stdio: "ignore" });
      fs.unlinkSync(tmpFile);
    } else if (info.asset.endsWith(".zip")) {
      // Write zip, extract
      const tmpFile = path.join(destDir, info.asset);
      fs.writeFileSync(tmpFile, data);
      if (process.platform === "win32") {
        execSync(`powershell -Command "Expand-Archive -Path '${tmpFile}' -DestinationPath '${destDir}'"`, { stdio: "ignore" });
      } else {
        execSync(`unzip -o "${tmpFile}" -d "${destDir}"`, { stdio: "ignore" });
      }
      fs.unlinkSync(tmpFile);
    }

    // Set executable permission
    if (process.platform !== "win32" && fs.existsSync(destPath)) {
      fs.chmodSync(destPath, 0o755);
    }

    console.log(`quikleaf: installed ${binName} for ${platformKey}`);
  } catch (e) {
    console.warn(
      `quikleaf: failed to download binary (${e.message})\n` +
      `Download manually from: https://github.com/deftio/quikleaf/releases`
    );
  }
}

main();
