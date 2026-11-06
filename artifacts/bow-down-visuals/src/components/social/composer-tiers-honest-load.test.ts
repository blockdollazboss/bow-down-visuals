/**
 * Composer members-audience tiers — honest load states (Stack-200
 * hardening D2, census section A item 10: the "empty lie" family).
 *
 * Before: loadMyTiers()'s catch did setMyTiers([]), so a failed tiers
 * load rendered "No fan tiers yet — create one under Memberships" —
 * a creator with paid tiers lost the members-only audience selector
 * and members posts silently degraded to creator-only. After: failure
 * leaves myTiers null (unloaded) and raises a failed flag; the members
 * row renders an honest error + retry (loadMyTiers stays callable
 * because the state never left null); the "No fan tiers yet" copy
 * renders ONLY on a confirmed-empty successful load.
 *
 * The FE suite runs in node (no DOM), so — like the sibling honest-load
 * pins — these tests pin the state machine in source: which setter each
 * load outcome calls, and which render branch each state reaches. The
 * new copy keys are English in en.json; the other nine catalogs carry
 * the English verbatim as UNREVIEWED placeholders.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const composer = read("./Composer.tsx");

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
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

describe("failure path — tiers never read as none on a failed load", () => {
  it("the load catch raises the failed flag and never writes the empty array", () => {
    expect(composer).toContain("setTiersFailed(true)");
    expect(composer).not.toContain("setMyTiers([])");
  });

  it("a successful load clears the failed flag", () => {
    expect(composer).toContain("setTiersFailed(false)");
  });

  it("failure keeps myTiers null so the retry can re-run the lazy loader", () => {
    /* the loader early-returns once tiers are non-null — failure must
       leave the state null or the retry door would be welded shut */
    expect(composer).toContain("if (myTiers !== null) return;");
    const catchAt = composer.indexOf("setTiersFailed(true)");
    const loadAt = composer.indexOf("async function loadMyTiers()");
    expect(composer.indexOf("setMyTiers(", loadAt)).toBeLessThan(catchAt);
  });

  it("failure renders the error state with a retry wired to the real loader", () => {
    expect(composer).toContain('data-testid="composer-tiers-load-error"');
    expect(composer).toContain('t("composerTiers.loadError")');
    expect(composer).toContain('t("composerTiers.retry")');
    expect(composer).toContain("onClick={() => void loadMyTiers()}");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the error state renders inside the unloaded branch, before the confirmed-empty copy", () => {
    const errAt = composer.indexOf('data-testid="composer-tiers-load-error"');
    const emptyAt = composer.indexOf("No fan tiers yet");
    expect(errAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the composerTiers honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../../locales/${loc}.json`)));
    for (const k of ["composerTiers.loadError", "composerTiers.retry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
