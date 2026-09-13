/**
 * 插件设置。经 `Plugin.loadData`/`saveData` 持久化到
 * `<工作空间>/data/storage/petal/<插件名>/settings.json`。
 */

/** 标题层级标识符号的渲染方式：`##` / `h2` / `H₂`（下标）/ 不显示 */
export type MarkerStyle = "hash" | "h" | "hSub" | "none";

export interface ISettings {
    /** 标题层级标识符号 */
    marker: MarkerStyle;
    /** 标题层级之间的连接符号 */
    separator: string;
}

export const DEFAULT_SETTINGS: ISettings = {
    marker: "hash",
    separator: "·",
};

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
    if (MARKER_CHOICES.indexOf(data.marker) > -1) {
        settings.marker = data.marker;
    }
    if (SEPARATOR_CHOICES.indexOf(data.separator) > -1) {
        settings.separator = data.separator;
    }
    return settings;
};
