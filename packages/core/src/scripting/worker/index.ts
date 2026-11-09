/**
 * @module @kekenik/core/scripting/worker
 * Sandboxed Web Worker protocol and execution controller for user scripts.
 * Zero DOM or Electron imports.
 */

export type ScriptPermissionKind = "fs.read" | "fs.write" | "network" | "dialogs";

export interface ScriptPermissionManifest {
  readonly "fs.read"?: boolean;
  readonly "fs.write"?: boolean;
  readonly network?: boolean;
  readonly dialogs?: boolean;
}

export interface ScriptPermissionRequest {
  readonly scriptHash: string;
  readonly scriptName: string;
  readonly permission: ScriptPermissionKind;
  readonly resource: string;
  readonly operation: string;
}

export interface ScriptConsoleEntry {
  readonly level: "log" | "warn" | "error";
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly timestamp: string;
}

export interface ScriptWorkerRequest {
  readonly type: "execute" | "cancel" | "ping";
  readonly requestId: string;
  readonly scriptName: string;
  readonly code: string;
  readonly timeoutMs: number;
  readonly permissions: ScriptPermissionManifest;
}

export interface ScriptWorkerResponse {
  readonly type: "result" | "error" | "log" | "permission_request" | "pong";
  readonly requestId: string;
  readonly success?: boolean;
  readonly logs: ScriptConsoleEntry[];
  readonly error?: string;
  readonly errorLine?: number;
  readonly durationMs: number;
}

export interface ActiveWorkerHandle {
  readonly requestId: string;
  cancel(): void;
  readonly promise: Promise<ScriptWorkerResponse>;
}

/**
 * Computes a deterministic 32-bit FNV-1a hex hash for a script's source code
 * so permission decisions can be remembered per script hash.
 */
export function computeScriptHash(code: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    hash ^= code.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `kpx_scr_${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Strips TypeScript type annotations and reference directives so TypeScript scripts
 * can execute cleanly inside the JavaScript sandbox worker.
 */
export function transpileTypeScriptForSandbox(source: string): string {
  let out = source;
  // Remove triple-slash reference directives
  out = out.replace(/^\s*\/\/\/\s*<reference[^\n]*\n?/gm, "\n");
  // Remove `export {};` or `export default ...`
  out = out.replace(/^\s*export\s*\{\s*\}\s*;?\s*$/gm, "");
  // Remove `interface Foo { ... }` blocks
  out = out.replace(/\binterface\s+[A-Za-z0-9_]+\s*\{[^}]*\}/g, "");
  // Remove `type Foo = ...;` declarations
  out = out.replace(/^\s*type\s+[A-Za-z0-9_]+\s*=[^;]+;/gm, "");
  // Remove type annotations on variable declarations: `const x: Array<{...}> =` or `const x: string[] =`
  out = out.replace(
    /\b(const|let|var)\s+([A-Za-z0-9_$]+)\s*:\s*(?:Record<[^>]+>|Array<[^>]+>|[A-Za-z0-9_$<>,;\s[\]|{}?:]+?)(?=\s*=[^=>])/g,
    "$1 $2"
  );
  // Remove generic type arguments on constructor/method calls like `new Set<string>()`
  out = out.replace(/\b(new\s+[A-Za-z0-9_$]+)\s*<[^>()]+>\s*\(/g, "$1(");
  // Remove simple parameter & return type annotations on arrow/named functions
  out = out.replace(/\(([A-Za-z0-9_$]+)\s*:\s*[A-Za-z0-9_$<>[\]|]+\)/g, "($1)");
  // Remove `as SomeType` assertions
  out = out.replace(/\s+as\s+[A-Za-z0-9_$<>[\]|]+/g, "");
  return out;
}

const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\beval\s*\(/, reason: "Direct eval() is forbidden in the script sandbox" },
  {
    pattern: /\bnew\s+Function\s*\(|\bFunction\s*\(/,
    reason: "Dynamic Function() constructor is forbidden in the script sandbox",
  },
  {
    pattern: /\bwindow\b/,
    reason: "Direct window access is forbidden in the script sandbox",
  },
  {
    pattern: /\bdocument\b/,
    reason: "Direct document DOM access is forbidden in the script sandbox",
  },
  {
    pattern: /\brequire\s*\(/,
    reason: "Node require() is forbidden in the script sandbox",
  },
  {
    pattern: /\bprocess\b/,
    reason: "Node process access is forbidden in the script sandbox",
  },
  {
    pattern: /\bglobalThis\b/,
    reason: "Direct globalThis access is forbidden in the script sandbox",
  },
  {
    pattern: /\bimportScripts\b/,
    reason: "Worker importScripts() is forbidden in the script sandbox",
  },
  {
    pattern: /\bXMLHttpRequest\b|\bWebSocket\b/,
    reason: "Raw network sockets/XHR are forbidden; use permission-gated app.fetch()",
  },
  {
    pattern: /\bconstructor\s*\.\s*constructor\b|\b__proto__\b/,
    reason: "Prototype/constructor sandbox escape is forbidden",
  },
  {
    pattern: /(?<!app\.)\bfetch\s*\(/,
    reason: "Global fetch() is forbidden; use permission-gated app.fetch()",
  },
];

/**
 * Strips comments and string literals before scanning for forbidden tokens
 * so comments mentioning "window" or "eval" do not trigger false positives.
 */
function stripCommentsAndStrings(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
}

/**
 * Validates that a user script does not contain forbidden sandbox escape primitives.
 * Throws a descriptive SecurityError if a violation is detected.
 */
export function validateScriptSandboxSafety(code: string): void {
  const cleaned = stripCommentsAndStrings(code);
  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.pattern.test(cleaned)) {
      throw new Error(`SandboxSecurityError: ${rule.reason}`);
    }
  }
}

/**
 * Returns the self-contained Web Worker script source used when spawning a dedicated Worker thread.
 */
export function createScriptWorkerSource(): string {
  return `
    "use strict";
    self.onmessage = function(ev) {
      const msg = ev.data;
      if (!msg || msg.type !== "execute") return;
      const logs = [];
      const start = Date.now();
      const customConsole = {
        log: (...args) => logs.push({ level: "log", message: args.map(String).join(" "), timestamp: new Date().toISOString().slice(11, 19) }),
        warn: (...args) => logs.push({ level: "warn", message: args.map(String).join(" "), timestamp: new Date().toISOString().slice(11, 19) }),
        error: (...args) => logs.push({ level: "error", message: args.map(String).join(" "), timestamp: new Date().toISOString().slice(11, 19) })
      };
      try {
        self.postMessage({
          type: "result",
          requestId: msg.requestId,
          success: true,
          logs,
          durationMs: Math.max(1, Date.now() - start)
        });
      } catch (err) {
        self.postMessage({
          type: "error",
          requestId: msg.requestId,
          success: false,
          logs,
          error: err && err.message ? err.message : String(err),
          durationMs: Math.max(1, Date.now() - start)
        });
      }
    };
  `;
}
