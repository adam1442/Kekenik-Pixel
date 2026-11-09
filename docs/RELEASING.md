# Releasing Kekenik Pixel

The whole release is driven by **one git tag**. Everything else (two Windows packages, four macOS
artifacts, three Linux packages, a web bundle, checksums and the GitHub Release) is produced by
`.github/workflows/release.yml`.

---

## 1. One-time repository setup

1. Create the GitHub repository and push this tree to `main`.
2. Make sure **Settings → Actions → General → Workflow permissions** is set to
   *Read and write permissions* (the release job needs it to create the Release).
3. Confirm the repository links in `package.json`, `README.md`, and
   `.github/ISSUE_TEMPLATE/config.yml` point to `adam1442/Kekenik-Pixel`.
4. Upload `Screenshot.jpg` to the repository root (the README references it at the top).
5. Optional: add branch protection for `main` requiring the **CI** workflow to pass.

---

## 2. Cut a release

```bash
git checkout main && git pull
npm ci
npm version patch --no-git-tag-version  # or minor / major; bumps package.json + package-lock.json
npm run generate:icons                  # regenerates versioned assets
npm run typecheck && npm test
git add package.json package-lock.json assets/icon installer-assets
git commit -m "Release new version"
VERSION=$(node -p "require('./package.json').version")
git tag "v$VERSION"
git push origin main
git push origin "v$VERSION"             # triggers release.yml
```

The workflow then:

| Job | Runner | Produces |
|---|---|---|
| `verify` | `ubuntu-latest` | typecheck + tests + web bundle (gate for everything else) |
| `build` (Windows x64) | `windows-latest` | `-win-x64-setup.exe`, `-win-x64-portable.exe` |
| `build` (macOS) | `macos-15` (ARM runner) | `-mac-x64.dmg/.zip`, `-mac-arm64.dmg/.zip` |
| `build` (Linux x64) | `ubuntu-22.04` | `.AppImage`, `.deb`, `.tar.gz` |
| `release` | `ubuntu-latest` | combined `SHA256SUMS.txt` + GitHub Release with every file attached |

Version numbers are read from `package.json`, so the tag (`v1.2.3`) and the artifact names
(`KekenikPixel-1.2.3-…`) always match.

### Manual / dry run

* **Actions → Release → Run workflow** builds the selected branch or tag and creates a **draft**
  release by default (untick *draft* to publish immediately). If the version tag already exists,
  it must point to the selected commit; otherwise bump the version. If it does not exist, the
  workflow creates `v<package.json version>` at the selected commit. The workflow must exist on
  the repository's default branch before the Run workflow button is available.
* A pushed tag must exactly match `v` followed by the package version. Use a new tag for fixes:
  rerunning an older tag uses the workflow and source saved at that tag.
* The publication job verifies all ten expected files before creating or updating a release. If a
  build fails, review that job's log; its successful build artifacts remain downloadable under
  the workflow run for the retention period.
* To build locally first, see [`BUILD.md`](BUILD.md) — `npm run dist:win`, `dist:mac`,
  `dist:linux`.

---

## 3. Artifact naming contract

`scripts/build.mjs#getExpectedArtifactNames()` is the single source of truth and is covered by
tests:

| Platform | File |
|---|---|
| Windows | `KekenikPixel-<version>-win-x64-setup.exe` |
| Windows (portable) | `KekenikPixel-<version>-win-x64-portable.exe` |
| macOS Intel | `KekenikPixel-<version>-mac-x64.dmg` / `.zip` |
| macOS Apple Silicon | `KekenikPixel-<version>-mac-arm64.dmg` / `.zip` |
| Linux AppImage | `KekenikPixel-<version>-linux-x64.AppImage` |
| Linux deb | `KekenikPixel-<version>-linux-x64.deb` |
| Linux tarball | `KekenikPixel-<version>-linux-x64.tar.gz` |
| Web | `KekenikPixel-<version>-web-bundle.html` |
| Checksums | `SHA256SUMS.txt` + `<artifact>.sha256` |

---

## 4. Code signing (optional, recommended for public releases)

The workflow currently produces **unsigned** builds. To enable signing, explicitly map the
relevant repository secrets into the build step environment and configure electron-builder;
secrets are not passed to the build automatically.

### Windows (Authenticode)

| Secret | Meaning |
|---|---|
| `CSC_LINK` | Base64 of your `.pfx`, or an absolute path / https URL |
| `CSC_KEY_PASSWORD` | Password for the `.pfx` |

`electron-builder` then signs the installer and the app executable. If the certificate uses a
SHA-1 subject, also set `windows.signtoolOptions.publisherName` in `package.json`.

### macOS (Developer ID + notarization)

| Secret | Meaning |
|---|---|
| `CSC_LINK` | Base64 of your `.p12` Developer ID certificate |
| `CSC_KEY_PASSWORD` | Password for the `.p12` |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization credentials |

Pass the certificate and notarization secrets to the macOS build step, enable certificate
auto-discovery as appropriate, and configure notarization in electron-builder.

> Unsigned builds are perfectly usable, but Windows SmartScreen and macOS Gatekeeper will show a
> warning on first launch.

---

## 5. Post-release checklist

- [ ] Release notes list every platform and file (the workflow generates a table automatically).
- [ ] `SHA256SUMS.txt` is attached and verifiable.
- [ ] `CHANGELOG.md` has an entry for the version.
- [ ] `docs/KNOWN_ISSUES.md` reflects reality.
- [ ] Download the Windows installer once on a clean VM and confirm the `.kpx` association works.
- [ ] Download the macOS DMG once and confirm right-click → Open launches the app.
