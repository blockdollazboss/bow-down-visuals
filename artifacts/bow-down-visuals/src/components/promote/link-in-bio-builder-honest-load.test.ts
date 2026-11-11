/**
 * LinkInBioBuilder (the link-in-bio page builder) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE MAIN LOAD is a per-source settle with the hierarchy
 *   stated in the source (S27-44): the bio-pages read IS the
 *   page — its rejection or non-ok throws into the loadError
 *   state; the artist-vaults read is an auxiliary prefill
 *   source whose failure degrades on its own and can never
 *   take the page's error state down with it. The empty
 *   builder is reachable only from a proven pages response.
 * - THE ANALYTICS READ is labeled non-fatal in the source —
 *   an enhancement panel whose absence claims nothing.
 * - SAVE AND PUBLISH throw the server's message on non-ok;
 *   neither claims a saved page or a live link before the
 *   response proves it.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LinkInBioBuilder.tsx");

describe("the load settles per source: the page leg is load-bearing, the vaults leg is not", () => {
  it("a failed pages leg throws into loadError; a failed vaults leg degrades alone", () => {
    expect(src).toContain("const [pagesSettled, vaultsSettled] = await Promise.allSettled([");
    expect(src).toContain('if (vaultsSettled.status === "fulfilled" && vaultsSettled.value.ok) {');
    expect(src).toContain('throw new Error(t("linkInBio.errors.loadFailed"));');
    expect(src).toContain("setLoadError(plainErrorText(err, t(\"linkInBio.errors.loadFailed\")));");
    expect(src).toContain("setPages(list);");
  });

  it("the analytics read is a labeled non-fatal enhancement", () => {
    expect(src).toContain("if (res.ok) setAnalytics(await res.json());");
    expect(src).toContain("} catch { /* analytics is non-fatal */ }");
  });
});

describe("save and publish claim nothing before an ok response", () => {
  it("both throw the server's message on non-ok", () => {
    const saves = src.split('if (!res.ok) throw new Error(apiErrorMessage(d, t("linkInBio.errors.saveFailed")));').length - 1;
    expect(saves).toBe(2);
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(d, t("linkInBio.errors.publishFailed")));');
  });
});
