/**
 * @module @kekenik/ui/skin/app-icon
 * Original pixel-art + vector Kekenik Pixel Application Icon (B16) and .kpx Document Icon (B17)
 * shared across TitleBar, AboutDialog, and HomeTab.
 */

import React from "react";
import { version as packageVersion } from "../../../../package.json";

export const KEKENIK_APP_VERSION = packageVersion;

const PALETTE_HEX: Record<string, string> = {
  B: "#1c1624", // Outer dark plum-ink silhouette border
  F: "#453859", // Rounded frame bevel midtone
  H: "#6e5c8a", // Frame top-left highlight
  C: "#f7f1de", // Warm pixel canvas light cell
  G: "#e4dbc2", // Warm pixel canvas checker cell
  R: "#ff4772", // Bold pixel stroke coral-magenta
  O: "#ff9e3b", // Bold pixel stroke warm amber
  M: "#2ed8a6", // Bold pixel stroke mint-teal
  P: "#60507a", // Brush handle / ferrule
  Y: "#ffd65c", // Brush gold collar
  K: "#00f0ff", // Crisp cursor pixel highlight
  W: "#ffffff", // Specular white pixel
};

export const APP_ICON_GRID_16: readonly string[] = [
  "..BBBBBBBBBBBB..",
  ".BHHHHHHHHHHHHB.",
  "BHFCCCCCCCCGBPWB",
  "BHCGGGGCGCCGYPPB",
  "BHCGCCCGCRROYB.B",
  "BHCCGCCCRROOYF.B",
  "BHCGCGCCROOOMCFB",
  "BHCGCCGCGOOMMCFB",
  "BHCCGCGCCGMMCCFB",
  "BHCGCGCCCGMCCGFB",
  "BHCCRRCCCGCCBKBB",
  "BHCGRRCCCCCBKWKB",
  "BHCCCGCCCCGCBKBB",
  "BHFFFFFFFFFFFFFB",
  ".BBBBBBBBBBBBBB.",
  "................",
];

export const KPX_DOC_GRID_16: readonly string[] = [
  "..BBBBBBBBBB....",
  "..BHHHHHHHHBWB..",
  "..BHCCCCCCCBBWB.",
  "..BHCCCCCCBBBBBB",
  "..BHCCRRCCCCCHB.",
  "..BHCCRROCCCCHB.",
  "..BHCCCOOMCCCHB.",
  "..BHCCCCOMMCCHB.",
  "..BHCCCCCMKCCHB.",
  "..BHCCCCCCCCCHB.",
  "..BHBBBBBBBBCHB.",
  "..BHBROKROKBCHB.",
  "..BHBBBBBBBBCHB.",
  "..BHFFFFFFFFFHB.",
  "..BBBBBBBBBBBBB.",
  "................",
];

export const KekenikAppIcon: React.FC<{
  size?: number;
  className?: string;
  dataTestId?: string;
  version?: string;
}> = ({
  size = 16,
  className = "",
  dataTestId = "kekenik-app-icon",
  version = KEKENIK_APP_VERSION,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    shapeRendering="crispEdges"
    data-testid={dataTestId}
    data-version={version}
    aria-label="Kekenik Pixel App Icon"
    className={`inline-block shrink-0 select-none ${className}`}
  >
    {APP_ICON_GRID_16.map((row, y) =>
      Array.from(row).map((ch, x) => {
        const fill = PALETTE_HEX[ch];
        if (!fill) return null;
        return <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />;
      })
    )}
  </svg>
);

export const KpxFileIcon: React.FC<{
  size?: number;
  className?: string;
  dataTestId?: string;
  version?: string;
}> = ({
  size = 16,
  className = "",
  dataTestId = "kekenik-kpx-file-icon",
  version = KEKENIK_APP_VERSION,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    shapeRendering="crispEdges"
    data-testid={dataTestId}
    data-version={version}
    aria-label="Kekenik Pixel Project (.kpx) Icon"
    className={`inline-block shrink-0 select-none ${className}`}
  >
    {KPX_DOC_GRID_16.map((row, y) =>
      Array.from(row).map((ch, x) => {
        const fill = PALETTE_HEX[ch];
        if (!fill) return null;
        return <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />;
      })
    )}
  </svg>
);
