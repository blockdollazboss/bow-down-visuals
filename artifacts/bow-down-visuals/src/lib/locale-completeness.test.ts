/**
 * locale-completeness.test.ts — Stack-900 Lane L3 (locale completeness).
 *
 * The census behind this file (git ls-files + key-diff over the 10
 * catalogs + a render probe on a real i18next instance) found the
 * catalogs structurally near-complete — waves, numeric parity and the
 * dead-key ratchet had closed almost everything. What remained:
 *
 *  1. photoShoot scene packs were wired to keys that exist in NO
 *     catalog (photoShoot.packs.*) while the translated strings sat
 *     dead under photoShoot.scenePacks.packs.* — fixed by rewiring;
 *     pinned below so the pointers can never drift again.
 *  2. communityGrants.* (47 keys) existed only in en — the live page
 *     silently fell back to English in 9 languages. The namespace is
 *     now present in every catalog under a strict honesty split:
 *       - title / byCreator carry each catalog's OWN approved
 *         translation of the identical English string (reused from
 *         nav.communityGrants / tutorials.byCreator);
 *       - PLACEHOLDER_KEYS carry the English text explicitly — the
 *         exact strings the i18next en-fallback already rendered,
 *         now visible in the catalog. They are UNREVIEWED
 *         placeholders pending real translation, NOT translations.
 *         When a real translation lands for a key, delete it from
 *         PLACEHOLDER_KEYS in the same commit (the list only shrinks).
 *       - OWNER_DECISION_KEYS (money + error copy) are deliberately
 *         ABSENT from the non-en catalogs: the locale honesty law
 *         forbids drafting money/error translations, so they wait
 *         for owner-approved translations. When one lands, remove
 *         the key from OWNER_DECISION_KEYS in the same commit.
 *  3. balance.* (16 keys — the permanent/temporary Visual Bucs
 *     breakdown) is likewise en-only money copy, pinned absent
 *     under the same owner-decision contract.
 *  4. The raw-key guard: a complete literal t("…") call with no
 *     defaultValue must resolve in en — otherwise users see the raw
 *     key. (Calls WITH a defaultValue are the house English-first
 *     pattern and are out of this guard's scope by design; template
 *     compositions are fragments, not complete keys.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("../", import.meta.url).pathname;
const LOCALES = ["en", "es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"] as const;
const NON_EN = LOCALES.filter((l) => l !== "en");

type Flat = Map<string, unknown>;
function flatten(obj: Record<string, unknown>, prefix = "", out: Flat = new Map()): Flat {
  for (const [k, v] of Object.entries(obj)) {
    const q = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v as Record<string, unknown>, q, out);
    else out.set(q, v);
  }
  return out;
}
function load(locale: string): Flat {
  return flatten(JSON.parse(readFileSync(join(SRC, "locales", `${locale}.json`), "utf8")));
}
const CATS: Record<string, Flat> = {};
for (const l of LOCALES) CATS[l] = load(l);
const EN = CATS.en!;

/* ------------------------------------------------------------------ */
/* 1. photoShoot scene-pack wiring                                     */
/* ------------------------------------------------------------------ */

describe("photoShoot scene packs point at keys that exist in every catalog", () => {
  const dataSrc = readFileSync(join(SRC, "components/photo/photo-shoot-scenes.ts"), "utf8");
  const nameKeys = [...dataSrc.matchAll(/nameKey:\s*"([^"]+)"/g)].map((m) => m[1]!);
  const blurbKeys = [...dataSrc.matchAll(/blurbKey:\s*"([^"]+)"/g)].map((m) => m[1]!);

  it("the data file declares 5 packs, each with a name and blurb key", () => {
    expect(nameKeys).toHaveLength(5);
    expect(blurbKeys).toHaveLength(5);
  });

  it("no key points at the retired photoShoot.packs.* path", () => {
    for (const k of [...nameKeys, ...blurbKeys]) expect(k.startsWith("photoShoot.packs.")).toBe(false);
  });

  it("every pack key resolves to a non-empty string in all 10 catalogs", () => {
    for (const k of [...nameKeys, ...blurbKeys]) {
      for (const l of LOCALES) {
        const v = CATS[l]!.get(k);
        expect(typeof v === "string" && (v as string).trim() !== "", `${l}: ${k}`).toBe(true);
      }
    }
  });

  it("the modal renders the section header from the catalog, not a literal", () => {
    const modal = readFileSync(join(SRC, "components/GenerateArtistImageModal.tsx"), "utf8");
    expect(modal).toContain('t("photoShoot.scenePacks.title")');
  });
});

/* ------------------------------------------------------------------ */
/* 2 + 3. communityGrants / balance honesty split                      */
/* ------------------------------------------------------------------ */

const CG_PLACEHOLDER_KEYS = [
  "subtitle", "loading", "noRoundTitle", "noRoundBody", "submissionsWindow",
  "votingWindow", "candidatesTitle", "totalVotes", "votesLabel", "noCandidates",
  "vote", "changeVote", "yourVote", "withdrawVote", "signInToVote",
  "voteRecorded", "voteWithdrawn", "submitTitle", "alreadySubmitted",
  "signInToSubmit", "projectTitleLabel", "projectTitlePlaceholder",
  "projectDescLabel", "projectDescPlaceholder", "submitButton",
  "projectSubmitted", "fundedProject", "fundedBadge", "tieTitle",
  "reportBackTitle", "reportOwed", "reportBackLabel", "reportBackPlaceholder",
  "reportBackSubmit", "reportPosted", "pastTitle",
] as const;

const CG_OWNER_DECISION_KEYS = [
  // money copy — amounts, pool, payment facts
  "fundedLine", "poolCaption", "vbOnlyLine", "noCandidatesResult", "tieBody",
  // error copy
  "loadError", "submitError", "voteError", "projectRequired",
] as const;

const BALANCE_OWNER_DECISION_KEYS = [
  "permanent_label", "temporary_label", "permanent_amount", "temporary_amount",
  "temporary_expires_day", "temporary_expires_days", "temporary_expires_today",
  "temporary_more_grant", "temporary_more_grants", "temporary_no_expiry",
  "temporary_spent_first", "includes_temporary_day", "includes_temporary_days",
  "includes_temporary_today", "includes_temporary_no_expiry", "breakdown_summary",
] as const;

describe("communityGrants — every en key is classified, and the split holds in all 9 catalogs", () => {
  it("the classification covers en's communityGrants exactly (a new en key must be classified here)", () => {
    const enKeys = [...EN.keys()].filter((k) => k.startsWith("communityGrants.")).map((k) => k.slice("communityGrants.".length)).sort();
    const classified = ["title", "byCreator", ...CG_PLACEHOLDER_KEYS, ...CG_OWNER_DECISION_KEYS].sort();
    expect(enKeys).toEqual(classified);
  });

  it("placeholder keys are present in every catalog, carrying the English text until translated", () => {
    for (const l of NON_EN) {
      for (const k of CG_PLACEHOLDER_KEYS) {
        expect(CATS[l]!.get(`communityGrants.${k}`), `${l}: communityGrants.${k}`).toBe(EN.get(`communityGrants.${k}`));
      }
    }
  });

  it("title and byCreator reuse each catalog's own approved translation of the same English string", () => {
    for (const l of NON_EN) {
      expect(CATS[l]!.get("communityGrants.title"), l).toBe(CATS[l]!.get("nav.communityGrants"));
      expect(CATS[l]!.get("communityGrants.byCreator"), l).toBe(CATS[l]!.get("tutorials.byCreator"));
    }
  });

  it("owner-decision money/error keys stay absent until owner-approved translations land", () => {
    for (const l of NON_EN) {
      for (const k of CG_OWNER_DECISION_KEYS) {
        expect(EN.has(`communityGrants.${k}`), `en communityGrants.${k}`).toBe(true);
        expect(CATS[l]!.has(`communityGrants.${k}`), `${l}: communityGrants.${k}`).toBe(false);
      }
    }
  });
});

describe("balance — en-only money copy, pinned absent under the owner-decision contract", () => {
  it("the pin list is exactly en's balance key set", () => {
    const enKeys = [...EN.keys()].filter((k) => k.startsWith("balance.")).map((k) => k.slice("balance.".length)).sort();
    expect(enKeys).toEqual([...BALANCE_OWNER_DECISION_KEYS].sort());
  });

  it("no non-en catalog carries a balance key yet", () => {
    for (const l of NON_EN) {
      for (const k of BALANCE_OWNER_DECISION_KEYS) {
        expect(CATS[l]!.has(`balance.${k}`), `${l}: balance.${k}`).toBe(false);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* ja plural reuse                                                     */
/* ------------------------------------------------------------------ */

describe("ja promo-clip.clips.count_one reuses ja's own approved string", () => {
  it("count_one equals ja videoExport.toastClipsOne (identical English source)", () => {
    expect(EN.get("promo-clip.clips.count_one")).toBe(EN.get("videoExport.toastClipsOne"));
    expect(CATS.ja!.get("promo-clip.clips.count_one")).toBe(CATS.ja!.get("videoExport.toastClipsOne"));
  });
});

/* ------------------------------------------------------------------ */
/* 4. raw-key guard                                                    */
/* ------------------------------------------------------------------ */

function stripComments(text: string): string {
  let out = "";
  let i = 0;
  let state: "code" | "sq" | "dq" | "tpl" | "line" | "block" = "code";
  while (i < text.length) {
    const c = text[i]!, d = text[i + 1] ?? "";
    if (state === "code") {
      if (c === "/" && d === "/") { state = "line"; out += "  "; i += 2; }
      else if (c === "/" && d === "*") { state = "block"; out += "  "; i += 2; }
      else if (c === "'") { state = "sq"; out += c; i++; }
      else if (c === '"') { state = "dq"; out += c; i++; }
      else if (c === "`") { state = "tpl"; out += c; i++; }
      else { out += c; i++; }
    } else if (state === "line") {
      if (c === "\n") { state = "code"; out += c; } else out += " ";
      i++;
    } else if (state === "block") {
      if (c === "*" && d === "/") { state = "code"; out += "  "; i += 2; }
      else { out += c === "\n" ? "\n" : " "; i++; }
    } else {
      out += c;
      if (c === "\\") { out += d; i += 2; continue; }
      if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) state = "code";
      i++;
    }
  }
  return out;
}

const PLURAL_SUFFIX = /^(.*)_(zero|one|two|few|many|other)$/;
function satisfiedByEn(key: string): boolean {
  if (EN.has(key)) return true;
  const base = key.match(PLURAL_SUFFIX)?.[1];
  if (base && EN.has(base)) return true;
  for (const k of EN.keys()) {
    if (k.startsWith(key + ".")) return true; // namespace / object read
    const b = k.match(PLURAL_SUFFIX)?.[1];
    if (b === key) return true; // base of an en plural family
  }
  return false;
}

describe("raw-key guard — a no-default literal t() key must resolve in en", () => {
  it("no complete literal t()/i18n.t() reference without defaultValue is missing from en", { timeout: 120_000 }, () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (p !== join(SRC, "locales")) walk(p); }
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) files.push(p);
      }
    };
    walk(SRC);
    const violations: string[] = [];
    const callArgs = (text: string, idx: number): string => {
      let depth = 1, i = idx;
      while (i < text.length && depth > 0 && i - idx < 2000) {
        const c = text[i]!;
        if (c === "(") depth++;
        else if (c === ")") depth--;
        i++;
      }
      return text.slice(idx, i);
    };
    for (const f of files) {
      const text = stripComments(readFileSync(f, "utf8"));
      for (const m of text.matchAll(/(?<![\w.])(?:t|i18n\.t)\(\s*([`'"])((?:\\.|(?!\1)[^\\])*)\1(\s*\+|\s*[,\)])/g)) {
        const raw = m[2]!;
        if (m[1] === "`" && raw.includes("${")) continue; // composition fragment
        if (m[3]!.includes("+")) continue; // string-concat fragment
        const args = callArgs(text, m.index + m[0].length);
        if (/defaultValue\s*:/.test(args)) continue; // house English-first pattern
        if (!satisfiedByEn(raw)) violations.push(`${raw} (${f.replace(SRC, "src/")})`);
      }
    }
    expect(violations, "raw-key renders — add the en key or give the call a defaultValue").toEqual([]);
  });
});
