/**
 * Locale fill pins — Stack 100 unit 54 ([D21], catalog translation
 * fill for already-wired keys). NO code wiring: this unit only fills
 * catalog values for keys the product already renders (or, for the
 * outOfCredits four, keys the stack1600 core's false-Bucs gate added
 * in en and English-filled in the other nine).
 *
 * The nine keys:
 *  - outOfCredits.checkingBalance / balanceErrorTitle /
 *    balanceErrorBody / retryBtn — the false-Bucs gate's honest
 *    balance states. en carries the gate lane's exact source text;
 *    the nine translations are THIS unit's drafts.
 *  - discord-bot.notSetUp / setupStateNote / installNeedsClientId /
 *    wiringLockedNote — the Discord desk's locked-state copy. Absent
 *    from EVERY catalog at this unit's base (en included); the en
 *    source text and the nine translations are adopted byte-for-byte
 *    from the stack1600 core join tree's seam repair, so the phase-2
 *    join meets identical strings, not a second draft.
 *  - team.createTeamHint — the earned-rank hint. Base carried the
 *    stale "Included with Shot Caller" copy (and stale translations
 *    of it); en + all nine now carry the core join tree's corrected
 *    earned-rank text byte-for-byte (★4 = 300 points, never a plan
 *    you can buy — the ★4 and 300 tokens survive in every catalog).
 *
 * Money-law calls (per key, made by this unit):
 *  - team.createTeamHint is money-class (it states the rank price in
 *    points): NOT re-drafted — the core's certified strings were
 *    adopted verbatim, ★4/300 tokens byte-identical everywhere.
 *  - outOfCredits.balanceErrorBody states a charge FACT ("nothing
 *    was charged") but no charge, fee, payout, or amount — no figure
 *    exists in it to carry verbatim; classed with this namespace's
 *    already-translated sibling lines (body / errAdd) and translated.
 *  - The remaining seven keys state no charge, fee, payout, or
 *    amount (installNeedsClientId carries an env-var name and the
 *    digit tokens 1 and 4, preserved exactly) — translated/adopted.
 *
 * TRANSLATION STATUS: the adopted strings are the core join tree's
 * own. This unit's four outOfCredits translations are AGENT-DRAFTED
 * and UNREVIEWED (standing stack600 practice).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readJson = (rel: string) =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const NON_EN = LOCALES.filter((l) => l !== "en");
const CATS: Record<string, Record<string, any>> = {};
for (const loc of LOCALES) CATS[loc] = readJson(`../locales/${loc}.json`);

const get = (loc: string, dotted: string) =>
  dotted.split(".").reduce<any>((o, k) => (o == null ? o : o[k]), CATS[loc]);

const OC_KEYS = [
  "outOfCredits.checkingBalance",
  "outOfCredits.balanceErrorTitle",
  "outOfCredits.balanceErrorBody",
  "outOfCredits.retryBtn",
];
const DISCORD_KEYS = [
  "discord-bot.notSetUp",
  "discord-bot.setupStateNote",
  "discord-bot.installNeedsClientId",
  "discord-bot.wiringLockedNote",
];
const ALL_KEYS = [...OC_KEYS, ...DISCORD_KEYS, "team.createTeamHint"];

/* The en source text, pinned literally: for the eight added keys this
   is the stack1600 core's text (the gate lane's / seam repair's own
   words); for the hint it is the core's corrected earned-rank copy.
   If en ever drifts, the fill's provenance breaks — fail here. */
const EN_SOURCE: Record<string, string> = {
  "outOfCredits.checkingBalance": "Checking your balance…",
  "outOfCredits.balanceErrorTitle": "We couldn't check your balance",
  "outOfCredits.balanceErrorBody":
    "Your balance didn't come through, so we can't tell whether you have enough Visual Bucs for this. Try again — nothing was charged.",
  "outOfCredits.retryBtn": "Try again",
  "discord-bot.notSetUp": "not set up",
  "discord-bot.setupStateNote":
    "Not connected yet — nothing is broken. This is a setup state: once the server keys from the checklist below are in place, Install and the wiring form switch on.",
  "discord-bot.installNeedsClientId":
    "Install is off until DISCORD_CLIENT_ID is set on the server — see steps 1 and 4 in the checklist below.",
  "discord-bot.wiringLockedNote":
    "Locked for now: these settings would save, but the bot can't announce anything until it's connected. They switch on once the server keys are in place.",
  "team.createTeamHint":
    "Unlocks at Shot Caller (★4) — an earned Creator Rank, never a plan you can buy: rank points come from publishing work, sales and growing your audience (300 points for ★4). Pool your Visual Bucs, share artist vaults, and create together.",
};

const tokens = (s: string) => s.match(/\{\{[^}]+\}\}/g) ?? [];
const digits = (s: string) => (s.match(/\d+/g) ?? []).sort();

describe("locale fill (unit 54) — en source text is the pinned provenance text", () => {
  it("en carries the exact source string for all nine keys", () => {
    for (const k of ALL_KEYS) expect(get("en", k), k).toBe(EN_SOURCE[k]);
  });
});

describe("locale fill (unit 54) — all nine keys filled in all nine catalogs", () => {
  it.each(NON_EN)("%s carries a real, non-fallback value for every key", (loc) => {
    for (const k of ALL_KEYS) {
      const v = get(loc, k);
      expect(typeof v, `${loc} ${k}`).toBe("string");
      expect((v as string).trim().length, `${loc} ${k}`).toBeGreaterThan(0);
      expect(v, `${loc} ${k} must not be the en fallback`).not.toBe(EN_SOURCE[k]);
    }
  });

  it.each(LOCALES)("%s preserves placeholder tokens and digit multiset vs en", (loc) => {
    for (const k of ALL_KEYS) {
      const v = get(loc, k) as string;
      expect(tokens(v), `${loc} ${k}`).toEqual(tokens(EN_SOURCE[k]));
      expect(digits(v), `${loc} ${k}`).toEqual(digits(EN_SOURCE[k]));
    }
  });

  it("the earned-rank tokens survive byte-for-byte in every catalog", () => {
    for (const loc of LOCALES) {
      const hint = get(loc, "team.createTeamHint") as string;
      expect(hint, loc).toContain("★4");
      expect(hint, loc).toContain("300");
      expect(hint, loc).toContain("Shot Caller");
      const inst = get(loc, "discord-bot.installNeedsClientId") as string;
      expect(inst, loc).toContain("DISCORD_CLIENT_ID");
    }
  });

  it("the stale 'Included with Shot Caller' hint copy is gone everywhere", () => {
    for (const loc of LOCALES) {
      const hint = get(loc, "team.createTeamHint") as string;
      expect(hint.startsWith("Included"), loc).toBe(false);
      expect(hint, loc).not.toContain("$199");
    }
  });
});
