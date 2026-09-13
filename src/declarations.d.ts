declare module "*.scss" {
    const content: Record<string, string>;
    export default content;
}

/** 移动端 App 注入的原生桥接，只用到关软键盘，参见思源 app/src/types/index.d.ts */
interface Window {
    JSAndroid?: {hideKeyboard?: () => void;};
    JSHarmony?: {hideKeyboard?: () => void;};
}
