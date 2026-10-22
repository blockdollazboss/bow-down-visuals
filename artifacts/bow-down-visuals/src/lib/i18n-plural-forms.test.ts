/*
 * Stack-23 lane 2 — plural correctness for the 12 keys that used to take
 * a caller-supplied `plural: "s"` interpolation (Stack-20 lane 19 wart):
 * callers passed an English "-s"/"-es" suffix unconditionally, so
 * Japanese/Korean/Arabic renders showed a stray Latin "s" after the noun
 * ("3個のクリップs"), German showed "Eintrs", and every locale inherited
 * English grammar. The keys now live in the catalogs as i18next CLDR
 * plural-suffixed forms (_zero/_one/_two/_few/_many/_other — the same
 * mechanism the rest of the catalog already uses, e.g. beats.beatCount)
 * and callers pass only { count }.
 *
 * Arabic is the reason all six suffixes exist for these keys: its CLDR
 * categories are zero/one/two/few/many/other, and i18next does NOT fall
 * back to the Arabic _other for a missing _few — it falls back to
 * English. _one/_other alone would render Arabic counts 2, 3–10 and
 * 11–99 in English.
 */
import { readFileSync } from "node:fs";
import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

const ALL = ["en", "es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"] as const;
type Locale = (typeof ALL)[number];

function load(locale: string): Record<string, unknown> {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

const KEYS = [
  "videoEditor.clipsRecoveredTitle",
  "videoEditor.clipsSyncedTitle",
  "videoEditor.consistencyAppliedDesc",
  "videoEditor.recoveredClipsMsg",
  "videoEditor.syncedClipsMsg",
  "videoEditor.tipClipsApproved",
  "videoEditor.tipEffectsSelected",
  "catalogImport.accountPieces",
  "catalogImport.scanFound",
  "catalogImport.uploadRegisteredNotice",
  "liveGuests.toastRevokeEnded",
  "playlist.itemsCount",
] as const;

const SUFFIXES = ["zero", "one", "two", "few", "many", "other"] as const;
const COUNTS = [0, 1, 2, 3, 5, 11, 100] as const;

const resources: Record<string, { translation: Record<string, unknown> }> = {};
for (const l of ALL) resources[l] = { translation: load(l) };

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({
    resources,
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
});

/* Platform token in Arabic script so scanFound renders stay script-pure
   for the stray-"s" sweep below. */
const OPTS = { platform: "يوتيوب", skipped: "" } as const;
const render = (lng: Locale, key: string, count: number): string =>
  i18n.t(key, { count, lng, ...OPTS }) as string;

describe("plural-suffixed catalog shape", () => {
  it("no catalog anywhere still carries a {{plural}} interpolation", () => {
    for (const l of ALL) {
      const raw = readFileSync(new URL(`../locales/${l}.json`, import.meta.url), "utf8");
      expect(raw.includes("{{plural}}"), `${l} still has {{{{plural}}}}`).toBe(false);
    }
  });

  it("each of the 12 keys exists in all six CLDR suffixed forms, base key gone", () => {
    const flat = (o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> => {
      if (o && typeof o === "object" && !Array.isArray(o)) {
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          const key = p ? `${p}.${k}` : k;
          if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
          else out[key] = v as string;
        }
      }
      return out;
    };
    for (const l of ALL) {
      const cat = flat(load(l));
      for (const key of KEYS) {
        expect(cat[key], `${l} still has base key ${key}`).toBeUndefined();
        for (const sfx of SUFFIXES) {
          expect(typeof cat[`${key}_${sfx}`], `${l} missing ${key}_${sfx}`).toBe("string");
          expect(cat[`${key}_${sfx}`]!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the four migrated callers no longer pass a plural: suffix", () => {
    const callers = [
      "../pages/video-editor.tsx",
      "../pages/catalog-import.tsx",
      "../pages/stream/playlist.tsx",
      "../components/go-live/GuestPanel.tsx",
    ];
    for (const rel of callers) {
      const src = readFileSync(new URL(rel, import.meta.url), "utf8");
      expect(src.includes("plural:"), `${rel} still passes plural:`).toBe(false);
    }
  });
});

describe("plural rendering across all 10 locales", () => {
  it("every touched key renders a real string at every probed count in every locale", () => {
    for (const lng of ALL) {
      for (const key of KEYS) {
        for (const count of COUNTS) {
          const out = render(lng, key, count);
          expect(typeof out, `${lng} ${key} @${count}`).toBe("string");
          expect(out.length, `${lng} ${key} @${count} empty`).toBeGreaterThan(0);
          expect(out, `${lng} ${key} @${count} resolved to the raw key`).not.toBe(key);
          expect(out.includes("{{"), `${lng} ${key} @${count} left an interpolation: ${out}`).toBe(false);
        }
      }
    }
  });

  it("no locale shows the stray Latin-s wart at count != 1", () => {
    /* The wart's signature: a Latin "s" glued straight onto a non-Latin
       noun ("クリップs", "مقطعs"), or a free-standing " s " token. The
       glued check only applies to the non-Latin scripts (ja/ko/ar/hi):
       in the Latin-script locales an "s" after an accented letter is
       native grammar ("estés"), and legit Latin loanwords inside
       ja/ko/ar/hi strings ("CSS", "Effects") never match — their "s"
       follows an ASCII letter. */
    const glued = /[^\x00-\x7F]s(?![a-zA-Z])/;
    const lone = /(?:^|\s)s(?=[\s.!?。]|$)/;
    const NON_LATIN = new Set(["ja", "ko", "ar", "hi"]);
    for (const lng of ALL) {
      for (const key of KEYS) {
        for (const count of COUNTS) {
          if (count === 1) continue;
          const out = render(lng, key, count);
          if (NON_LATIN.has(lng)) {
            expect(glued.test(out), `${lng} ${key} @${count} glued s: ${out}`).toBe(false);
          }
          expect(lone.test(out), `${lng} ${key} @${count} lone s: ${out}`).toBe(false);
        }
      }
    }
  });
});

describe("exact plural forms (spot pins)", () => {
  it("en pluralizes with -s/-es and singular at 1", () => {
    expect(render("en", "videoEditor.clipsRecoveredTitle", 1)).toBe("1 clip recovered!");
    expect(render("en", "videoEditor.clipsRecoveredTitle", 2)).toBe("2 clips recovered!");
    expect(render("en", "videoEditor.clipsRecoveredTitle", 0)).toBe("0 clips recovered!");
    expect(render("en", "playlist.itemsCount", 1)).toBe("1 item");
    expect(render("en", "playlist.itemsCount", 7)).toBe("7 items");
    expect(render("en", "liveGuests.toastRevokeEnded", 1)).toBe(
      "The link is dead and 1 guest pass ended with it.",
    );
    expect(render("en", "liveGuests.toastRevokeEnded", 2)).toBe(
      "The link is dead and 2 guest passes ended with it.",
    );
  });

  it("ja renders natively, same invariant form at 1 and at count != 1", () => {
    expect(render("ja", "videoEditor.clipsRecoveredTitle", 1)).toBe("1個のクリップを復元しました！");
    expect(render("ja", "videoEditor.clipsRecoveredTitle", 3)).toBe("3個のクリップを復元しました！");
    expect(render("ja", "playlist.itemsCount", 5)).toBe("5 アイテム");
  });

  it("ko renders natively, same invariant form at 1 and at count != 1", () => {
    expect(render("ko", "playlist.itemsCount", 1)).toBe("1개의 아이템");
    expect(render("ko", "playlist.itemsCount", 4)).toBe("4개의 아이템");
    expect(render("ko", "liveGuests.toastRevokeEnded", 2)).toBe(
      "링크가 죽었고 게스트 패스 2개가 함께 끝났습니다.",
    );
  });

  it("ar uses its own CLDR categories: dual at 2, plural noun at 3-10, singular at 1/11-99/100+", () => {
    expect(render("ar", "videoEditor.clipsRecoveredTitle", 0)).toBe("تمت استعادة 0 مقاطع!");
    expect(render("ar", "videoEditor.clipsRecoveredTitle", 1)).toBe("تمت استعادة 1 مقطع!");
    expect(render("ar", "videoEditor.clipsRecoveredTitle", 2)).toBe("تمت استعادة 2 مقطعين!");
    expect(render("ar", "videoEditor.clipsRecoveredTitle", 3)).toBe("تمت استعادة 3 مقاطع!");
    expect(render("ar", "videoEditor.clipsRecoveredTitle", 11)).toBe("تمت استعادة 11 مقطع!");
    expect(render("ar", "videoEditor.clipsRecoveredTitle", 100)).toBe("تمت استعادة 100 مقطع!");
    expect(render("ar", "playlist.itemsCount", 2)).toBe("2 عنصرين");
    expect(render("ar", "playlist.itemsCount", 5)).toBe("5 عناصر");
    expect(render("ar", "catalogImport.scanFound", 3)).toBe(
      "وُجد 3 قطع جديدة على يوتيوب. اختر أدناه ما يأتي إلى البيت.",
    );
  });

  it("de/fr/es/pt/it/hi spot forms", () => {
    expect(render("de", "playlist.itemsCount", 1)).toBe("1 Eintrag");
    expect(render("de", "playlist.itemsCount", 2)).toBe("2 Einträge");
    expect(render("fr", "liveGuests.toastRevokeEnded", 1)).toBe(
      "Le lien est mort et 1 pass invité s'est terminé avec lui.",
    );
    expect(render("fr", "liveGuests.toastRevokeEnded", 2)).toBe(
      "Le lien est mort et 2 pass invités se sont terminés avec lui.",
    );
    expect(render("es", "videoEditor.clipsSyncedTitle", 1)).toBe("¡1 clip sincronizado!");
    expect(render("es", "videoEditor.clipsSyncedTitle", 2)).toBe("¡2 clips sincronizados!");
    expect(render("pt", "playlist.itemsCount", 2)).toBe("2 itens");
    expect(render("it", "videoEditor.tipEffectsSelected", 1)).toBe(
      "1 effetto selezionato. Controlla la scheda Effetti per vedere l'anteprima CSS live.",
    );
    expect(render("it", "videoEditor.tipEffectsSelected", 2)).toBe(
      "2 effetti selezionati. Controlla la scheda Effetti per vedere l'anteprima CSS live.",
    );
    expect(render("hi", "videoEditor.clipsSyncedTitle", 1)).toBe("1 क्लिप सिंक हो गया!");
    expect(render("hi", "videoEditor.clipsSyncedTitle", 2)).toBe("2 क्लिप सिंक हो गए!");
  });
});
