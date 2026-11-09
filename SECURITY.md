# Security Policy

## Supported versions

Security fixes are shipped for the **latest released version** of Kekenik Pixel.

| Version | Supported |
|---|---|
| 1.0.x | ✅ |
| < 1.0 | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

* Use GitHub's private reporting: **Security → Report a vulnerability**
  (repository *Security* tab → *Advisories*).
* If that is unavailable, e-mail **security@kekenik.com** with:
  * a description of the issue and its impact,
  * reproduction steps or a proof of concept,
  * the affected version, platform and, if relevant, the file that triggers it.

You can expect an acknowledgement within **72 hours** and a status update within **7 days**.
Please allow time for a fix to be released before any public disclosure.

## Scope

The following are in scope:

* The Electron main process, preload bridge and IPC surface (`apps/desktop`).
* File parsing of untrusted documents (`.kpx`, `.aseprite/.ase`, PNG/APNG, GIF, WebP, JPEG, BMP,
  ICO, TGA, QOI, PCX, FLI/FLC) — memory-safety, denial-of-service via crafted files.
* The scripting runtime and extension loader (sandbox escapes, arbitrary code execution).
* The packaging/release pipeline (installer, update metadata, signing, artifact integrity).
* Anything that could allow a malicious document, extension or script to read or write files it
  should not, or to execute code outside the sandbox.

## Out of scope

* Missing code-signing certificates / SmartScreen or Gatekeeper warnings on unsigned builds
  (documented limitation).
* Vulnerabilities that require the user to run an attacker-supplied binary or to disable OS
  security features.
* Vulnerabilities in third-party dependencies without a demonstrable impact on Kekenik Pixel
  (still report them — they are triaged and fixed through Dependabot).

## Security design notes

* `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` — the renderer never
  receives `ipcRenderer` or Node APIs; the preload exposes a small, typed, zod-validated bridge.
* A strict Content-Security-Policy is applied to every renderer response.
* All file parsing happens on `Uint8Array` buffers written in TypeScript, with explicit bounds
  checks (no native decoders).
* Scripts and extensions run inside a worker-based sandbox with a whitelisted API surface.
* Release artifacts ship with `SHA256SUMS.txt`; every installer is built by CI from a verified
  tree (typecheck + 215 tests + bundle verification).

## Verifying a release

```bash
sha256sum -c SHA256SUMS.txt          # Linux
shasum -a 256 -c SHA256SUMS.txt      # macOS
Get-FileHash -Algorithm SHA256 .\KekenikPixel-*.exe    # Windows PowerShell
```
