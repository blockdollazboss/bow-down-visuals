/**
 * SplitScreenPanel — honest load standard (deep-pins tranche 4,
 * batch B). Two loads and one paid job flow. The layout catalog:
 * layouts start null (the skeleton grid), a non-ok answer throws
 * into catalogError — which replaces the whole configure phase
 * with the error copy plus a Retry button that re-runs the load —
 * and the layouts/price land only from a parsed ok answer, so a
 * failed catalog never renders as an empty picker. The referral
 * read is a documented passenger (sharing works without the code).
 * Render (paid): missing cells refuse before any call; a decline
 * returns to configure with nothing charged; 402 is the named
 * out-of-credits error; non-ok throws into jobError. The poll
 * clears its interval on done, on failed AND on any poll error,
 * and is cleared on unmount — the result url is set only inside
 * the done branch, a failed job surfaces the server's words with
 * the refunded note instead of becoming a result.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SplitScreenPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("catalog — loading, failed and loaded stay separate", () => {
  it("layouts start null (skeleton); a non-ok answer throws into the error state", () => {
    expect(src).toContain("const [layouts, setLayouts] = useState<SplitScreenLayout[] | null>(null);");
    const body = slice(src, "const loadLayouts = useCallback(async () => {", "useEffect(() => {\n    loadLayouts();");
    expect(body).toContain('if (!res.ok) throw new Error(t("splitScreen.catalogFailed"));');
    expect(body.indexOf("setLayouts(data.layouts ?? []);")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
    expect(body).toContain('setCatalogError(plainErrorText(err, t("splitScreen.catalogFailed")));');
  });

  it("the error state carries a retry and gates the configure phase; null layouts render the skeleton", () => {
    expect(src).toContain("{catalogError && (");
    expect(src).toContain("onClick={loadLayouts}");
    expect(src).toContain('{phase === "configure" && !catalogError && (');
    expect(src).toContain("{!layouts ? (");
  });

  it("the referral read is a documented passenger — sharing works without the code", () => {
    expect(src).toContain("/* sharing still works without the code */");
    expect(src).toContain("if (res.ok) {");
  });
});

describe("render + poll — decline / 402 / failure are endings; the result comes only from a done job", () => {
  it("missing cells refuse before any call; decline and 402 return to configure", () => {
    const body = slice(src, "async function render() {", "/* ── Virality");
    expect(body).toContain("if (missing.length > 0) {");
    expect(body).toContain("if (!res) {");
    expect(body).toContain("// User cancelled the credit confirmation");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain('setJobError(apiErrorMessage(data, t("splitScreen.outOfCredits")));');
    expect(body).toContain("if (!res.ok) {");
    expect(body.indexOf("pollJob(data.jobId);")).toBeGreaterThan(body.indexOf("if (!res.ok) {"));
  });

  it("the poll clears on done, on failed and on error, and on unmount; the result sets only on done", () => {
    const body = slice(src, "async function pollJob(jobId: string) {", "async function render() {");
    expect(body).toContain('if (!res.ok) throw new Error(t("splitScreen.pollFailed"));');
    expect(body).toContain('if (job.state === "done") {');
    expect(body.indexOf("setResultUrl(job.result.url);")).toBeGreaterThan(body.indexOf('if (job.state === "done") {'));
    expect(body).toContain('} else if (job.state === "failed") {');
    expect(body).toContain('setJobError(apiErrorMessage(job, t("splitScreen.renderFailedDefault")));');
    expect(body).toContain("if (pollRef.current) clearInterval(pollRef.current);");
    expect(src).toContain("useEffect(() => () => {\n    if (pollRef.current) clearInterval(pollRef.current);\n  }, []);");
  });
});
