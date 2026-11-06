/**
 * Character Director cast grid — honest vaults load (Stack-200
 * hardening D2, census section A item 20: the "empty lie" family).
 *
 * Before: the vaults load early-returned on !res.ok and the catch was
 * "cast grid simply stays empty" — the render then showed the
 * noVaults copy telling the creator to go create a vault, even when
 * they already had vaults and the read merely failed. After: failure
 * raises vaultsError; with nothing loaded the cast section renders
 * the error + retry in place of the noVaults line, a failed reload
 * keeps the loaded grid behind an error banner, and the noVaults
 * copy renders only on a confirmed-empty successful load.
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
const director = read("./CharacterDirector.tsx");
const loadAt = director.indexOf('fetch("/api/artist-vaults"');
const loader = director.slice(director.lastIndexOf("(async () => {", loadAt), director.indexOf("return () => { cancelled = true; };", loadAt));

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

describe("failure path — a failed vaults read never reads as 'no vaults'", () => {
  it("the loader throws on a non-ok response instead of early-returning silently", () => {
    expect(loader).toContain('if (!res.ok) throw new Error("vaults load failed");');
    expect(loader).not.toContain("if (!res.ok || cancelled) return;");
    expect(director).not.toContain("cast grid simply stays empty");
  });

  it("failure records the error state; success clears it", () => {
    expect(loader).toContain("setVaultsError(true)");
    expect(loader).toContain("setVaultsError(false)");
  });

  it("failure with nothing loaded renders the error + retry in place of the noVaults line", () => {
    expect(director).toContain('data-testid="director-vaults-load-error"');
    expect(director).toContain("vaultsError && vaults.length === 0");
    expect(director).toContain("setVaultsAttempt((n) => n + 1)");
    /* the retry re-runs the load effect through the attempt dep */
    expect(director).toContain("}, [vaultsAttempt]);");
  });

  it("a failed reload keeps the loaded grid and shows the error banner over it", () => {
    expect(director).toContain('data-testid="director-vaults-reload-error"');
    expect(director).toContain('data-testid="director-cast-grid"');
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the error branch renders before the noVaults branch", () => {
    const errAt = director.indexOf('data-testid="director-vaults-load-error"');
    const emptyAt = director.indexOf("noVaults`)}");
    expect(errAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the characterDirector honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../../locales/${loc}.json`)));
    for (const k of ["wave9.characterDirector.vaultsLoadError", "wave9.characterDirector.vaultsRetry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
