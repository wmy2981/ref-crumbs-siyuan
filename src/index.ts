import {Plugin} from "siyuan";
import {
    DEFAULT_SETTINGS,
    ISettings,
    mergeSettings,
    STORAGE_NAME,
} from "./settings";
import "./index.scss";

// `/api/block/getBlockBreadcrumb` 返回值项，参见 kernel/model/blockinfo.go 中的 BlockPath
interface IBreadcrumb {
    id: string;
    name: string;
    type: string;
    subType: string;
}

// 每次 hint 列表里可请求的数量上限：搜索返回全部块，太多请求会阻塞
const MAX_CONCURRENT = 4;

// `((` 引用搜索提示面板
const HINT_ITEM_SELECTOR = ".protyle-hint .b3-list-item";
// 搜索面板（页签与 Ctrl+P 对话框共用同一份模板）结果项；未引用列表同款模板
const SEARCH_ITEM_SELECTOR = '[data-type="search-item"]';
const ITEM_SELECTOR = `${HINT_ITEM_SELECTOR}, ${SEARCH_ITEM_SELECTOR}`;
const CRUMB_CLASS = "ref-crumbs__crumbs";
const CRUMB_SEARCH_CLASS = "ref-crumbs__crumbs--search";
const DATASET_DONE = "rcDone";
const DATASET_MOUNTED = "rcMounted";

export default class RefCrumbs extends Plugin {
    private originalFetch: typeof window.fetch;
    private hookedFetch: typeof window.fetch;
    private lastRefSearchNotebook = "";
    private observer: MutationObserver;
    private crumbCache = new Map<string, string>();
    private pendingIDs = new Set<string>();
    private queue: {id: string; notebook: string;}[] = [];
    private activeCount = 0;
    private settings: ISettings = {...DEFAULT_SETTINGS};

    async onload() {
        let stored: unknown;
        try {
            stored = await this.loadData(STORAGE_NAME);
        } catch {
            // 首次安装或读取失败，用默认值
        }
        this.settings = mergeSettings(stored);
        this.hookFetchRequest();
        this.installObserver();
        this.preloadHints();
    }

    onunload() {
        if (window.fetch === this.hookedFetch) {
            window.fetch = this.originalFetch;
        }
        this.observer?.disconnect();
    }

    /**
     * 记录最近一次 `/api/search/searchRefBlock` 请求中的 notebook 参数（加密笔记本需要透传）。
     * 页面内同一时刻只会有一个块引用搜索面板，记录一个值足够。
     */
    private hookFetchRequest() {
        this.originalFetch = window.fetch.bind(window);
        const hooked: typeof window.fetch = (input: RequestInfo, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input.url;
            if (url.includes("/api/search/searchRefBlock") && init?.body) {
                try {
                    const body = JSON.parse(init.body as string);
                    this.lastRefSearchNotebook = body.notebook || "";
                } catch (_) {
                    // 请求体不是 JSON 时忽略
                }
            }
            return this.originalFetch(input, init);
        };
        this.hookedFetch = hooked;
        window.fetch = hooked;
    }

    private installObserver() {
        this.observer = new MutationObserver((mutations) => {
            const items = new Set<HTMLElement>();
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node instanceof HTMLElement) {
                        if (node.matches(ITEM_SELECTOR)) {
                            items.add(node);
                        } else if (node.querySelector) {
                            node.querySelectorAll(ITEM_SELECTOR).forEach((el) => {
                                items.add(el as HTMLElement);
                            });
                        }
                    }
                }
            }
            if (items.size > 0) {
                this.processItems(items);
            }
        });
        this.observer.observe(document.body, {childList: true, subtree: true});
    }

    /**
     * 插件加载时页面上可能已经存在列表（例如插件重载），初始扫描一次。
     */
    private preloadHints() {
        document.querySelectorAll(ITEM_SELECTOR).forEach((el) => {
            this.processItems(new Set<HTMLElement>([el as HTMLElement]));
        });
    }

    /**
     * 列表项对应的块 id：引用提示项挂在子元素 `.b3-list-item__first` 上，
     * 搜索结果项挂在列表项自身。资源搜索结果只有 `data-id`，取不到块 id 时跳过。
     */
    private itemID(item: HTMLElement): string {
        return item.dataset.nodeId || item.querySelector("[data-node-id]")?.getAttribute("data-node-id") || "";
    }

    private processItems(items: Set<HTMLElement>) {
        for (const item of items) {
            if (item.dataset[DATASET_DONE] === "1") {
                continue;
            }
            item.dataset[DATASET_DONE] = "1";
            if (!item.isConnected) {
                continue;
            }
            const id = this.itemID(item);
            if (!id) {
                // “新建文件/新建子文档”等无块 id 的提示项，或资源搜索结果
                continue;
            }
            if (this.crumbCache.has(id)) {
                this.paintIfMounted(item, this.crumbCache.get(id));
                continue;
            }
            // notebook 只对引用提示面板有意义：搜索面板的块可能来自任意笔记本，
            // 透传别的笔记本会让内核按该笔记本路由 blocktree 而查不到块。
            this.enqueue(id, item.dataset.type === "search-item" ? "" : this.lastRefSearchNotebook);
        }
    }

    private enqueue(id: string, notebook: string) {
        if (this.crumbCache.has(id) || this.pendingIDs.has(id)) {
            return;
        }
        this.pendingIDs.add(id);
        this.queue.push({id, notebook});
        this.pump();
    }

    /**
     * 并发池：同一时间最多发 MAX_CONCURRENT 个面包屑请求，避免大量文档树加载阻塞。
     */
    private pump() {
        while (this.activeCount < MAX_CONCURRENT && this.queue.length > 0) {
            const {id, notebook} = this.queue.shift();
            this.activeCount++;
            this.fetchBreadcrumb(id, notebook).then((html) => {
                this.crumbCache.set(id, html);
                this.paintById(id);
            }).catch((_err) => {
                // 请求失败（如拉取/网络异常）时仅缓存空值，不阻塞后续
                this.crumbCache.set(id, "");
            }).finally(() => {
                this.pendingIDs.delete(id);
                this.activeCount--;
                this.pump();
            });
        }
    }

    private async fetchBreadcrumb(id: string, notebook: string): Promise<string> {
        const param: Record<string, unknown> = {id, excludeTypes: []};
        if (notebook) {
            param.notebook = notebook;
        }
        const response = await fetch("/api/block/getBlockBreadcrumb", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(param),
        });
        const payload = await response.json();
        if (payload.code !== 0) {
            throw new Error(payload.msg || `getBlockBreadcrumb failed: ${id}`);
        }
        return this.buildCrumbHTML(payload.data || []);
    }

    /**
     * 仅保留标题层级链 h2~h6（h1 不需要），层级用可配置的标识符号表达、与 hPath 的文档树路径区分。
     * 目标块自身是标题时，后端会把该标题名置空（编辑器面包屑菜单的惯例），
     * 这里渲染为空名占位，渲染时用搜索结果项的块文本补回，见 paintIfMounted。
     */
    private buildCrumbHTML(paths: IBreadcrumb[]): string {
        const headings = paths.filter((p) => p && p.type === "NodeHeading" && /^h[2-6]$/.test(p.subType));
        if (headings.length === 0) {
            return "";
        }
        // 每级标题包一层 inline-block：换行只发生在层级之间，单个标题名内部不被拆开，
        // 标题名本身过长时再由容器兜底换行。
        // 连接符放在前一级末尾，避免换行后行首出现孤立的连接符。
        const sep = `<span class="ref-crumbs__sep">${this.settings.separator}</span>`;
        return headings.map((h, i) => {
            const name = h.name || "";
            return '<span class="ref-crumbs__item">' + this.markerHTML(h.subType) +
                (name ?
                    `<span class="ref-crumbs__name">${name}</span>` :
                    '<span class="ref-crumbs__name ref-crumbs__empty-name"></span>') +
                (i < headings.length - 1 ? sep : "") + "</span>";
        }).join("");
    }

    /** 标题层级标识符号，h1 已被过滤，subType 形如 `h2` */
    private markerHTML(subType: string): string {
        const level = parseInt(subType.slice(1), 10);
        switch (this.settings.marker) {
            case "h":
                return `<span class="ref-crumbs__marker">h${level}</span>`;
            case "hSub":
                return `<span class="ref-crumbs__marker">H<sub>${level}</sub></span>`;
            case "none":
                return "";
            default:
                return `<span class="ref-crumbs__marker">${"#".repeat(level)}</span>`;
        }
    }

    /**
     * 面包屑响应回来后，把标题链渲染到当前存在的列表项上。
     * 列表每次输入都会被整体重写（innerHTML 重建），因此以 id 重新定位元素，
     * 并校验元素仍然连接且尚未渲染。
     */
    private paintById(id: string) {
        const html = this.crumbCache.get(id);
        if (html === undefined || html === "") {
            return;
        }
        document.querySelectorAll(ITEM_SELECTOR).forEach((el) => {
            const item = el as HTMLElement;
            if (this.itemID(item) === id) {
                this.paintIfMounted(item, html);
            }
        });
    }

    /**
     * 标题链追加到 hPath 的右侧，与文档树路径保持同行，仅通过「#」前缀和颜色区分。
     * 两块面板的行结构不同：
     * - 引用提示项是多行块，hPath 在最后一个 `.b3-list-item__meta` 里，面包屑塞进这一行；
     * - 搜索结果项是单行 flex，hPath 所在的 meta 带 `--ellipsis`（截断）不能复用，
     *   面包屑作为独立的 flex 子项插在 hPath 之后，由自身样式控制收缩换行。
     */
    private paintIfMounted(item: HTMLElement, html: string) {
        if (!item.isConnected || item.dataset[DATASET_MOUNTED] === "1" || !html) {
            return;
        }
        item.dataset[DATASET_MOUNTED] = "1";
        const crumb = document.createElement("span");
        crumb.innerHTML = html;
        if (item.dataset.type === "search-item") {
            crumb.className = `${CRUMB_CLASS} ${CRUMB_SEARCH_CLASS}`;
            const paths = item.querySelectorAll(".b3-list-item__meta--ellipsis");
            const path = paths.length > 0 ? paths[paths.length - 1] : null;
            if (path) {
                path.insertAdjacentElement("afterend", crumb);
            } else {
                item.appendChild(crumb);
            }
        } else {
            const metas = item.querySelectorAll(":scope > div.b3-list-item__meta");
            const meta = metas.length > 0 ? metas[metas.length - 1] : null;
            if (!meta) {
                return;
            }
            crumb.className = CRUMB_CLASS;
            meta.appendChild(crumb);
        }
        // 列表项本身就是标题块时补回空名标题
        crumb.querySelectorAll(".ref-crumbs__empty-name").forEach((emptyName) => {
            const selfText = item.querySelector(".b3-list-item__text")?.textContent?.trim() || "";
            if (selfText) {
                emptyName.textContent = selfText;
            }
        });
    }
}
