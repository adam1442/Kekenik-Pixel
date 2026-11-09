/**
 * @module @kekenik/ui/widgets
 * Custom pixel-art beveled UI widget library matching Aseprite 1.3 visual style.
 * Implements B09 (select-all on focus across all input widgets; no raw <input>/<textarea> outside widgets/)
 * and B10 (draggable Dialog / PixelDialog with viewport clamping).
 */

import React, { useEffect, useRef, useState } from "react";
import { clamp, hexToRgba, RGBA, rgbaToHex } from "../../../core/src/index.ts";
import { PixelIcon } from "../skin/index.tsx";

/**
 * Helper hook that selects all text whenever an input or textarea receives focus
 * (via keyboard Tab, programmatic .focus(), or mouse click) and prevents the
 * initial mouseup from collapsing the selection.
 */
function useSelectAllOnFocus<T extends HTMLInputElement | HTMLTextAreaElement>(
  enabled = true
) {
  const justFocusedRef = useRef(false);

  const handleFocus = (e: React.FocusEvent<T>) => {
    if (!enabled) return;
    justFocusedRef.current = true;
    const el = e.currentTarget;
    el.select();
    try {
      el.setSelectionRange(0, el.value.length);
    } catch {
      // Ignore if input type does not support setSelectionRange
    }
  };

  const handleMouseUp = (e: React.MouseEvent<T>) => {
    if (!enabled) return;
    if (justFocusedRef.current) {
      justFocusedRef.current = false;
      e.preventDefault();
      const el = e.currentTarget;
      el.select();
      try {
        el.setSelectionRange(0, el.value.length);
      } catch {
        // Ignore
      }
    }
  };

  const handleBlur = () => {
    justFocusedRef.current = false;
  };

  return { handleFocus, handleMouseUp, handleBlur };
}

export const PixelButton: React.FC<{
  children?: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
  className?: string;
  size?: "xs" | "sm" | "md";
  dataTestId?: string;
}> = ({
  children,
  onClick,
  onDoubleClick,
  disabled = false,
  active = false,
  title,
  className = "",
  size = "sm",
  dataTestId,
}) => {
  const pad =
    size === "xs"
      ? "px-1.5 py-0.5 text-[11px]"
      : size === "sm"
      ? "px-2 py-0.5 text-xs"
      : "px-3 py-1 text-xs";
  return (
    <button
      type="button"
      data-testid={dataTestId}
      onClick={disabled ? undefined : onClick}
      onDoubleClick={disabled ? undefined : onDoubleClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-1 font-mono select-none transition-none ${pad} ${
        active
          ? "kpx-bevel-inset bg-[var(--kpx-btn-active)] text-white"
          : "kpx-bevel-outset bg-[var(--kpx-btn-bg)] text-[var(--kpx-text)] hover:brightness-105 active:kpx-bevel-inset"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${className}`}
    >
      {children}
    </button>
  );
};

export const ToggleButton: React.FC<{
  pressed: boolean;
  onChange: (next: boolean) => void;
  children?: React.ReactNode;
  title?: string;
  disabled?: boolean;
  className?: string;
}> = ({ pressed, onChange, children, title, disabled, className = "" }) => (
  <PixelButton
    active={pressed}
    disabled={disabled}
    title={title}
    onClick={() => onChange(!pressed)}
    className={className}
  >
    {children}
  </PixelButton>
);

export const NumberField: React.FC<{
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  widthClass?: string;
  ariaLabel?: string;
  dataTestId?: string;
}> = ({
  value,
  onChange,
  min = 1,
  max = 16384,
  step = 1,
  suffix,
  widthClass = "w-16",
  ariaLabel,
  dataTestId,
}) => {
  const [draft, setDraft] = useState<string>(() => String(value));
  const [focused, setFocused] = useState(false);
  const { handleFocus, handleMouseUp, handleBlur } = useSelectAllOnFocus<HTMLInputElement>(true);

  useEffect(() => {
    if (!focused) {
      setDraft(String(value));
    }
  }, [value, focused]);

  const parseValue = (raw: string): number =>
    step < 1 ? parseFloat(raw) : parseInt(raw, 10);

  const commitDraft = (raw: string) => {
    const parsed = parseValue(raw);
    if (!Number.isNaN(parsed)) {
      const clamped = clamp(parsed, min, max);
      onChange(clamped);
      setDraft(String(clamped));
    } else {
      setDraft(String(value));
    }
  };

  return (
    <div
      className={`inline-flex items-center kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] px-1.5 py-0.5 text-xs font-mono ${widthClass}`}
    >
      <input
        type="text"
        inputMode="numeric"
        role="spinbutton"
        aria-label={ariaLabel}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        data-testid={dataTestId}
        value={focused ? draft : String(value)}
        onFocus={(e) => {
          setFocused(true);
          setDraft(String(value));
          handleFocus(e);
        }}
        onMouseUp={handleMouseUp}
        onBlur={() => {
          setFocused(false);
          handleBlur();
          commitDraft(draft);
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const parsed = parseValue(raw);
          if (!Number.isNaN(parsed)) {
            onChange(clamp(parsed, min, max));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            const next = clamp(Number((value + step).toFixed(4)), min, max);
            onChange(next);
            setDraft(String(next));
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            const next = clamp(Number((value - step).toFixed(4)), min, max);
            onChange(next);
            setDraft(String(next));
          } else if (e.key === "Enter") {
            commitDraft(draft);
          }
        }}
        className="w-full bg-transparent outline-none text-xs font-mono"
      />
      {suffix && <span className="text-[10px] opacity-60 ml-0.5 select-none">{suffix}</span>}
    </div>
  );
};

export const TextField: React.FC<{
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  dir?: "ltr" | "rtl";
  ariaLabel?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  dataTestId?: string;
}> = ({
  value,
  onChange,
  placeholder,
  className = "",
  dir,
  ariaLabel,
  autoFocus,
  onBlur,
  onKeyDown,
  dataTestId,
}) => {
  const { handleFocus, handleMouseUp, handleBlur } = useSelectAllOnFocus<HTMLInputElement>(true);
  return (
    <input
      type="text"
      dir={dir}
      aria-label={ariaLabel}
      data-testid={dataTestId}
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder}
      onFocus={handleFocus}
      onMouseUp={handleMouseUp}
      onBlur={() => {
        handleBlur();
        onBlur?.();
      }}
      onKeyDown={onKeyDown}
      onChange={(e) => onChange(e.target.value)}
      className={`kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] px-2 py-0.5 text-xs font-mono outline-none ${className}`}
    />
  );
};

export const HexField: React.FC<{
  value: string;
  onChange: (hex: string) => void;
  onValidColor?: (rgba: RGBA) => void;
  alpha?: number;
  ariaLabel?: string;
  className?: string;
  dataTestId?: string;
}> = ({
  value,
  onChange,
  onValidColor,
  alpha = 255,
  ariaLabel = "Hex color code",
  className = "w-full",
  dataTestId,
}) => {
  const { handleFocus, handleMouseUp, handleBlur } = useSelectAllOnFocus<HTMLInputElement>(true);
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      data-testid={dataTestId}
      value={value}
      onFocus={handleFocus}
      onMouseUp={handleMouseUp}
      onBlur={handleBlur}
      onChange={(e) => {
        const next = e.target.value;
        onChange(next);
        if (/^#?[0-9a-fA-F]{6}$/.test(next.trim())) {
          onValidColor?.(hexToRgba(next.trim(), alpha));
        }
      }}
      className={`kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] px-1.5 py-0.5 text-[11px] font-mono outline-none ${className}`}
    />
  );
};

export const ComboEntry: React.FC<{
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (val: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
}> = ({ value, options, onChange, ariaLabel, placeholder, className = "" }) => {
  const { handleFocus, handleMouseUp, handleBlur } = useSelectAllOnFocus<HTMLInputElement>(true);
  return (
    <div className={`inline-flex items-center gap-0.5 ${className}`}>
      <input
        type="text"
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onFocus={handleFocus}
        onMouseUp={handleMouseUp}
        onBlur={handleBlur}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] px-1.5 py-0.5 text-xs font-mono outline-none"
      />
      {options.length > 0 && (
        <select
          aria-label={ariaLabel ? `${ariaLabel} presets` : "Combo presets"}
          value={options.some((o) => o.value === value) ? value : ""}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="kpx-bevel-outset bg-[var(--kpx-btn-bg)] text-[var(--kpx-text)] px-1 py-0.5 text-xs font-mono outline-none cursor-pointer"
        >
          <option value="">▾</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
};

export const PixelSlider: React.FC<{
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
  label?: string;
  ariaLabel?: string;
  className?: string;
}> = ({ value, min, max, onChange, label, ariaLabel, className = "" }) => {
  const pct = clamp(((value - min) / Math.max(1, max - min)) * 100, 0, 100);
  return (
    <div
      role="slider"
      aria-label={ariaLabel ?? label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          onChange(clamp(value + 1, min, max));
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          onChange(clamp(value - 1, min, max));
        }
      }}
      className={`relative h-4 kpx-bevel-inset bg-[var(--kpx-input-bg)] select-none cursor-ew-resize overflow-hidden ${className}`}
      onMouseDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const update = (clientX: number) => {
          const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
          onChange(Math.round(min + ratio * (max - min)));
        };
        update(e.clientX);
        const onMove = (ev: MouseEvent) => update(ev.clientX);
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
    >
      <div className="h-full bg-[#8ab0cc]" style={{ width: `${pct}%` }} />
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-black font-bold">
        {label ? `${label}: ${value}` : value}
      </span>
    </div>
  );
};

export const SliderValue: React.FC<{
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
  label?: string;
  ariaLabel?: string;
  suffix?: string;
  className?: string;
}> = ({ value, min, max, onChange, label, ariaLabel, suffix, className = "" }) => (
  <div className={`flex items-center gap-1.5 ${className}`}>
    <PixelSlider
      value={value}
      min={min}
      max={max}
      onChange={onChange}
      label={label}
      ariaLabel={ariaLabel ?? label}
      className="flex-1"
    />
    <NumberField
      ariaLabel={ariaLabel ? `${ariaLabel} Value` : label ? `${label} Value` : undefined}
      value={value}
      min={min}
      max={max}
      suffix={suffix}
      widthClass="w-12"
      onChange={onChange}
    />
  </div>
);

export const ColorInputField: React.FC<{
  value: string;
  onChange: (hex: string) => void;
  ariaLabel?: string;
  className?: string;
}> = ({ value, onChange, ariaLabel, className = "w-8 h-5" }) => (
  <input
    type="color"
    aria-label={ariaLabel}
    value={value.slice(0, 7)}
    onChange={(e) => onChange(e.target.value)}
    className={`border border-black cursor-pointer ${className}`}
  />
);

export const TextAreaField: React.FC<{
  value: string;
  onChange: (val: string) => void;
  ariaLabel?: string;
  rows?: number;
  placeholder?: string;
  className?: string;
  selectAllOnFocus?: boolean;
}> = ({
  value,
  onChange,
  ariaLabel,
  rows = 2,
  placeholder,
  className = "",
  selectAllOnFocus = false,
}) => {
  const { handleFocus, handleMouseUp, handleBlur } =
    useSelectAllOnFocus<HTMLTextAreaElement>(selectAllOnFocus);
  return (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onFocus={handleFocus}
      onMouseUp={handleMouseUp}
      onBlur={handleBlur}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className={`kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] px-1.5 py-1 text-xs font-mono outline-none ${className}`}
    />
  );
};

export const PixelSelect: React.FC<{
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (val: string) => void;
  className?: string;
  ariaLabel?: string;
}> = ({ value, options, onChange, className = "", ariaLabel }) => (
  <select
    aria-label={ariaLabel}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={`kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] px-1.5 py-0.5 text-xs font-mono outline-none cursor-pointer ${className}`}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

export const PixelCheckbox: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}> = ({ checked, onChange, label }) => (
  <label className="inline-flex items-center gap-1.5 text-xs font-mono cursor-pointer select-none">
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-3.5 h-3.5 kpx-bevel-inset bg-[var(--kpx-input-bg)] flex items-center justify-center text-black"
    >
      {checked && <PixelIcon name="check" size={10} />}
    </button>
    <span>{label}</span>
  </label>
);

export const PixelRadioGroup: React.FC<{
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (val: string) => void;
  className?: string;
}> = ({ value, options, onChange, className = "" }) => (
  <div className={`flex flex-wrap items-center gap-2 ${className}`}>
    {options.map((opt) => {
      const active = opt.value === value;
      return (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className="inline-flex items-center gap-1 text-xs font-mono cursor-pointer select-none"
        >
          <span className="w-3.5 h-3.5 rounded-full border border-black bg-[var(--kpx-input-bg)] flex items-center justify-center">
            {active && <span className="w-1.5 h-1.5 rounded-full bg-black" />}
          </span>
          <span>{opt.label}</span>
        </button>
      );
    })}
  </div>
);

export const ColorSwatch: React.FC<{
  color: RGBA;
  selected?: boolean;
  isTransparentIndex?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  size?: number;
  title?: string;
}> = ({
  color,
  selected = false,
  isTransparentIndex = false,
  onClick,
  onContextMenu,
  size = 16,
  title,
}) => {
  const hex = rgbaToHex(color);
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title ?? hex}
      style={{
        width: size,
        height: size,
        backgroundColor: color.a === 0 ? "transparent" : hex,
      }}
      className={`relative border border-[#19161c] select-none shrink-0 ${
        selected ? "ring-1 ring-white z-10" : ""
      }`}
    >
      {isTransparentIndex && (
        <svg viewBox="0 0 10 10" className="w-full h-full">
          <polygon points="0,0 10,0 0,10" fill="#000000" />
          <polygon points="10,0 10,10 0,10" fill="#ffffff" />
        </svg>
      )}
    </button>
  );
};

export const SectionDivider: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center gap-1 my-1.5 select-none">
    <span className="text-[11px] font-mono text-[#4f463d]">--</span>
    <span className="text-xs font-mono font-bold text-[#234d8c]">{label}</span>
    <div className="flex-1 border-b border-dashed border-[#7d756d]" />
  </div>
);

/**
 * Shared Draggable Modal Dialog widget (B10).
 * Every dialog in Kekenik Pixel renders through `Dialog` / `PixelDialog` and can be dragged
 * by its title bar, clamped within the viewport.
 */
export const Dialog: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClass?: string;
  companionTop?: React.ReactNode;
}> = ({ title, onClose, children, widthClass = "w-[360px]", companionTop }) => {
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleTitleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startOffsetX = offset.x;
    const startOffsetY = offset.y;

    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 720;
    const maxOffsetX = Math.max(120, Math.floor(vw / 2) - 40);
    const maxOffsetY = Math.max(80, Math.floor(vh / 2) - 24);

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      setOffset({
        x: clamp(startOffsetX + dx, -maxOffsetX, maxOffsetX),
        y: clamp(startOffsetY + dy, -maxOffsetY, maxOffsetY),
      });
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/45 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px)`,
        }}
        data-dialog-offset-x={offset.x}
        data-dialog-offset-y={offset.y}
        className="flex flex-col items-center"
      >
        {companionTop && <div className="mb-1.5">{companionTop}</div>}
        <div
          ref={dialogRef}
          role="dialog"
          aria-label={title}
          data-testid="pixel-dialog"
          className={`kpx-window bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] shadow-2xl ${widthClass} max-w-[95vw] max-h-[90vh] flex flex-col`}
        >
          <div
            data-testid="dialog-titlebar"
            onMouseDown={handleTitleMouseDown}
            className="flex items-center justify-between px-2 py-1 bg-[var(--kpx-header-bg)] text-[var(--kpx-header-text)] select-none border-b border-black cursor-move"
          >
            <span className="text-xs font-mono font-bold tracking-wide">{title}</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="w-4 h-4 kpx-bevel-outset bg-[var(--kpx-btn-bg)] text-black flex items-center justify-center hover:brightness-110 cursor-pointer"
            >
              <PixelIcon name="close" size={10} />
            </button>
          </div>
          <div className="p-3 overflow-y-auto flex-1 font-mono text-xs">{children}</div>
        </div>
      </div>
    </div>
  );
};

export const PixelDialog = Dialog;

export const PixelTabs: React.FC<{
  tabs: ReadonlyArray<{ id: string; label: string; badge?: string | number }>;
  activeId: string;
  onSelect: (id: string) => void;
}> = ({ tabs, activeId, onSelect }) => (
  <div className="flex items-center gap-0.5 border-b border-black pb-0.5 select-none">
    {tabs.map((tab) => {
      const active = tab.id === activeId;
      return (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelect(tab.id)}
          className={`px-2.5 py-1 text-xs font-mono ${
            active
              ? "kpx-bevel-outset bg-[var(--kpx-header-bg)] text-white font-bold"
              : "bg-[var(--kpx-tab-inactive)] text-[var(--kpx-text)] hover:brightness-105"
          }`}
        >
          {tab.label}
          {tab.badge !== undefined && (
            <span className="ml-1 px-1 py-0.2 bg-black/25 rounded text-[10px]">{tab.badge}</span>
          )}
        </button>
      );
    })}
  </div>
);

export const SplitPane: React.FC<{
  direction: "horizontal" | "vertical";
  size: number;
  minSize?: number;
  maxSize?: number;
  onResize: (newSize: number) => void;
  first: React.ReactNode;
  second: React.ReactNode;
}> = ({ direction, size, minSize = 100, maxSize = 480, onResize, first, second }) => {
  const isHoriz = direction === "horizontal";
  return (
    <div className={`flex ${isHoriz ? "flex-row" : "flex-col"} w-full h-full overflow-hidden`}>
      <div
        style={isHoriz ? { width: size } : { height: size }}
        className="shrink-0 overflow-hidden"
      >
        {first}
      </div>
      <div
        onMouseDown={(e) => {
          const startPos = isHoriz ? e.clientX : e.clientY;
          const startSize = size;
          const onMove = (ev: MouseEvent) => {
            const delta = (isHoriz ? ev.clientX : ev.clientY) - startPos;
            onResize(clamp(startSize + delta, minSize, maxSize));
          };
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        }}
        className={`${
          isHoriz ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize"
        } bg-[var(--kpx-chrome-bg)] hover:bg-[var(--kpx-accent-bg)] shrink-0 border border-black/40`}
      />
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">{second}</div>
    </div>
  );
};

export const PixelTooltip: React.FC<{
  text: string;
  children: React.ReactNode;
}> = ({ text, children }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-[#18141c] text-[#fef08a] border border-black text-[10px] font-mono whitespace-nowrap z-50 pointer-events-none shadow">
          {text}
        </div>
      )}
    </div>
  );
};
