/**
 * FinalVideoExport — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The export dialog's two loads are
 * the prepare step and the live quality estimate, and both record
 * failure as failure:
 *
 * - THE ESTIMATE is a full machine: opening/refreshing sets the
 *   loading flag and CLEARS any prior error; a non-ok response
 *   throws the server's message; the catch NULLS the estimate and
 *   records the error — so the panel can never keep showing a stale
 *   or invented figure after a failed refresh, and the error state
 *   is passed into the quality panel alongside the loading flag.
 * - THE PREPARE step records its state from the server's real
 *   verdict (`allReady` ? done : failed, with the per-clip check
 *   rows the server returned); a non-ok response throws, and the
 *   catch lands the state on "failed" with the error recorded.
 *
 * The dialog's job lifecycle, gating and failure UX carry their own
 * suites (final-video-export-*.test.ts); this pin covers the two
 * loads' honesty contract, including the catalog block for their
 * error keys. The FE suite runs in node (no DOM).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const exp = read("./FinalVideoExport.tsx");

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

describe("the quality estimate never shows a stale or invented figure", () => {
  it("a refresh sets loading and clears the prior error first", () => {
    expect(exp).toContain("setEstimateLoading(true);\n    setEstimateError(null);");
  });

  it("a non-ok estimate response throws the server's message", () => {
    expect(exp).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("videoExport.errEstimateHttp", { status: res.status })));');
  });

  it("failure nulls the estimate and records the error", () => {
    expect(exp).toContain("setEstimate(null);\n        setEstimateError(plainErrorText(err, t(\"videoExport.errEstimate\")));");
  });

  it("the loading flag and error are passed into the quality panel", () => {
    expect(exp).toContain("estimateLoading={estimateLoading}");
    expect(exp).toContain("estimateError={estimateError}");
  });
});

describe("the prepare step records the server's real verdict", () => {
  it("a non-ok prepare response throws the server's message", () => {
    expect(exp).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("videoExport.errPrepareHttp", { status: res.status })));');
  });

  it("the recorded state derives from the server's allReady verdict and its check rows", () => {
    expect(exp).toContain("setClipCheckResults(data.clips);");
    expect(exp).toContain('setPrepareState(data.allReady ? "done" : "failed");');
  });

  it("a thrown prepare lands on failed with the error recorded", () => {
    expect(exp).toContain('setPrepareState("failed");\n      setPrepareError(plainErrorText(err, t("videoExport.errPrepare")));');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the export honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["videoExport.errEstimate", "videoExport.errPrepare"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
