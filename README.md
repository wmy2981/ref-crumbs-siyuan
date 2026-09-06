# Ref Crumbs

A SiYuan plugin that shows the heading breadcrumb chain (h2 → h6) of each block in the block reference (`((`) search list.

## Features

- Shows the heading chain in every result item of the `((` block reference search list (except the `((newFile` / `((newSubDoc` create hints)
- The heading chain is visually distinct from the existing hPath: the level is expressed by the count of `#` prefixes (`##` / `###` / `####`)
- Only h2 → h6 are shown; h1 is omitted (the document heading duplicates the document name)
- When a result item itself is a heading block, the missing terminal name is filled in automatically from the block text
- Supports encrypted notebooks (`notebook` parameter is passed through)
- Pure frontend: powered by the official API `/api/block/getBlockBreadcrumb`; no kernel changes, no SQL permission required
- Performance guards: 4-way request pool + per-block result cache

## The Problem

By default, the SiYuan `((` search list shows only the **hPath** (notebook / document tree path) under each result, e.g.:

```
Release summary for v0.2
Team Notes/Product/Milestone Review/
```

The real position of a block, however, is often buried inside the document's heading structure. Ref Crumbs appends the block's **heading chain** to the right of the hPath:

```
Release summary for v0.2
Team Notes/Product/Milestone Review/  ## Milestone Review · ### v0.2 Launch
```

So you can see at a glance which section each reference candidate actually lives in.

## Screenshots

![preview](assets/preview.png)

## Installation

### Bazaar

Search "Ref Crumbs" in the SiYuan bazaar (Settings → Bazaar → Plugins), install and enable it.

### Manual

1. Copy this directory (or the contents of `dist/`) to `<workspace>/data/plugins/ref-crumbs/`
2. Enable the plugin in Settings → Plugins

## Usage

Type `((` in any editor to trigger block reference search; the heading chain appears under each result item. No configuration required.

## Build

```bash
npm install
npm run build
```

Output goes to `dist/` (including `package.zip` for bazaar submission).

## License

MIT License, see [LICENSE](./LICENSE).
