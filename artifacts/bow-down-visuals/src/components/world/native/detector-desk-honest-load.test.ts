/**
 * DetectorDesk — honest load standard (deep-pins tranche 3,
 * batch 6). The desk has no collection load — its pre-run state is
 * the file intake and the readiness gate — and the standard lands
 * on the run: every variant (image URL, image file, audio file,
 * video frames) rides confirmedFetch with the registry cost as the
 * explicit override, and the four outcomes stay four outcomes: a
 * decline returns with nothing run; a 402 (or an out_of_credits
 * error body) is the out-of-credits line; a non-ok is the server's
 * words under the refund-truth fallback copy; an ok answer that
 * won't parse is its own "unreadable" note. The verdict card and
 * the session history update ONLY from a parsed result — a failed
 * run never enters the history. Client-side intake rejects a
 * wrong-kind or oversize file with its own line before any spend,
 * and the frame/duration readers are bounded (30s / 15s timeouts)
 * so a stuck file can never spin the desk forever.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./DetectorDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("intake — rejected before any spend, bounded readers", () => {
  it("pickFile rejects wrong-kind and oversize files with their own lines", () => {
    const pick = slice(src, "const pickFile = (picked: File | null) => {", "const run = async () => {");
    expect(pick).toContain("const kind = detectorKindOfFile(picked);");
    expect(pick).toContain('setFileError(t("worldIdentityMisc.detFileWrongKind"));');
    expect(pick).toContain("if (picked.size > DETECTOR_MAX_FILE_BYTES) {");
    expect(pick).toContain('setFileError(t("worldIdentityMisc.detFileTooBig"));');
    expect(pick.indexOf("setFile(picked);")).toBeGreaterThan(pick.indexOf("DETECTOR_MAX_FILE_BYTES"));
  });

  it("the frame and duration readers carry hard timeouts — nothing spins forever", () => {
    expect(src).toContain('reject(new Error("Video load timed out"));');
    expect(src).toContain("}, 30000);");
    expect(src).toContain("}, 15000);");
    expect(src).toContain("const ready = mode === \"url\" ? detectorUrlReady(mediaUrl) : file !== null;");
  });
});

describe("the run — four outcomes stay four outcomes", () => {
  it("decline returns; 402 is named; non-ok is the server's words; unparseable is its own note", () => {
    const body = slice(src, "const run = async () => {", "const VerdictIcon =");
    expect(body).toContain("if (!res) return; // spend confirmation declined — nothing ran");
    expect(body).toContain('if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {');
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain('setNote(apiErrorMessage(d, t("worldIdentityMisc.detFailedRefund")));');
    expect(body).toContain("const parsed = detectionResultOfResponse(data);");
    expect(body).toContain("if (!parsed) {");
    expect(body).toContain('setNote(t("worldIdentityMisc.detUnreadable"));');
  });

  it("the verdict and history update only from a parsed result", () => {
    const body = slice(src, "const run = async () => {", "const VerdictIcon =");
    expect(body.indexOf("setResult(parsed);")).toBeGreaterThan(body.indexOf("if (!parsed) {"));
    expect(body.indexOf("pushDetectorHistory(h, {")).toBeGreaterThan(body.indexOf("setResult(parsed);"));
    expect(src).toContain('data-testid="world-detector-desk-result"');
    expect(src).toContain("overrideCost: DETECTOR_COST_VISUAL_BUCS,");
  });
});
