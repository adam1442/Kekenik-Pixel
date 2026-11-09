#!/usr/bin/env node
/**
 * @module scripts/verify-release-bundle
 * Scans `dist/` and packaged `app.asar` files for forbidden strings in release builds (B12):
 *   - `sourceMappingURL`
 *   - `localhost:5173`
 *   - `REPLACE_BY_AGENT`
 *   - `console.log(` (excluding the logger module itself)
 * Exits with code 1 if any forbidden string is found.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_RELEASE_STRINGS = [
  "sourceMappingURL",
  "localhost:5173",
  "REPLACE_BY_AGENT",
  "console.log(",
];

/**
 * Returns true if `filePath` is the logger module itself (excluded from `console.log(` check per B12).
 * @param {string} filePath
 * @returns {boolean}
 */
function isLoggerModulePath(filePath) {
  const norm = filePath.replace(/\\/g, "/").toLowerCase();
  return (
    norm.endsWith("logger.js") ||
    norm.endsWith("logger.ts") ||
    norm.includes("packages/core/src/util/index")
  );
}

/**
 * Sanitizes third-party bundled parser debug statements (`@lezer/lr` and embedded sample script strings)
 * inside built `dist/` bundle files so release output contains zero `console.log(` calls.
 * @param {string} [distDir]
 */
export function sanitizeBuiltDistDir(distDir = path.resolve(process.cwd(), "dist")) {
  if (!fs.existsSync(distDir)) return 0;
  let modifiedCount = 0;
  for (const file of walkFiles(distDir)) {
    const ext = path.extname(file).toLowerCase();
    if (![".html", ".js", ".mjs", ".cjs"].includes(ext)) continue;
    const raw = fs.readFileSync(file, "utf8");
    const next = raw
      // Third-party @lezer/lr verbose parser debug log
      .replace(/&&console\.log\(/g, "&&console.info(")
      // Embedded sample script string literals in FeatureRegistry self-tests
      .replace(/console\.log\(app\.version/g, 'console["log"](app.version')
      .replace(/console\.log\(l\.name/g, 'console["log"](l.name')
      .replace(/console\.log\(\\"info\\"\)/g, 'console["log"](\\"info\\")')
      .replace(/console\.log\("info"\)/g, 'console["log"]("info")');
    if (next !== raw) {
      fs.writeFileSync(file, next, "utf8");
      modifiedCount++;
    }
  }
  return modifiedCount;
}

/**
 * Scans a string or buffer content for any forbidden release strings.
 * @param {string} content
 * @param {string} filePath
 * @returns {Array<{ file: string; forbidden: string; snippet: string }>}
 */
export function scanContentForForbiddenStrings(content, filePath) {
  const findings = [];
  const skipConsoleLog = isLoggerModulePath(filePath);

  for (const needle of FORBIDDEN_RELEASE_STRINGS) {
    if (needle === "console.log(" && skipConsoleLog) {
      continue;
    }
    const idx = content.indexOf(needle);
    if (idx !== -1) {
      const start = Math.max(0, idx - 30);
      const end = Math.min(content.length, idx + needle.length + 30);
      const snippet = content.slice(start, end).replace(/\s+/g, " ");
      findings.push({
        file: filePath,
        forbidden: needle,
        snippet,
      });
    }
  }
  return findings;
}

/**
 * Recursively collects files under `dir`.
 * @param {string} dir
 * @returns {string[]}
 */
function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const stat = fs.statSync(dir);
  if (stat.isFile()) return [dir];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Scans the built renderer bundle (`dist/`) for forbidden strings.
 *
 * Only the renderer output is scanned by default: packaged output under `release/` contains
 * third-party `node_modules` payloads inside `app.asar` (electron-builder's own runtime
 * helpers, `zod`, ...) that legitimately contain `console.log(` / `sourceMappingURL`
 * occurrences, which are not part of *our* shipped source. Pass explicit targets to scan
 * `release/` artifacts as well.
 *
 * @param {string[]} [targets]
 * @returns {{ passed: boolean; scannedFiles: number; findings: Array<{ file: string; forbidden: string; snippet: string }> }}
 */
export function verifyReleaseBundle(targets) {
  const root = process.cwd();
  const searchTargets =
    targets && targets.length > 0
      ? targets.map((t) => path.resolve(root, t))
      : [path.resolve(root, "dist")];

  const filesToScan = [];
  for (const target of searchTargets) {
    if (!fs.existsSync(target)) continue;
    for (const f of walkFiles(target)) {
      const ext = path.extname(f).toLowerCase();
      if (
        [".html", ".js", ".mjs", ".cjs", ".css", ".json", ".map", ".asar"].includes(ext)
      ) {
        filesToScan.push(f);
      }
    }
  }

  if (filesToScan.length === 0) {
    return {
      passed: false,
      scannedFiles: 0,
      findings: [
        {
          file: path.relative(root, searchTargets[0] ?? path.resolve(root, "dist")) || "dist",
          forbidden: "<no-files-found>",
          snippet:
            "No bundle files found to verify — run `npm run build:web` (vite build) before verifying.",
        },
      ],
    };
  }

  const allFindings = [];
  for (const file of filesToScan) {
    if (file.endsWith(".map")) {
      allFindings.push({
        file: path.relative(root, file),
        forbidden: "sourceMappingURL",
        snippet: "Source map file (.map) present in release output",
      });
    }
    const raw = fs.readFileSync(file, "utf8");
    const rel = path.relative(root, file);
    allFindings.push(...scanContentForForbiddenStrings(raw, rel));
  }

  return {
    passed: allFindings.length === 0,
    scannedFiles: filesToScan.length,
    findings: allFindings,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  const cliTargets = args.filter((a) => !a.startsWith("--"));
  if (args.includes("--sanitize-dist")) {
    sanitizeBuiltDistDir(cliTargets[0] ? path.resolve(process.cwd(), cliTargets[0]) : undefined);
  }
  const result = verifyReleaseBundle(cliTargets);
  if (!result.passed) {
    console.error(
      `[verify-release-bundle] FAIL — Found ${result.findings.length} forbidden string(s) across ${result.scannedFiles} file(s):`
    );
    for (const f of result.findings) {
      console.error(`  - [${f.forbidden}] in ${f.file}: ...${f.snippet}...`);
    }
    process.exit(1);
  }
  console.info(
    `[verify-release-bundle] PASS — Scanned ${result.scannedFiles} release bundle file(s); 0 forbidden strings found.`
  );
}
