import {Plugin} from "siyuan";
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

const HINT_ITEM_SELECTOR = ".protyle-hint .b3-list-item";
const CRUMB_CLASS = "ref-crumbs__crumbs";
const DATASET_DONE = "rcDone";
const DATASET_MOUNTED = "rcMounted";

export default class RefCrumbs extends Plugin {
    private originalFetch: typeof window.fetch;
    private hookedFetch: typeof window.fetch;
    private lastRefSearchNotebook = "";
    private observer: MutationObserver;
    private crumbCache = new Map<string, string>();
    private pendingIDs = new Set<string>();
    private queue: string[] = [];
    private activeCount = 0;

    onload() {
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
                        if (node.matches(HINT_ITEM_SELECTOR)) {
                            items.add(node);
                        } else if (node.querySelector) {
                            node.querySelectorAll(HINT_ITEM_SELECTOR).forEach((el) => {
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
     * 插件加载时页面上的 hint 面板可能已经存在（例如插件重载），初始扫描一次。
     */
    private preloadHints() {
        document.querySelectorAll(HINT_ITEM_SELECTOR).forEach((el) => {
            this.processItems(new Set<HTMLElement>([el as HTMLElement]));
        });
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
            const id = item.querySelector("[data-node-id]")?.getAttribute("data-node-id");
            if (!id) {
                // “新建文件/新建子文档”等无块 id 的提示项
                continue;
            }
            if (this.crumbCache.has(id)) {
                this.paintIfMounted(item, this.crumbCache.get(id));
                continue;
            }
            this.enqueue(id);
        }
    }

    private enqueue(id: string) {
        if (this.crumbCache.has(id) || this.pendingIDs.has(id)) {
            return;
        }
        this.pendingIDs.add(id);
        this.queue.push(id);
        this.pump();
    }

    /**
     * 并发池：同一时间最多发 MAX_CONCURRENT 个面包屑请求，避免大量文档树加载阻塞。
     */
    private pump() {
        while (this.activeCount < MAX_CONCURRENT && this.queue.length > 0) {
            const id = this.queue.shift();
            this.activeCount++;
            this.fetchBreadcrumb(id).then((html) => {
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

    private async fetchBreadcrumb(id: string): Promise<string> {
        const param: Record<string, unknown> = {id, excludeTypes: []};
        if (this.lastRefSearchNotebook) {
            param.notebook = this.lastRefSearchNotebook;
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
     * 仅保留标题层级链 h2~h6（h1 不需要），层级用「#」前缀表达、与 hPath 的文档树路径区分。
     * 目标块自身是标题时，后端会把该标题名置空（编辑器面包屑菜单的惯例），
     * 这里渲染为空名占位，渲染时用搜索结果项的块文本补回，见 paintIfMounted。
     */
    private buildCrumbHTML(paths: IBreadcrumb[]): string {
        const headings = paths.filter((p) => p && p.type === "NodeHeading" && /^h[2-6]$/.test(p.subType));
        if (headings.length === 0) {
            return "";
        }
        return headings.map((h) => {
            const level = parseInt(h.subType.slice(1), 10);
            const name = h.name || "";
            return `<span class="ref-crumbs__hash">${"#".repeat(level)}</span>` + (name
                ? `<span class="ref-crumbs__name">${name}</span>`
                : '<span class="ref-crumbs__name ref-crumbs__empty-name"></span>');
        }).join('<span class="ref-crumbs__sep">·</span>');
    }

    /**
     * 面包屑响应回来后，把标题链渲染到当前存在的搜索列表项上。
     * 搜索列表每次输入都会被整体重写（innerHTML 重建），因此以 id 重新定位元素，
     * 并校验元素仍然连接且尚未渲染。
     */
    private paintById(id: string) {
        const html = this.crumbCache.get(id);
        if (html === undefined || html === "") {
            return;
        }
        document.querySelectorAll(HINT_ITEM_SELECTOR).forEach((el) => {
            const item = el as HTMLElement;
            const nodeID = item.querySelector("[data-node-id]")?.getAttribute("data-node-id");
            if (nodeID === id) {
                this.paintIfMounted(item, html);
            }
        });
    }

    /**
     * 标题链追加到 hPath 行（列表项最后一个 `.b3-list-item__meta`）的右侧，
     * 与文档树路径保持同行，仅通过「#」前缀和颜色区分。
     */
    private paintIfMounted(item: HTMLElement, html: string) {
        if (!item.isConnected || item.dataset[DATASET_MOUNTED] === "1" || !html) {
            return;
        }
        item.dataset[DATASET_MOUNTED] = "1";
        const metas = item.querySelectorAll(":scope > div.b3-list-item__meta");
        const meta = metas.length > 0 ? metas[metas.length - 1] : null;
        if (!meta) {
            return;
        }
        const crumb = document.createElement("span");
        crumb.className = CRUMB_CLASS;
        crumb.innerHTML = html;
        meta.appendChild(crumb);
        // 搜索结果本身就是标题块时补回空名标题
        crumb.querySelectorAll(".ref-crumbs__empty-name").forEach((emptyName) => {
            const selfText = item.querySelector(".b3-list-item__text")?.textContent?.trim() || "";
            if (selfText) {
                emptyName.textContent = selfText;
            }
        });
    }
}
