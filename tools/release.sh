#!/usr/bin/env bash
#
# release.sh — preflight checks, merge feature branch to main, push.
# CI handles tagging and publishing automatically after merge.
#
# Usage:
#   npm run release
#
# Run this from your feature branch when you're ready to ship.
#
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

die()  { echo -e "${RED}ERROR: $*${NC}" >&2; exit 1; }
info() { echo -e "${GREEN}$*${NC}"; }
warn() { echo -e "${YELLOW}$*${NC}"; }

# --- preflight ---------------------------------------------------------------

BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Must NOT be on main (you release FROM a feature branch)
[ "$BRANCH" != "main" ] || die "Must be on a feature branch, not main.\n  The release script merges your feature branch into main."

# Clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  die "Working tree is dirty. Commit or stash changes first."
fi

# --- read version ------------------------------------------------------------

VERSION=$(node -p "require('./package.json').version")
[ -n "$VERSION" ] || die "Could not read version from package.json"
TAG="v${VERSION}"

info "Branch:  $BRANCH"
info "Version: $VERSION"
info "Tag:     $TAG"
echo ""

# --- check version is new ----------------------------------------------------

info "=== Checking version ==="
node tools/checkVersion.cjs || die "Version check failed. Bump the version before releasing."
echo ""

# --- verify versions are in sync --------------------------------------------

CARGO_VERSION=$(grep '^version' src-tauri/Cargo.toml | head -1 | sed 's/version = "\(.*\)"/\1/')
TAURI_VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")

if [ "$VERSION" != "$CARGO_VERSION" ]; then
  die "Cargo.toml version ($CARGO_VERSION) does not match package.json ($VERSION).\n  Use 'npm run feature' to bump versions consistently."
fi
if [ "$VERSION" != "$TAURI_VERSION" ]; then
  die "tauri.conf.json version ($TAURI_VERSION) does not match package.json ($VERSION).\n  Use 'npm run feature' to bump versions consistently."
fi
info "  All version files in sync: $VERSION"
echo ""

# --- run quality gates -------------------------------------------------------

info "=== TypeScript check ==="
npx tsc --noEmit || die "TypeScript check failed."
echo ""

info "=== Running unit tests ==="
npm test || die "Unit tests failed. Fix failures before releasing."
echo ""

if [ "${SKIP_PLAYWRIGHT:-}" != "1" ]; then
  info "=== Running E2E tests ==="
  npx playwright install chromium 2>/dev/null || true
  npm run test:e2e || die "E2E tests failed. Fix failures before releasing."
  echo ""
else
  warn "=== Skipping E2E tests (SKIP_PLAYWRIGHT=1) ==="
  echo ""
fi

info "=== Rust check ==="
(cd src-tauri && cargo check) || die "Rust check failed."
echo ""

info "=== Rust tests ==="
(cd src-tauri && cargo test) || die "Rust tests failed."
echo ""

# --- capture any drift and commit it before releasing -------------------------

if ! git diff --quiet || ! git diff --cached --quiet; then
  warn "Tests produced uncommitted changes."
  warn "Committing them to '$BRANCH' before squash-merging."
  git add -A
  git commit -m "chore: refresh artifacts for ${TAG}" || die "Auto-commit of drift failed."
  echo ""
fi

# --- show summary ------------------------------------------------------------

COMMIT_COUNT=$(git rev-list --count main..HEAD 2>/dev/null || echo "?")
info "=== Preflight passed ==="
info "  Branch:  $BRANCH"
info "  Version: $VERSION ($TAG)"
info "  Commits: $COMMIT_COUNT since main"
echo ""

warn "This will:"
warn "  1. Push $BRANCH to origin"
warn "  2. Create a PR to main"
warn "  3. Auto-merge after CI passes (squash)"
warn "  4. Tag $TAG and trigger release workflow"
echo ""

read -r -p "Proceed? [y/N] " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# --- push branch and create PR -----------------------------------------------

info "\nPushing $BRANCH to origin..."
git push -u origin "$BRANCH" || die "Push failed."

info "\nCreating PR..."
PR_URL=$(gh pr create \
  --title "release ${TAG}" \
  --body "Automated release from \`${BRANCH}\`.

## Changes
$(git log --oneline main..HEAD | sed 's/^/- /')" \
  2>&1) || die "PR creation failed: $PR_URL"

info "PR created: $PR_URL"

info "\nEnabling auto-merge (squash)..."
gh pr merge --squash --auto || warn "Auto-merge not available — merge manually after CI passes."

info "\n=== Release $TAG submitted ==="
info "CI will run on the PR. After merge, push the tag to trigger the release workflow:"
echo "  git checkout main && git pull"
echo "  git tag $TAG && git push origin $TAG"
echo ""
info "Monitor at:"
echo "  $PR_URL"
echo "  https://github.com/deftio/quikleaf/actions"
