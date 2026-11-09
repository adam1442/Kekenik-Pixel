/**
 * @module @kekenik/ui/featurecenter/agent3-dialogs
 * All 9 interactive Agent-3 Dialogs:
 * 1. LayerPropertiesDialog (`dialog.layer_properties`)
 * 2. FramePropertiesDialog (`dialog.frame_properties`)
 * 3. CelPropertiesDialog (`dialog.cel_properties`)
 * 4. TagPropertiesDialog (`dialog.tag_properties`)
 * 5. SlicePropertiesDialog (`dialog.slice_properties`)
 * 6. TilesetPropertiesDialog (`dialog.tileset_properties`)
 * 7. ConstantFrameRateDialog (`dialog.constant_frame_rate`)
 * 8. NewTilemapLayerDialog (`dialog.new_tilemap_layer`)
 * 9. OnionSkinSettingsDialog (`dialog.onion_skin`)
 */

import React, { useState } from "react";
import {
  AddSliceCommand,
  AddTagCommand,
  ALL_BLEND_MODES,
  BlendMode,
  createModelId,
  createPurgeUnusedTilesCommand,
  getCel,
  getSliceKeyForFrame,
  hexToRgba,
  RemoveSliceCommand,
  RemoveTagCommand,
  rgbaToHex,
  SetCelPropsCommand,
  SetFrameRangeDurationCommand,
  SetLayerFullPropsCommand,
  t,
  TagDirection,
  TilemapLayer,
  UpdateSliceCommand,
  UpdateTagCommand,
  UpdateTilesetCommand,
  upsertSliceKey,
} from "../../../core/src/index.ts";
import { useAppStore } from "../app/store.ts";
import {
  ColorInputField,
  NumberField,
  PixelButton,
  PixelCheckbox,
  PixelDialog,
  PixelSelect,
  PixelSlider,
  SectionDivider,
  TextField,
} from "../widgets/index.tsx";

/**
 * 1. Layer Properties Dialog (`Layer > Layer Properties...`, `Shift+P`)
 */
export const LayerPropertiesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const layer = doc?.sprite.layers.find((l) => l.id === activeLayerId);

  const [name, setName] = useState(layer?.name ?? "Layer 1");
  const [blendMode, setBlendMode] = useState<BlendMode>(layer?.blendMode ?? "normal");
  const [opacity, setOpacity] = useState(layer?.opacity ?? 255);
  const [visible, setVisible] = useState(layer?.visible ?? true);
  const [editable, setEditable] = useState(layer?.editable ?? true);
  const [preferLinked, setPreferLinked] = useState(layer?.preferLinkedCels ?? false);
  const [reference, setReference] = useState(layer?.reference ?? false);
  const [userColor, setUserColor] = useState(layer?.userData.color ?? "#3b82f6");
  const [useColorSwatch, setUseColorSwatch] = useState(Boolean(layer?.userData.color));
  const [notes, setNotes] = useState(layer?.userData.text ?? "");

  if (!doc || !layer) return null;

  const handleApply = () => {
    doc.execute(
      new SetLayerFullPropsCommand(layer.id, {
        name: name.trim() || layer.name,
        blendMode,
        opacity,
        visible,
        editable,
        preferLinkedCels: preferLinked,
        reference,
        userData: {
          text: notes,
          color: useColorSwatch ? userColor : undefined,
        },
      })
    );
    bumpRevision();
    onClose();
  };

  return (
    <PixelDialog title="Layer Properties" onClose={onClose} widthClass="w-[380px]">
      <div className="space-y-2.5 text-xs font-mono">
        <div className="flex items-center justify-between gap-2">
          <span>Name:</span>
          <TextField value={name} onChange={setName} className="w-52" />
        </div>

        <div className="flex items-center justify-between gap-2">
          <span>Blend Mode:</span>
          <PixelSelect
            ariaLabel="Dialog Layer Blend Mode"
            value={blendMode}
            onChange={(v) => setBlendMode(v as BlendMode)}
            options={ALL_BLEND_MODES.map((m) => ({ value: m, label: m }))}
            className="w-52"
          />
        </div>

        <PixelSlider
          label="Opacity (0..255)"
          value={opacity}
          min={0}
          max={255}
          onChange={setOpacity}
        />

        <SectionDivider label="Layer Flags:" />
        <div className="grid grid-cols-2 gap-1.5">
          <PixelCheckbox checked={visible} onChange={setVisible} label="Visible" />
          <PixelCheckbox checked={editable} onChange={setEditable} label="Editable (Unlocked)" />
          <PixelCheckbox
            checked={preferLinked}
            onChange={setPreferLinked}
            label="Continuous (Linked Cels)"
          />
          <PixelCheckbox
            checked={reference}
            onChange={setReference}
            label="Reference Guide Layer"
          />
        </div>

        <SectionDivider label="Timeline Color & User Data:" />
        <div className="flex items-center justify-between">
          <PixelCheckbox
            checked={useColorSwatch}
            onChange={setUseColorSwatch}
            label="Custom Timeline Row Color"
          />
          <ColorInputField
            ariaLabel="Layer User Color"
            value={userColor}
            onChange={(hex) => {
              setUserColor(hex);
              setUseColorSwatch(true);
            }}
            className="w-10 h-5"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <span>User Notes:</span>
          <TextField value={notes} onChange={setNotes} className="w-52" />
        </div>

        <div className="flex justify-end gap-1.5 pt-2">
          <PixelButton onClick={handleApply}>{t("common.ok")}</PixelButton>
          <PixelButton onClick={onClose}>{t("common.cancel")}</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 2. Frame Properties Dialog (`Frame > Frame Properties...`, `P`)
 */
export const FramePropertiesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const selectedCelRange = useAppStore((s) => s.selectedCelRange);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const frame = doc?.sprite.frames[activeFrameIndex];
  const [durationMs, setDurationMs] = useState(frame?.durationMs ?? 100);
  const [applyToRange, setApplyToRange] = useState(Boolean(selectedCelRange));
  const [applyToAll, setApplyToAll] = useState(false);

  if (!doc || !frame) return null;

  const handleApply = () => {
    let indices: number[] = [activeFrameIndex];
    if (applyToAll) {
      indices = doc.sprite.frames.map((f) => f.index);
    } else if (applyToRange && selectedCelRange) {
      const f0 = Math.min(selectedCelRange.fromFrame, selectedCelRange.toFrame);
      const f1 = Math.max(selectedCelRange.fromFrame, selectedCelRange.toFrame);
      indices = [];
      for (let f = f0; f <= f1; f++) indices.push(f);
    }
    doc.execute(new SetFrameRangeDurationCommand(indices, durationMs));
    bumpRevision();
    onClose();
  };

  return (
    <PixelDialog
      title={`Frame Properties (Frame #${activeFrameIndex + 1})`}
      onClose={onClose}
      widthClass="w-[340px]"
    >
      <div className="space-y-3 text-xs font-mono">
        <div className="flex items-center justify-between">
          <span>Frame Number:</span>
          <span className="font-bold">
            #{activeFrameIndex + 1} of {doc.sprite.frames.length}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span>Duration (msecs):</span>
          <NumberField
            ariaLabel="Frame Duration Milliseconds"
            value={durationMs}
            min={10}
            max={65535}
            suffix="ms"
            widthClass="w-24"
            onChange={setDurationMs}
          />
        </div>

        <div className="text-[11px] opacity-80">
          Equivalent FPS: {(1000 / Math.max(10, durationMs)).toFixed(1)} frames/sec
        </div>

        {selectedCelRange && (
          <PixelCheckbox
            checked={applyToRange}
            onChange={setApplyToRange}
            label={`Apply to selected frame range (${
              Math.min(selectedCelRange.fromFrame, selectedCelRange.toFrame) + 1
            }..${Math.max(selectedCelRange.fromFrame, selectedCelRange.toFrame) + 1})`}
          />
        )}

        <PixelCheckbox
          checked={applyToAll}
          onChange={setApplyToAll}
          label={`Apply to all ${doc.sprite.frames.length} frames`}
        />

        <div className="flex justify-end gap-1.5 pt-1">
          <PixelButton onClick={handleApply}>{t("common.ok")}</PixelButton>
          <PixelButton onClick={onClose}>{t("common.cancel")}</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 3. Cel Properties Dialog (`Frame > Cel Properties...`)
 */
export const CelPropertiesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const linkSelectedCels = useAppStore((s) => s.linkSelectedCels);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const cel = doc ? getCel(doc.sprite, activeLayerId, activeFrameIndex) : undefined;
  const [opacity, setOpacity] = useState(cel?.opacity ?? 255);
  const [zIndex, setZIndex] = useState(cel?.zIndex ?? 0);
  const [posX, setPosX] = useState(cel?.x ?? 0);
  const [posY, setPosY] = useState(cel?.y ?? 0);
  const [notes, setNotes] = useState(cel?.userData.text ?? "");

  if (!doc || !cel) return null;

  const handleApply = () => {
    doc.execute(
      new SetCelPropsCommand(
        [{ layerId: activeLayerId, frameIndex: activeFrameIndex }],
        {
          opacity,
          zIndex,
          x: posX,
          y: posY,
          userData: { ...cel.userData, text: notes },
        }
      )
    );
    bumpRevision();
    onClose();
  };

  return (
    <PixelDialog
      title={`Cel Properties (Frame #${activeFrameIndex + 1})`}
      onClose={onClose}
      widthClass="w-[350px]"
    >
      <div className="space-y-2.5 text-xs font-mono">
        <PixelSlider
          label="Cel Opacity (0..255)"
          value={opacity}
          min={0}
          max={255}
          onChange={setOpacity}
        />

        <div className="flex items-center justify-between">
          <span>Z-Index Offset (-32..+32):</span>
          <NumberField
            ariaLabel="Dialog Cel Z-Index"
            value={zIndex}
            min={-32}
            max={32}
            widthClass="w-20"
            onChange={setZIndex}
          />
        </div>

        <SectionDivider label="Cel Position Offset:" />
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between">
            <span>X:</span>
            <NumberField
              ariaLabel="Cel X Offset"
              value={posX}
              min={-512}
              max={512}
              widthClass="w-16"
              onChange={setPosX}
            />
          </div>
          <div className="flex items-center justify-between">
            <span>Y:</span>
            <NumberField
              ariaLabel="Cel Y Offset"
              value={posY}
              min={-512}
              max={512}
              widthClass="w-16"
              onChange={setPosY}
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span>Linked Status: {cel.linkId ? "Linked Cel" : "Independent"}</span>
          <div className="flex items-center gap-1">
            <PixelButton size="xs" onClick={() => linkSelectedCels(true)}>
              Link Next
            </PixelButton>
            {cel.linkId && (
              <PixelButton size="xs" onClick={() => linkSelectedCels(false)}>
                Unlink
              </PixelButton>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span>User Data:</span>
          <TextField value={notes} onChange={setNotes} className="w-48" />
        </div>

        <div className="flex justify-end gap-1.5 pt-2">
          <PixelButton onClick={handleApply}>{t("common.ok")}</PixelButton>
          <PixelButton onClick={onClose}>{t("common.cancel")}</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 4. Tag Properties Dialog (`Frame > Tags > Tag Properties...`)
 */
export const TagPropertiesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const selectedCelRange = useAppStore((s) => s.selectedCelRange);
  const activeTagId = useAppStore((s) => s.activeTagId);
  const setActiveTagId = useAppStore((s) => s.setActiveTagId);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const existingTag = doc?.sprite.tags.find((tg) => tg.id === activeTagId);
  const [isNew, setIsNew] = useState(!existingTag);
  const [name, setName] = useState(existingTag?.name ?? "walk");
  const [fromFrame, setFromFrame] = useState(
    existingTag
      ? existingTag.fromFrame + 1
      : selectedCelRange
      ? Math.min(selectedCelRange.fromFrame, selectedCelRange.toFrame) + 1
      : activeFrameIndex + 1
  );
  const [toFrame, setToFrame] = useState(
    existingTag
      ? existingTag.toFrame + 1
      : selectedCelRange
      ? Math.max(selectedCelRange.fromFrame, selectedCelRange.toFrame) + 1
      : Math.min(doc?.sprite.frames.length ?? 1, activeFrameIndex + 2)
  );
  const [direction, setDirection] = useState<TagDirection>(
    existingTag?.direction ?? "forward"
  );
  const [repeat, setRepeat] = useState(existingTag?.repeat ?? 0);
  const [color, setColor] = useState(existingTag?.color ?? "#16a34a");
  const [notes, setNotes] = useState(existingTag?.userData.text ?? "");

  if (!doc) return null;
  const maxFrames = doc.sprite.frames.length;

  const handleSave = () => {
    const f0 = Math.max(0, Math.min(maxFrames - 1, fromFrame - 1));
    const f1 = Math.max(f0, Math.min(maxFrames - 1, toFrame - 1));

    if (isNew || !existingTag) {
      const created = {
        id: createModelId("tag"),
        name: name.trim() || "tag",
        fromFrame: f0,
        toFrame: f1,
        direction,
        color,
        repeat,
        userData: { text: notes },
      };
      doc.execute(new AddTagCommand(created));
      setActiveTagId(created.id);
    } else {
      doc.execute(
        new UpdateTagCommand(existingTag.id, {
          name: name.trim() || existingTag.name,
          fromFrame: f0,
          toFrame: f1,
          direction,
          color,
          repeat,
          userData: { text: notes },
        })
      );
    }
    bumpRevision();
    onClose();
  };

  return (
    <PixelDialog
      title={isNew ? "New Animation Tag" : `Tag Properties (${existingTag?.name})`}
      onClose={onClose}
      widthClass="w-[370px]"
    >
      <div className="space-y-2.5 text-xs font-mono">
        {doc.sprite.tags.length > 0 && (
          <div className="flex items-center justify-between">
            <span>Mode:</span>
            <div className="flex items-center gap-1">
              <PixelButton
                size="xs"
                active={!isNew}
                onClick={() => setIsNew(false)}
              >
                Edit Selected
              </PixelButton>
              <PixelButton
                size="xs"
                active={isNew}
                onClick={() => {
                  setIsNew(true);
                  setName(`tag_${doc.sprite.tags.length + 1}`);
                }}
              >
                + Create New Tag
              </PixelButton>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span>Tag Name:</span>
          <TextField value={name} onChange={setName} className="w-48" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between">
            <span>From:</span>
            <NumberField
              ariaLabel="Tag From Frame"
              value={fromFrame}
              min={1}
              max={maxFrames}
              widthClass="w-16"
              onChange={setFromFrame}
            />
          </div>
          <div className="flex items-center justify-between">
            <span>To:</span>
            <NumberField
              ariaLabel="Tag To Frame"
              value={toFrame}
              min={1}
              max={maxFrames}
              widthClass="w-16"
              onChange={setToFrame}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span>Animation Direction:</span>
          <PixelSelect
            ariaLabel="Tag Animation Direction"
            value={direction}
            onChange={(v) => setDirection(v as TagDirection)}
            options={[
              { value: "forward", label: "Forward" },
              { value: "reverse", label: "Reverse" },
              { value: "pingpong", label: "Ping-pong" },
              { value: "pingpong-reverse", label: "Ping-pong Reverse" },
            ]}
          />
        </div>

        <div className="flex items-center justify-between">
          <span>Repeat (0 = Infinite):</span>
          <NumberField
            ariaLabel="Tag Repeat Count"
            value={repeat}
            min={0}
            max={999}
            widthClass="w-20"
            onChange={setRepeat}
          />
        </div>

        <div className="flex items-center justify-between">
          <span>Banner Color:</span>
          <ColorInputField
            ariaLabel="Tag Banner Color"
            value={color}
            onChange={setColor}
            className="w-12 h-5"
          />
        </div>

        <div className="flex items-center justify-between">
          <span>User Notes:</span>
          <TextField value={notes} onChange={setNotes} className="w-48" />
        </div>

        <div className="flex justify-between pt-2 border-t border-black/20">
          {!isNew && existingTag ? (
            <PixelButton
              onClick={() => {
                doc.execute(new RemoveTagCommand(existingTag.id));
                bumpRevision();
                onClose();
              }}
            >
              Delete Tag
            </PixelButton>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1.5">
            <PixelButton onClick={handleSave}>{t("common.ok")}</PixelButton>
            <PixelButton onClick={onClose}>{t("common.cancel")}</PixelButton>
          </div>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 5. Slice Properties Dialog (`dialog.slice_properties`)
 */
export const SlicePropertiesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const activeSliceId = useAppStore((s) => s.activeSliceId);
  const setActiveSliceId = useAppStore((s) => s.setActiveSliceId);
  const selectSliceBounds = useAppStore((s) => s.selectSliceBounds);
  const exportSliceAsNewDocument = useAppStore((s) => s.exportSliceAsNewDocument);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const slice = doc?.sprite.slices.find((s) => s.id === activeSliceId) ?? doc?.sprite.slices[0];
  const currentKey = slice
    ? getSliceKeyForFrame(slice, activeFrameIndex)
    : { frameIndex: 0, bounds: { x: 4, y: 4, width: 24, height: 24 } };

  const [name, setName] = useState(slice?.name ?? "ui_slice");
  const [color, setColor] = useState(slice?.color ?? "#f59e0b");
  const [bx, setBx] = useState(currentKey.bounds.x);
  const [by, setBy] = useState(currentKey.bounds.y);
  const [bw, setBw] = useState(currentKey.bounds.width);
  const [bh, setBh] = useState(currentKey.bounds.height);

  const [has9Patch, setHas9Patch] = useState(Boolean(currentKey.center));
  const [cx, setCx] = useState(currentKey.center?.x ?? 4);
  const [cy, setCy] = useState(currentKey.center?.y ?? 4);
  const [cw, setCw] = useState(currentKey.center?.width ?? Math.max(4, bw - 8));
  const [ch, setCh] = useState(currentKey.center?.height ?? Math.max(4, bh - 8));

  const [hasPivot, setHasPivot] = useState(Boolean(currentKey.pivot));
  const [px, setPx] = useState(currentKey.pivot?.x ?? Math.floor(bw / 2));
  const [py, setPy] = useState(currentKey.pivot?.y ?? Math.floor(bh / 2));

  if (!doc) return null;

  const handleSave = () => {
    const centerRect = has9Patch
      ? { x: cx, y: cy, width: Math.max(1, cw), height: Math.max(1, ch) }
      : undefined;
    const pivotPt = hasPivot ? { x: px, y: py } : undefined;

    if (!slice) {
      const created = {
        id: createModelId("slice"),
        name: name.trim() || "slice_1",
        color,
        keys: [
          {
            frameIndex: activeFrameIndex,
            bounds: { x: bx, y: by, width: Math.max(1, bw), height: Math.max(1, bh) },
            center: centerRect,
            pivot: pivotPt,
          },
        ],
        userData: { text: "" },
      };
      doc.execute(new AddSliceCommand(created));
      setActiveSliceId(created.id);
    } else {
      const workingCopy = {
        ...slice,
        keys: slice.keys.map((k) => ({ ...k, bounds: { ...k.bounds } })),
      };
      upsertSliceKey(workingCopy, activeFrameIndex, {
        bounds: { x: bx, y: by, width: Math.max(1, bw), height: Math.max(1, bh) },
        center: centerRect,
        pivot: pivotPt,
      });
      doc.execute(
        new UpdateSliceCommand(slice.id, {
          name: name.trim() || slice.name,
          color,
          keys: workingCopy.keys,
        })
      );
    }
    bumpRevision();
    onClose();
  };

  return (
    <PixelDialog
      title={slice ? `Slice Properties (${slice.name} @ Frame #${activeFrameIndex + 1})` : "New Slice"}
      onClose={onClose}
      widthClass="w-[410px]"
    >
      <div className="space-y-2.5 text-xs font-mono">
        <div className="flex items-center justify-between gap-2">
          <span>Slice Name:</span>
          <TextField value={name} onChange={setName} className="w-48" />
          <ColorInputField
            ariaLabel="Slice Color"
            value={color}
            onChange={setColor}
            className="w-8 h-5"
          />
        </div>

        <SectionDivider label={`Bounds at Frame #${activeFrameIndex + 1}:`} />
        <div className="grid grid-cols-4 gap-1.5">
          <div>
            <div className="text-[10px]">X</div>
            <NumberField value={bx} min={0} max={2048} widthClass="w-16" onChange={setBx} />
          </div>
          <div>
            <div className="text-[10px]">Y</div>
            <NumberField value={by} min={0} max={2048} widthClass="w-16" onChange={setBy} />
          </div>
          <div>
            <div className="text-[10px]">Width</div>
            <NumberField value={bw} min={1} max={2048} widthClass="w-16" onChange={setBw} />
          </div>
          <div>
            <div className="text-[10px]">Height</div>
            <NumberField value={bh} min={1} max={2048} widthClass="w-16" onChange={setBh} />
          </div>
        </div>

        <SectionDivider label="9-Slices Center & Pivot:" />
        <PixelCheckbox
          checked={has9Patch}
          onChange={setHas9Patch}
          label="9-Slices Scaling Center (Inner Rect)"
        />
        {has9Patch && (
          <div className="grid grid-cols-4 gap-1.5 pl-3">
            <div>
              <div className="text-[10px]">Center X</div>
              <NumberField value={cx} min={0} max={bw} widthClass="w-16" onChange={setCx} />
            </div>
            <div>
              <div className="text-[10px]">Center Y</div>
              <NumberField value={cy} min={0} max={bh} widthClass="w-16" onChange={setCy} />
            </div>
            <div>
              <div className="text-[10px]">Center W</div>
              <NumberField value={cw} min={1} max={bw} widthClass="w-16" onChange={setCw} />
            </div>
            <div>
              <div className="text-[10px]">Center H</div>
              <NumberField value={ch} min={1} max={bh} widthClass="w-16" onChange={setCh} />
            </div>
          </div>
        )}

        <PixelCheckbox
          checked={hasPivot}
          onChange={setHasPivot}
          label="Pivot Point (Origin Relative to Slice)"
        />
        {hasPivot && (
          <div className="grid grid-cols-2 gap-2 pl-3">
            <div className="flex items-center justify-between">
              <span>Pivot X:</span>
              <NumberField value={px} min={-512} max={512} widthClass="w-16" onChange={setPx} />
            </div>
            <div className="flex items-center justify-between">
              <span>Pivot Y:</span>
              <NumberField value={py} min={-512} max={512} widthClass="w-16" onChange={setPy} />
            </div>
          </div>
        )}

        {slice && (
          <div className="flex items-center justify-between pt-1 border-t border-black/20">
            <PixelButton
              size="xs"
              onClick={() => {
                selectSliceBounds(slice.id);
                onClose();
              }}
            >
              Select Slice Bounds
            </PixelButton>
            <PixelButton
              size="xs"
              onClick={() => {
                exportSliceAsNewDocument(slice.id);
                onClose();
              }}
            >
              Export Slice as Sprite Tab
            </PixelButton>
            <PixelButton
              size="xs"
              onClick={() => {
                doc.execute(new RemoveSliceCommand(slice.id));
                bumpRevision();
                onClose();
              }}
            >
              Delete Slice
            </PixelButton>
          </div>
        )}

        <div className="flex justify-end gap-1.5 pt-1">
          <PixelButton onClick={handleSave}>{t("common.ok")}</PixelButton>
          <PixelButton onClick={onClose}>{t("common.cancel")}</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 6. Tileset Properties Dialog (`dialog.tileset_properties`)
 */
export const TilesetPropertiesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const activeLayer = doc?.sprite.layers.find((l) => l.id === activeLayerId);
  const tileset =
    activeLayer && activeLayer.kind === "tilemap"
      ? doc?.sprite.tilesets.find((ts) => ts.id === (activeLayer as TilemapLayer).tilesetId) ??
        doc?.sprite.tilesets[0]
      : doc?.sprite.tilesets[0];

  const [name, setName] = useState(tileset?.name ?? "Tileset 1");
  const [baseIndex, setBaseIndex] = useState(tileset?.baseIndex ?? 0);
  const [originX, setOriginX] = useState(tileset?.gridOriginX ?? 0);
  const [originY, setOriginY] = useState(tileset?.gridOriginY ?? 0);
  const [columns, setColumns] = useState(tileset?.columns ?? 8);

  if (!doc || !tileset) return null;

  const handleSave = () => {
    doc.execute(
      new UpdateTilesetCommand(tileset.id, "Tileset Properties", (_s, ts) => {
        ts.name = name.trim() || ts.name;
        ts.baseIndex = baseIndex;
        ts.gridOriginX = originX;
        ts.gridOriginY = originY;
        ts.columns = Math.max(1, columns);
      })
    );
    bumpRevision();
    onClose();
  };

  return (
    <PixelDialog title="Tileset Properties" onClose={onClose} widthClass="w-[350px]">
      <div className="space-y-2.5 text-xs font-mono">
        <div className="flex items-center justify-between">
          <span>Tileset Name:</span>
          <TextField value={name} onChange={setName} className="w-44" />
        </div>
        <div className="flex items-center justify-between">
          <span>Tile Size:</span>
          <span className="font-bold">
            {tileset.tileWidth} × {tileset.tileHeight} px ({tileset.tiles.length} tiles)
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between">
            <span>Origin X:</span>
            <NumberField value={originX} min={-256} max={256} widthClass="w-16" onChange={setOriginX} />
          </div>
          <div className="flex items-center justify-between">
            <span>Origin Y:</span>
            <NumberField value={originY} min={-256} max={256} widthClass="w-16" onChange={setOriginY} />
          </div>
          <div className="flex items-center justify-between">
            <span>Base Index:</span>
            <NumberField value={baseIndex} min={0} max={16} widthClass="w-16" onChange={setBaseIndex} />
          </div>
          <div className="flex items-center justify-between">
            <span>Columns:</span>
            <NumberField value={columns} min={1} max={64} widthClass="w-16" onChange={setColumns} />
          </div>
        </div>

        <div className="flex justify-between pt-2 border-t border-black/20">
          <PixelButton
            size="xs"
            onClick={() => {
              doc.execute(createPurgeUnusedTilesCommand(tileset.id));
              bumpRevision();
            }}
          >
            Purge Unused Tiles
          </PixelButton>
          <div className="flex items-center gap-1.5">
            <PixelButton onClick={handleSave}>{t("common.ok")}</PixelButton>
            <PixelButton onClick={onClose}>{t("common.cancel")}</PixelButton>
          </div>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 7. Constant Frame Rate Dialog (`Frame > Constant Frame Rate...`)
 */
export const ConstantFrameRateDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const selectedCelRange = useAppStore((s) => s.selectedCelRange);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const [durationMs, setDurationMs] = useState(100);
  const [scope, setScope] = useState<"all" | "range">(selectedCelRange ? "range" : "all");

  if (!doc) return null;

  const handleApply = () => {
    let indices = doc.sprite.frames.map((f) => f.index);
    if (scope === "range" && selectedCelRange) {
      const f0 = Math.min(selectedCelRange.fromFrame, selectedCelRange.toFrame);
      const f1 = Math.max(selectedCelRange.fromFrame, selectedCelRange.toFrame);
      indices = [];
      for (let f = f0; f <= f1; f++) indices.push(f);
    }
    doc.execute(new SetFrameRangeDurationCommand(indices, durationMs, "Constant Frame Rate"));
    bumpRevision();
    onClose();
  };

  return (
    <PixelDialog title="Constant Frame Rate" onClose={onClose} widthClass="w-[330px]">
      <div className="space-y-2.5 text-xs font-mono">
        <div className="flex items-center justify-between">
          <span>Frame Duration:</span>
          <NumberField
            ariaLabel="Constant Frame Duration"
            value={durationMs}
            min={10}
            max={10000}
            suffix="ms"
            widthClass="w-24"
            onChange={setDurationMs}
          />
        </div>
        <div className="flex items-center gap-1">
          {[50, 83, 100, 150, 200].map((presetMs) => (
            <PixelButton
              key={presetMs}
              size="xs"
              active={durationMs === presetMs}
              onClick={() => setDurationMs(presetMs)}
            >
              {presetMs}ms
            </PixelButton>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span>Target Scope:</span>
          <PixelSelect
            ariaLabel="Constant Frame Rate Scope"
            value={scope}
            onChange={(v) => setScope(v as "all" | "range")}
            options={[
              { value: "all", label: `All Frames (1..${doc.sprite.frames.length})` },
              { value: "range", label: "Selected Timeline Range" },
            ]}
          />
        </div>
        <div className="flex justify-end gap-1.5 pt-2">
          <PixelButton onClick={handleApply}>{t("common.ok")}</PixelButton>
          <PixelButton onClick={onClose}>{t("common.cancel")}</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 8. New Tilemap Layer Dialog (`Layer > New Tilemap Layer...`)
 */
export const NewTilemapLayerDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const createTilemapLayer = useAppStore((s) => s.createTilemapLayer);

  const [name, setName] = useState("Tilemap Layer");
  const [tileWidth, setTileWidth] = useState(16);
  const [tileHeight, setTileHeight] = useState(16);
  const [existingTilesetId, setExistingTilesetId] = useState("new");

  if (!doc) return null;

  const handleCreate = () => {
    createTilemapLayer({
      name: name.trim() || "Tilemap Layer",
      tileWidth,
      tileHeight,
      existingTilesetId: existingTilesetId === "new" ? undefined : existingTilesetId,
    });
    onClose();
  };

  return (
    <PixelDialog title="New Tilemap Layer" onClose={onClose} widthClass="w-[340px]">
      <div className="space-y-2.5 text-xs font-mono">
        <div className="flex items-center justify-between">
          <span>Layer Name:</span>
          <TextField value={name} onChange={setName} className="w-44" />
        </div>
        <div className="flex items-center justify-between">
          <span>Tileset:</span>
          <PixelSelect
            ariaLabel="Tileset Selection"
            value={existingTilesetId}
            onChange={setExistingTilesetId}
            options={[
              { value: "new", label: "Create New Tileset" },
              ...doc.sprite.tilesets.map((ts) => ({
                value: ts.id,
                label: `Reuse: ${ts.name} (${ts.tileWidth}x${ts.tileHeight})`,
              })),
            ]}
          />
        </div>
        {existingTilesetId === "new" && (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center justify-between">
              <span>Tile W:</span>
              <NumberField
                ariaLabel="New Tileset Width"
                value={tileWidth}
                min={4}
                max={128}
                widthClass="w-16"
                onChange={setTileWidth}
              />
            </div>
            <div className="flex items-center justify-between">
              <span>Tile H:</span>
              <NumberField
                ariaLabel="New Tileset Height"
                value={tileHeight}
                min={4}
                max={128}
                widthClass="w-16"
                onChange={setTileHeight}
              />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-1.5 pt-2">
          <PixelButton onClick={handleCreate}>{t("common.ok")}</PixelButton>
          <PixelButton onClick={onClose}>{t("common.cancel")}</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 9. Onion Skin Settings Dialog (`View > Onion Skin Settings...`)
 */
export const OnionSkinSettingsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const onionSkin = useAppStore((s) => s.onionSkin);
  const setOnionSkin = useAppStore((s) => s.setOnionSkin);

  return (
    <PixelDialog title="Onion Skin Preferences" onClose={onClose} widthClass="w-[360px]">
      <div className="space-y-2.5 text-xs font-mono">
        <PixelCheckbox
          checked={onionSkin.enabled}
          onChange={(enabled) => setOnionSkin({ enabled })}
          label="Enable Onion Skin Ghosting (F3)"
        />
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between">
            <span>Frames Before:</span>
            <NumberField
              value={onionSkin.framesBefore}
              min={0}
              max={8}
              widthClass="w-16"
              onChange={(framesBefore) => setOnionSkin({ framesBefore })}
            />
          </div>
          <div className="flex items-center justify-between">
            <span>Frames After:</span>
            <NumberField
              value={onionSkin.framesAfter}
              min={0}
              max={8}
              widthClass="w-16"
              onChange={(framesAfter) => setOnionSkin({ framesAfter })}
            />
          </div>
        </div>

        <PixelSlider
          label="Initial Ghost Opacity"
          value={onionSkin.initialOpacity}
          min={16}
          max={255}
          onChange={(initialOpacity) => setOnionSkin({ initialOpacity })}
        />
        <PixelSlider
          label="Per-Frame Falloff Step"
          value={onionSkin.opacityStep}
          min={0}
          max={100}
          onChange={(opacityStep) => setOnionSkin({ opacityStep })}
        />

        <div className="flex items-center justify-between">
          <span>Ghost Style:</span>
          <PixelSelect
            ariaLabel="Dialog Onion Mode"
            value={onionSkin.mode}
            onChange={(v) => setOnionSkin({ mode: v as "tint" | "merge" })}
            options={[
              { value: "tint", label: "Red / Blue Tinted Ghosts" },
              { value: "merge", label: "True Color Merge" },
            ]}
          />
        </div>

        <div className="flex items-center justify-between">
          <span>Tint Colors (Prev / Next):</span>
          <div className="flex items-center gap-1.5">
            <ColorInputField
              ariaLabel="Previous Frame Tint Color"
              value={rgbaToHex(onionSkin.prevTint)}
              onChange={(hex) => setOnionSkin({ prevTint: hexToRgba(hex, 255) })}
              className="w-8 h-5"
            />
            <ColorInputField
              ariaLabel="Next Frame Tint Color"
              value={rgbaToHex(onionSkin.nextTint)}
              onChange={(hex) => setOnionSkin({ nextTint: hexToRgba(hex, 255) })}
              className="w-8 h-5"
            />
          </div>
        </div>

        <PixelCheckbox
          checked={onionSkin.loopTag}
          onChange={(loopTag) => setOnionSkin({ loopTag })}
          label="Loop Ghost Frames Through Active Tag"
        />
        <PixelCheckbox
          checked={onionSkin.currentLayerOnly}
          onChange={(currentLayerOnly) => setOnionSkin({ currentLayerOnly })}
          label="Show Active Layer Only"
        />
        <div className="flex items-center justify-between">
          <span>Render Position:</span>
          <PixelSelect
            ariaLabel="Dialog Onion Position"
            value={onionSkin.position}
            onChange={(v) => setOnionSkin({ position: v as "behind" | "in_front" })}
            options={[
              { value: "behind", label: "Behind Active Sprite" },
              { value: "in_front", label: "In Front of Active Sprite" },
            ]}
          />
        </div>

        <div className="flex justify-end pt-2">
          <PixelButton onClick={onClose}>{t("common.ok")}</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};
