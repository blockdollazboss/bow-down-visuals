/**
 * locale-source-auto.test.ts — Stack-30 Lane E (E4), updated for the
 * owner's Oct 17, 2026 ruling.
 *
 * labelPitch.sourceAuto is the song-source toggle's automatic mode.
 * English renamed that mode to "✨ Turbo (AI picks)" when every AI
 * auto mode became Turbo — but the 9 non-English catalogs still
 * rendered their generic word for "auto" (Auto / Automático / تلقائي /
 * 自動 / 자동 …), i.e. they were translated from the pre-Turbo string
 * and never followed the rename. (The key was never English-only; it
 * was stale.) Stack-30 first carried "✨ Turbo" + each catalog's own
 * translated "(AI picks)" parenthetical into every catalog.
 *
 * The owner then ruled the other way on the mode word itself
 * (Oct 17, 2026, 22:14 EDT): translate the mode word per language —
 * do NOT keep "Turbo" as an untranslated brand word outside English.
 * So each catalog now names the mode with its own native word for the
 * fast/automatic mode (Schnell / Rápido / Rapide / Rapida / سريع /
 * तेज़ / 高速 / 빠른), the "(AI picks)" parenthetical stays translated,
 * and create-simple.simple_mode — which still said "Simple Mode" in
 * all 9 catalogs — carries the same translated mode name. The
 * orphaned dashboard.simple_mode / dashboard.try_simple_mode keys
 * (no code caller) were aligned in the same pass.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;

type Catalog = {
  labelPitch?: { sourceAuto?: string };
  "create-simple"?: { simple_mode?: string };
  dashboard?: { simple_mode?: string; try_simple_mode?: string };
};

function catalog(locale: string): Catalog {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Catalog;
}

function sourceAuto(locale: string): string {
  const v = catalog(locale).labelPitch?.sourceAuto;
  if (!v) throw new Error(`${locale}.json is missing labelPitch.sourceAuto`);
  return v;
}

/** The translated Turbo-mode label each catalog must carry (owner ruling, Oct 17 2026). */
const SOURCE_AUTO: Record<string, string> = {
  es: "✨ Rápido (la IA elige)",
  fr: "✨ Rapide (l'IA choisit)",
  de: "✨ Schnell (KI wählt)",
  it: "✨ Rapida (sceglie l'AI)",
  pt: "✨ Rápido (IA escolhe)",
  ar: "✨ سريع (الذكاء الاصطناعي يختار)",
  hi: "✨ तेज़ (AI चुनता है)",
  ja: "✨ 高速(AIが選ぶ)",
  ko: "✨ 빠른 (AI 선택)",
};

const SIMPLE_MODE: Record<string, string> = {
  es: "Modo rápido",
  fr: "Mode rapide",
  de: "Schnellmodus",
  it: "Modalità rapida",
  pt: "Modo Rápido",
  ar: "الوضع السريع",
  hi: "तेज़ मोड",
  ja: "高速モード",
  ko: "빠른 모드",
};

const DASHBOARD_SIMPLE_MODE: Record<string, string> = {
  es: "Modo rápido",
  fr: "Mode rapide",
  de: "Schnellmodus",
  it: "Modalità Rapida",
  pt: "Modo Rápido",
  ar: "الوضع السريع",
  hi: "तेज़ मोड",
  ja: "高速モード",
  ko: "빠른 모드",
};

const DASHBOARD_TRY_SIMPLE_MODE: Record<string, string> = {
  es: "Probar el modo rápido",
  fr: "Essayer le mode rapide",
  de: "Schnellmodus ausprobieren",
  it: "Prova la Modalità Rapida",
  pt: "Testar o Modo Rápido",
  ar: "جرّب الوضع السريع",
  hi: "तेज़ मोड आज़माएं",
  ja: "高速モードを試す",
  ko: "빠른 모드 사용해 보기",
};

describe("labelPitch.sourceAuto — the Turbo mode name in every catalog", () => {
  it("english is the canonical string", () => {
    expect(sourceAuto("en")).toBe("✨ Turbo (AI picks)");
  });

  it.each(LOCALES.filter((l) => l !== "en"))(
    "%s names the Turbo mode with its own translated mode word",
    (locale) => {
      const v = sourceAuto(locale);
      expect(v).toBe(SOURCE_AUTO[locale]);
      // The mode word is translated — not the untranslated brand word,
      // and not the English string with a translated hat.
      expect(v.startsWith("✨ Turbo")).toBe(false);
      expect(v).not.toBe(sourceAuto("en"));
      // The parenthetical stays translated.
      expect(v).toContain("(");
    },
  );
});

describe("create-simple.simple_mode — the Turbo mode name in every catalog", () => {
  it("english is the canonical string", () => {
    expect(catalog("en")["create-simple"]?.simple_mode).toBe("Turbo Mode");
  });

  it.each(LOCALES.filter((l) => l !== "en"))("%s carries the same translated mode name", (locale) => {
    expect(catalog(locale)["create-simple"]?.simple_mode).toBe(SIMPLE_MODE[locale]);
  });
});

describe("dashboard mode keys (orphaned, aligned in the same pass)", () => {
  it.each(LOCALES.filter((l) => l !== "en"))("%s dashboard strings match the translated mode name", (locale) => {
    const d = catalog(locale).dashboard;
    expect(d?.simple_mode).toBe(DASHBOARD_SIMPLE_MODE[locale]);
    expect(d?.try_simple_mode).toBe(DASHBOARD_TRY_SIMPLE_MODE[locale]);
  });
});
