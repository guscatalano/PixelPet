# Releasing PixelPet

PixelPet ships as a Windows NSIS installer + portable `.exe`, published to
[GitHub Releases](https://github.com/guscatalano/PixelPet/releases). Installed
copies update themselves from those releases via `electron-updater`.

## How it works

- **`.github/workflows/build.yml`** builds on every push/PR (uploading artifacts so
  `main` always has a working build) and, when a **`vX.Y.Z` tag** is pushed, runs
  `electron-builder --publish always` to attach the installer + portable exe to a
  GitHub Release.
- `electron-builder` creates the release as a **draft**. You review it and click
  **Publish** — that's the moment it goes live and auto-update starts serving it to users.
- On launch (installed app only), `electron-updater` checks the latest published release,
  downloads a newer version in the background, and shows **"Restart to update"** in the tray.

> **Requirement:** the GitHub repo must be **public** (or the app must carry a token) for
> auto-update to reach it. PixelPet is public, so nothing to do.

## Cutting a release

1. **Land your changes on `main`.** Work on a branch, open a PR, let CI go green, merge.
2. **Make sure the tree is clean** (`git status`) and you're on `main` (`git pull`).
3. **Bump the version + tag** with one command — this edits `package.json`, commits, and
   creates the `vX.Y.Z` tag:

   ```bash
   npm run release:patch   # 0.1.0 -> 0.1.1   (bug fixes)
   npm run release:minor   # 0.1.0 -> 0.2.0   (new features)
   npm run release:major   # 0.1.0 -> 1.0.0   (breaking / "1.0")
   ```

   Each script runs `npm version …` (commit + tag) then `git push --follow-tags`, which
   pushes the commit and the tag. The tag push is what triggers the release build.
4. **Watch the build** in the Actions tab. When it finishes, a **draft release** appears.
5. **Edit the release notes**, then click **Publish release**. Auto-update now serves it.
6. **Smoke-test:** download the installer from the release, run it, confirm the pet launches.

## Versioning

[SemVer](https://semver.org/), staying in `0.x` while pre-1.0:

- **patch** — bug fixes, tweaks, no new surface.
- **minor** — new features, backwards-compatible (the usual bump during 0.x).
- **major** — reserved for the first stable `1.0.0` and later breaking changes.

Keep a short human-readable summary in the GitHub release notes (what changed, any caveats).

## Not done yet / roadmap

- **Code signing.** Releases are currently **unsigned**, so users hit a SmartScreen
  "unknown publisher" warning (documented in the README). Adding a signing cert
  (e.g. Azure Trusted Signing) removes it — plug the credentials into the workflow and
  electron-builder signs automatically.
- **winget.** Once releases are stable, submit a manifest to
  [`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs) so users can
  `winget install PixelPet`.

## Manual build (local, no publish)

```bash
npm run dist   # builds + packages into release/ without publishing
```
