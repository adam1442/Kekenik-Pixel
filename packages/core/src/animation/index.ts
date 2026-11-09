/**
 * @module @kekenik/core/animation
 * Pure TypeScript animation playback engine (per-frame durations, forward/reverse/ping-pong directions,
 * subtags, speed multiplier, constant frame rate, frame-drop compensation, fake-clock stepping)
 * and Onion Skin ghost frame resolver & compositor.
 * Zero DOM, React, or Electron imports.
 */

import {
  BlendMode,
  getPaletteForFrame,
  PixelImage,
  ReadonlySprite,
  Tag,
  TagDirection,
  TilemapLayer,
} from "../model/index.ts";
import {
  blitRegionRGBA,
  compositeFrameAdvanced,
  ExtraCelOverlay,
  renderTilemapCel,
} from "../render/index.ts";
import { clamp, RGBA } from "../util/index.ts";

export interface PlaybackRange {
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly direction: TagDirection;
  readonly repeat: number; // 0 = infinite, >= 1 = finite repeats
  readonly tagId?: string;
}

export interface PlaybackConfig {
  readonly playSubtags: boolean;
  readonly activeTagId?: string | null;
  readonly customRange?: { fromFrame: number; toFrame: number } | null;
  readonly directionOverride?: TagDirection | null;
  readonly speedMultiplier: number; // e.g. 0.25, 0.5, 1, 2, 4
  readonly constantFrameRate: boolean;
  readonly constantFrameDurationMs: number; // e.g. 100ms
  readonly playOnce: boolean;
  readonly dropFramesSkip: boolean;
}

export const DEFAULT_PLAYBACK_CONFIG: PlaybackConfig = {
  playSubtags: true,
  activeTagId: null,
  customRange: null,
  directionOverride: null,
  speedMultiplier: 1,
  constantFrameRate: false,
  constantFrameDurationMs: 100,
  playOnce: false,
  dropFramesSkip: true,
};

export interface PlaybackClockState {
  frameIndex: number;
  sequenceCursor: number;
  elapsedInFrameMs: number;
  completedCycles: number;
  stopped: boolean;
}

/**
 * Builds the ordered frame index sequence for one full cycle of `(fromFrame..toFrame)`
 * according to `direction` (`forward`, `reverse`, `pingpong`, `pingpong-reverse`).
 */
export function buildPlaybackSequence(
  fromFrame: number,
  toFrame: number,
  direction: TagDirection
): number[] {
  const start = Math.min(fromFrame, toFrame);
  const end = Math.max(fromFrame, toFrame);
  const count = end - start + 1;
  if (count <= 1) return [start];

  const forwardList: number[] = [];
  for (let f = start; f <= end; f++) {
    forwardList.push(f);
  }

  switch (direction) {
    case "forward":
      return forwardList;
    case "reverse":
      return [...forwardList].reverse();
    case "pingpong": {
      if (count === 2) return [start, end];
      const back: number[] = [];
      for (let f = end - 1; f > start; f--) {
        back.push(f);
      }
      return [...forwardList, ...back];
    }
    case "pingpong-reverse": {
      const rev = [...forwardList].reverse();
      if (count === 2) return rev;
      const up: number[] = [];
      for (let f = start + 1; f < end; f++) {
        up.push(f);
      }
      return [...rev, ...up];
    }
  }
}

/**
 * Finds the innermost (narrowest) or matching Tag containing `frameIndex`.
 */
export function findActiveTagForFrame(
  tags: readonly Tag[],
  frameIndex: number,
  preferredTagId?: string | null
): Tag | null {
  if (preferredTagId) {
    const preferred = tags.find((t) => t.id === preferredTagId);
    if (preferred && frameIndex >= preferred.fromFrame && frameIndex <= preferred.toFrame) {
      return preferred;
    }
  }
  const containing = tags.filter(
    (t) => frameIndex >= t.fromFrame && frameIndex <= t.toFrame
  );
  if (containing.length === 0) return null;
  // Prefer the narrowest (most specific subtag)
  containing.sort((a, b) => a.toFrame - a.fromFrame - (b.toFrame - b.fromFrame));
  return containing[0];
}

/**
 * Resolves the effective playback range (`fromFrame`, `toFrame`, `direction`, `repeat`) for a Sprite.
 */
export function resolvePlaybackRange(
  sprite: ReadonlySprite,
  currentFrame: number,
  config: Partial<PlaybackConfig> = {}
): PlaybackRange {
  const maxFrame = Math.max(0, sprite.frames.length - 1);
  const cfg = { ...DEFAULT_PLAYBACK_CONFIG, ...config };

  if (cfg.customRange) {
    const f0 = clamp(Math.min(cfg.customRange.fromFrame, cfg.customRange.toFrame), 0, maxFrame);
    const f1 = clamp(Math.max(cfg.customRange.fromFrame, cfg.customRange.toFrame), 0, maxFrame);
    return {
      fromFrame: f0,
      toFrame: f1,
      direction: cfg.directionOverride ?? "forward",
      repeat: cfg.playOnce ? 1 : 0,
    };
  }

  if (cfg.playSubtags && sprite.tags.length > 0) {
    const tag = findActiveTagForFrame(sprite.tags, currentFrame, cfg.activeTagId);
    if (tag) {
      return {
        fromFrame: clamp(tag.fromFrame, 0, maxFrame),
        toFrame: clamp(tag.toFrame, 0, maxFrame),
        direction: cfg.directionOverride ?? tag.direction,
        repeat: cfg.playOnce ? 1 : tag.repeat,
        tagId: tag.id,
      };
    }
  }

  return {
    fromFrame: 0,
    toFrame: maxFrame,
    direction: cfg.directionOverride ?? "forward",
    repeat: cfg.playOnce ? 1 : 0,
  };
}

/**
 * Returns the effective duration in milliseconds for `frameIndex` given `PlaybackConfig`.
 */
export function getEffectiveFrameDurationMs(
  sprite: ReadonlySprite,
  frameIndex: number,
  config: Partial<PlaybackConfig> = {}
): number {
  const cfg = { ...DEFAULT_PLAYBACK_CONFIG, ...config };
  const baseMs = cfg.constantFrameRate
    ? Math.max(10, cfg.constantFrameDurationMs)
    : Math.max(10, sprite.frames[frameIndex]?.durationMs ?? 100);
  const speed = clamp(cfg.speedMultiplier || 1, 0.1, 16);
  return Math.max(5, baseMs / speed);
}

/**
 * Creates an initial `PlaybackClockState` for deterministic playback stepping.
 */
export function createPlaybackClockState(
  sprite: ReadonlySprite,
  startFrameIndex: number,
  config: Partial<PlaybackConfig> = {}
): PlaybackClockState {
  const range = resolvePlaybackRange(sprite, startFrameIndex, config);
  const seq = buildPlaybackSequence(range.fromFrame, range.toFrame, range.direction);
  const idxInSeq = Math.max(0, seq.indexOf(startFrameIndex));
  return {
    frameIndex: seq[idxInSeq] ?? startFrameIndex,
    sequenceCursor: idxInSeq,
    elapsedInFrameMs: 0,
    completedCycles: 0,
    stopped: false,
  };
}

/**
 * Advances a `PlaybackClockState` by `deltaMs` (supports fake clock unit testing and
 * frame-drop compensation when `deltaMs` exceeds one or more frame durations).
 */
export function advancePlaybackClock(
  sprite: ReadonlySprite,
  state: PlaybackClockState,
  deltaMs: number,
  config: Partial<PlaybackConfig> = {}
): PlaybackClockState {
  if (state.stopped || sprite.frames.length <= 1 || deltaMs <= 0) {
    return { ...state };
  }
  const cfg = { ...DEFAULT_PLAYBACK_CONFIG, ...config };
  const range = resolvePlaybackRange(sprite, state.frameIndex, cfg);
  const seq = buildPlaybackSequence(range.fromFrame, range.toFrame, range.direction);
  if (seq.length === 0) return { ...state };

  let cursor = state.sequenceCursor;
  if (cursor < 0 || cursor >= seq.length || seq[cursor] !== state.frameIndex) {
    const found = seq.indexOf(state.frameIndex);
    cursor = found >= 0 ? found : 0;
  }

  let elapsed = state.elapsedInFrameMs + deltaMs;
  let completedCycles = state.completedCycles;
  let stopped = false;
  let safetySteps = 0;

  while (safetySteps < 256) {
    safetySteps += 1;
    const currentFrameIdx = seq[cursor];
    const frameDur = getEffectiveFrameDurationMs(sprite, currentFrameIdx, cfg);
    if (elapsed < frameDur) break;

    elapsed -= frameDur;
    const nextCursor = cursor + 1;
    if (nextCursor >= seq.length) {
      completedCycles += 1;
      if (range.repeat > 0 && completedCycles >= range.repeat) {
        cursor = seq.length - 1;
        elapsed = 0;
        stopped = true;
        break;
      }
      cursor = 0;
    } else {
      cursor = nextCursor;
    }

    // If dropFramesSkip is disabled, advance at most 1 frame per tick
    if (!cfg.dropFramesSkip) {
      elapsed = 0;
      break;
    }
  }

  return {
    frameIndex: seq[cursor],
    sequenceCursor: cursor,
    elapsedInFrameMs: elapsed,
    completedCycles,
    stopped,
  };
}

/**
 * Finds the start frame of the next (`dir = 1`) or previous (`dir = -1`) Tag in the timeline.
 */
export function findAdjacentTagFrame(
  sprite: ReadonlySprite,
  currentFrame: number,
  dir: -1 | 1
): number {
  if (sprite.tags.length === 0) {
    return clamp(currentFrame + dir, 0, Math.max(0, sprite.frames.length - 1));
  }
  const sorted = [...sprite.tags].sort((a, b) => a.fromFrame - b.fromFrame);
  if (dir > 0) {
    const next = sorted.find((t) => t.fromFrame > currentFrame);
    return next ? next.fromFrame : sorted[0].fromFrame;
  }
  const prevCandidates = sorted.filter((t) => t.fromFrame < currentFrame);
  return prevCandidates.length > 0
    ? prevCandidates[prevCandidates.length - 1].fromFrame
    : sorted[sorted.length - 1].fromFrame;
}

/**
 * Assigns vertical row indices (`0..K`) to tags so overlapping or nested tags cascade cleanly
 * without colliding in the Timeline header (`tags.nested_cascading`).
 */
export function computeCascadingTagRows(
  tags: readonly Tag[]
): Array<{ tag: Tag; row: number }> {
  const sorted = [...tags].sort((a, b) => {
    if (a.fromFrame !== b.fromFrame) return a.fromFrame - b.fromFrame;
    return b.toFrame - a.toFrame;
  });
  const rowEndFrames: number[] = [];
  const result: Array<{ tag: Tag; row: number }> = [];

  for (const tag of sorted) {
    let assignedRow = -1;
    for (let r = 0; r < rowEndFrames.length; r++) {
      if (tag.fromFrame > rowEndFrames[r]) {
        assignedRow = r;
        rowEndFrames[r] = tag.toFrame;
        break;
      }
    }
    if (assignedRow === -1) {
      assignedRow = rowEndFrames.length;
      rowEndFrames.push(tag.toFrame);
    }
    result.push({ tag, row: assignedRow });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Onion Skin Engine & Compositor
// ---------------------------------------------------------------------------

export interface OnionSkinSettings {
  readonly enabled: boolean;
  readonly framesBefore: number; // 0..8
  readonly framesAfter: number; // 0..8
  readonly initialOpacity: number; // 1..255 (default 128)
  readonly opacityStep: number; // 0..128 (default 28)
  readonly mode: "tint" | "merge";
  readonly blendMode: BlendMode;
  readonly prevTint: RGBA; // default Red tint
  readonly nextTint: RGBA; // default Blue tint
  readonly loopTag: boolean;
  readonly currentLayerOnly: boolean;
  readonly position: "behind" | "in_front";
}

export const DEFAULT_ONION_SKIN_SETTINGS: OnionSkinSettings = {
  enabled: false,
  framesBefore: 2,
  framesAfter: 2,
  initialOpacity: 128,
  opacityStep: 28,
  mode: "tint",
  blendMode: "normal",
  prevTint: { r: 239, g: 68, b: 68, a: 255 },
  nextTint: { r: 59, g: 130, b: 246, a: 255 },
  loopTag: true,
  currentLayerOnly: false,
  position: "behind",
};

export interface OnionSkinGhostDescriptor {
  readonly frameIndex: number;
  readonly side: "prev" | "next";
  readonly distance: number;
  readonly opacity: number;
}

/**
 * Resolves the list of previous and next ghost frame descriptors for Onion Skin rendering,
 * respecting `loopTag`, `framesBefore`, `framesAfter`, `initialOpacity`, and `opacityStep`.
 */
export function resolveOnionSkinGhostFrames(
  sprite: ReadonlySprite,
  activeFrameIndex: number,
  settings: OnionSkinSettings
): OnionSkinGhostDescriptor[] {
  const totalFrames = sprite.frames.length;
  if (!settings.enabled || totalFrames <= 1) return [];

  let minFrame = 0;
  let maxFrame = totalFrames - 1;
  let canWrap = false;

  if (settings.loopTag) {
    const tag = findActiveTagForFrame(sprite.tags, activeFrameIndex);
    if (tag) {
      minFrame = clamp(tag.fromFrame, 0, totalFrames - 1);
      maxFrame = clamp(tag.toFrame, 0, totalFrames - 1);
      canWrap = maxFrame > minFrame;
    }
  }

  const spanLen = maxFrame - minFrame + 1;
  const descriptors: OnionSkinGhostDescriptor[] = [];

  const stepIndex = (offset: number): number | null => {
    const raw = activeFrameIndex + offset;
    if (raw >= minFrame && raw <= maxFrame) return raw;
    if (!canWrap || spanLen <= 1) return null;
    const wrapped = ((((raw - minFrame) % spanLen) + spanLen) % spanLen) + minFrame;
    return wrapped === activeFrameIndex ? null : wrapped;
  };

  for (let d = settings.framesBefore; d >= 1; d--) {
    const fIdx = stepIndex(-d);
    if (fIdx === null || fIdx === activeFrameIndex) continue;
    const opacity = clamp(
      settings.initialOpacity - (d - 1) * settings.opacityStep,
      12,
      255
    );
    descriptors.push({ frameIndex: fIdx, side: "prev", distance: d, opacity });
  }

  for (let d = settings.framesAfter; d >= 1; d--) {
    const fIdx = stepIndex(d);
    if (fIdx === null || fIdx === activeFrameIndex) continue;
    const opacity = clamp(
      settings.initialOpacity - (d - 1) * settings.opacityStep,
      12,
      255
    );
    descriptors.push({ frameIndex: fIdx, side: "next", distance: d, opacity });
  }

  return descriptors;
}

/**
 * Composites a single frame for onion skinning (either all visible layers or `currentLayerOnly`).
 */
function compositeSourceForOnion(
  sprite: ReadonlySprite,
  frameIndex: number,
  activeLayerId: string,
  currentLayerOnly: boolean
): PixelImage {
  if (!currentLayerOnly) {
    return compositeFrameAdvanced(sprite, frameIndex);
  }
  const out = new PixelImage(sprite.width, sprite.height, "rgba");
  const layer = sprite.layers.find((l) => l.id === activeLayerId);
  if (!layer || layer.kind === "group") {
    return compositeFrameAdvanced(sprite, frameIndex);
  }
  const cel = sprite.cels.find(
    (c) => c.layerId === activeLayerId && c.frameIndex === frameIndex
  );
  if (!cel) return out;
  const palette = getPaletteForFrame(sprite, frameIndex);
  const srcImg =
    layer.kind === "tilemap" && cel.tilemapData
      ? renderTilemapCel(
          cel,
          layer as TilemapLayer,
          sprite.tilesets,
          sprite.width,
          sprite.height,
          palette,
          sprite.transparentIndex
        )
      : cel.image;
  blitRegionRGBA(
    out,
    srcImg,
    cel.x,
    cel.y,
    "normal",
    cel.opacity,
    palette,
    sprite.transparentIndex,
    { x: 0, y: 0, width: sprite.width, height: sprite.height }
  );
  return out;
}

/**
 * Applies red/blue tinting to an RGBA ghost frame image when `settings.mode === "tint"`.
 */
export function applyOnionTint(source: PixelImage, tint: RGBA): PixelImage {
  const out = source.clone();
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 0) continue;
    // Preserve pixel luminance detail while tinting strongly toward `tint`
    const luma = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    d[i] = ((luma * 96 + tint.r * 160) >> 8) & 0xff;
    d[i + 1] = ((luma * 96 + tint.g * 160) >> 8) & 0xff;
    d[i + 2] = ((luma * 96 + tint.b * 160) >> 8) & 0xff;
  }
  return out;
}

/**
 * Renders the combined Onion Skin ghost overlay image for `activeFrameIndex`.
 */
export function renderOnionSkinOverlay(
  sprite: ReadonlySprite,
  activeFrameIndex: number,
  activeLayerId: string,
  settings: OnionSkinSettings
): PixelImage {
  const out = new PixelImage(sprite.width, sprite.height, "rgba");
  const ghosts = resolveOnionSkinGhostFrames(sprite, activeFrameIndex, settings);
  if (ghosts.length === 0) return out;

  const palette = getPaletteForFrame(sprite, activeFrameIndex);
  const fullClip = { x: 0, y: 0, width: sprite.width, height: sprite.height };

  for (const ghost of ghosts) {
    const rawGhost = compositeSourceForOnion(
      sprite,
      ghost.frameIndex,
      activeLayerId,
      settings.currentLayerOnly
    );
    const tinted =
      settings.mode === "tint"
        ? applyOnionTint(
            rawGhost,
            ghost.side === "prev" ? settings.prevTint : settings.nextTint
          )
        : rawGhost;

    blitRegionRGBA(
      out,
      tinted,
      0,
      0,
      settings.blendMode,
      ghost.opacity,
      palette,
      sprite.transparentIndex,
      fullClip
    );
  }

  return out;
}

/**
 * Composites the active frame together with the Onion Skin ghost overlay (either `"behind"` or `"in_front"`).
 */
export function compositeFrameWithOnionSkin(
  sprite: ReadonlySprite,
  activeFrameIndex: number,
  activeLayerId: string,
  settings: OnionSkinSettings,
  extraCel?: ExtraCelOverlay | null
): PixelImage {
  const mainFrame = compositeFrameAdvanced(sprite, activeFrameIndex, { extraCel });
  if (!settings.enabled || sprite.frames.length <= 1) {
    return mainFrame;
  }

  const onionOverlay = renderOnionSkinOverlay(
    sprite,
    activeFrameIndex,
    activeLayerId,
    settings
  );
  const palette = getPaletteForFrame(sprite, activeFrameIndex);
  const fullClip = { x: 0, y: 0, width: sprite.width, height: sprite.height };

  if (settings.position === "behind") {
    const combined = onionOverlay;
    blitRegionRGBA(
      combined,
      mainFrame,
      0,
      0,
      "normal",
      255,
      palette,
      sprite.transparentIndex,
      fullClip
    );
    return combined;
  }

  // "in_front"
  blitRegionRGBA(
    mainFrame,
    onionOverlay,
    0,
    0,
    settings.blendMode,
    255,
    palette,
    sprite.transparentIndex,
    fullClip
  );
  return mainFrame;
}
