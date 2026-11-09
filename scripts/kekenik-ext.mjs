#!/usr/bin/env node
/**
 * `kekenik-ext` CLI — validates an extension folder's `package.json` manifest
 * and packs all files in the directory into a standard `.kpext` PKZIP archive.
 *
 * Usage:
 *   node scripts/kekenik-ext.mjs pack samples/extensions/theme-cyberpunk
 *   node scripts/kekenik-ext.mjs pack-all
 */

import fs from "node:fs";
import path from "node:path";

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function packFilesToZip(files) {
  const entries = Object.entries(files).map(([name, content]) => {
    const cleanName = name.replace(/^\/+/, "");
    const nameBytes = Buffer.from(cleanName, "utf8");
    const dataBytes = Buffer.from(content, "utf8");
    const crc = crc32(dataBytes);
    return { nameBytes, dataBytes, crc };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const e of entries) {
    localSize += 30 + e.nameBytes.length + e.dataBytes.length;
    centralSize += 46 + e.nameBytes.length;
  }
  const out = Buffer.alloc(localSize + centralSize + 22);
  let offset = 0;
  const localOffsets = [];

  for (const e of entries) {
    localOffsets.push(offset);
    out.writeUInt32LE(0x04034b50, offset);
    out.writeUInt16LE(20, offset + 4);
    out.writeUInt16LE(0, offset + 6);
    out.writeUInt16LE(0, offset + 8);
    out.writeUInt16LE(0, offset + 10);
    out.writeUInt16LE(0, offset + 12);
    out.writeUInt32LE(e.crc, offset + 14);
    out.writeUInt32LE(e.dataBytes.length, offset + 18);
    out.writeUInt32LE(e.dataBytes.length, offset + 22);
    out.writeUInt16LE(e.nameBytes.length, offset + 26);
    out.writeUInt16LE(0, offset + 28);
    e.nameBytes.copy(out, offset + 30);
    e.dataBytes.copy(out, offset + 30 + e.nameBytes.length);
    offset += 30 + e.nameBytes.length + e.dataBytes.length;
  }

  const centralStart = offset;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    out.writeUInt32LE(0x02014b50, offset);
    out.writeUInt16LE(20, offset + 4);
    out.writeUInt16LE(20, offset + 6);
    out.writeUInt16LE(0, offset + 8);
    out.writeUInt16LE(0, offset + 10);
    out.writeUInt16LE(0, offset + 12);
    out.writeUInt16LE(0, offset + 14);
    out.writeUInt32LE(e.crc, offset + 16);
    out.writeUInt32LE(e.dataBytes.length, offset + 20);
    out.writeUInt32LE(e.dataBytes.length, offset + 24);
    out.writeUInt16LE(e.nameBytes.length, offset + 28);
    out.writeUInt16LE(0, offset + 30);
    out.writeUInt16LE(0, offset + 32);
    out.writeUInt16LE(0, offset + 34);
    out.writeUInt16LE(0, offset + 36);
    out.writeUInt32LE(0, offset + 38);
    out.writeUInt32LE(localOffsets[i], offset + 42);
    e.nameBytes.copy(out, offset + 46);
    offset += 46 + e.nameBytes.length;
  }

  out.writeUInt32LE(0x06054b50, offset);
  out.writeUInt16LE(0, offset + 4);
  out.writeUInt16LE(0, offset + 6);
  out.writeUInt16LE(entries.length, offset + 8);
  out.writeUInt16LE(entries.length, offset + 10);
  out.writeUInt32LE(centralSize, offset + 12);
  out.writeUInt32LE(centralStart, offset + 16);
  out.writeUInt16LE(0, offset + 20);
  return out;
}

function validateManifest(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") return ["Manifest must be a JSON object"];
  if (typeof raw.id !== "string" || !/^[a-z0-9._-]+$/i.test(raw.id)) {
    errors.push("Invalid id");
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    errors.push("Missing name");
  }
  if (typeof raw.version !== "string" || !/^\d+\.\d+\.\d+/.test(raw.version)) {
    errors.push("Invalid semver version");
  }
  if (!raw.engines || typeof raw.engines.kekenikPixel !== "string") {
    errors.push("Missing engines.kekenikPixel");
  }
  if (!raw.contributes || typeof raw.contributes !== "object") {
    errors.push("Missing contributes object");
  }
  return errors;
}

function packFolder(folderPath) {
  const abs = path.resolve(folderPath);
  const pkgPath = path.join(abs, "package.json");
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Missing package.json in ${abs}`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const errs = validateManifest(pkg);
  if (errs.length > 0) {
    throw new Error(`Manifest validation failed for ${abs}: ${errs.join(", ")}`);
  }

  const files = {};
  for (const entry of fs.readdirSync(abs)) {
    const full = path.join(abs, entry);
    if (fs.statSync(full).isFile() && !entry.endsWith(".kpext")) {
      files[entry] = fs.readFileSync(full, "utf8");
    }
  }
  const zipBuf = packFilesToZip(files);
  const outPath = path.join(path.dirname(abs), `${path.basename(abs)}.kpext`);
  fs.writeFileSync(outPath, zipBuf);
  console.log(`[kekenik-ext] Packed & validated ${pkg.id}@${pkg.version} -> ${outPath} (${zipBuf.length} bytes)`);
}

const cmd = process.argv[2] || "pack-all";
const target = process.argv[3];

if (cmd === "pack" && target) {
  packFolder(target);
} else {
  const samplesRoot = path.resolve("samples/extensions");
  for (const dir of fs.readdirSync(samplesRoot)) {
    const full = path.join(samplesRoot, dir);
    if (fs.statSync(full).isDirectory()) {
      packFolder(full);
    }
  }
}
