export const FORBIDDEN_RELEASE_STRINGS: readonly string[];

export interface ForbiddenFinding {
  file: string;
  forbidden: string;
  snippet: string;
}

export interface VerifyReleaseBundleResult {
  passed: boolean;
  scannedFiles: number;
  findings: ForbiddenFinding[];
}

export function sanitizeBuiltDistDir(distDir?: string): number;
export function scanContentForForbiddenStrings(
  content: string,
  filePath: string
): ForbiddenFinding[];
export function verifyReleaseBundle(targets?: string[]): VerifyReleaseBundleResult;
