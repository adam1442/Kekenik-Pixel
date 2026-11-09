# Releasing Kekenik Pixel

The whole release is driven by **one git tag**. Everything else (four installers, four macOS
artifacts, three Linux packages, checksums and the GitHub Release) is produced by
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
npm version patch            # or minor / major — bumps package.json + creates a vX.Y.Z tag
git push --follow-tags       # triggers .github/workflows/release.yml
```

The workflow then:

| Job | Runner | Produces |
|---|---|---|
| `verify` | `ubuntu-latest` | typecheck + tests + web bundle (gate for everything else) |
| `build` (Windows x64) | `windows-latest` | `-win-x64-setup.exe`, `-win-x64-portable.exe` |
| `build` (macOS) | `macos-14` | `-mac-x64.dmg/.zip`, `-mac-arm64.dmg/.zip` |
| `build` (Linux x64) | `ubuntu-22.04` | `.AppImage`, `.deb`, `.tar.gz` |
| `release` | `ubuntu-latest` | combined `SHA256SUMS.txt` + GitHub Release with every file attached |

Version numbers are read from `package.json`, so the tag (`v1.2.3`) and the artifact names
(`KekenikPixel-1.2.3-…`) always match.

### Manual / dry run

* **Actions → Release → Run workflow** builds everything and creates a **draft** release by
  default (untick *draft* to publish immediately).
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

Signing is configured **only through repository secrets** — no code changes are needed.

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

Remove `CSC_IDENTITY_AUTO_DISCOVERY: "false"` from the workflow env once real certificates are
provided, and add a `notarize` block under `build.mac` in `package.json`.

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
