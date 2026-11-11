/**
 * JewelryStudio — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 3).
 *
 * FIXED in this lane — the catalog load lied by omission:
 * - The catalog (GET /api/jewelry/status) feeds the ENTIRE design
 *   step (pieces / metals / stones / styles / apparel / deco grids)
 *   and every price line (preview / STL / consult). Its load never
 *   checked res.ok and swallowed every failure (`.catch(() => {})`),
 *   so on any failure the studio silently stood on the hardcoded
 *   fallback prices (2 / 4 / 1 VB) with default options — a failed
 *   load dressed up as a working studio, the design step a blank
 *   (the grids are gated on `catalog &&` with no loading or failure
 *   state at all).
 * - Now: the loader throws on non-ok AND on a catalog-less body
 *   into catalogFailed; a failure banner names the state and
 *   retries the real load (catalogTick); the design step renders a
 *   loading card while the catalog is in flight instead of nothing.
 * - The hub-logo pick had the same silence: a failed (or non-ok)
 *   fetch of a hub-made logo was swallowed with no signal, reading
 *   as a dead button. It now checks res.ok and surfaces the error
 *   banner line (jewelry.hubLogoFailed).
 *
 * PINNED AS-IS — the paid writes already checked their answers:
 * preview / STL throw the server's message on non-ok with the 402
 * separated into the OutOfCredits surface; the estimate throws on
 * non-ok; the consultant surfaces the house fallback REPLY as a
 * reply (a labeled stand-in, not a fake success claim).
 *
 * The new keys are English in en.json; the other nine catalogs
 * carry the English verbatim as UNREVIEWED placeholders (locale
 * honesty rule).
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const studio = read("./JewelryStudio.tsx");
const loader = studio.slice(studio.indexOf("/* Load public catalog + guide once. */"), studio.indexOf("useEffect(() => {\n    consultEndRef"));

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
const catalogs = Object.fromEntries(
  LOCALES.map((l) => [l, flat(JSON.parse(read(`../../locales/${l}.json`)))]),
) as Record<(typeof LOCALES)[number], Record<string, string>>;

describe("catalog load (FIXED): failure is a named state with a retry, never silent defaults", () => {
  it("the loader throws on non-ok and on a catalog-less body; success clears the flag", () => {
    expect(loader).toContain('const res = await fetch("/api/jewelry/status");');
    expect(loader).toContain('if (!res.ok) throw new Error("catalog load failed");');
    expect(loader).toContain('if (!d || typeof d !== "object" || !d.pieces) throw new Error("catalog load failed");');
    expect(loader).toContain("setCatalogFailed(false);");
    expect(loader).toContain("if (!cancelled) setCatalogFailed(true);");
    expect(loader).not.toContain('.catch(() => {});\n    fetch("/api/jewelry/guide")');
  });

  it("the failure banner names the state and retries the real load", () => {
    expect(studio).toContain("{catalogFailed && (");
    expect(studio).toContain('data-testid="jewelry-catalog-failed"');
    expect(studio).toContain('t("jewelry.catalogLoadFailed")');
    expect(studio).toContain("onClick={() => setCatalogTick((n) => n + 1)}");
    expect(studio).toContain('t("jewelry.catalogRetry")');
  });

  it("the design step shows a loading card while the catalog is in flight", () => {
    expect(studio).toContain("{step === 1 && !catalog && (");
    expect(studio).toContain('t("jewelry.catalogLoading")');
    expect(studio.indexOf("{step === 1 && !catalog && (")).toBeLessThan(studio.indexOf("{step === 1 && catalog && ("));
  });
});

describe("hub logo pick (FIXED): a failed fetch says so", () => {
  it("the pick checks res.ok and surfaces the error banner copy", () => {
    const pick = studio.slice(studio.indexOf("const res = await fetch(l.url);"), studio.indexOf('className="h-16 w-16 overflow-hidden'));
    expect(pick).toContain('if (!res.ok) throw new Error("logo fetch failed");');
    expect(pick).toContain('setError(t("jewelry.hubLogoFailed"));');
    expect(pick).not.toContain("catch { /* fetch failed — user can upload manually */ }");
  });
});

describe("the paid writes already checked their answers — unchanged", () => {
  it("preview + STL: 402 separates; non-ok throws the server's message", () => {
    expect(studio).toContain("if (res.status === 402) { handleOutOfCredits(); return; }");
    expect(studio).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("jewelry.previewFailed")));');
    expect(studio).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("jewelry.stlFailed")));');
    expect(studio).toContain("setPreviewUrl(data.url);");
    expect(studio.indexOf('if (!res.ok) throw new Error(apiErrorMessage(data, t("jewelry.previewFailed")))')).toBeLessThan(studio.indexOf("setPreviewUrl(data.url);"));
  });

  it("estimate throws on non-ok; the consultant's fallback is a labeled reply, not a claim", () => {
    const est = studio.slice(studio.indexOf("async function loadEstimate()"), studio.indexOf("useEffect(() => {\n    if (step === 4"));
    expect(est).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("jewelry.estimateFailed")));');
    expect(studio).toContain('setConsultMsgs((m) => [...m, { role: "assistant", content: t("jewelry.consultFallback") }]);');
  });
});

describe("catalog: the new copy resolves in all 10 locales", () => {
  it("the five new jewelry keys are present and non-empty everywhere", () => {
    for (const l of LOCALES) {
      for (const k of ["catalogLoadFailed", "catalogRetry", "catalogLoading", "catalogLoadingNote", "hubLogoFailed"]) {
        expect(catalogs[l][`jewelry.${k}`], `${l} jewelry.${k}`).toBeTruthy();
      }
    }
    expect(catalogs.en["jewelry.catalogRetry"]).toBe("Try again");
  });
});
