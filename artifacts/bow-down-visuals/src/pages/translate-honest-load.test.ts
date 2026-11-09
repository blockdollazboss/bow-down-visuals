/**
 * Translate (video dubbing) voice picker — honest load states
 * (Stack 400 C-28: the honest-load pin layer completing the
 * "empty lie" audit).
 *
 * The voices load already carries the honest machine — its catch
 * comment names the family ("Empty-lie fix: a failed load is NOT
 * 'no voices available'"). loadVoices() throws on a non-ok answer,
 * the catch raises voicesFailed while keeping whatever is loaded,
 * and the picker reaches "no voices" only after the loading and
 * failed branches; with voices on screen a failed reload shows its
 * own inline error line instead of going silent. Both error
 * surfaces retry by bumping the nonce that re-runs the real load.
 * What was missing is the PIN; this file pins the shape in source,
 * like the sibling honest-load pins (the FE suite runs in node,
 * no DOM).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./translate.tsx");
const loadAt = page.indexOf("async function loadVoices() {");
const loader = page.slice(loadAt, page.indexOf("if (user) loadVoices();", loadAt));

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
const KEYS = ["translate.loadingVoices", "translate.voicesLoadError", "translate.voicesRetry", "translate.noVoices"];

describe("failure path — a failed voices load never reads as 'no voices available'", () => {
  it("the loader throws on a non-ok answer and raises the failed state in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error("voices load failed");');
    expect(loader).toContain("if (!cancelled) setVoicesFailed(true);");
    expect(loader).toContain("setVoicesFailed(false);");
    expect(loader).toContain("Empty-lie fix: a failed load is NOT");
  });

  it("failure with an empty picker renders the error panel with a retry that re-runs the load", () => {
    expect(page).toContain('data-testid="translate-voices-load-error"');
    expect(page).toContain("onClick={() => setVoicesNonce((n) => n + 1)}");
    expect(page).toContain("}, [user, voicesNonce]);");
  });

  it("failure with voices already loaded keeps them and shows the inline reload error", () => {
    expect(page).toContain('data-testid="translate-voices-reload-error"');
    expect(page).toContain("{voicesFailed && (");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the no-voices line renders only after the loading and failed branches", () => {
    const loadingAt = page.indexOf("{voicesLoading ? (");
    const errorAt = page.indexOf(") : voicesFailed && voices.length === 0 ? (");
    const emptyAt = page.indexOf(") : voices.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the translate voices keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of KEYS) expect(typeof cat[k] === "string" && cat[k].length > 0).toBe(true);
  });
});
