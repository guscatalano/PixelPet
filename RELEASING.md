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

## Microsoft Store (MSIX)

The Store build is a **separate track** from the GitHub Releases above — the Store signs
the package (no SmartScreen) and manages updates, so the in-app auto-updater turns itself
off inside a Store build (`process.windowsStore`). It is **not** attached to GitHub Releases.

The identity is already registered in Partner Center and wired into `build.appx` in
`package.json`:

| Field | Value |
|-------|-------|
| Identity Name | `GusCatalano.PixelPets` |
| Publisher | `CN=119E0257-3B74-437C-A728-AC7C50256853` |
| Publisher Display Name | `Gus Catalano` |
| Package Family Name | `GusCatalano.PixelPets_hbnb01h0zx9vj` |
| Store ID | `9MZ89Q1DGR0R` |

Store tile art (Square/Wide/Splash/StoreLogo PNGs) is generated into `assets/` by
`npm run gen:icons`, and electron-builder picks it up by filename.

### Build & submit

1. **Prerequisite:** the Windows 10/11 SDK must be installed (electron-builder needs
   `makeappx.exe`). Build on a Windows machine (or CI runner).
2. Bump the version if needed (the Store rejects re-uploading the same version).
3. Package the appx:

   ```bash
   npm run pack:store   # -> release/PixelPet <version>.appx
   ```

   electron-builder leaves it unsigned; **the Store signs it on ingestion**, so don't sign
   it yourself for a Store submission.
4. In [Partner Center](https://partner.microsoft.com/dashboard) → PixelPets → **Packages**,
   upload the `.appx`. Fill in the store listing (description, screenshots), then submit.
5. After it passes certification it goes live; the **Store deep link / web URL** appear then
   and can back a `winget` entry.

## Not done yet / roadmap

- **Code signing (direct download).** The GitHub-release installer/portable are still
  **unsigned**, so users hit a SmartScreen "unknown publisher" warning (documented in the
  README). Adding a cert (e.g. Azure Trusted Signing) removes it — plug the credentials into
  the workflow and electron-builder signs automatically. (The Store build doesn't need this.)
- **winget.** Once the Store listing is live (or the signed direct download exists), submit a
  manifest to [`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs) so users
  can `winget install PixelPet`.

## Manual build (local, no publish)

```bash
npm run dist   # builds + packages into release/ without publishing
```
