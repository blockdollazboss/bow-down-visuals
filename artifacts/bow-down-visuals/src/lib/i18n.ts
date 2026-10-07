import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "../locales/en.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import pt from "../locales/pt.json";
import de from "../locales/de.json";
import it from "../locales/it.json";
import hi from "../locales/hi.json";
import ar from "../locales/ar.json";
import ja from "../locales/ja.json";
import ko from "../locales/ko.json";

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
      es: { translation: es },
      fr: { translation: fr },
      pt: { translation: pt },
      de: { translation: de },
      it: { translation: it },
      hi: { translation: hi },
      ar: { translation: ar },
      ja: { translation: ja },
      ko: { translation: ko },
    },
    lng: "en", // default to English on first visit; detector only overrides if user explicitly chose
    fallbackLng: "en",
    defaultNS: "translation",
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
