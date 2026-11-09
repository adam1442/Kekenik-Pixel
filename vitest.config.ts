import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@kekenik/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@kekenik/ui": path.resolve(__dirname, "packages/ui/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "packages/**/*.test.tsx"],
    environment: "node",
    globals: true,
  },
});
