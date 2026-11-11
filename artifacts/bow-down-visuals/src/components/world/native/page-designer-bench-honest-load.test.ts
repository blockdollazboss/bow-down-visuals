/**
 * PageDesignerBench — honest load standard (deep-pins tranche 3,
 * batch 4). The AI Page Designer's in-World bench.
 *
 * The profile load is a four-state machine and the states can never
 * be confused: loading (NativeLoadingState) · error (NativeErrorState
 * with a retry wired to the real loadProfile) · empty — reached ONLY
 * from the rail's own "no profile" answers (a 404, or a body the seam
 * can't shape, designerProfileOf null) — · ready. The header comment
 * records the law: a member with no profile gets the honest empty
 * state "— never a design applied to nobody." A failed read (non-ok,
 * non-404, or a throw) lands in error, NEVER in empty.
 *
 * Writes pin as-is, all checked before success:
 * - The three paid generators (theme 400 / bio 100 / banner 200, all
 *   registry-priced via the seam's cost getters) walk the same chain:
 *   decline returns · 402 names out-of-credits · non-ok OR a
 *   parse-less body surfaces the server's words · the result state
 *   is written only from the parsed answer.
 * - applyPatch (the profile's own PUT rail) checks res.ok before the
 *   success note and returns a boolean the callers can trust; on
 *   failure the error line carries the server's words.
 * - The free photo upload intake-gates the file client-side first,
 *   then throws on non-ok or a missing url before setUploadedUrl.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PageDesignerBench.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("load — four states, and empty only from the rail's own no-profile answers", () => {
  it("loadProfile: 404 and unshapeable bodies are empty; every other failure is error", () => {
    const loader = slice(src, "async function loadProfile() {", "useEffect(() => {");
    expect(loader).toContain('setLoadState("loading")');
    expect(loader).toContain("if (res.status === 404) {");
    expect(loader).toContain('setLoadState("empty")');
    expect(loader).toContain("if (!res.ok) {");
    expect(loader).toContain('setLoadState("error")');
    expect(loader).toContain("const parsed = designerProfileOf(data);");
    expect(loader).toContain("if (!parsed) {");
    expect(loader.indexOf('setLoadState("ready")')).toBeGreaterThan(loader.indexOf("setProfile(parsed)"));
  });

  it("render order is loading → error → empty → ready, with the retry wired to the real loader", () => {
    const loadAt = src.indexOf('loadState === "loading"');
    const errAt = src.indexOf('loadState === "error"');
    const emptyAt = src.indexOf('loadState === "empty"');
    const readyAt = src.indexOf('loadState === "ready" && profile');
    expect(loadAt).toBeGreaterThan(-1);
    expect(errAt).toBeGreaterThan(loadAt);
    expect(emptyAt).toBeGreaterThan(errAt);
    expect(readyAt).toBeGreaterThan(emptyAt);
    const errBlock = slice(src, 'loadState === "error"', 'loadState === "empty"');
    expect(errBlock).toContain("onRetry={() => void loadProfile()}");
  });
});

describe("paid generators — decline, 402, failure, success are four separate outcomes", () => {
  it("theme design: the result is written only from a parsed answer", () => {
    const body = slice(src, "async function runDesign(regenerate: boolean) {", "async function runBio()");
    expect(body).toContain("overrideCost: themeCost");
    expect(body).toContain("if (!res) {");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setDesignOutOfCredits(true)");
    expect(body).toContain("const parsed = pageDesignOf(data);");
    expect(body).toContain("if (!res.ok || !parsed) {");
    expect(body.indexOf("setDesign(parsed)")).toBeGreaterThan(body.indexOf("if (!res.ok || !parsed)"));
  });

  it("bio writer mirrors the chain", () => {
    const body = slice(src, "async function runBio() {", "async function runBanner()");
    expect(body).toContain("overrideCost: bioCost");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("const bio = pageBioOf(data);");
    expect(body).toContain("if (!res.ok || !bio) {");
    expect(body.indexOf("setBioDraft(bio)")).toBeGreaterThan(body.indexOf("if (!res.ok || !bio)"));
  });

  it("banner art mirrors the chain, then applies on the checked PUT rail", () => {
    const body = slice(src, "async function runBanner() {", "async function pickUpload(");
    expect(body).toContain("overrideCost: bannerCost");
    expect(body).toContain("const url = pageImageUrlOf(data);");
    expect(body).toContain("if (!res.ok || !url) {");
    expect(body.indexOf("setBannerUrl(url)")).toBeGreaterThan(body.indexOf("if (!res.ok || !url)"));
    expect(body).toContain("await applyPatch(");
    expect(body).toContain("buildProfileBannerPatch(url)");
  });

  it("the three costs come from the seam's registry-priced getters", () => {
    expect(src).toContain("const themeCost = pageDesignerThemeCost();");
    expect(src).toContain("const bioCost = pageDesignerBioCost();");
    expect(src).toContain("const bannerCost = pageDesignerBannerCost();");
  });
});

describe("apply + upload — checked before any success note", () => {
  it("applyPatch: non-ok lands the server's words and returns false; the note only follows ok", () => {
    const body = slice(src, "async function applyPatch(", "async function stealPalette()");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain("setApplyError(apiErrorMessage(data,");
    expect(body).toContain("return false;");
    expect(body.indexOf("setApplyNote(note)")).toBeGreaterThan(body.indexOf("if (!res.ok) {"));
    expect(body).toContain("return true;");
    expect(body).toContain("setApplying(false)");
  });

  it("the free upload intake-gates the file, then throws on non-ok or a missing url", () => {
    const body = slice(src, "async function pickUpload(", "\n  return (");
    expect(body).toContain("const verdict = photoIntakeVerdict(file);");
    expect(body).toContain('if (verdict === "not-image")');
    expect(body).toContain('if (verdict === "too-large")');
    expect(body).toContain("skipConfirm: true");
    expect(body).toContain("const url = pageImageUrlOf(data);");
    expect(body).toContain("if (!res.ok || !url) {");
    expect(body.indexOf("setUploadedUrl(url)")).toBeGreaterThan(body.indexOf("if (!res.ok || !url)"));
  });
});
