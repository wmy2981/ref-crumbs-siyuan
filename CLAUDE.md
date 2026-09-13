# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & dev loop

- `npm run build` — webpack production build. Outputs the plugin package root `dist/` plus the bazaar asset `package.zip` in the repo root.
- `npm run dev` — webpack watch mode. `npm run format` (dprint) and `npm run lint` (eslint --fix) are configured.
- Build artifacts are gitignored (`dist/`, `package.zip`, `index.js`, `index.css`, `/i18n`) — after editing source, rebuild and the SiYuan instance picks it up via the symlink `<workspace>/data/plugins/ref-crumbs-siyuan` → `dist/`; reload the plugin in SiYuan (disable/enable or restart) to see changes.
- This is a pure frontend plugin: no kernel plugin, no kernel.js, do not add one unless the feature really needs it.

## Bazaar manifest contract (PR check hard-fails)

- `plugin.json` `name` must equal the GitHub repo name (`ref-crumbs-siyuan`); `url` must be exactly `https://github.com/wmy2981/ref-crumbs-siyuan` (bazaar `checkURL` requires an exact owner/repo match).
- `backends`/`frontends`: if `"all"` is present it must be the ONLY value.
- Since no kernel.js ships, never declare `kernels`. If no funding, delete the whole `funding` field — an empty funding object is rejected.
- `icon` ≤ 64 KiB (suggested 160×160), `preview` ≤ 512 KiB (suggested 1024×768); PNG/JPEG/WebP/AVIF only, files must sit at the package root (i.e. `dist/`), never a subdirectory.
- Image sources live in `assets/` (`icon.svg` → `scripts/render-icon.mjs` regenerates `icon.png` via sharp; `preview.html` is rendered to `preview.png` via a browser screenshot). After editing either source, re-render and rebuild — the files inside `dist/` are flat copies, not the sources.

## Release flow

Releases are published by `.github/workflows/release.yml` on every push:

1. Bump `version` in `plugin.json` and `package.json` (semver, no `v` prefix) → commit → push. A mismatch between the two fails the run.
2. The workflow runs `npm ci` + `npm run build`, then compares the manifest version with the highest `v*` tag: higher → tag the commit, create the Release (notes grouped from Conventional Commits by `scripts/release-notes.mjs`, which skips merges and version-bump commits) and upload `package.zip`; equal → skip the release; lower → the run fails. Either way `package.zip` is uploaded as a build artifact.
3. The tag uses the `v` prefix; bazaar checks the Latest Release, so no manual `npm run build` / `gh release create` is needed.
4. First listing: PR to `siyuan-note/bazaar` that only appends `wmy2981/ref-crumbs-siyuan` to its root `plugins.txt`. Later versions need no PR: the bazaar index auto-updates every 1-3 hours by pulling new releases.
5. If an already-listed package does not show up after a while, look for the repo under `stage-fail` label issues or check the bazaar Stage workflow logs; a common cause is a version that was not bumped in the manifest.

## SiYuan target

- `minAppVersion` is 3.6.0; the feature relies on the official API `/api/block/getBlockBreadcrumb` and the `.protyle-hint` DOM structure — verify API/DOM changes against the siyuan-source checkout before bumping the minimum version.
