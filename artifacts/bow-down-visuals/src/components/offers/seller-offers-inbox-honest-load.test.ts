/**
 * SellerOffersInbox — honest load states (Stack-200 hardening D1,
 * census section A item 1: the "empty lie" family).
 *
 * Before: reload()'s catch did setOffers([]) and the render collapsed
 * failure, loading and genuinely-no-offers into the same `return null`
 * — the whole inbox section vanished, taking real money offers with
 * it. After: failure raises a visible error card with retry and never
 * writes the empty array; a failed reload keeps offers already on
 * screen behind an error banner; the section renders nothing ONLY on
 * a confirmed-empty successful load.
 *
 * The FE suite runs in node (no DOM), so — like the sibling wiring
 * pins — these tests pin the state machine in source: which setter
 * each load outcome calls, and which render branch each state reaches.
 * The new copy keys are English in en.json; the other nine catalogs
 * carry the English verbatim as UNREVIEWED placeholders.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const inbox = read("./SellerOffersInbox.tsx");

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

describe("failure path — the inbox never vanishes on a failed load", () => {
  it("the load catch raises the failed flag and never writes the empty array", () => {
    expect(inbox).toContain("setLoadFailed(true)");
    /* setOffers([]) survives exactly once: the signed-out early return.
       The failure path must not fabricate an empty inbox. */
    expect(inbox.match(/setOffers\(\[\]\)/g)).toHaveLength(1);
    expect(inbox).toContain("if (!user) { setOffers([]); return; }");
  });

  it("a successful load clears the failed flag", () => {
    expect(inbox).toContain("setLoadFailed(false)");
  });

  it("failure with nothing on screen renders the error card with a retry", () => {
    expect(inbox).toContain('data-testid="seller-offers-load-error"');
    expect(inbox).toContain('t("offersInbox.loadError")');
    /* the retry is wired to the real reload, in both error branches */
    expect(inbox.match(/onClick=\{\(\) => void reload\(\)\}/g)).toHaveLength(2);
  });

  it("a failed reload keeps the loaded offers and shows the error banner over them", () => {
    expect(inbox).toContain('data-testid="seller-offers-reload-error"');
    expect(inbox).toContain("{loadFailed && (");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the first load renders a pending state, not nothing", () => {
    expect(inbox).toContain('data-testid="seller-offers-loading"');
    expect(inbox).toContain('t("offersInbox.loading")');
  });

  it("the section renders nothing only for a confirmed-empty successful load", () => {
    expect(inbox).toContain("if (offers.length === 0) return null;");
    /* the empty return sits AFTER the failure and loading branches */
    const errAt = inbox.indexOf('data-testid="seller-offers-load-error"');
    const loadAt = inbox.indexOf('data-testid="seller-offers-loading"');
    const emptyAt = inbox.indexOf("if (offers.length === 0) return null;");
    expect(errAt).toBeGreaterThan(-1);
    expect(loadAt).toBeGreaterThan(errAt);
    expect(emptyAt).toBeGreaterThan(loadAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the offersInbox honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../../locales/${loc}.json`)));
    for (const k of ["offersInbox.loading", "offersInbox.loadError", "offersInbox.retry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
