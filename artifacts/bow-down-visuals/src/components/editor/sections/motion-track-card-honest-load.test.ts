/**
 * MotionTrackCard — honest load standard (deep-pins tranche 3,
 * batch 8). The card's job flows are poll-based and every poll is
 * bounded by its terminal states. Track: a decline returns, 402 is
 * the out-of-Bucs toast, a jobId-less answer throws; the poll
 * clears its interval on done, on failed AND on any poll error —
 * and crucially the RESULT is set only from a done job carrying its
 * result, while a failed job surfaces the server's words (a failed
 * track never becomes a result). The interval is also cleared on
 * unmount, so nothing polls forever. Apply: decline / 402 / non-ok
 * or url-less are separate endings; the result url is set only from
 * a parsed ok answer. The share-accounts read is a documented
 * enhancement (its comment: the share section stays hidden on
 * failure). Share throws on non-ok before its success toast.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./MotionTrackCard.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("track — the poll always terminates; a failed job is never a result", () => {
  it("start: decline returns, 402 is named, a jobId-less answer throws", () => {
    const body = slice(src, "async function handleTrack() {", "function addAnchor() {");
    expect(body).toContain("if (!res) return;");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("if (!res.ok || !body.jobId) throw new Error(apiErrorMessage(body, t(\"videoEditor.motionTrack.trackFailed\")));");
  });

  it("the poll clears on done, on failed and on error; the result sets only from a done job", () => {
    const body = slice(src, "async function handleTrack() {", "function addAnchor() {");
    expect(body).toContain('if (jb.state === "done") {');
    expect(body.indexOf("setTrackResult(jb.result as TrackResult);")).toBeGreaterThan(body.indexOf('if (jb.state === "done") {'));
    expect(body).toContain('} else if (jb.state === "failed") {');
    expect(body).toContain("if (pollTimer.current) window.clearInterval(pollTimer.current);");
    expect(src).toContain("useEffect(() => () => {\n    if (pollTimer.current) window.clearInterval(pollTimer.current);\n  }, []);");
  });
});

describe("apply + share — checked before success", () => {
  it("apply sets the result only from an ok answer carrying a url", () => {
    const body = slice(src, "async function handleApply() {", "async function loadAccounts() {");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("if (!res.ok || !body.url) throw new Error(apiErrorMessage(body, t(\"videoEditor.motionTrack.applyFailed\")));");
    expect(body.indexOf("setResultUrl(body.url as string);")).toBeGreaterThan(body.indexOf("if (!res.ok || !body.url) throw"));
  });

  it("the accounts read is a documented enhancement; share throws before its toast", () => {
    expect(src).toContain("catch { /* share section stays hidden */ }");
    const body = slice(src, "async function handleShare(platform:", "function handleUseInEditor() {");
    expect(body).toContain("if (!res.ok) throw new Error(apiErrorMessage(body, t(\"videoEditor.motionTrack.shareFailed\")));");
    expect(body.indexOf('toast({ title: t("videoEditor.motionTrack.shareOk", { platform }) });')).toBeGreaterThan(
      body.indexOf("if (!res.ok) throw"),
    );
  });
});
