/**
 * 插件设置。经 `Plugin.loadData`/`saveData` 持久化到
 * `<工作空间>/data/storage/petal/<插件名>/settings.json`。
 */

/** 标题层级标识符号的渲染方式：`##` / `h2` / `H₂`（下标）/ 不显示 */
export type MarkerStyle = "hash" | "h" | "hSub" | "none";

export interface ISettings {
    /** 引用搜索列表（`((`）显示面包屑 */
    refList: boolean;
    /** 搜索面板结果列表显示面包屑 */
    searchList: boolean;
    /** 标题层级标识符号 */
    marker: MarkerStyle;
    /** 标题层级之间的连接符号 */
    separator: string;
    /** 面包屑包含目标块自身的标题 */
    includeSelf: boolean;
    /** 折叠过长的标题名 */
    truncate: boolean;
    /** 单个标题名保留的字符数 */
    maxLength: number;
}

export const DEFAULT_SETTINGS: ISettings = {
    refList: true,
    searchList: false,
    marker: "hash",
    separator: "·",
    includeSelf: true,
    truncate: false,
    maxLength: 12,
};

/** 标题名长度上下限，限制在设置面板里误填的取值范围 */
export const MIN_MAX_LENGTH = 1;
export const MAX_MAX_LENGTH = 200;

export const isValidMaxLength = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= MIN_MAX_LENGTH && value <= MAX_MAX_LENGTH;

/** 标识符号候选项，界面文案见设置面板 */
export const MARKER_CHOICES: MarkerStyle[] = ["hash", "h", "hSub", "none"];

/** 连接符号候选项 */
export const SEPARATOR_CHOICES = ["·", "/", "-", "~", ">"];

export const STORAGE_NAME = "settings.json";

/** 合并已存配置，缺失或非法的字段回落默认值 */
export const mergeSettings = (stored: unknown): ISettings => {
    const settings = {...DEFAULT_SETTINGS};
    if (!stored || typeof stored !== "object") {
        return settings;
    }
    const data = stored as Partial<ISettings>;
    if (typeof data.refList === "boolean") {
        settings.refList = data.refList;
    }
    if (typeof data.searchList === "boolean") {
        settings.searchList = data.searchList;
    }
    if (MARKER_CHOICES.indexOf(data.marker) > -1) {
        settings.marker = data.marker;
    }
    if (SEPARATOR_CHOICES.indexOf(data.separator) > -1) {
        settings.separator = data.separator;
    }
    if (typeof data.includeSelf === "boolean") {
        settings.includeSelf = data.includeSelf;
    }
    if (typeof data.truncate === "boolean") {
        settings.truncate = data.truncate;
    }
    if (isValidMaxLength(data.maxLength)) {
        settings.maxLength = data.maxLength;
    }
    return settings;
};
