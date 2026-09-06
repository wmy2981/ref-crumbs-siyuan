# Ref Crumbs

A SiYuan plugin that shows the heading breadcrumbs (h2 → h6) of each block in the block reference (`((`) search list.

## Features

- Appends the heading chain of each result block in the `((` search list, e.g. `## Section Two › ### Section Three`
- The heading chain is shown alongside the existing hPath (notebook/document tree path) with a distinct look:
  - hPath: document tree path (grey small text, `/` separated)
  - heading chain: tinted pill style with theme-colored `#` prefixes, level expressed by the `#` count
- Data source: the official API `/api/block/getBlockBreadcrumb`, no kernel modification needed
- `notebook` parameter is passed through automatically for encrypted notebooks

## Notes

- Only h2~h6 are shown; the document heading (h1) is omitted (it duplicates the document name)
- The search list is rebuilt on each keystroke; the plugin locates items by block id, with a concurrency limit (4) and result caching

## Build

```bash
npm install
npm run build
```

Output goes to `dist/`.
