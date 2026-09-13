# Ref Crumbs

[简体中文](README.zh-CN.md) | English

Show the heading chain of every block in SiYuan's block reference search, so you can tell which section a reference actually lives in.

![Block reference search with heading breadcrumbs](assets/preview.png)

## What it does

SiYuan's `((` search list shows the document path of each result, but not where the block sits inside that document. Ref Crumbs appends the block's heading chain to the same line:

```
第二轮迭代上线总结
产品手册/版本发布/复盘/  ## 里程碑复盘 · ### 第二轮迭代
```

- Works in the `((` reference list, and optionally in the search panel (off by default)
- Shows h2 – h6 only; the document title is already in the path
- When the block itself is a heading, it is appended as the last level; turn that option off to keep only the headings above it
- Keeps the look of the document path, and wraps when the line runs out of room
- Long heading names can be collapsed with an ellipsis (off by default), level by level, so a long h3 never hides the h2 above it
- Marker (`##` / `h2` / `H₂` / none), separator (`·` `/` `-` `~` `>`) and the collapse length are configurable

## Install

- **Bazaar** — Settings → Bazaar → Plugins, search `Ref Crumbs`
- **Manual** — copy `dist/` into `<workspace>/data/plugins/ref-crumbs-siyuan/`, then enable the plugin in Settings → Plugins

## Settings

Settings → Bazaar → Ref Crumbs.

| Option | Default |
| --- | --- |
| Breadcrumbs in the block reference list | on |
| Breadcrumbs in the search panel | off |
| Heading level marker | `##` |
| Heading level separator | `·` |
| Include the block's own heading | on |
| Collapse long heading names | off |
| Maximum heading name length | 12 characters |

## Notes

- Requires SiYuan 3.6.0 or later, works with encrypted notebooks
- Pure frontend plugin: nothing is changed in the kernel and no SQL permission is needed

## Build

```bash
npm install
npm run build
```

Output: `dist/` (plugin package) and `package.zip` (bazaar asset).

## License

MIT License, see [LICENSE](./LICENSE).
