#!/usr/bin/env bash
#
# feature.sh — create a feature branch with proper naming and auto-bump version.
#
# Usage:
#   npm run feature -- "<short-description>"
#   npm run feature -- "<short-description>" minor
#   npm run feature -- "<short-description>" major
#
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

die()  { echo -e "${RED}ERROR: $*${NC}" >&2; exit 1; }
info() { echo -e "${GREEN}$*${NC}"; }
warn() { echo -e "${YELLOW}$*${NC}"; }

# --- parse args --------------------------------------------------------------

NAME="${1:-}"
BUMP="${2:-patch}"

[ -n "$NAME" ] || die "Usage: npm run feature -- <short-description> [patch|minor|major]"
[[ "$BUMP" =~ ^(patch|minor|major)$ ]] || die "Bump type must be patch, minor, or major (got '$BUMP')."

# Sanitize branch name: lowercase, replace spaces/underscores with hyphens
BRANCH="feature/$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | tr ' _' '-' | sed 's/[^a-z0-9-]//g')"

# --- preflight ---------------------------------------------------------------

# Must be on main
CURRENT=$(git rev-parse --abbrev-ref HEAD)
[ "$CURRENT" = "main" ] || die "Must be on 'main' to start a feature (currently on '$CURRENT').\n  Run: git checkout main"

# Clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  die "Working tree is dirty. Commit or stash changes first."
fi

# Pull latest from origin
info "Pulling latest main from origin..."
if ! git pull origin main; then
  die "Failed to pull from origin. Check your network connection and remote config.\n  Run: git remote -v"
fi

# Verify local main matches origin/main
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/main 2>/dev/null || echo "unknown")
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ] && [ "$REMOTE_SHA" != "unknown" ]; then
  warn "WARNING: Local main ($LOCAL_SHA) differs from origin/main ($REMOTE_SHA)"
  warn "Your feature branch may not be based on the latest release."
  read -r -p "Continue anyway? [y/N] " CONFIRM
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

# --- read current version ----------------------------------------------------

CURRENT_VERSION=$(node -p "require('./package.json').version")
[ -n "$CURRENT_VERSION" ] || die "Could not read version from package.json"

# --- compute new version -----------------------------------------------------

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case "$BUMP" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

# --- create branch and bump --------------------------------------------------

git checkout -b "$BRANCH"

# Bump version in package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '${NEW_VERSION}';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Bump version in src-tauri/Cargo.toml
if [[ "$OSTYPE" == darwin* ]]; then
  sed -i '' "s/^version = \".*\"/version = \"${NEW_VERSION}\"/" src-tauri/Cargo.toml
else
  sed -i "s/^version = \".*\"/version = \"${NEW_VERSION}\"/" src-tauri/Cargo.toml
fi

# Bump version in src-tauri/tauri.conf.json
node -e "
  const fs = require('fs');
  const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  conf.version = '${NEW_VERSION}';
  fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n');
"

# Bump version in npm/quikleaf/package.json (version + optionalDependencies)
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('npm/quikleaf/package.json', 'utf8'));
  pkg.version = '${NEW_VERSION}';
  for (const dep of Object.keys(pkg.optionalDependencies || {})) {
    pkg.optionalDependencies[dep] = '${NEW_VERSION}';
  }
  fs.writeFileSync('npm/quikleaf/package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Bump version in npm platform packages
for platform in darwin-arm64 darwin-x64 linux-x64 win32-x64; do
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('npm/${platform}/package.json', 'utf8'));
    pkg.version = '${NEW_VERSION}';
    fs.writeFileSync('npm/${platform}/package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
done

git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json npm/quikleaf/package.json npm/darwin-arm64/package.json npm/darwin-x64/package.json npm/linux-x64/package.json npm/win32-x64/package.json
git commit -m "bump version to ${NEW_VERSION}"

info "\nCreated branch: $BRANCH"
info "Version bumped: $CURRENT_VERSION -> $NEW_VERSION"
info "\nReady to work. When done, run:"
echo "  npm run release"
