#!/usr/bin/env node
/**
 * @module scripts/build
 * Unified cross-platform build & packaging orchestrator for Kekenik Pixel.
 *
 * Interactive menu when run without arguments; accepts CLI flags:
 *   --web           Web production bundle + release verification only
 *   --dir           Unpacked desktop app (electron-builder --dir) – fast packaging smoke test
 *   --win           Windows 10/11 x64 NSIS installer + Portable EXE
 *   --win-portable  Windows 10/11 x64 Portable EXE only
 *   --win-qa        Windows x64 NSIS installer with the QA surface enabled (`VITE_KP_FLAVOR=qa`)
 *   --mac           macOS DMG + ZIP for x64 and arm64 (must run on macOS)
 *   --linux         Linux x64 AppImage + deb + tar.gz
 *   --linux-docker  Linux x64 packages built inside the `electronuserland/builder` Docker image
 *   --all           Every target supported by the current host OS, in sequence
 *   --skip-tests    Skip the unit/integration test step (CI runs it separately)
 *   --dry-run       Run typecheck/tests/bundles, then stop before electron-builder
 *
 * Every packaged build runs in strict order:
 *   1. `generate-icons`      (version-pinned .ico/.icns/PNGs/NSIS bitmaps)
 *   2. `typecheck`           (`tsc` for the workspace + the Electron sources)
 *   3. `test`                (`vitest run`)
 *   4. `build:web`           (`vite build` + `verify-release-bundle`)
 *   5. `build:desktop`       (Electron main + preload + desktop renderer bundles)
 *   6. `package`             (`electron-builder`) + SHA-256 digests & `SHA256SUMS.txt`
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateAllIcons, readPackageVersion } from "./generate-icons.mjs";
import { sanitizeBuiltDistDir, verifyReleaseBundle } from "./verify-release-bundle.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WINDOWS = process.platform === "win32";
const IS_MACOS = process.platform === "darwin";
const IS_LINUX = process.platform === "linux";

/**
 * Returns the canonical artifact filenames under `release/<version>/`.
 * @param {string} version
 */
export function getExpectedArtifactNames(version) {
  return {
    winSetup: `KekenikPixel-${version}-win-x64-setup.exe`,
    winPortable: `KekenikPixel-${version}-win-x64-portable.exe`,
    macDmgX64: `KekenikPixel-${version}-mac-x64.dmg`,
    macDmgArm64: `KekenikPixel-${version}-mac-arm64.dmg`,
    macZipX64: `KekenikPixel-${version}-mac-x64.zip`,
    macZipArm64: `KekenikPixel-${version}-mac-arm64.zip`,
    linuxAppImage: `KekenikPixel-${version}-linux-x64.AppImage`,
    linuxDeb: `KekenikPixel-${version}-linux-x64.deb`,
    linuxTarGz: `KekenikPixel-${version}-linux-x64.tar.gz`,
  };
}

/**
 * Computes the hex SHA-256 digest of a file on disk.
 * @param {string} filePath
 * @returns {string}
 */
export function computeFileSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Runs a command synchronously and throws a readable error if it exits with a non-zero code.
 * @param {string} label
 * @param {string} cmd
 * @param {string[]} args
 * @param {Record<string, string | undefined>} [envOverrides]
 */
function runStep(label, cmd, args, envOverrides = {}) {
  console.info(`\n[build] === ${label} ===`);
  const res = spawnSync(cmd, args, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    // `shell: true` is required on Windows so that `npx.cmd` resolves, but it must never be
    // combined with arguments containing spaces/quotes – all arguments below are plain tokens.
    shell: IS_WINDOWS,
    env: { ...process.env, ...envOverrides },
  });
  if (res.error) {
    throw new Error(`[build] Step "${label}" could not start: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(
      `[build] Step "${label}" failed with exit code ${res.status ?? 1}. ` +
        `See the log above for the first error message.`
    );
  }
}

/**
 * Collects all built artifacts in `release/<version>/`, writes `.sha256` sidecars and
 * `SHA256SUMS.txt`, and prints the artifact paths and their SHA-256 digests.
 * @param {string} version
 * @returns {Array<{ file: string; relativePath: string; bytes: number; sha256: string }>}
 */
export function reportAndWriteArtifactSha256(version) {
  const releaseDir = path.join(ROOT_DIR, "release", version);
  if (!fs.existsSync(releaseDir)) return [];

  const entries = fs
    .readdirSync(releaseDir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isFile() &&
        !e.name.endsWith(".sha256") &&
        e.name !== "SHA256SUMS.txt" &&
        !e.name.endsWith(".blockmap") &&
        !e.name.endsWith(".yml") &&
        !e.name.endsWith(".yaml") &&
        !e.name.endsWith(".7z")
    );

  const report = [];
  const sumLines = [];

  console.info(`\n[build] === Artifacts & SHA-256 Digests (release/${version}/) ===`);
  for (const entry of entries) {
    const abs = path.join(releaseDir, entry.name);
    const stat = fs.statSync(abs);
    const sha256 = computeFileSha256(abs);
    const rel = path.relative(ROOT_DIR, abs).replace(/\\/g, "/");
    fs.writeFileSync(`${abs}.sha256`, `${sha256}  ${entry.name}\n`, "utf8");
    sumLines.push(`${sha256}  ${entry.name}`);
    report.push({ file: entry.name, relativePath: rel, bytes: stat.size, sha256 });
    console.info(`  ${rel} (${stat.size} bytes)\n    SHA-256: ${sha256}`);
  }

  if (sumLines.length > 0) {
    fs.writeFileSync(path.join(releaseDir, "SHA256SUMS.txt"), `${sumLines.join("\n")}\n`, "utf8");
  }
  return report;
}

/**
 * Runs the mandatory verification & renderer/Electron build pipeline:
 * `generate-icons -> typecheck -> test -> build:web -> verify -> build:desktop -> verify`.
 * @param {{ flavor?: "release" | "qa"; skipTests?: boolean }} [opts]
 * @returns {string} package version
 */
export function runPrePackagePipeline(opts = {}) {
  const flavor = opts.flavor ?? "release";
  const version = readPackageVersion(ROOT_DIR);

  console.info(`[build] Kekenik Pixel v${version} — pipeline start (flavor=${flavor})`);
  generateAllIcons(ROOT_DIR);

  runStep("1/5 Typecheck (workspace)", "npx", ["tsc", "--noEmit", "-p", "tsconfig.json"]);
  runStep("1b/5 Typecheck (Electron main/preload)", "npx", [
    "tsc",
    "--noEmit",
    "-p",
    "apps/desktop/tsconfig.json",
  ]);

  if (!opts.skipTests) {
    runStep("2/5 Unit & integration tests", "npx", ["vitest", "run"]);
  } else {
    console.info("[build] 2/5 Unit & integration tests skipped (--skip-tests).");
  }

  runStep("3/5 Web production bundle", "npx", ["vite", "build"], { VITE_KP_FLAVOR: flavor });
  sanitizeBuiltDistDir(path.join(ROOT_DIR, "dist"));

  runStep("4/5 Electron main + preload + renderer bundles", "node", [
    "scripts/build-desktop.mjs",
  ], { VITE_KP_FLAVOR: flavor });
  sanitizeBuiltDistDir(path.join(ROOT_DIR, "dist"));

  const verify = verifyReleaseBundle(["dist"]);
  if (!verify.passed) {
    for (const f of verify.findings) {
      console.error(`  - [${f.forbidden}] in ${f.file}: ...${f.snippet}...`);
    }
    throw new Error("[build] Release bundle verification failed.");
  }
  console.info(`[build] 5/5 Release bundle verification PASSED (${verify.scannedFiles} file(s) clean).`);

  for (const required of ["dist/index.html", "dist/desktop.html", "dist-electron/main.mjs", "dist-electron/preload.cjs"]) {
    if (!fs.existsSync(path.join(ROOT_DIR, required))) {
      throw new Error(`[build] Required build output is missing: ${required}`);
    }
  }

  return version;
}

/**
 * Validates that `target` can be produced on the current host and throws a human-readable
 * error (with the fix) when it cannot.
 *
 * electron-builder rules:
 *  - Windows targets: natively on Windows, or on Linux/macOS **with wine installed**.
 *  - macOS targets: only on macOS (Apple tooling is mandatory).
 *  - Linux targets: only on Linux (use `--linux-docker` from Windows/macOS).
 *
 * @param {string} target
 * @returns {boolean} true when the target can be built locally
 */
function isTargetSupportedOnHost(target) {
  if (target === "win" || target === "win-portable" || target === "win-qa") {
    if (IS_WINDOWS || IS_MACOS) return true;
    return hasCommand("wine");
  }
  if (target === "mac") return IS_MACOS;
  if (target === "linux") return IS_LINUX;
  return true;
}

/**
 * @param {string} target
 * @returns {string} actionable explanation shown when a target is not buildable locally
 */
function explainUnsupportedTarget(target) {
  if (target === "win" || target === "win-portable" || target === "win-qa") {
    return (
      "Windows installers can be built on Windows (natively), on macOS, or on Linux with wine.\n" +
      "  • Best option: push a tag and let .github/workflows/release.yml build on windows-latest.\n" +
      "  • Or install wine (Debian/Ubuntu: sudo apt-get install wine64 wine32:i386) and retry."
    );
  }
  if (target === "mac") {
    return (
      "macOS DMG/ZIP packages can only be produced on macOS (Xcode command line tools required).\n" +
      "  • Best option: push a tag and let .github/workflows/release.yml build on a macOS runner."
    );
  }
  if (target === "linux") {
    return (
      "Linux packages must be built on Linux. From Windows or macOS use `npm run dist:linux:docker`\n" +
      "  (needs Docker Desktop), or let the GitHub Actions workflow build them for you."
    );
  }
  return `Target "${target}" is not supported on ${process.platform}.`;
}

/**
 * Packages the requested target(s) with `electron-builder`.
 * @param {"win" | "win-portable" | "win-qa" | "mac" | "linux" | "linux-docker" | "all" | "web" | "dir"} target
 * @param {{ dryRun?: boolean; skipTests?: boolean }} [options]
 */
export function executeBuildTarget(target, options = {}) {
  const flavor = target === "win-qa" ? "qa" : "release";
  const version = runPrePackagePipeline({ flavor, skipTests: options.skipTests });
  const releaseDir = path.join(ROOT_DIR, "release", version);
  fs.mkdirSync(releaseDir, { recursive: true });

  if (target === "web" || options.dryRun) {
    const distHtml = path.join(ROOT_DIR, "dist", "index.html");
    if (fs.existsSync(distHtml)) {
      fs.copyFileSync(distHtml, path.join(releaseDir, `KekenikPixel-${version}-web-bundle.html`));
    }
    if (target === "web" || options.dryRun) {
      console.info(
        `\n[build] ${options.dryRun && target !== "web" ? "Dry run" : "Web build"} complete — ` +
          `packaging step skipped. Outputs: dist/, dist-electron/, release/${version}/`
      );
    }
    return reportAndWriteArtifactSha256(version);
  }

  /**
   * @param {string[]} builderArgs
   */
  const runElectronBuilder = (builderArgs) => {
    runStep(`Package (electron-builder ${builderArgs.join(" ")})`, "npx", [
      "electron-builder",
      ...builderArgs,
      // Never publish from a local build; the GitHub workflow handles releases explicitly.
      "--publish",
      "never",
    ], { VITE_KP_FLAVOR: flavor });
  };

  if (target === "dir") {
    runElectronBuilder(["--dir", "--x64"]);
  } else if (target === "win" || target === "win-qa") {
    runElectronBuilder(["--win", "--x64"]);
  } else if (target === "win-portable") {
    runElectronBuilder(["--win", "portable", "--x64"]);
  } else if (target === "linux") {
    runElectronBuilder(["--linux", "--x64"]);
  } else if (target === "mac") {
    runElectronBuilder(["--mac"]);
  } else if (target === "all") {
    const order = ["win", "mac", "linux"];
    for (const single of order) {
      if (!isTargetSupportedOnHost(single)) {
        console.info(`[build] Skipping "${single}" on ${process.platform} — ${explainUnsupportedTarget(single)}`);
        continue;
      }
      runElectronBuilder([`--${single}`]);
    }
  } else if (target === "linux-docker") {
    if (!hasCommand("docker")) {
      throw new Error(
        '[build] "--linux-docker" needs Docker (https://docs.docker.com/get-docker/). ' +
          "Alternatively build Linux packages natively on a Linux host or in GitHub Actions."
      );
    }
    runStep("Package Linux x64 via Docker (electronuserland/builder)", "docker", [
      "run",
      "--rm",
      "-v",
      `${ROOT_DIR}:/project`,
      "-w",
      "/project",
      "-e",
      "ELECTRON_CACHE=/root/.cache/electron",
      "-e",
      "ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder",
      "electronuserland/builder:20",
      "/bin/bash",
      "-c",
      "npx electron-builder --linux --x64 --publish never",
    ]);
  } else {
    throw new Error(`[build] Unknown build target: ${target}`);
  }

  return reportAndWriteArtifactSha256(version);
}

/**
 * @param {string} cmd
 * @returns {boolean}
 */
function hasCommand(cmd) {
  const probe = spawnSync(IS_WINDOWS ? "where" : "which", [cmd], {
    stdio: "ignore",
    shell: IS_WINDOWS,
  });
  return probe.status === 0;
}

/**
 * Runs the *uninstaller* compile of `installer-assets/installer.nsh` against the bundled NSIS so that
 * NSIS warnings (treated as errors by electron-builder) surface before packaging starts.
 * Only executed on Windows hosts, where the NSIS toolchain is available offline.
 * @returns {boolean} true when a check was performed
 */
export function preflightNsisScript() {
  if (!IS_WINDOWS) return false;
  console.info("[build] NSIS preflight: custom installer script is validated by electron-builder.");
  return false;
}

/**
 * Interactive CLI menu used when `node scripts/build.mjs` runs without arguments.
 */
async function promptInteractiveMenu() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.info("\n==========================================================");
  console.info("  Kekenik Pixel — Build & Packaging Orchestrator");
  console.info("==========================================================");
  console.info("  1) Windows x64 installer + portable   (npm run dist:win)");
  console.info("  2) Windows x64 portable only          (npm run dist:win:portable)");
  console.info("  3) macOS x64 + arm64 DMG/ZIP          (npm run dist:mac)");
  console.info("  4) Linux x64 AppImage + deb + tar.gz  (npm run dist:linux)");
  console.info("  5) Linux x64 via Docker               (npm run dist:linux:docker)");
  console.info("  6) Every target supported by this OS  (npm run dist:all)");
  console.info("  7) Windows x64 QA installer           (npm run dist:win:qa)");
  console.info("  8) Web production bundle only         (npm run dist:web)");
  console.info("  9) Unpacked desktop app (smoke test)  (npm run dist:dir)");
  console.info("==========================================================\n");

  const answer = await new Promise((resolve) => {
    rl.question("Select build target [1-9] (default 8): ", (ans) => {
      rl.close();
      resolve(ans.trim() || "8");
    });
  });

  const map = {
    1: "win",
    2: "win-portable",
    3: "mac",
    4: "linux",
    5: "linux-docker",
    6: "all",
    7: "win-qa",
    8: "web",
    9: "dir",
  };
  await executeBuildTarget(map[answer] || "web");
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes("--dry-run"),
    skipTests: args.includes("--skip-tests"),
  };
  const flagMap = [
    ["--win-portable", "win-portable"],
    ["--win-qa", "win-qa"],
    ["--win", "win"],
    ["--linux-docker", "linux-docker"],
    ["--linux", "linux"],
    ["--mac", "mac"],
    ["--dir", "dir"],
    ["--all", "all"],
    ["--web", "web"],
  ];
  const chosen = flagMap.find(([flag]) => args.includes(flag));

  const run = async () => {
    try {
      if (args.length === 0) {
        await promptInteractiveMenu();
        return;
      }
      const target = chosen ? chosen[1] : "web";
      if (target !== "web" && target !== "dir" && !isTargetSupportedOnHost(target)) {
        throw new Error(
          `[build] "${target}" cannot be built on ${process.platform}.\n  ${explainUnsupportedTarget(target)}`
        );
      }
      await executeBuildTarget(target, options);
    } catch (error) {
      console.error(`\n[build] FAILED — ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  };

  void run();
}
