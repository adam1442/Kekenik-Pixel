/**
 * @module @kekenik/ui/i18n
 * React hooks (`useDirection`, `useTranslation`) and locale exports for Kekenik Pixel UI.
 */

import { useEffect } from "react";
import {
  EN_STRINGS,
  FA_STRINGS,
  formatLocalizedNumber,
  isRTL,
  LocaleCode,
  t,
  toPersianNumerals,
} from "../../../core/src/index.ts";
import { useAppStore } from "../app/store.ts";

export { EN_STRINGS, FA_STRINGS, formatLocalizedNumber, isRTL, t, toPersianNumerals };

/**
 * Hook that returns the current UI text direction (`"rtl"` for Persian, `"ltr"` for English)
 * and synchronizes `document.documentElement.dir` while keeping canvas coordinates LTR.
 */
export function useDirection(): {
  dir: "ltr" | "rtl";
  isRtl: boolean;
  locale: LocaleCode;
  canvasDir: "ltr";
} {
  const locale = useAppStore((s) => s.locale);
  const rtl = isRTL(locale);
  const dir: "ltr" | "rtl" = rtl ? "rtl" : "ltr";

  useEffect(() => {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.dir = dir;
      document.documentElement.lang = locale;
    }
  }, [dir, locale]);

  return {
    dir,
    isRtl: rtl,
    locale,
    canvasDir: "ltr",
  };
}

/**
 * Hook providing localized string lookup `t(key)` and numeral formatting bound to active store locale.
 */
export function useTranslation() {
  const locale = useAppStore((s) => s.locale);
  return {
    locale,
    isRtl: isRTL(locale),
    t: (key: string) => t(key, locale),
    n: (val: string | number) => formatLocalizedNumber(val, locale),
  };
}
