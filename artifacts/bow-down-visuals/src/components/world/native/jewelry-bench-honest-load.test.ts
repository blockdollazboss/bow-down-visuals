/**
 * JewelryBench — honest load standard (deep-pins tranche 3, batch 3).
 * The Logo-to-Luxury Studio's in-World bench — the twin of the
 * JewelryStudio page component fixed in tranche 3 batch 1.
 *
 * The catalog load is the bench's whole foundation (every option
 * grid and every price rides it) and it is honest here by design:
 * the loader throws on non-ok AND on a parse miss into catalogState
 * "failed", and the render gates EVERYTHING behind the three-state
 * machine — loading card, then error card with a retry wired to the
 * real reload (catalogTick), then the bench. No fallback prices or
 * default options ever stand in for a failed catalog.
 *
 * The guide read is a DOCUMENTED bonus (its catch comment: "guide is
 * a bonus read — the bench works without it") — pinned as the
 * documented exception; a failed guide simply means no guide
 * sections, which is also its genuine empty state.
 *
 * The hub-logo pick checks res.ok before reading the blob (fixed in
 * this tranche alongside the studio twin — the bench already had
 * the honest structure; this pin locks it). Paid writes pin as-is:
 * preview / STL / consult all ride confirmedFetch with the
 * CATALOG's own prices, treat 402 as its own named outcome, throw on
 * non-ok, and only write success state from a parsed answer — the
 * consult's labeled stand-in reply (jewelryConsultFallback) renders
 * as an assistant message, never as a fake designer answer. The
 * free estimate throws on non-ok AND on a parse miss before
 * setEstimate.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./JewelryBench.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("catalog load — the foundation fails honestly, with a wired retry", () => {
  it("the loader throws on non-ok and on a parse miss into the failed state", () => {
    const loader = slice(src, 'const [catalogTick, setCatalogTick] = useState(0);', "}, [catalogTick]);");
    expect(loader).toContain('setCatalogState("loading")');
    expect(loader).toContain('if (!res.ok) throw new Error("status");');
    expect(loader).toContain("const parsed = parseJewelryCatalog((await res.json()) as unknown);");
    expect(loader).toContain('if (!parsed) throw new Error("catalog");');
    expect(loader.indexOf('setCatalogState("ready")')).toBeGreaterThan(loader.indexOf('if (!parsed) throw'));
    expect(loader).toContain('setCatalogState("failed")');
  });

  it("render gates the whole bench: loading card → error card → bench", () => {
    const renderAt = src.indexOf("{catalogState === \"loading\" ? (");
    const failedAt = src.indexOf('catalogState === "failed" || !catalog', renderAt);
    const benchAt = src.indexOf('data-testid="world-jewelry-error"', renderAt);
    expect(renderAt).toBeGreaterThan(-1);
    expect(failedAt).toBeGreaterThan(renderAt);
    expect(benchAt).toBeGreaterThan(failedAt);
    const errBlock = src.slice(failedAt, src.indexOf(") : (", failedAt));
    expect(errBlock).toContain('t("worldCommerceStands.jewelryFailed")');
    expect(errBlock).toContain("onRetry={() => setCatalogTick((n) => n + 1)}");
  });

  it("the guide read is the documented bonus exception", () => {
    const guide = slice(src, "const [catalogTick, setCatalogTick] = useState(0);", "if (isGuest) {");
    expect(guide).toContain("if (!res.ok) return;");
    expect(guide).toContain("/* guide is a bonus read — the bench works without it */");
  });

  it("guests fire no loads — the guest card returns before the loaders' effects matter", () => {
    expect(src).toContain("if (isGuest) {");
    expect(src).toContain('t("worldCommerceStands.jewelryGuestBefore")');
  });
});

describe("writes — the catalog's own prices, checked before success", () => {
  it("hub-logo pick: a failed fetch surfaces the error instead of reading as a dead button", () => {
    const body = slice(src, "const pickHubLogo = async (url: string) => {", "const buildForm =");
    expect(body).toContain("const res = await fetch(url);");
    expect(body).toContain("if (!res.ok) throw new Error(\"logo\");");
    expect(body).toContain('setError(t("worldCommerceStands.jewelryLogoFetchFailed"))');
  });

  it("preview: decline runs nothing, 402 is named, non-ok and a missing url are errors", () => {
    const body = slice(src, "const generatePreview = async () => {", "const exportStl =");
    expect(body).toContain("overrideCost: catalog.previewCreditCost");
    expect(body).toContain("if (!res) return; /* declined the confirm — nothing charged */");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain("const url = parseJewelryDesignUrl(data);");
    expect(body).toContain("if (!url) {");
    expect(body.indexOf("setPreviewUrl(url)")).toBeGreaterThan(body.indexOf("if (!url) {"));
  });

  it("STL export mirrors the preview's honesty", () => {
    const body = slice(src, "const exportStl = async () => {", "const loadEstimate =");
    expect(body).toContain("overrideCost: catalog.stlCreditCost");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("const info = parseJewelryStl(data);");
    expect(body).toContain("if (!info) {");
    expect(body.indexOf("setStlInfo(info)")).toBeGreaterThan(body.indexOf("if (!info) {"));
  });

  it("the free estimate throws on non-ok and on a parse miss before setEstimate", () => {
    const body = slice(src, "const loadEstimate = async () => {", "const sendConsult =");
    expect(body).toContain('if (!res.ok) throw new Error("estimate");');
    expect(body).toContain("const parsed = parseJewelryEstimate(data);");
    expect(body).toContain('if (!parsed) throw new Error("estimate");');
    expect(body.indexOf("setEstimate(parsed)")).toBeGreaterThan(body.indexOf("if (!parsed) throw"));
    expect(body).toContain('setError(t("worldCommerceStands.jewelryEstimateFailed"))');
  });

  it("consult: decline restores the draft, 402 is a named message, a parse miss is the labeled stand-in", () => {
    const body = slice(src, "const sendConsult = async () => {", "const handToShop =");
    expect(body).toContain("overrideCost: catalog.consultCreditCost");
    expect(body).toContain("setConsultMsgs((m) => m.slice(0, -1));");
    expect(body).toContain("setConsultInput(msg);");
    expect(body).toContain('t("worldCommerceStands.jewelryConsultOutOfBucs")');
    expect(body).toContain("if (!res.ok) throw new Error(\"consult\");");
    expect(body).toContain('reply ?? t("worldCommerceStands.jewelryConsultFallback")');
  });
});
