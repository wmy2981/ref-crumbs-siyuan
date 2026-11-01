import {
    Plugin,
    Setting,
    showMessage,
} from "siyuan";
import {
    DEFAULT_SETTINGS,
    ISettings,
    isValidMaxLength,
    MARKER_CHOICES,
    MarkerStyle,
    MAX_MAX_LENGTH,
    mergeSettings,
    MIN_MAX_LENGTH,
    SEPARATOR_CHOICES,
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
// 限制长时间使用时的缓存占用；访问已有条目时提升其保留优先级
const MAX_CACHE_SIZE = 500;

// `((` 引用搜索提示面板
const HINT_ITEM_SELECTOR = ".protyle-hint .b3-list-item";
// 搜索面板（页签与 Ctrl+P 对话框共用同一份模板）结果项；未引用列表同款模板
const SEARCH_ITEM_SELECTOR = '[data-type="search-item"]';
const ITEM_SELECTOR = `${HINT_ITEM_SELECTOR}, ${SEARCH_ITEM_SELECTOR}`;
const CRUMB_CLASS = "ref-crumbs__crumbs";
const CRUMB_SEARCH_CLASS = "ref-crumbs__crumbs--search";
const DATASET_DONE = "rcDone";
const DATASET_MOUNTED = "rcMounted";

/** 搜索结果项与引用提示项的 DOM 结构不同，靠 `data-type` 区分 */
const isSearchItem = (item: HTMLElement) => item.dataset.type === "search-item";

/** 与思源 `isMobile()` 同款判定：只有移动端布局才渲染 `#sidebar` */
const isMobileLayout = () => Boolean(document.getElementById("sidebar"));

/** 超过字符数上限时截断为「前 N 个字符 + …」，按码点计数避免拆开代理对 */
const truncateText = (text: string, maxLength: number) => {
    const chars = Array.from(text);
    return chars.length > maxLength ? chars.slice(0, maxLength).join("") + "…" : text;
};

// 后端返回的标题名已做 HTML 转义（kernel/model/blockinfo.go 的 EscapeHTML），
// 截断前先解码，否则 `&amp;` 这类实体会被截成半截
const decodeHTML = (text: string) => {
    const element = document.createElement("textarea");
    element.innerHTML = text;
    return element.value;
};

const ESCAPES: Record<string, string> = {"&": "&amp;", "<": "&lt;", ">": "&gt;"};
const escapeHTML = (text: string) => text.replace(/[&<>]/g, (char) => ESCAPES[char]);

export default class RefCrumbs extends Plugin {
    private originalFetch: typeof window.fetch;
    private hookedFetch: typeof window.fetch;
    private lastRefSearchNotebook = "";
    private observer: MutationObserver;
    // 缓存接口原始数据，显示配置变化时无需重新请求；键包含笔记本上下文
    private crumbCache = new Map<string, IBreadcrumb[]>();
    private pendingIDs = new Set<string>();
    private queue: {id: string; notebook: string;}[] = [];
    private queueHead = 0;
    private activeCount = 0;
    private requestControllers = new Set<AbortController>();
    private unloaded = false;
    private settings: ISettings = {...DEFAULT_SETTINGS};

    async onload() {
        await this.loadSettings();
        this.buildSettingPanel();
        this.hookFetchRequest();
        this.installObserver();
        this.preloadHints();
    }

    onunload() {
        this.unloaded = true;
        this.observer?.disconnect();
        this.queue = [];
        this.queueHead = 0;
        this.pendingIDs.clear();
        this.crumbCache.clear();
        for (const controller of this.requestControllers) {
            controller.abort();
        }
        this.requestControllers.clear();
        if (window.fetch === this.hookedFetch) {
            window.fetch = this.originalFetch;
        }
    }

    private async loadSettings() {
        let stored: unknown;
        try {
            stored = await this.loadData(STORAGE_NAME);
        } catch {
            // 首次安装或存储文件读取失败，用默认值
        }
        this.settings = mergeSettings(stored);
    }

    /**
     * 其他窗口改了配置时由内核推送触发（内核会把保存方窗口排除在外，
     * 所以本窗口的变更由设置面板就地应用）。定义本钩子后思源不再重载插件。
     */
    async onDataChanged() {
        await this.loadSettings();
        this.repaint();
    }

    /**
     * 移动端打开设置面板时不得程序性聚焦 input/textarea。宿主有两处会这么做：`Dialog.bindInput`
     * 逐个控件先 focus 一次（app/src/dialog/index.ts），`Setting.open` 结尾再聚焦面板里第一个
     * `input, textarea`（app/src/plugin/Setting.ts）。而 `mobile/index.ts` 重写的
     * `HTMLElement.prototype.focus` 不判 `isConnected` 就经原生桥接唤起软键盘，键盘触发的 adjustResize
     * 会改 WebView 高度、整页重排，面板弹出的那一帧就闪旧画面。
     * `bindInput` 那次 focus 发生在控件插入对话框之前，元素此时还游离在文档外，事后 blur 和按祖先
     * 节点判断都拦不住，所以这里在打开期间按元素类型接管 `HTMLElement.prototype.focus`，打开结束
     * 立即还原。用户触碰控件不经过这个重写，照常可输入。
     */
    openSetting() {
        if (!isMobileLayout()) {
            super.openSetting();
            return;
        }
        const proto = HTMLElement.prototype;
        const originalFocus = proto.focus;
        proto.focus = function(this: HTMLElement, options?: FocusOptions) {
            // 对话框容器等非输入控件的聚焦照常放行，不会唤键盘
            if (!(this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement)) {
                originalFocus.call(this, options);
            }
        };
        try {
            super.openSetting();
        } finally {
            proto.focus = originalFocus;
        }
        // 入场过渡（transform/opacity）会临时建层、结束时再拆层，App 的 WebView 在拆层那一帧
        // 只能提交拆层前的旧纹理，面板正文会残留一帧旧画面。这里在过渡开始前就把面板和正文
        // 常驻提升为独立图层，入场期间不再建层/拆层；只加图层提示，不动宿主的 transition 与类切换时序。
        // `Setting.dialog` 运行时存在，当前 npm 包的类型声明里还没有它
        const dialogElement = (this.setting as Setting & {dialog?: {element?: HTMLElement;};}).dialog?.element;
        const container = dialogElement?.querySelector(".b3-dialog__container");
        if (container instanceof HTMLElement) {
            container.style.setProperty("will-change", "transform");
            const content = container.querySelector(".b3-dialog__content");
            if (content instanceof HTMLElement) {
                content.style.setProperty("will-change", "transform");
            }
        }
    }

    /** 注册思源设置面板，配置经 loadData/saveData 持久化 */
    private buildSettingPanel() {
        // 控件只改草稿，点保存才落到 this.settings 并落盘；取消/关闭即丢弃
        let draft: ISettings = {...this.settings};
        this.setting = new Setting({
            confirmCallback: () => {
                this.settings = {...draft};
                // 本窗口保存不会收到内核的 dataChange 推送，这里就地生效
                this.repaint();
                this.saveData(STORAGE_NAME, this.settings).catch(() => {
                    showMessage(this.i18n.saveFailed, 6000, "error");
                });
            },
            destroyCallback: () => {
                draft = {...this.settings};
            },
        });
        const markerLabels: Record<MarkerStyle, string> = {
            hash: "##, ###, ####",
            h: "h2, h3, h4",
            hSub: "H₂, H₃, H₄",
            none: this.i18n.markerNone,
        };
        this.setting.addItem({
            title: this.i18n.refListTitle,
            description: this.i18n.refListDesc,
            createActionElement: () =>
                this.switchElement(draft.refList, (checked) => {
                    draft.refList = checked;
                }),
        });
        this.setting.addItem({
            title: this.i18n.searchListTitle,
            description: this.i18n.searchListDesc,
            createActionElement: () =>
                this.switchElement(draft.searchList, (checked) => {
                    draft.searchList = checked;
                }),
        });
        this.setting.addItem({
            title: this.i18n.markerTitle,
            description: this.i18n.markerDesc,
            createActionElement: () =>
                this.selectElement(
                    MARKER_CHOICES.map((value) => ({value, label: markerLabels[value]})),
                    draft.marker,
                    (value) => {
                        draft.marker = value as MarkerStyle;
                    },
                ),
        });
        this.setting.addItem({
            title: this.i18n.separatorTitle,
            description: this.i18n.separatorDesc,
            createActionElement: () =>
                this.selectElement(
                    SEPARATOR_CHOICES.map((value) => ({value, label: value})),
                    draft.separator,
                    (value) => {
                        draft.separator = value;
                    },
                ),
        });
        this.setting.addItem({
            title: this.i18n.includeSelfTitle,
            description: this.i18n.includeSelfDesc,
            createActionElement: () =>
                this.switchElement(draft.includeSelf, (checked) => {
                    draft.includeSelf = checked;
                }),
        });
        this.setting.addItem({
            title: this.i18n.truncateTitle,
            description: this.i18n.truncateDesc,
            createActionElement: () =>
                this.switchElement(draft.truncate, (checked) => {
                    draft.truncate = checked;
                }),
        });
        this.setting.addItem({
            title: this.i18n.maxLengthTitle,
            description: this.i18n.maxLengthDesc,
            createActionElement: () =>
                this.numberElement(draft.maxLength, (value) => {
                    draft.maxLength = value;
                }),
        });
    }

    private switchElement(checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "b3-switch fn__flex-center";
        input.checked = checked;
        input.addEventListener("change", () => onChange(input.checked));
        return input;
    }

    /**
     * 数字输入：监听 input 而非 change —— 设置对话框把回车绑定为保存，
     * 此时 change 尚未派发，用 change 会丢掉刚输入的长度。
     * 只有合法取值写入草稿，失焦时把空值/越界值回退到最近一次有效取值。
     */
    private numberElement(value: number, onChange: (value: number) => void): HTMLElement {
        const input = document.createElement("input");
        input.type = "number";
        input.className = "b3-text-field";
        input.min = String(MIN_MAX_LENGTH);
        input.max = String(MAX_MAX_LENGTH);
        input.value = String(value);
        let current = value;
        input.addEventListener("input", () => {
            const parsed = parseInt(input.value, 10);
            if (isValidMaxLength(parsed)) {
                current = parsed;
                onChange(current);
            }
        });
        input.addEventListener("change", () => {
            input.value = String(current);
        });
        return input;
    }

    private selectElement(
        choices: {value: string; label: string;}[],
        value: string,
        onChange: (value: string) => void,
    ): HTMLElement {
        const select = document.createElement("select");
        select.className = "b3-select fn__flex-center fn__size200";
        for (const choice of choices) {
            const option = document.createElement("option");
            option.value = choice.value;
            option.textContent = choice.label;
            select.appendChild(option);
        }
        select.value = value;
        select.addEventListener("change", () => onChange(select.value));
        return select;
    }

    /**
     * 记录最近一次 `/api/search/searchRefBlock` 请求中的 notebook 参数（加密笔记本需要透传）。
     * 页面内同一时刻只会有一个块引用搜索面板，记录一个值足够。
     */
    private hookFetchRequest() {
        this.originalFetch = window.fetch.bind(window);
        const hooked: typeof window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
            // fetch 也接受 URL 对象（PDF.js 就这样调用），只有 Request 与字符串才有 .url；
            // 直接读 input.url 会拿到 undefined，随后的 .includes 抛错会让 PDF 加载失败
            const url = typeof input === "string" ?
                input :
                input instanceof URL ?
                input.href :
                input instanceof Request ?
                input.url :
                "";
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
        this.processItems(new Set(document.querySelectorAll<HTMLElement>(ITEM_SELECTOR)));
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
            // 所属面板关闭时不必记录已处理标记，配置改回来后会整体重画
            if (!this.surfaceEnabled(item) || item.dataset[DATASET_DONE] === "1") {
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
            // notebook 只对引用提示面板有意义：搜索面板的块可能来自任意笔记本，
            // 透传别的笔记本会让内核按该笔记本路由 blocktree 而查不到块。
            const notebook = isSearchItem(item) ? "" : this.lastRefSearchNotebook;
            const paths = this.cachedPaths(this.cacheKey(id, notebook));
            if (paths) {
                this.paintIfMounted(item, this.buildCrumbHTML(paths, id));
                continue;
            }
            this.enqueue(id, notebook);
        }
    }

    /** 列表项所属面板是否启用了面包屑 */
    private surfaceEnabled(item: HTMLElement): boolean {
        return isSearchItem(item) ? this.settings.searchList : this.settings.refList;
    }

    /** 配置变更只重新生成 HTML，保留原始路径缓存，避免重复请求 */
    private repaint() {
        const items = document.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
        items.forEach((item) => {
            item.querySelectorAll(`.${CRUMB_CLASS}`).forEach((crumb) => crumb.remove());
            delete item.dataset[DATASET_DONE];
            delete item.dataset[DATASET_MOUNTED];
        });
        this.processItems(new Set(items));
    }

    private cacheKey(id: string, notebook: string) {
        return notebook ? `${notebook}:${id}` : id;
    }

    private cachedPaths(key: string): IBreadcrumb[] | undefined {
        const paths = this.crumbCache.get(key);
        if (paths) {
            this.storePaths(key, paths);
        }
        return paths;
    }

    private storePaths(key: string, paths: IBreadcrumb[]) {
        // Map 的插入顺序兼作 LRU 顺序，更新已有条目不增加缓存体积
        this.crumbCache.delete(key);
        this.crumbCache.set(key, paths);
        if (this.crumbCache.size > MAX_CACHE_SIZE) {
            this.crumbCache.delete(this.crumbCache.keys().next().value);
        }
    }

    private enqueue(id: string, notebook: string) {
        const key = this.cacheKey(id, notebook);
        if (this.unloaded || this.crumbCache.has(key) || this.pendingIDs.has(key)) {
            return;
        }
        this.pendingIDs.add(key);
        this.queue.push({id, notebook});
        this.pump();
    }

    /**
     * 并发池：同一时间最多发 MAX_CONCURRENT 个面包屑请求，避免大量文档树加载阻塞。
     */
    private pump() {
        while (!this.unloaded && this.activeCount < MAX_CONCURRENT && this.queueHead < this.queue.length) {
            const {id, notebook} = this.queue[this.queueHead++];
            if (this.queueHead === this.queue.length) {
                this.queue = [];
                this.queueHead = 0;
            }
            this.activeCount++;
            const key = this.cacheKey(id, notebook);
            const controller = new AbortController();
            this.requestControllers.add(controller);
            this.fetchBreadcrumb(id, notebook, controller.signal).then((paths) => {
                this.storePaths(key, paths);
                this.paintById(id, notebook, paths);
            }).catch((error) => {
                if (error?.name === "AbortError") {
                    return;
                }
                // 请求失败（如拉取/网络异常）时仅缓存空值，不阻塞后续
                this.storePaths(key, []);
            }).finally(() => {
                this.requestControllers.delete(controller);
                this.pendingIDs.delete(key);
                this.activeCount--;
                if (!this.unloaded) {
                    this.pump();
                }
            });
        }
    }

    private async fetchBreadcrumb(id: string, notebook: string, signal: AbortSignal): Promise<IBreadcrumb[]> {
        const param: Record<string, unknown> = {id, excludeTypes: []};
        if (notebook) {
            param.notebook = notebook;
        }
        const response = await fetch("/api/block/getBlockBreadcrumb", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(param),
            signal,
        });
        const payload = await response.json();
        if (payload.code !== 0) {
            throw new Error(payload.msg || `getBlockBreadcrumb failed: ${id}`);
        }
        return payload.data || [];
    }

    /**
     * 标题名渲染：开启折叠且超长时截断，逐级独立判断，不影响同链其他层级。
     */
    private crumbName(name: string): string {
        if (!name || !this.settings.truncate) {
            return name;
        }
        return escapeHTML(truncateText(decodeHTML(name), this.settings.maxLength));
    }

    /**
     * 仅保留标题层级链 h2~h6（h1 不需要），层级用可配置的标识符号表达、与 hPath 的文档树路径区分。
     * 目标块自身也在路径里，位于链尾且名字被后端置空（编辑器面包屑菜单的惯例）：
     * 关闭「包含自身标题」时按 id 认出并摘掉它；开启时渲染为空名占位，
     * 渲染时用搜索结果项的块文本补回，见 paintIfMounted。
     */
    private buildCrumbHTML(paths: IBreadcrumb[], id: string): string {
        const last = paths[paths.length - 1];
        const chain = !this.settings.includeSelf && last && last.id === id ? paths.slice(0, -1) : paths;
        const headings = chain.filter((p) => p && p.type === "NodeHeading" && /^h[2-6]$/.test(p.subType));
        if (headings.length === 0) {
            return "";
        }
        // 每级标题包一层 inline-block：换行只发生在层级之间，单个标题名不被拆开。
        // 连接符放在前一级末尾，避免换行后行首出现孤立的连接符。
        const sep = `<span class="ref-crumbs__sep">${this.settings.separator}</span>`;
        return headings.map((h, i) => {
            const name = this.crumbName(h.name || "");
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
     * 面包屑响应回来后，直接按 id 定位相关列表项，避免每个响应都遍历全部搜索结果。
     * 列表每次输入都会被整体重写（innerHTML 重建），不缓存已卸载的 DOM 节点。
     */
    private paintById(id: string, notebook: string, paths: IBreadcrumb[]) {
        if (paths.length === 0) {
            return;
        }
        const html = this.buildCrumbHTML(paths, id);
        const items = new Set<HTMLElement>();
        document.querySelectorAll<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`).forEach((element) => {
            // 搜索项的 id 在自身，引用项的 id 在子元素；文档中同 id 的块不属于目标列表
            const item = element.matches(SEARCH_ITEM_SELECTOR) ? element : element.closest(HINT_ITEM_SELECTOR);
            if (item instanceof HTMLElement) {
                items.add(item);
            }
        });
        items.forEach((item) => this.paintIfMounted(item, html));
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
        if (isSearchItem(item)) {
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
        // 列表项本身就是标题块时补回空名标题，同样受折叠设置约束
        crumb.querySelectorAll(".ref-crumbs__empty-name").forEach((emptyName) => {
            const selfText = item.querySelector(".b3-list-item__text")?.textContent?.trim() || "";
            if (selfText) {
                emptyName.textContent = this.settings.truncate ?
                    truncateText(selfText, this.settings.maxLength) :
                    selfText;
            }
        });
    }
}
