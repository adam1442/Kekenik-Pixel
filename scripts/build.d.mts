export interface ExpectedArtifactNames {
  winSetup: string;
  winPortable: string;
  macDmgX64: string;
  macDmgArm64: string;
  macZipX64: string;
  macZipArm64: string;
  linuxAppImage: string;
  linuxDeb: string;
  linuxTarGz: string;
}

export interface BuiltArtifactReport {
  file: string;
  relativePath: string;
  bytes: number;
  sha256: string;
}

export type BuildTarget =
  | "win"
  | "win-portable"
  | "win-qa"
  | "mac"
  | "linux"
  | "linux-docker"
  | "all"
  | "web"
  | "dir";

export function getExpectedArtifactNames(version: string): ExpectedArtifactNames;
export function computeFileSha256(filePath: string): string;
export function reportAndWriteArtifactSha256(version: string): BuiltArtifactReport[];
export function runPrePackagePipeline(opts?: {
  flavor?: "release" | "qa";
  skipTests?: boolean;
}): string;
export function executeBuildTarget(
  target: BuildTarget,
  options?: { dryRun?: boolean; skipTests?: boolean }
): BuiltArtifactReport[];
export function preflightNsisScript(): boolean;
