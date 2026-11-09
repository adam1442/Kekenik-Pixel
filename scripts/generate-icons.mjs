#!/usr/bin/env node
/**
 * @module scripts/generate-icons
 * Generates all B16 application icons and B17 .kpx project file icons from deterministic
 * code-defined pixel-art grids + vector SVG masters. Uses only Node built-in modules (`fs`, `path`, `zlib`, `crypto`).
 *
 * Outputs under `assets/icon/`:
 *  - `app.svg` (Vector + pixel master, version-pinned to `package.json`)
 *  - `icon.ico` (Multi-size Windows ICO: 16, 24, 32, 48, 64, 128, 256)
 *  - `icon.icns` (Apple ICNS container: icp4, icp5, icp6, ic07, ic08, ic09, ic10)
 *  - `icon.png` (512x512 primary PNG)
 *  - `png/16x16.png` .. `png/1024x1024.png` (Linux hicolor icon set: 16, 24, 32, 48, 64, 128, 256, 512, 1024)
 *  - `tray-16.png`, `tray-24.png`, `tray-32.png`, `taskbar-32.png` (Tray & taskbar variants)
 *  - `installer-header.bmp` (150x57 24-bit BMP for NSIS MUI_HEADERIMAGE_BITMAP)
 *  - `installer-sidebar.bmp` (164x314 24-bit BMP for NSIS MUI_WELCOMEFINISHPAGE_BITMAP)
 *  - `file-kpx.svg`, `file-kpx-16.svg`, `file-kpx-32.svg` (Dedicated .kpx document icon masters)
 *  - `file-kpx-16.png`, `file-kpx-32.png`, `file-kpx-48.png`, `file-kpx-64.png`, `file-kpx-128.png`, `file-kpx-256.png`
 *  - `file-kpx.ico` (multi-size Windows document association icon)
 *  - `file-kpx.icns` (multi-size macOS document association icon)
 *  - `icon-manifest.json` (Version-pinned manifest with SHA-256 hashes)
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Reads the current version from `package.json` so all icons are version-pinned.
 * @param {string} [rootDir]
 * @returns {string}
 */
export function readPackageVersion(rootDir = ROOT_DIR) {
  const pkgPath = path.join(rootDir, "package.json");
  const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return String(raw.version || "1.0.0");
}

// Color palette for the original Kekenik Pixel App Icon:
// Rounded pixel-art canvas frame + bold diagonal 3-tone pixel brush stroke + brush nib + cyan cursor pixel.
export const APP_ICON_PALETTE = {
  ".": [0, 0, 0, 0], // Transparent
  B: [28, 22, 36, 255], // Outer dark plum-ink silhouette border (#1c1624)
  F: [69, 56, 89, 255], // Rounded frame bevel midtone (#453859)
  H: [110, 92, 138, 255], // Frame top-left highlight (#6e5c8a)
  C: [247, 241, 222, 255], // Warm pixel canvas light cell (#f7f1de)
  G: [228, 219, 194, 255], // Warm pixel canvas checker cell (#e4dbc2)
  R: [255, 71, 114, 255], // Bold pixel stroke coral-magenta (#ff4772)
  O: [255, 158, 59, 255], // Bold pixel stroke warm amber (#ff9e3b)
  M: [46, 216, 166, 255], // Bold pixel stroke mint-teal (#2ed8a6)
  P: [96, 80, 122, 255], // Brush handle / ferrule (#60507a)
  Y: [255, 214, 92, 255], // Brush gold collar (#ffd65c)
  K: [0, 240, 255, 255], // Crisp cursor pixel highlight (#00f0ff)
  W: [255, 255, 255, 255], // Specular white pixel (#ffffff)
};

// 16x16 master pixel grid for App Icon (readable at 16px, scales crisply to any size)
export const APP_ICON_GRID_16 = [
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

// Dedicated 16x16 small-size-optimized .kpx document icon grid (folded corner page + pixel stroke mark)
export const KPX_DOC_GRID_16 = [
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

// Dedicated 32x32 .kpx document icon generator (page with folded corner + embedded mini app mark + KPX pixel badge)
export function renderKpxDocPixels(size) {
  if (size <= 24) {
    return scalePixelGrid(KPX_DOC_GRID_16, APP_ICON_PALETTE, size);
  }
  // Construct a crisp 32x32 master grid and integer/nearest-neighbor scale to `size`
  const grid32 = Array.from({ length: 32 }, () => Array(32).fill("."));
  const setPx = (x, y, code) => {
    if (x >= 0 && x < 32 && y >= 0 && y < 32) grid32[y][x] = code;
  };
  const fillRect = (x0, y0, w, h, code) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) setPx(x, y, code);
    }
  };

  // Document body (x: 4..27, y: 2..29) with top-right dog-ear fold (6x6)
  for (let y = 2; y <= 29; y++) {
    for (let x = 4; x <= 27; x++) {
      const inFold = x >= 22 && y <= 7 && x - 22 > y - 2;
      if (inFold) continue;
      const isBorder =
        x === 4 ||
        x === 27 ||
        y === 2 ||
        y === 29 ||
        (x >= 22 && y <= 7 && x - 22 === y - 2);
      if (isBorder) {
        setPx(x, y, "B");
      } else if (x === 5 || y === 3) {
        setPx(x, y, "H");
      } else if (x === 26 || y === 28) {
        setPx(x, y, "F");
      } else {
        setPx(x, y, (x + y) % 2 === 0 ? "C" : "G");
      }
    }
  }
  // Folded flap triangle
  for (let y = 3; y <= 7; y++) {
    for (let x = 22; x <= 26; x++) {
      if (x - 22 <= y - 2) {
        setPx(x, y, x === 22 || y === 7 ? "B" : "W");
      }
    }
  }

  // Center Kekenik Pixel emblem (8x8 mini canvas frame + brush stroke) at (10, 7)..(21, 18)
  fillRect(9, 7, 14, 12, "B");
  fillRect(10, 8, 12, 10, "C");
  // Diagonal pixel brush stroke inside emblem
  setPx(11, 15, "R");
  setPx(12, 15, "R");
  setPx(12, 14, "R");
  setPx(13, 14, "O");
  setPx(14, 13, "O");
  setPx(15, 12, "O");
  setPx(16, 11, "M");
  setPx(17, 11, "M");
  setPx(18, 10, "Y");
  setPx(19, 9, "P");
  // Cursor pixel in emblem bottom-right
  setPx(19, 15, "B");
  setPx(20, 15, "K");
  setPx(19, 16, "K");

  // Bottom ".KPX" banner bar (x: 6..25, y: 20..26)
  fillRect(6, 20, 20, 7, "B");
  fillRect(7, 21, 18, 5, "F");
  // Pixel letters "KPX" in white (W) / cyan (K)
  // 'K' at x=9..12, y=21..25
  for (let y = 21; y <= 25; y++) setPx(9, y, "W");
  setPx(11, 21, "W");
  setPx(10, 22, "W");
  setPx(10, 23, "W");
  setPx(11, 24, "W");
  setPx(12, 25, "W");
  // 'P' at x=14..17, y=21..25
  for (let y = 21; y <= 25; y++) setPx(14, y, "O");
  setPx(15, 21, "O");
  setPx(16, 21, "O");
  setPx(17, 22, "O");
  setPx(15, 23, "O");
  setPx(16, 23, "O");
  // 'X' at x=19..22, y=21..25
  setPx(19, 21, "K");
  setPx(22, 21, "K");
  setPx(20, 22, "K");
  setPx(21, 22, "K");
  setPx(20, 23, "K");
  setPx(21, 23, "K");
  setPx(20, 24, "K");
  setPx(21, 24, "K");
  setPx(19, 25, "K");
  setPx(22, 25, "K");

  const stringRows = grid32.map((r) => r.join(""));
  return scalePixelGrid(stringRows, APP_ICON_PALETTE, size);
}

/**
 * Nearest-neighbor scales a character grid into an RGBA `Uint8Array` of `targetSize x targetSize`.
 * @param {string[]} grid
 * @param {Record<string, number[]>} palette
 * @param {number} targetSize
 * @returns {Uint8Array}
 */
export function scalePixelGrid(grid, palette, targetSize) {
  const srcH = grid.length;
  const srcW = grid[0].length;
  const out = new Uint8Array(targetSize * targetSize * 4);

  for (let y = 0; y < targetSize; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / targetSize));
    const row = grid[sy];
    for (let x = 0; x < targetSize; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / targetSize));
      const ch = row[sx] || ".";
      const rgba = palette[ch] || [0, 0, 0, 0];
      const idx = (y * targetSize + x) * 4;
      out[idx] = rgba[0];
      out[idx + 1] = rgba[1];
      out[idx + 2] = rgba[2];
      out[idx + 3] = rgba[3];
    }
  }
  return out;
}

/**
 * Generates the vector + pixel SVG string for `assets/icon/app.svg` or `.kpx` file icons.
 * @param {string[]} grid
 * @param {Record<string, number[]>} palette
 * @param {string} version
 * @param {string} title
 * @returns {string}
 */
export function renderGridToSvg(grid, palette, version, title) {
  const h = grid.length;
  const w = grid[0].length;
  const rects = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = grid[y][x];
      const rgba = palette[ch];
      if (!rgba || rgba[3] === 0) continue;
      const hex =
        "#" +
        [rgba[0], rgba[1], rgba[2]]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("");
      rects.push(`  <rect x="${x}" y="${y}" width="1" height="1" fill="${hex}" />`);
    }
  }
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="256" height="256" shape-rendering="crispEdges" data-product="Kekenik Pixel" data-version="${version}">`,
    `  <title>${title} (v${version})</title>`,
    ...rects,
    `</svg>`,
    ``,
  ].join("\n");
}

// ---- Pure Node PNG Encoder (with version tEXt chunk) ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Encodes an RGBA `Uint8Array` of `width x height` into a valid PNG `Buffer` with an embedded `tEXt` version chunk.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba
 * @param {string} version
 * @returns {Buffer}
 */
export function encodeRgbaToPngBuffer(width, height, rgba, version = "1.0.0") {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawScanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawScanlines[rowStart] = 0; // filter type 0 (None)
    const srcStart = y * width * 4;
    Buffer.from(rgba.buffer, rgba.byteOffset + srcStart, width * 4).copy(
      rawScanlines,
      rowStart + 1
    );
  }

  const compressed = zlib.deflateSync(rawScanlines, { level: 9 });
  const textPayload = Buffer.from(`Software\0Kekenik Pixel v${version}`, "utf8");

  return Buffer.concat([
    signature,
    makePngChunk("IHDR", ihdr),
    makePngChunk("tEXt", textPayload),
    makePngChunk("IDAT", compressed),
    makePngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Packs multiple `{ size, pngBuffer }` entries into a Windows `.ico` container.
 * Supports sizes 16, 24, 32, 48, 64, 128, 256 (256 is stored as width/height byte 0 per ICO spec).
 * @param {Array<{ size: number; png: Buffer }>} entries
 * @returns {Buffer}
 */
export function encodeMultiSizeIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type 1 = ICON
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  const dataBlocks = [];
  let offset = 6 + count * 16;

  for (const item of entries) {
    const entry = Buffer.alloc(16);
    entry[0] = item.size >= 256 ? 0 : item.size;
    entry[1] = item.size >= 256 ? 0 : item.size;
    entry[2] = 0; // Palette count
    entry[3] = 0; // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // 32 bpp
    entry.writeUInt32LE(item.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    dataBlocks.push(item.png);
    offset += item.png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...dataBlocks]);
}

/**
 * Packs PNG buffers into an Apple `.icns` container (`icns` magic header + `icp4`..`ic10` blocks).
 * @param {Record<number, Buffer>} pngBySize
 * @returns {Buffer}
 */
export function encodeIcnsContainer(pngBySize) {
  const mapping = [
    { size: 16, ostype: "icp4" },
    { size: 32, ostype: "icp5" },
    { size: 64, ostype: "icp6" },
    { size: 128, ostype: "ic07" },
    { size: 256, ostype: "ic08" },
    { size: 512, ostype: "ic09" },
    { size: 1024, ostype: "ic10" },
  ];

  const blocks = [];
  let totalLen = 8;
  for (const { size, ostype } of mapping) {
    const png = pngBySize[size];
    if (!png) continue;
    const blockHeader = Buffer.alloc(8);
    blockHeader.write(ostype, 0, 4, "ascii");
    blockHeader.writeUInt32BE(png.length + 8, 4);
    blocks.push(blockHeader, png);
    totalLen += png.length + 8;
  }

  const fileHeader = Buffer.alloc(8);
  fileHeader.write("icns", 0, 4, "ascii");
  fileHeader.writeUInt32BE(totalLen, 4);
  return Buffer.concat([fileHeader, ...blocks]);
}

/**
 * Encodes an RGB/RGBA buffer into an uncompressed 24-bit Windows `.bmp` (bottom-up DIB) required by NSIS.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba
 * @returns {Buffer}
 */
export function encode24BitBmp(width, height, rgba) {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelArraySize = rowStride * height;
  const fileSize = 54 + pixelArraySize;
  const buf = Buffer.alloc(fileSize);

  // BITMAPFILEHEADER (14 bytes)
  buf.write("BM", 0, 2, "ascii");
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);

  // BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // Positive height = standard bottom-up BMP for NSIS
  buf.writeUInt16LE(1, 26); // Planes
  buf.writeUInt16LE(24, 28); // 24-bit RGB
  buf.writeUInt32LE(0, 30); // BI_RGB
  buf.writeUInt32LE(pixelArraySize, 34);
  buf.writeInt32LE(2835, 38); // 72 DPI
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  for (let y = 0; y < height; y++) {
    const bmpRow = height - 1 - y;
    const dstRowStart = 54 + bmpRow * rowStride;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = dstRowStart + x * 3;
      buf[dstIdx] = rgba[srcIdx + 2]; // B
      buf[dstIdx + 1] = rgba[srcIdx + 1]; // G
      buf[dstIdx + 2] = rgba[srcIdx]; // R
    }
  }
  return buf;
}

/**
 * Renders branded NSIS installer banner (150x57 header or 164x314 sidebar) with the Kekenik Pixel icon & accent stripes.
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
function renderNsisBannerRgba(width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // Dark pixel-studio plum gradient + subtle grid + accent stripe
      const isGrid = x % 16 === 0 || y % 16 === 0;
      const isAccentBottom = y >= height - 4;
      if (isAccentBottom) {
        out[idx] = 255;
        out[idx + 1] = 71;
        out[idx + 2] = 114;
        out[idx + 3] = 255;
      } else {
        out[idx] = isGrid ? 48 : 36;
        out[idx + 1] = isGrid ? 39 : 29;
        out[idx + 2] = isGrid ? 62 : 46;
        out[idx + 3] = 255;
      }
    }
  }

  // Stamp scaled app icon onto the banner
  const iconSize = width >= 160 ? 96 : 48;
  const iconPixels = scalePixelGrid(APP_ICON_GRID_16, APP_ICON_PALETTE, iconSize);
  const offsetX = width >= 160 ? Math.floor((width - iconSize) / 2) : width - iconSize - 8;
  const offsetY = width >= 160 ? 32 : Math.floor((height - iconSize) / 2);

  for (let iy = 0; iy < iconSize; iy++) {
    for (let ix = 0; ix < iconSize; ix++) {
      const sIdx = (iy * iconSize + ix) * 4;
      if (iconPixels[sIdx + 3] === 0) continue;
      const dx = offsetX + ix;
      const dy = offsetY + iy;
      if (dx >= 0 && dx < width && dy >= 0 && dy < height) {
        const dIdx = (dy * width + dx) * 4;
        out[dIdx] = iconPixels[sIdx];
        out[dIdx + 1] = iconPixels[sIdx + 1];
        out[dIdx + 2] = iconPixels[sIdx + 2];
        out[dIdx + 3] = 255;
      }
    }
  }
  return out;
}

/**
 * Generates all B16 and B17 icon files into `assets/icon/` (and mirrors installer assets into `build/`).
 * @param {string} [rootDir]
 */
export function generateAllIcons(rootDir = ROOT_DIR) {
  const version = readPackageVersion(rootDir);
  const iconDir = path.join(rootDir, "assets", "icon");
  const pngDir = path.join(iconDir, "png");
  const buildDir = path.join(rootDir, "installer-assets");

  fs.mkdirSync(pngDir, { recursive: true });
  fs.mkdirSync(buildDir, { recursive: true });

  const writtenFiles = [];
  const writeAndTrack = (relPath, bufOrStr) => {
    const abs = path.join(rootDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const buf = typeof bufOrStr === "string" ? Buffer.from(bufOrStr, "utf8") : bufOrStr;
    fs.writeFileSync(abs, buf);
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    writtenFiles.push({ path: relPath.replace(/\\/g, "/"), bytes: buf.length, sha256 });
  };

  // 1. Vector + pixel SVG master (`assets/icon/app.svg`)
  const appSvg = renderGridToSvg(
    APP_ICON_GRID_16,
    APP_ICON_PALETTE,
    version,
    "Kekenik Pixel Application Icon"
  );
  writeAndTrack("assets/icon/app.svg", appSvg);

  // 2. App PNG set (16, 24, 32, 48, 64, 128, 256, 512, 1024)
  const appSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  /** @type {Record<number, Buffer>} */
  const appPngBySize = {};
  for (const sz of appSizes) {
    const rgba = scalePixelGrid(APP_ICON_GRID_16, APP_ICON_PALETTE, sz);
    const png = encodeRgbaToPngBuffer(sz, sz, rgba, version);
    appPngBySize[sz] = png;
    writeAndTrack(`assets/icon/png/${sz}x${sz}.png`, png);
  }
  writeAndTrack("assets/icon/icon.png", appPngBySize[512]);

  // 3. Tray and Taskbar variants
  writeAndTrack("assets/icon/tray-16.png", appPngBySize[16]);
  writeAndTrack("assets/icon/tray-24.png", appPngBySize[24]);
  writeAndTrack("assets/icon/tray-32.png", appPngBySize[32]);
  writeAndTrack("assets/icon/taskbar-32.png", appPngBySize[32]);

  // 4. Multi-size Windows `icon.ico` (16/24/32/48/64/128/256)
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const appIco = encodeMultiSizeIco(icoSizes.map((sz) => ({ size: sz, png: appPngBySize[sz] })));
  writeAndTrack("assets/icon/icon.ico", appIco);

  // 5. macOS `icon.icns`
  const appIcns = encodeIcnsContainer(appPngBySize);
  writeAndTrack("assets/icon/icon.icns", appIcns);

  // 6. NSIS Installer Header (150x57) and Sidebar (164x314) BMP images
  const headerBmp = encode24BitBmp(150, 57, renderNsisBannerRgba(150, 57));
  const sidebarBmp = encode24BitBmp(164, 314, renderNsisBannerRgba(164, 314));
  writeAndTrack("assets/icon/installer-header.bmp", headerBmp);
  writeAndTrack("assets/icon/installer-sidebar.bmp", sidebarBmp);
  writeAndTrack("installer-assets/installerHeader.bmp", headerBmp);
  writeAndTrack("installer-assets/installerSidebar.bmp", sidebarBmp);

  // 7. B17: Dedicated `.kpx` Project Document Icons (SVG masters + 16/32 optimized PNGs + multi-size file-kpx.ico)
  const kpxSvg16 = renderGridToSvg(
    KPX_DOC_GRID_16,
    APP_ICON_PALETTE,
    version,
    "Kekenik Pixel Project (.kpx) 16px Document Icon"
  );
  writeAndTrack("assets/icon/file-kpx-16.svg", kpxSvg16);
  writeAndTrack("assets/icon/file-kpx.svg", kpxSvg16);
  writeAndTrack(
    "assets/icon/file-kpx-32.svg",
    kpxSvg16.replace('width="256" height="256"', 'width="32" height="32"')
  );

  /** @type {Record<number, Buffer>} */
  const kpxPngBySize = {};
  for (const sz of icoSizes) {
    const rgba = renderKpxDocPixels(sz);
    const png = encodeRgbaToPngBuffer(sz, sz, rgba, version);
    kpxPngBySize[sz] = png;
    writeAndTrack(`assets/icon/file-kpx-${sz}.png`, png);
  }
  const kpxIco = encodeMultiSizeIco(icoSizes.map((sz) => ({ size: sz, png: kpxPngBySize[sz] })));
  writeAndTrack("assets/icon/file-kpx.ico", kpxIco);

  // electron-builder resolves the file association's .ico path to the same basename with
  // .icns on macOS. Supply a real ICNS with Retina sizes, not a copy of the app icon.
  for (const sz of [512, 1024]) {
    kpxPngBySize[sz] = encodeRgbaToPngBuffer(sz, sz, renderKpxDocPixels(sz), version);
  }
  writeAndTrack("assets/icon/file-kpx.icns", encodeIcnsContainer(kpxPngBySize));

  // 8. Version-pinned manifest
  const manifest = {
    productName: "Kekenik Pixel",
    appId: "com.kekenik.pixel",
    version,
    generatedAt: "deterministic",
    files: writtenFiles,
  };
  writeAndTrack("assets/icon/icon-manifest.json", JSON.stringify(manifest, null, 2) + "\n");

  return manifest;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const manifest = generateAllIcons();
  console.info(
    `[generate-icons] Generated ${manifest.files.length} icon assets for Kekenik Pixel v${manifest.version}.`
  );
}
