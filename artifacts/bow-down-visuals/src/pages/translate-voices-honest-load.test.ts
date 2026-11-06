/**
 * Translate voice picker — honest load states (Stack-200 hardening D2,
 * census section A item 9: the "empty lie" family).
 *
 * Before: loadVoices() never checked res.ok and its catch did
 * setVoices([]), so ANY failure rendered translate.noVoices ("No
 * voices available right now") — a creator with cloned vault voices
 * was told none exist and could not dub. After: the loader throws on
 * !res.ok; failure raises voicesFailed and never writes the voices
 * state; the picker renders an honest error + retry (re-running the
 * load via a nonce) when nothing is loaded, and an error banner over
 * the grid when a reload fails; noVoices renders ONLY on a
 * confirmed-empty successful load.
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
const page = read("./translate.tsx");

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

describe("failure path — voices never read as unavailable on a failed load", () => {
  it("the loader throws on a non-ok response instead of parsing an error body as an empty list", () => {
    expect(page).toContain('if (!res.ok) throw new Error("voices load failed");');
  });

  it("the load catch raises the failed flag and never writes the empty array", () => {
    expect(page).toContain("setVoicesFailed(true)");
    expect(page).not.toContain("setVoices([])");
  });

  it("a successful load clears the failed flag", () => {
    expect(page).toContain("setVoicesFailed(false)");
  });

  it("failure with nothing loaded renders the error state with a retry that re-runs the load", () => {
    expect(page).toContain('data-testid="translate-voices-load-error"');
    expect(page).toContain('t("translate.voicesLoadError")');
    expect(page).toContain('t("translate.voicesRetry")');
    /* the retry bumps the nonce the load effect depends on — both error branches */
    expect(page.match(/onClick=\{\(\) => setVoicesNonce\(\(n\) => n \+ 1\)\}/g)).toHaveLength(2);
    expect(page).toContain("}, [user, voicesNonce]);");
  });

  it("a failed reload keeps the loaded voices and shows the error banner over the grid", () => {
    expect(page).toContain('data-testid="translate-voices-reload-error"');
    expect(page).toContain("{voicesFailed && (");
  });
});

describe("genuine-empty path stays distinct from failure", () => {
  it("the noVoices copy renders only after the failure branch", () => {
    const errAt = page.indexOf('data-testid="translate-voices-load-error"');
    const emptyAt = page.indexOf('t("translate.noVoices")');
    expect(errAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the translate honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["translate.voicesLoadError", "translate.voicesRetry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
