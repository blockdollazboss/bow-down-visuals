/**
 * ProductReviews — honest load standard (deep-pins tranche 5).
 * The list load throws on !ok and the catch sets loadError;
 * the render order is loading spinner → loadError + "Try
 * again" (which re-arms loading and re-runs the load) → the
 * loaded tree. The honest empty copy ("No reviews yet — every
 * review here comes from a verified buyer…") exists only
 * inside the loaded branch, and the subtler trap is covered
 * too: reviews empty while the summary counts some renders
 * "The reviews for this product couldn't be shown." instead
 * of a bare void. Submit sets the saved tick only after
 * res.ok. The eligibility probe is a best-effort enhancement
 * (its failure just leaves the form hidden) — pinned as such.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ProductReviews.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the list load — four states in order", () => {
  it("throws on !ok; success clears loadError; the catch sets it; loading always settles", () => {
    const body = slice(src, "const loadReviews = useCallback(async () => {", "const loadEligibility = useCallback");
    expect(body).toContain('if (!res.ok) throw new Error("load");');
    expect(body).toContain("setSummary(data.summary);");
    expect(body).toContain("setReviews(data.reviews ?? []);");
    expect(body).toContain("setLoadError(false);");
    expect(body).toContain("setLoadError(true);");
    expect(body).toContain("setLoading(false);");
    expect(body.indexOf('if (!res.ok) throw new Error("load");')).toBeLessThan(body.indexOf("setSummary(data.summary);"));
    const catchPart = slice(body, "} catch {", "} finally {");
    expect(catchPart).toContain("setLoadError(true);");
    expect(catchPart).not.toContain("setReviews");
    expect(catchPart).not.toContain("setSummary");
  });

  it("render order: spinner → loadError + retry → loaded; the empty copy lives only in the loaded branch", () => {
    const body = slice(src, "{loading ? (", "</section>");
    expect(body).toContain(") : loadError ? (");
    expect(body).toContain("Reviews couldn't load just now.");
    expect(body).toContain("onClick={() => { setLoading(true); void loadReviews(); }}");
    expect(body).toContain('data-testid="product-reviews-summary"');
    expect(body).toContain("No reviews yet — every review here comes from a verified buyer, so this fills in as buyers share their take.");
    expect(body.indexOf("{loading ? (")).toBeLessThan(body.indexOf(") : loadError ? ("));
    expect(body.indexOf(") : loadError ? (")).toBeLessThan(body.indexOf('data-testid="product-reviews-summary"'));
    expect(body.indexOf('data-testid="product-reviews-summary"')).toBeLessThan(
      body.indexOf("No reviews yet — every review here comes from a verified buyer"),
    );
  });

  it("empty list + non-zero summary count shows the couldn't-be-shown line, never a silent void", () => {
    expect(src).toContain("{reviews.length === 0 && summary.count > 0 && (");
    expect(src).toContain("The reviews for this product couldn't be shown.");
  });
});

describe("writes + the enhancement probe", () => {
  it("submit throws on !ok before the saved tick can land", () => {
    const body = slice(src, "if (!res.ok) throw new Error(apiErrorMessage(data, \"Your review couldn't be saved.\"));", "setSaving(false);");
    expect(body).toContain("setSavedTick(true);");
    expect(src.indexOf("if (!res.ok) throw new Error(apiErrorMessage(data, \"Your review couldn't be saved.\"));")).toBeLessThan(
      src.indexOf("setSavedTick(true);"),
    );
    expect(body).not.toContain("setLoadError");
  });

  it("eligibility is best-effort by design: !ok returns silently and the catch writes nothing", () => {
    const body = slice(src, "const loadEligibility = useCallback(async () => {", "useEffect(() => { void loadReviews(); }, [loadReviews]);");
    expect(body).toContain("if (!res.ok) return;");
    expect(body).toContain("} catch { /* eligibility is an enhancement — the list below still stands */ }");
    const catchPart = slice(body, "} catch { /* eligibility", "}, [user, getAccessToken, productType, productId]);");
    expect(catchPart).not.toContain("setLoadError");
    expect(catchPart).not.toContain("setReviews");
  });
});
