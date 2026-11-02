# Publishing quikleaf

How a version gets from a commit on `main` to GitHub Releases and npm, who
is trusted at each step, and what the npm errors mean when it fails. Written
after v1.2.1 and v1.2.2, which each needed several tries to reach npm.

## The path

```
git push origin main          (version in package.json is new)
  └─ ci.yml  check            tests on ubuntu
     └─ ci.yml  tag           pushes v<version>, dispatches release.yml
        └─ release.yml build  4 platforms, GitHub Release + installers + archives
           └─ release.yml publish   dispatches publish.yml --ref v<version>
              └─ publish.yml        npm publish --provenance (OIDC, no token)
```

Nothing in that chain waits for a human. A push to `main` with a new version
ends on npm. The `feature` and `release` scripts in `tools/` are conveniences
in front of the push (version bump, local gates, PR); `main` is not protected
and a direct push does the same thing.

Two GitHub quirks shape the workflow files:

- Tags and releases created with the default `GITHUB_TOKEN` do not trigger
  other workflows. So `ci.yml` and `release.yml` both call `gh workflow run`
  explicitly instead of relying on `push: tags`.
- npm's trusted publisher is matched against the **filename** of the workflow
  that runs `npm publish`. That is why npm publishing is its own file,
  `publish.yml`, dispatched by `release.yml`, rather than a job inside it.

## Trust points

1. **GitHub → npm identity.** When `publish.yml` runs with `id-token: write`,
   GitHub mints a short-lived OIDC token that says: repository
   `deftio/quikleaf`, workflow file `publish.yml`, this commit, this run.
2. **npm's trusted publisher config.** On npmjs.com, package quikleaf →
   Settings → Trusted Publishing holds one configuration:
   GitHub Actions, owner `deftio`, repository `quikleaf`, workflow filename
   `publish.yml`, environment empty, allowed actions including direct
   `npm publish`. npm compares the OIDC token to this. A match may publish.
3. **Provenance.** npm signs a SLSA statement linking the published tarball
   to the source commit and the workflow run, and records it in the Sigstore
   transparency log. The npm page shows the provenance badge.
4. **No long-lived credential exists.** There is no `NPM_TOKEN` secret in the
   repository, and the package's publishing access is set to "Require
   two-factor authentication and disallow bypass 2fa tokens". The only way to
   publish is a run of `publish.yml` on `deftio/quikleaf`, or a maintainer at
   a terminal with 2FA.

## What the launcher is

The npm package `quikleaf` is a 4-file launcher, no binaries. On first run
`bin/quikleaf` downloads the archive for the platform from the GitHub release
of its own version (`quikleaf-darwin-aarch64.tar.gz` etc.) into a per-user
cache and runs it. So `publish.yml` refuses to publish unless the launcher's
version equals the tag and all four archives are attached to that release.

The launcher has no `postinstall` script on purpose. npm 12 blocks
install-time lifecycle scripts for `npm install -g` and `npx` unless the user
opts in per package, which would have left the launcher with nothing to run.

## Setting up the npm side (once per package)

1. The first version of a new package must be published by hand from a
   terminal with 2FA; OIDC cannot create a package.
2. npmjs.com → package → Settings → Publishing access: choose "Require
   two-factor authentication and disallow bypass 2fa tokens". This only
   restricts classic tokens and does not affect trusted publishing.
3. npmjs.com → package → Settings → Trusted Publishing → add GitHub Actions:
   owner `deftio`, repository `quikleaf`, workflow filename `publish.yml`,
   environment blank. Under **Allowed actions**, enable direct `npm publish`.
   Since May 2026 the form defaults to stage-only, which refuses `npm publish`.
4. Publish once within two days. The first successful publish validates the
   configuration; an unvalidated one expires and must be recreated.

npm does not validate the configuration when it is saved. Mistakes show up
only as the errors below, at publish time. Existing configurations cannot be
edited; delete and recreate.

## Reading the errors

All of these appear *after* "Signed provenance statement" in the log, because
provenance is signed client-side before the registry is asked anything. A
signed provenance line therefore does not mean the config is right.

| Error on `PUT https://registry.npmjs.org/quikleaf` | Meaning | Fix |
|---|---|---|
| `403 OIDC permission denied for this action` | A trusted publisher matched this run, but its allowed actions do not include `npm publish` (stage-only config). | Recreate the config with direct `npm publish` allowed, or switch the workflow to `npm stage publish` and approve each version with 2FA. |
| `404 Not Found ... could not be found or you do not have permission` | No trusted publisher matched this run's identity. npm returns 404 rather than say which field differs. | Compare owner, repository, filename (`publish.yml`, not `.yaml`, no path) and environment (must be blank) character by character. Or there is no config at all. |
| `ENEEDAUTH` / `Unable to authenticate` | No OIDC token was available: `id-token: write` missing, or a self-hosted runner. | Add the permission at job level; use GitHub-hosted runners. |
| `E403` with `NODE_AUTH_TOKEN` in use | A classic token was used and is blocked by the 2FA policy. | Remove the token; let OIDC authenticate. |

## Re-running a publish

The release and tag do not need to change. From any ref of this repository:

```bash
gh workflow run publish.yml --ref main -f tag=v1.2.2
gh run watch "$(gh run list --workflow publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

The job skips with a notice if that version is already on npm.

## Checking a published version

```bash
npm view quikleaf version dist-tags
npm view quikleaf@1.2.2 dist.attestations.url        # provenance attached
npm install -g --ignore-scripts quikleaf@1.2.2        # how npm 12 installs it
quikleaf                                              # first run downloads the binary
```
