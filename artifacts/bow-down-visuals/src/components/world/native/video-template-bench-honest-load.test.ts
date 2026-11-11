/**
 * VideoTemplateBench — honest load standard (deep-pins
 * tranche 4, batch D). The standard lands in three places:
 *
 * - THE CATALOG LOAD: a non-ok read throws, and an ok read in
 *   a shape the seam's parser can't trust throws too — both
 *   land the failed state (error copy + working Retry), never
 *   an empty shelf. The catalog records, and the state flips
 *   to ready, only after both guards. A ready-but-empty
 *   catalog is honest on its face: no chips and the
 *   pick-a-template prompt, not an error costume.
 * - THE APPLY (paid): missing slots refuse before any call; a
 *   declined spend confirmation returns to the form untouched;
 *   non-ok is its own error line with 402 named as
 *   out-of-credits; an ok answer without a jobId is "the
 *   render didn't start," never a working state — polling
 *   starts only from a proven jobId.
 * - THE POLL: both server terminal states stop the poll — done
 *   (only with a result URL) records the video, failed lands
 *   the rail's error line, which the render pairs with the
 *   auto-refund suffix. A thrown poll is deliberately NOT a
 *   failed render — the comment says so — the poll keeps its
 *   3-second beat until a terminal state arrives.
 *
 * Slot uploads follow the same rule: a returned URL that
 * doesn't fit the slot is a notice, not a fill; the slot fills
 * only after the second media check, and a thrown upload is
 * its own notice.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./VideoTemplateBench.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the catalog: failure is the error state, never an empty shelf", () => {
  const load = slice(src, "const loadCatalog = useCallback", "useEffect(() => {\n    void loadCatalog();");

  it("non-ok throws; an unparseable payload throws; success records before ready", () => {
    expect(load).toContain("if (!res.ok) throw new Error(`catalog ${res.status}`);");
    expect(load).toContain("const parsed = parseVideoTemplateCatalog(await res.json().catch(() => null));");
    expect(load).toContain('if (!parsed) throw new Error("catalog drift");');
    expect(load.indexOf("setCatalog(parsed.templates);")).toBeGreaterThan(load.indexOf('if (!parsed) throw new Error("catalog drift");'));
    expect(load.indexOf('setLoadState("ready");')).toBeGreaterThan(load.indexOf("setCatalog(parsed.templates);"));
    expect(load).toContain('setLoadState("failed");');
  });

  it("the render orders loading before failed before the catalog", () => {
    expect(src.indexOf('loadState === "loading"')).toBeLessThan(src.indexOf('loadState === "failed"'));
    expect(src).toContain('data-testid="world-video-template-bench-load-failed"');
    expect(src).toContain("onRetry={() => void loadCatalog()}");
    expect(src).toContain('message={t("worldDeskRemainder.vtbLoadFailedMessage")}');
    expect(src.indexOf('data-testid="world-video-template-bench-load-failed"')).toBeLessThan(
      src.indexOf('data-testid="world-video-template-bench-catalog"'),
    );
  });

  it("a payload slug the catalog doesn't carry preselects nothing", () => {
    expect(src).toContain("const found = catalog.find((t) => t.key === deepLinkKey);");
    expect(src).toContain("if (found) {");
  });
});

describe("the apply: nothing is claimed before the rail proves a job", () => {
  const apply = slice(src, "const apply = async () => {", "  return (\n    <div className=\"space-y-3\" data-testid=\"world-video-template-bench\">");

  it("missing slots refuse before the call; a decline returns untouched", () => {
    expect(apply).toContain("const missing = missingSlotLabels(selected, slotUrls);");
    expect(apply).toContain("if (missing.length > 0) {");
    expect(apply.indexOf("if (missing.length > 0) {")).toBeLessThan(apply.indexOf("confirmedFetch(VIDEO_TEMPLATE_APPLY_PATH"));
    expect(apply).toContain("if (!res) return; /* the member declined the confirmation — back to the form, untouched */");
  });

  it("non-ok is an error line, 402 named; no jobId is 'didn't start', never working", () => {
    expect(apply).toContain("if (!res.ok) {");
    expect(apply).toContain("if (res.status === 402) {");
    expect(apply).toContain('setJobError(t("worldDeskRemainder.vtbOutOfCredits"));');
    expect(apply.indexOf("if (!res) return;")).toBeLessThan(apply.indexOf("if (!res.ok) {"));
    expect(apply).toContain("if (!data?.jobId) {");
    expect(apply).toContain('setJobError(t("worldDeskRemainder.vtbRenderDidntStart"));');
    expect(apply.indexOf('setJobState("working");')).toBeGreaterThan(apply.indexOf("if (!data?.jobId) {"));
    expect(apply.indexOf("startPolling(data.jobId);")).toBeGreaterThan(apply.indexOf("if (!data?.jobId) {"));
  });
});

describe("the poll: real terminal states stop it", () => {
  const poll = slice(src, "const startPolling = (jobId: string) => {", "const apply = async () => {");

  it("done requires a result URL; failed lands the rail's error line; both stop the poll", () => {
    expect(poll).toContain('if (read.state === "done" && read.resultUrl) {');
    expect(poll).toContain('} else if (read.state === "failed") {');
    expect(poll.indexOf('read.state === "done"')).toBeLessThan(poll.indexOf('read.state === "failed"'));
    expect(poll).toContain('setJobError(templateJobErrorLine(read, t("worldDeskRemainder.vtbJobFailed")));');
    expect(poll).toContain('setJobState("done");');
    expect(poll).toContain('setJobState("failed");');
  });

  it("a missed poll is not dressed as a failed render", () => {
    expect(poll).toContain("/* a missed poll is not a failed render — keep polling */");
  });

  it("a failed render's line carries the auto-refund suffix", () => {
    expect(src).toContain('{jobError}{t("worldDeskRemainder.vtbRefundSuffix", { cost: applyCost })}');
  });
});

describe("slot uploads: the slot fills only from a URL that fits it", () => {
  it("a misfit returned URL is a notice; a thrown upload is its own notice", () => {
    expect(src).toContain("if (!slotAcceptsMedia(slot, url, file.type)) {");
    expect(src).toContain('setNotice(t("worldDeskRemainder.vtbUploadDoesntFit", { label: slot.label }));');
    expect(src.indexOf("setSlotUrls((prev) => ({ ...prev, [slot.key]: url }));")).toBeGreaterThan(
      src.indexOf("if (!slotAcceptsMedia(slot, url, file.type)) {"),
    );
    expect(src).toContain('setNotice(t("worldDeskRemainder.vtbUploadFailed"));');
  });
});
