# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

PixelPet is an Electron (electron-vite + TypeScript) desktop pet for Windows and macOS. See README.md for the feature list and RELEASING.md for the release runbooks.

## Commands

```bash
npm run dev          # run with hot reload (predev regenerates icons)
npm run typecheck    # tsc on tsconfig.node.json (main/preload) AND tsconfig.web.json (renderer) — what CI gates on
npm run build        # compile to out/
npm run dist         # Windows NSIS + portable into release/ (no publish)
npm run pack:store   # unsigned MSIX/appx for the Microsoft Store (needs Windows SDK)
```

There is no test runner. Correctness checks are standalone "proof" scripts that exit non-zero on failure:

```bash
npm run proof:coords   # src/main/desktop/coords.ts — Electron window-coord safety
npm run proof:wander   # src/main/behavior/wander.ts — Independence trait moves the pet the right way
npm run build && npx electron scripts/climbProof.mjs   # live: pet climbs a decoy window (Windows only)
```

`coordProof`/`wanderProof` transpile the real `.ts` module with esbuild and import it, so they only work for modules with no imports. Follow that pattern (pure, import-free module + proof script) for new logic that needs verification.

Screenshots are generated, not captured: `npm run shots:readme` (→ `docs/screenshots/`, committed) and `npm run shots:store` (→ `store-assets/`, ignored). Both need `npm run build` first.

## Architecture

**Main process owns the pet's brain; the renderer only draws.** `src/main/behavior/engine.ts` runs a 16 ms physics/behaviour tick: it moves the pet's `BrowserWindow`, picks ambient behaviour weighted by personality (`personality.ts`, `wander.ts`), applies Care Mode decay (`care/needs.ts`), and sends `pet:play` (`PlayCommand {clip, facing}`) and `pet:walk-step` to the renderer. The renderer (`src/renderer/pet/main.ts`) plays clips through an animation graph and reports back `pet:clip-ended` / `pet:state-reached`. Interaction (hover, click, drag) goes renderer → main as triggers. `ClipName` in `src/shared/types.ts` is the contract between the two sides.

**Windows.** Each HTML entry in `electron.vite.config.ts` is a separate `BrowserWindow` with its own preload bridge: `pet` (transparent always-on-top overlay with per-pixel click-through), `settings`, `dream` (photo bubble), `item` (draggable care items), `string` (toy), `sonar`, `knocked`. Adding a window means adding both a renderer input and (if it needs IPC) a preload input there. `src/main/index.ts` creates the windows and registers all `ipcMain` handlers (`pet:*`, `settings:*`, `care:*`, `ai:*`, `immich:*`, `pets:*`, `dream:*`).

**Desktop world.** On Windows, `src/main/desktop/windows.ts` enumerates top-level windows via koffi FFI (Win32); `world.ts` turns them into ledges the pet stands on. koffi is a native dep — kept external by `externalizeDepsPlugin` and excluded from the mac build. macOS uses the floor only.

**Any computed coordinate passed to `setPosition`/`setBounds`/`getDisplayNearestPoint` must go through `winCoord`/`clampWinCoord` in `src/main/desktop/coords.ts`.** `Math.round` can yield `-0`, which Electron rejects with a throw inside the physics interval and crashes the app (this happened in the field).

**Pets are data, rendered procedurally — no sprite sheets.** A pet is DNA (geometry, coat, marking, personality) from `src/shared/petdna.ts` / `pets.ts`, drawn at runtime by:
- `shared/catgen.ts` — front view, curled sleep, walk grid; owns the rasterizer and the "detail" supersample factor (`setDetail`). All geometry is authored in a 44×44 unit space.
- `shared/rigcat.ts` — articulated side-view rig; poses are joint sets interpolated with `lerpPose`.
- `shared/turn34.ts` — ¾ head-turn derived from the front pose.

Collars are an accessory stored per pet, not part of DNA. Creature packs (`packs/*.pixelpet.json`, format in `packs/README.md`) are validated/clamped DNA.

**Mirrored tooling copies.** `scripts/catgen.mjs`, `scripts/rigcat.mjs`, `scripts/turn34.mjs` are plain-JS mirrors of the `src/shared` renderers (detail factor 1 only) used by the preview/gallery/demo scripts. Geometry/pose changes to the TS renderers should be mirrored there. Some scripts (e.g. `climbProof.mjs`, `dnaProof.mjs`) also duplicate constants from `engine.ts` / `petdna.ts` — keep them in sync.

**AI pet generation** (`src/main/ai/`): a vision provider (OpenAI or Anthropic) maps photos → PetDNA. API keys (and the Immich key in `dream/immich.ts`) are encrypted via the OS keychain (`secrets.ts`, `safeStorage`), never written to `settings.json`.

**Store vs direct builds.** `process.windowsStore` disables the in-app updater (`updater.ts`) and start-on-boot handling. Direct downloads auto-update from GitHub Releases via electron-updater.

## Releases

- `npm run release:patch|minor|major` bumps, commits "Release vX.Y.Z", tags, and pushes; the `v*` tag triggers `build.yml` (draft GitHub Release, Windows then macOS) and `store.yml` (MSIX + Store submission using `store/listing.en-us.json`).
- Convention: each release is preceded by a "Document vX.Y.Z: …" commit adding a user-facing entry to `CHANGELOG.md` (plain-language, written for users, grouped New / Changed / Fixed).
