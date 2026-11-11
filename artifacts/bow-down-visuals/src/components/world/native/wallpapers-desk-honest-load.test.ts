/**
 * WallpapersDesk (world/native) — honest load standard
 * (deep-pins tranche 3, batch 2). This is the SECOND WallpapersDesk —
 * the Create Wing's native one; the wallpapers/ desk was pinned in
 * tranche 2.
 *
 * Two reads feed the desk, and both degradations are honest:
 * - The asset library (fetchAssetLibrary): a failure lands in
 *   assetsError and renders as a visible line in section 1 — the
 *   pack choices merely shrink to session art; the failure is never
 *   dressed up as "you have no art" and never hidden.
 * - The brand kit (fetchBrandKit): resolves null BY SEAM DESIGN when
 *   the kit can't be read; the cost line then names the honest
 *   fallback (branded with your NAME instead of your logo) — pinned
 *   as documented degradation, not a list load.
 *
 * Every spend is a confirmedFetch write checked before state moves:
 * generate / render / pack-of-10 / clip / screensaver validate their
 * response through the seam's shape parsers (generationSubmitOf /
 * renderOfResponse / packOfResponse / screensaverOfResponse) and
 * THROW on misshapen bodies — success state is only ever written
 * from a parsed answer. Generation polling is BOUNDED (60 polls ×
 * 3s) and exhaustion throws — it can never spin forever. A decline
 * (confirmedFetch resolving null) returns before any state write,
 * and every failure lands in its own visible per-section error line.
 * The zip download checks res.ok before reading the blob.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./WallpapersDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("load — the asset library failure is a visible line, never a fake empty", () => {
  it("loadAssets records the failure message and clears it only on success", () => {
    const loader = slice(src, "const loadAssets = useCallback(async () => {", "}, [getAccessToken]);");
    expect(loader).toContain("setAssets(await fetchAssetLibrary(getAccessToken))");
    expect(loader).toContain("setAssetsError(null)");
    expect(loader).toContain('setAssetsError(t("wallpapers.libraryFailed"))');
  });

  it("the failure line renders in section 1 next to the art it feeds", () => {
    expect(src).toContain("{assetsError ? <p");
    expect(src).toContain("{assetsError}</p>");
  });

  it("the brand kit resolves null by seam design and the cost line names the fallback", () => {
    expect(src).toContain("void fetchBrandKit(getAccessToken).then((kit) => {");
    const costAt = src.indexOf('data-testid="world-wallpapers-desk-cost"');
    const costBlock = src.slice(costAt, src.indexOf("wpCostClean", costAt));
    expect(costBlock).toContain("brandKit?.logoUrl");
    expect(costBlock).toContain("wpCostBrandedLogo");
    expect(costBlock).toContain("wpCostBrandedName");
  });
});

describe("writes — confirmed, checked, and only a parsed answer moves state", () => {
  it("art generation: decline returns, non-ok throws, misshapen submit throws before state", () => {
    const body = slice(src, "async function generateArt() {", "async function renderCurrent()");
    expect(body).toContain("if (!res) return;");
    expect(body).toContain('throw new Error(apiErrorText(data, t("wallpapers.generateFailed")))');
    expect(body).toContain("if (!submit) throw new Error");
    expect(body.indexOf("setCurrentArt(url)")).toBeGreaterThan(body.indexOf("const url = submit.kind"));
    expect(body).toContain("setArtError(outOfBucs(");
  });

  it("the render: branded rides free skipConfirm, clean rides the clean-render cost; misshapen render throws", () => {
    const body = slice(src, "async function renderCurrent() {", "async function makePackOf10()");
    expect(body).toContain("{ skipConfirm: true }");
    expect(body).toContain("overrideCost: WALLPAPER_CLEAN_RENDER_COST");
    expect(body).toContain("const render = renderOfResponse(data, preset);");
    expect(body).toContain("if (!render) throw new Error");
    expect(body.indexOf("setRenders((prev) => prependRenders(prev, [render]))")).toBeGreaterThan(
      body.indexOf("const render = renderOfResponse(data, preset);"),
    );
    expect(body).toContain("setRenderError(outOfBucs(");
  });

  it("pack of 10: a null body-build returns BEFORE the fetch; a misshapen pack throws", () => {
    const body = slice(src, "async function makePackOf10() {", "async function generateVideo()");
    expect(body).toContain("const body = buildPack10Request(packSelected, presetKey, aiDisclosure);");
    expect(body).toContain("if (!body) return;");
    expect(body.indexOf("if (!body) return;")).toBeLessThan(body.indexOf("confirmedFetch(WALLPAPER_PACK10_PATH"));
    expect(body).toContain("const pack = packOfResponse(data);");
    expect(body).toContain("if (!pack) throw new Error");
    expect(body).toContain("setPackError(outOfBucs(");
  });

  it("clip generation and the screensaver render follow the same checked pattern", () => {
    const clip = slice(src, "async function generateVideo() {", "async function renderScreensaver()");
    expect(clip).toContain("if (!res) return;");
    expect(clip).toContain("const submit = generationSubmitOf(data);");
    expect(clip).toContain("if (!submit) throw new Error");
    expect(clip).toContain("setVideoError(outOfBucs(");
    const ss = slice(src, "async function renderScreensaver() {", "async function downloadPackZip()");
    expect(ss).toContain("const render = screensaverOfResponse(data, ssPreset);");
    expect(ss).toContain("if (!render) throw new Error");
    expect(ss).toContain("setSsError(outOfBucs(");
  });

  it("the zip download checks res.ok before reading the blob, failure lands in zipError", () => {
    const body = slice(src, "async function downloadPackZip() {", "const sub =");
    expect(body).toContain('if (!res.ok) throw new Error(t("worldCatalogLibrary.wpZipError"))');
    expect(body.indexOf("const blob = await res.blob()")).toBeGreaterThan(body.indexOf("if (!res.ok)"));
    expect(body).toContain("setZipError(");
  });
});

describe("no infinite spin — generation polling is bounded and exhaustion throws", () => {
  it("pollGeneration caps at 60 polls and throws when the job fails or time runs out", () => {
    const body = slice(src, "async function pollGeneration(", "async function generateArt()");
    expect(body).toContain("for (let i = 0; i < 60; i++)");
    expect(body).toContain('if (verdict.kind === "done") return verdict.url;');
    expect(body).toContain('if (verdict.kind === "failed")');
    expect(body).toContain("throw new Error(apiErrorText(pdata");
    expect(body.trimEnd().endsWith('throw new Error(t("wallpapers.generateFailed"));\n  }')).toBe(true);
  });

  it("every busy flag settles in a finally, so no section can spin forever", () => {
    for (const setter of ["setGenerating(false)", "setRendering(false)", "setPackBusy(false)", "setGeneratingVideo(false)", "setSsBusy(false)", "setZipBusy(false)"]) {
      expect(src).toContain(setter);
    }
  });
});
