/*
 * Stack-24 lane 1 — catalog-wide plural-category fill.
 *
 * The defect (found by Stack-23 lane 2 while fixing its 12 keys): with
 * i18next 25, a locale that is missing a CLDR plural category for a key
 * does NOT fall back to the same-language _other — it falls back to
 * ENGLISH. Arabic has six categories (zero/one/two/few/many/other), so
 * every pre-existing `_one/_other` family rendered English at Arabic
 * counts 0, 2, 3–10 and 11–99 ("2 beats" inside an Arabic page).
 *
 * Verified per language against Intl.PluralRules (what i18next 25 uses):
 *   en/de/hi: one+other — covered by _one/_other.
 *   ja/ko:    other only — covered.
 *   ar:       zero/one/two/few/many/other — was missing four categories.
 *   es/fr/pt/it: one+other+many — the SAME gap, reachable only at exact
 *             millions (Intl.PluralRules('fr').select(1000000) === 'many'),
 *             so _many (= _other text) was added for their families too.
 *
 * This test is catalog-wide and data-driven: families are enumerated from
 * en.json at runtime (a plural family = a base key carrying both _one and
 * _other; retentionDoctor.type_other is an option label, not a plural),
 * and every locale that carries a family must carry a variant for every
 * CLDR category that locale can actually select.
 */
import { readFileSync } from "node:fs";
import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

const ALL = ["en", "es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"] as const;
type Locale = (typeof ALL)[number];
const CLDR = ["zero", "one", "two", "few", "many", "other"] as const;

function load(locale: string): Record<string, unknown> {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

const CATS: Record<Locale, Record<string, string>> = {} as never;
for (const l of ALL) CATS[l] = flat(load(l));

/* Plural families, derived from the source catalog: base keys with both
   _one and _other in en. */
const FAMILIES: string[] = [];
for (const k of Object.keys(CATS.en)) {
  const m = k.match(/^(.*)_one$/);
  if (m && typeof CATS.en[`${m[1]}_other`] === "string") FAMILIES.push(m[1]!);
}
FAMILIES.sort();

/* Categories a locale can actually select, probed the way i18next does. */
function reachableCategories(locale: Locale): Set<string> {
  const pr = new Intl.PluralRules(locale);
  const cats = new Set<string>();
  const probes: number[] = [];
  for (let i = 0; i <= 200; i++) probes.push(i);
  probes.push(1000, 10000, 100000, 1000000, 2000000, 0.5, 1.5, 2.5);
  for (const n of probes) cats.add(pr.select(n));
  return cats;
}
const REACHABLE: Record<Locale, Set<string>> = {} as never;
for (const l of ALL) REACHABLE[l] = reachableCategories(l);

const presentIn = (locale: Locale, fam: string): boolean =>
  typeof CATS[locale][`${fam}_one`] === "string" || typeof CATS[locale][`${fam}_other`] === "string";

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

/* One dummy bag for every placeholder the families use; the expected
   string is interpolated from the same bag, so an exact match proves the
   render came from the asserted catalog entry — no fallback anywhere. */
const BAG = { name: "سارة", cost: 7, tone: "ودود", price: 9 } as const;
const interpolate = (tpl: string, count: number): string =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
    name === "count" ? String(count) : String(BAG[name as keyof typeof BAG] ?? ""),
  );
const render = (lng: Locale, key: string, count: number): string =>
  i18n.t(key, { count, lng, ...BAG }) as string;

describe("plural family enumeration", () => {
  it("finds the catalog's plural families in en (23 at this base)", () => {
    expect(FAMILIES.length).toBe(23);
    expect(FAMILIES).toContain("beats.beatCount");
    expect(FAMILIES).not.toContain("retentionDoctor.type");
  });

  it("per-language reachable categories match the CLDR facts this lane rests on", () => {
    expect([...REACHABLE.ar].sort()).toEqual(["few", "many", "one", "other", "two", "zero"]);
    for (const l of ["es", "fr", "pt", "it"] as const) {
      expect(REACHABLE[l].has("many"), `${l} should reach many at millions`).toBe(true);
      expect(new Intl.PluralRules(l).select(1000000)).toBe("many");
    }
    for (const l of ["en", "de", "hi"] as const) {
      expect([...REACHABLE[l]].sort()).toEqual(["one", "other"]);
    }
    expect([...REACHABLE.ja]).toEqual(["other"]);
    expect([...REACHABLE.ko]).toEqual(["other"]);
  });
});

describe("every locale carries every category it can select", () => {
  it.each(ALL)("%s: all present families cover all reachable categories", (locale) => {
    const missing: string[] = [];
    for (const fam of FAMILIES) {
      if (!presentIn(locale, fam)) continue;
      for (const cat of REACHABLE[locale]) {
        const v = CATS[locale][`${fam}_${cat}`];
        if (typeof v !== "string" || v.length === 0) missing.push(`${fam}_${cat}`);
      }
    }
    expect(missing, `${locale} missing category variants`).toEqual([]);
  });
});

describe("arabic renders — catalog-wide, no English fallback", () => {
  const AR_COUNTS: Array<[number, (typeof CLDR)[number]]> = [
    [0, "zero"],
    [1, "one"],
    [2, "two"],
    [3, "few"],
    [5, "few"],
    [11, "many"],
    [100, "other"],
  ];

  it("ar carries all 20 families present at this base, each in all six forms", () => {
    const arFams = FAMILIES.filter((f) => presentIn("ar", f));
    expect(arFams.length).toBe(20);
    for (const fam of arFams) {
      for (const sfx of CLDR) {
        expect(typeof CATS.ar[`${fam}_${sfx}`], `ar missing ${fam}_${sfx}`).toBe("string");
      }
    }
  });

  it("every ar family renders its own category string at 0/1/2/3/5/11/100", () => {
    for (const fam of FAMILIES) {
      if (!presentIn("ar", fam)) continue;
      for (const [count, cat] of AR_COUNTS) {
        const expected = interpolate(CATS.ar[`${fam}_${cat}`]!, count);
        const out = render("ar", fam, count);
        expect(out, `ar ${fam} @${count} (${cat})`).toBe(expected);
        expect(out.includes("{{"), `ar ${fam} @${count} left an interpolation`).toBe(false);
      }
    }
  });

  it("arabic grammar spot pins: dual at 2, plural noun at 3-10, singular at 11/100", () => {
    expect(render("ar", "beats.beatCount", 2)).toBe("2 لحنين");
    expect(render("ar", "beats.beatCount", 5)).toBe("5 ألحان");
    expect(render("ar", "beats.beatCount", 11)).toBe("11 لحن");
    expect(render("ar", "beats.beatCount", 100)).toBe("100 لحن");
    expect(render("ar", "chooseArtist.hiddenCount", 2)).toBe("+2 فنانان آخران — عرض أفضل 10 لديك");
    expect(render("ar", "clipMaker.cutClips", 2)).toBe("قص 2 مقطعين · 7 نقاط");
    expect(render("ar", "clipMaker.highlightsFound", 2)).toBe("تم العثور على 2 لحظتين مميزتين");
    expect(render("ar", "lyricVideo.unmatchedLines", 2)).toBe(
      "تعذّرت مطابقة 2 سطرين بثقة — تحقق من توقيتهما أدناه.",
    );
    expect(render("ar", "lyricVideo.unmatchedLines", 100)).toBe(
      "تعذّرت مطابقة 100 سطر بثقة — تحقق من توقيته أدناه.",
    );
    expect(render("ar", "hub.trayAssetCount", 3)).toBe("· 3 أصول");
    expect(render("ar", "commentReplies.draftReplies", 11)).toBe("صياغة 11 رد · 7 Visual Bucs");
    /* Families whose ar strings were still English text — now Arabic. */
    expect(render("ar", "promo-clip.clips.count", 2)).toBe("2 مقطعين");
    expect(render("ar", "podcast.script.wordsCount", 5)).toBe("5 كلمات");
    expect(render("ar", "pricing.wantedMeter.starOption", 2)).toBe("2 نجمتين — سارة $9/month");
  });
});

describe("es/fr/pt/it millions render in-language (_many filled)", () => {
  it.each(["es", "fr", "pt", "it"] as const)(
    "%s renders its own _many string at exact millions",
    (locale) => {
      for (const fam of FAMILIES) {
        if (!presentIn(locale, fam)) continue;
        for (const count of [1000000, 2000000]) {
          const expected = interpolate(CATS[locale][`${fam}_many`]!, count);
          expect(render(locale, fam, count), `${locale} ${fam} @${count}`).toBe(expected);
        }
      }
    },
  );
});
