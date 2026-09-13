# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Build & dev loop

- `npm run build` — webpack production build. Outputs the plugin package root `dist/` plus the bazaar asset `package.zip` in the repo root.
- `npm run dev` — webpack watch mode, but it emits `index.js` / `index.css` / `i18n/` to the repo root: only `npm run build` fills `dist/`.
- Build artifacts are gitignored (`dist/`, `package.zip`, `index.js`, `index.css`, `/i18n`) — after a build the SiYuan instance picks it up via the symlink `<workspace>/data/plugins/ref-crumbs-siyuan` → `dist/`; reload the plugin in SiYuan (disable/enable or restart) to see changes.
- There are no tests and no type checking: esbuild-loader only strips types and `tsc` runs in no script or CI job. `npm run lint` (eslint --fix) and `npm run format` (dprint) are the only checks; `npm run format:check` verifies without writing.
- Format only the files you touched. dprint mandates LF while the working tree is checked out with CRLF, and several committed files (README bullet style, `scripts/*.mjs` import order) are not dprint-clean — a repo-wide `npm run format` rewrites unrelated files.
- npm is the package manager in practice (`package-lock.json`, `npm ci` in CI) even though `package.json` declares `packageManager: pnpm`.
- This is a pure frontend plugin: no kernel plugin, no kernel.js, do not add one unless the feature really needs it.

## Source conventions

- Comments in `src/` are Chinese — keep new ones Chinese too.
- Every user-facing string goes through `src/i18n/en.json` and `src/i18n/zh-CN.json` (read as `this.i18n.*`); add each new key to both files and keep the key sets identical.
- Settings persist through `loadData`/`saveData` into `<workspace>/data/storage/petal/<plugin>/settings.json`. A new setting must also be validated in `mergeSettings()` so a missing or invalid stored value falls back to the default.

## Bazaar manifest contract (PR check hard-fails)

- `plugin.json` `name` must equal the GitHub repo name (`ref-crumbs-siyuan`); `url` must be exactly `https://github.com/wmy2981/ref-crumbs-siyuan` (bazaar `checkURL` requires an exact owner/repo match).
- `backends`/`frontends`: if `"all"` is present it must be the ONLY value.
- Since no kernel.js ships, never declare `kernels`. If no funding, delete the whole `funding` field — an empty funding object is rejected.
- `icon` ≤ 64 KiB (suggested 160×160), `preview` ≤ 512 KiB (suggested 1024×768); PNG/JPEG/WebP/AVIF only, files must sit at the package root (i.e. `dist/`), never a subdirectory.
- Image sources live in `assets/` (`icon.svg` → `node scripts/render-icon.mjs` regenerates `icon.png` via sharp, run it from the repo root; `preview.html` is rendered to `preview.png` via a 1024×768 browser screenshot). After editing either source, re-render and rebuild — the files inside `dist/` are flat copies, not the sources. A missing PNG is filtered out silently, so the build still passes and only the listing breaks.

## Release flow

Releases are published by `.github/workflows/release.yml` on every push:

1. Bump `version` in `plugin.json` and `package.json` (semver, no `v` prefix) → commit → push. A mismatch between the two fails the run.
2. The workflow runs `npm ci` + `npm run build`, then compares the manifest version with the highest `v*` tag: higher → tag the commit, create the Release (notes grouped from Conventional Commits by `scripts/release-notes.mjs`, which skips merges and version-bump commits) and upload `package.zip`; equal → skip the release; lower → the run fails. `package.zip` is uploaded as a build artifact whenever the build succeeded.
3. The tag uses the `v` prefix; bazaar checks the Latest Release, so no manual `npm run build` / `gh release create` is needed.
4. First listing: PR to `siyuan-note/bazaar` that only appends `wmy2981/ref-crumbs-siyuan` to its root `plugins.txt`. Later versions need no PR: the bazaar index auto-updates every 1-3 hours by pulling new releases.
5. If an already-listed package does not show up after a while, look for the repo under `stage-fail` label issues or check the bazaar Stage workflow logs; a common cause is a version that was not bumped in the manifest.

## SiYuan target

- `minAppVersion` is 3.6.0. The plugin depends on the official API `/api/block/getBlockBreadcrumb`, the `.protyle-hint .b3-list-item` markup, the search panel's `[data-type="search-item"]` items, and a `window.fetch` monkey-patch that captures the `searchRefBlock` notebook parameter — check all of these against the SiYuan source for the targeted version before bumping the minimum.
