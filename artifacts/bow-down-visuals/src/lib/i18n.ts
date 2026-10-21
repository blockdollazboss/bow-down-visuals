import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "../locales/en.json";

/*
 * First-load performance (Stack-21): only English is bundled into the entry
 * chunk. The other nine locale catalogs used to be static imports here,
 * which put ~4.4 MB raw / ~1.44 MB gzip of JSON into the initial bundle
 * that every visitor on every route had to download and parse before first
 * paint — even though the detector below only ever activates a non-English
 * language from an explicit stored choice (first visit is always English).
 * Each non-English catalog is now a lazily imported chunk, fetched on
 * demand: once at startup when a stored choice names it, and whenever the
 * user picks it in the language switcher.
 */
const localeLoaders: Record<string, () => Promise<{ default: unknown }>> = {
  es: () => import("../locales/es.json"),
  fr: () => import("../locales/fr.json"),
  pt: () => import("../locales/pt.json"),
  de: () => import("../locales/de.json"),
  it: () => import("../locales/it.json"),
  hi: () => import("../locales/hi.json"),
  ar: () => import("../locales/ar.json"),
  ja: () => import("../locales/ja.json"),
  ko: () => import("../locales/ko.json"),
};

const loadedLocales = new Set<string>(["en"]);

/**
 * Fetch a locale's catalog chunk (once) and register it with i18next.
 * Resolves true when the locale's strings are ready to render.
 */
export async function ensureLocaleLoaded(lng: string): Promise<boolean> {
  const base = lng.split("-")[0];
  if (loadedLocales.has(base)) return true;
  const loader = localeLoaders[base];
  if (!loader) return false;
  const mod = await loader();
  i18n.addResourceBundle(base, "translation", mod.default as object, true, true);
  loadedLocales.add(base);
  return true;
}

/** Switch language, loading its catalog chunk first when it isn't bundled. */
export async function setLanguage(lng: string): Promise<void> {
  await ensureLocaleLoaded(lng);
  await i18n.changeLanguage(lng);
}

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Español", flag: "🇪🇸" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
  { code: "pt", name: "Português", flag: "🇧🇷" },
  { code: "de", name: "Deutsch", flag: "🇩🇪" },
  { code: "it", name: "Italiano", flag: "🇮🇹" },
  { code: "hi", name: "हिन्दी", flag: "🇮🇳" },
  { code: "ar", name: "العربية", flag: "🇸🇦" },
  { code: "ja", name: "日本語", flag: "🇯🇵" },
  { code: "ko", name: "한국어", flag: "🇰🇷" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
    },
    fallbackLng: "en",
    defaultNS: "translation",
    // NOTE: no `lng` set here — the LanguageDetector reads the user's
    // saved choice from localStorage ("bdv-language"). First visit has
    // nothing stored, so the detector returns nothing and i18next falls
    // back to `fallbackLng: "en"`. Setting `lng` explicitly would bypass
    // the detector entirely and reset to English on every page load.
    interpolation: {
      escapeValue: false,
    },
    detection: {
      // Only respect an explicit user choice stored in localStorage.
      // Browser language is intentionally NOT used — first visit is always English.
      order: ["localStorage"],
      caches: ["localStorage"],
      lookupLocalStorage: "bdv-language",
    },
  });

// A returning visitor's stored choice may name a language whose catalog is
// no longer bundled. i18next already reports that language as active (its
// strings resolve through the English fallback for the moment); fetch its
// chunk now and re-apply so the UI re-renders in the chosen language.
const detectedLanguage = i18n.language;
if (detectedLanguage && !loadedLocales.has(detectedLanguage.split("-")[0])) {
  void ensureLocaleLoaded(detectedLanguage).then((ready) => {
    if (ready) void i18n.changeLanguage(detectedLanguage);
  });
}

// RTL support + document language: update <html lang> and dir on language change
const RTL_LANGUAGES = new Set(["ar"]);
function applyDocumentLanguage(lng: string) {
  const base = lng.split("-")[0];
  document.documentElement.lang = base;
  document.documentElement.dir = RTL_LANGUAGES.has(base) ? "rtl" : "ltr";
}
i18n.on("languageChanged", applyDocumentLanguage);
// Apply immediately for the initial language
applyDocumentLanguage(i18n.language || "en");

export default i18n;
