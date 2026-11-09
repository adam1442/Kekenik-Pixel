/**
 * @module @kekenik/core/i18n
 * Internationalization layer with English (en) default, complete Persian (fa / fa-IR) translation,
 * Persian numeral conversion, extension language pack overrides, and RTL direction helpers.
 */

import enJson from "../../../ui/src/i18n/locales/en.json";
import faJson from "../../../ui/src/i18n/locales/fa.json";
import { LocaleCode } from "../settings/index.ts";

export const EN_STRINGS: Record<string, string> = { ...enJson };
export const FA_STRINGS: Record<string, string> = { ...faJson };

if (import.meta.env.VITE_KP_FLAVOR !== "release") {
  EN_STRINGS["panel.featurecenter"] = "Feature Center";
  EN_STRINGS["dialog.feature_center"] = "Feature Center";
  FA_STRINGS["panel.featurecenter"] = "مرکز قابلیت‌ها";
  FA_STRINGS["dialog.feature_center"] = "مرکز قابلیت‌ها";
}

const extensionOverrides = new Map<string, { locale: string; strings: Record<string, string> }>();

let currentLocale: LocaleCode = "en";

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"] as const;

/**
 * Converts ASCII digits `0..9` into Persian Unicode numerals `۰..۹`.
 */
export function toPersianNumerals(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

/**
 * Formats a number or string using Persian numerals when `locale === "fa-IR"`.
 */
export function formatLocalizedNumber(
  value: string | number,
  locale: LocaleCode = currentLocale
): string {
  if (locale === "fa-IR") {
    return toPersianNumerals(value);
  }
  return String(value);
}

/**
 * Registers language pack string overrides from an enabled `.kpext` extension.
 */
export function registerLocaleOverrides(
  sourceId: string,
  locale: string,
  strings: Record<string, string>
): void {
  extensionOverrides.set(sourceId, { locale, strings: { ...strings } });
}

/**
 * Removes language pack string overrides when an extension is disabled or uninstalled.
 */
export function unregisterLocaleOverrides(sourceId: string): void {
  extensionOverrides.delete(sourceId);
}

/**
 * Sets the active UI locale ('en' | 'fa' | 'fa-IR') and updates document root direction when in DOM.
 */
export function setLocale(locale: LocaleCode): void {
  currentLocale = locale;
  const g = globalThis as { document?: { documentElement?: { dir?: string; lang?: string } } };
  if (g.document?.documentElement) {
    g.document.documentElement.dir = isRTL(locale) ? "rtl" : "ltr";
    g.document.documentElement.lang = locale;
  }
}

/**
 * Gets the active UI locale.
 */
export function getLocale(): LocaleCode {
  return currentLocale;
}

/**
 * Returns true if the specified or active locale uses Right-to-Left (RTL) text direction.
 */
export function isRTL(locale: LocaleCode = currentLocale): boolean {
  return locale === "fa" || locale === "fa-IR";
}

/**
 * Translates a key using active extension overrides + locale dictionary, falling back to English or the key itself.
 */
export function t(key: string, locale: LocaleCode = currentLocale): string {
  const baseLang = locale === "fa" || locale === "fa-IR" ? "fa" : "en";

  // Check active extension overrides first (in reverse insertion order)
  const overrideEntries = Array.from(extensionOverrides.values()).reverse();
  for (const ov of overrideEntries) {
    if (ov.locale === baseLang && key in ov.strings) {
      const val = ov.strings[key];
      return locale === "fa-IR" ? toPersianNumerals(val) : val;
    }
  }

  const dict = baseLang === "fa" ? FA_STRINGS : EN_STRINGS;
  const raw = dict[key] ?? EN_STRINGS[key] ?? key;
  return locale === "fa-IR" ? toPersianNumerals(raw) : raw;
}
