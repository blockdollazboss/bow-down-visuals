/**
 * Presave landing — honest load states (Stack 400 C-28: the
 * honest-load pin layer completing the "empty lie" audit).
 *
 * Spot-checked HONEST by the census; this is the pin. The single
 * release load throws on a non-ok answer or a payload with no
 * title, its catch records the error message, and the render is
 * loading → error (with a retry that bumps retryNonce, re-running
 * the effect that performs the real load) → the release itself.
 * There is no empty state to hide behind: a failed load can only
 * ever reach the error panel.
 *
 * This file pins that shape in source, like the sibling
 * honest-load pins (the FE suite runs in node, no DOM). The load
 * copy goes through presave.* keys, pinned for all 10 catalogs
 * below; the retry label is a hardcoded English literal, pinned
 * as written.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./presave.tsx");
const loadAt = page.indexOf("setError(null);");
const loader = page.slice(loadAt, page.indexOf("}, [slug, t, retryNonce]);", loadAt));

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

describe("failure path — a failed release load never reads as a missing release", () => {
  it("the loader throws on a non-ok response or a title-less payload", () => {
    expect(loader).toContain("if (!res.ok || !release?.title) {");
    expect(loader).toContain('throw new Error(apiErrorMessage(json, t("presave.errors.notFound")));');
  });

  it("the catch records the error state and loading always clears", () => {
    expect(loader).toContain('setError(plainErrorText(err, t("presave.errors.loadFailed")))');
    expect(loader).toContain("setLoading(false);");
  });

  it("a successful load records the release data", () => {
    expect(loader).toContain("setData(release);");
  });

  it("the state machine starts at loading with no error", () => {
    expect(page).toContain("const [loading, setLoading] = useState(true);");
    expect(page).toContain("const [error, setError] = useState<string | null>(null);");
  });

  it("failure renders the error panel with a retry wired to the real load via the retry nonce", () => {
    expect(page).toContain('error ?? t("presave.errors.notFound")');
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(page).toContain("Try again");
  });
});

describe("loading and success paths stay distinct from failure", () => {
  it("the error branch renders only after the loading branch, and the release only after the error branch", () => {
    const loadingAt = page.indexOf("{loading ? (");
    const errorAt = page.indexOf(") : error || !data ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(page).toContain('t("presave.loading")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the presave honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["presave.loading", "presave.errors.loadFailed", "presave.errors.notFound"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
