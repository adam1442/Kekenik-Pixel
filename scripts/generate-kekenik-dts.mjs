import fs from "node:fs";
import path from "node:path";

const srcPath = path.resolve("packages/core/src/scripting/kekenik.d.ts");
const outDir = path.resolve("packages/core/dist/scripting");
const outPath = path.join(outDir, "kekenik.d.ts");

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(srcPath, outPath);
