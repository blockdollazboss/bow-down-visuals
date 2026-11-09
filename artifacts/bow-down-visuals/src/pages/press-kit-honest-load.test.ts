/**
 * Press Kit (mine) — honest load states (Stack 400 C-28: the
 * honest-load pin layer completing the "empty lie" audit).
 *
 * The kits list load settles per-source (Promise.allSettled, so a
 * failed vaults leg cannot discard the kits, or vice versa): a
 * kits leg that is rejected, non-ok, or unparseable sets
 * kitsError, a successful leg records the kits and clears it. The
 * render checks the error state before the empty copy, so a failed
 * load renders the error line with a retry — the retry bumps
 * sourcesRetryNonce, which re-runs the effect performing the real
 * load — and "No press kits yet" can only render on a loaded,
 * non-error list. NOTED GAP, pinned as-is: this list has no
 * distinct loading state, so the empty copy can show briefly
 * during the first load; the failure path itself never reads as
 * empty, which is what this pin certifies.
 *
 * This file pins that shape in source, like the sibling
 * honest-load pins (the FE suite runs in node, no DOM). The kits
 * copy goes through press-kit.* keys (two with English
 * defaultValue fallbacks in the page), pinned for all 10 catalogs
 * below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./press-kit.tsx");
const loadAt = page.indexOf("if (!user) return;");
const loader = page.slice(loadAt, page.indexOf("}, [user, sourcesRetryNonce]);", loadAt));

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

describe("failure path — a failed kits load never reads as no press kits", () => {
  it("the sources settle independently and a failed kits leg records the error state", () => {
    expect(loader).toContain("await Promise.allSettled([");
    expect(loader).toContain('fetch("/api/press-kit/mine", { credentials: "include" })');
    expect(loader).toContain('if (kSettled.status === "fulfilled" && kSettled.value.ok) {');
    expect(loader).toContain("setKitsError(true);");
  });

  it("a successful kits load records the kits and clears the error state", () => {
    expect(loader).toContain("setKits(k.kits ?? []);");
    expect(loader).toContain("setKitsError(false);");
  });

  it("failure renders the error line with a retry wired to the real load via the retry nonce", () => {
    expect(page).toContain('t("press-kit.kitsLoadError", { defaultValue: "Couldn\'t load your press kits — your kits are safe, this just couldn\'t reach them." })');
    expect(page).toContain('data-testid="btn-retry-kits"');
    expect(page).toContain("onClick={() => setSourcesRetryNonce((n) => n + 1)}");
    expect(page).toContain('t("press-kit.retryLoad", { defaultValue: "Try again" })');
  });
});

describe("genuine-empty path stays distinct from failure", () => {
  it("the empty copy renders only after the error branch", () => {
    const errorAt = page.indexOf("kitsError && kits.length === 0 ? (");
    const emptyAt = page.indexOf(") : kits.length === 0 && (");
    expect(errorAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain('t("press-kit.emptyKits")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the press-kit honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["press-kit.kitsLoadError", "press-kit.retryLoad", "press-kit.emptyKits"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
