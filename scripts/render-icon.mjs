// 将 assets/icon.svg 渲染为 icon.png（160x160，思源集市建议尺寸，上限 64KiB）
import sharp from "sharp";
import fs from "node:fs";

const svg = fs.readFileSync(new URL("../assets/icon.svg", import.meta.url), "utf8");
await sharp(Buffer.from(svg)).resize(160, 160).png({compressionLevel: 9}).toFile("assets/icon.png");
const stat = fs.statSync("assets/icon.png");
console.log(`icon.png done: ${stat.size} bytes`);
