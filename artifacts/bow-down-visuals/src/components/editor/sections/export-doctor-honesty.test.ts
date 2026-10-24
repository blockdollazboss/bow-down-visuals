/**
 * export-doctor-honesty.test.ts — Stack-100 #3 Lane 4 deep-audit pins (FE).
 *
 * Lane D verified ExportDoctor's cost surface only. These pins hold the
 * rest of the panel honest:
 *  - the "Export First 20s + Audio Test" button calls its own handler
 *    (it previously called the lip-sync variant, which made the whole
 *    short-test debug/step/result apparatus unreachable);
 *  - the audio-sync diagnostic sends clipEdits keyed the way the rail
 *    resolves them (scene number), not by scene ID;
 *  - multi-clip + URL-check results carry a stale guard and a session
 *    expiry, like the Scene-1 checks already had;
 *  - no status row claims a success it never measured (hardcoded "yes ✓"
 *    duration match, synthesized clipId "resolved", Replit "allowed");
 *  - the results-clearing button is labelled for what it does;
 *  - short-test client timeouts match the other doctor exports (8 min),
 *    so a server-side success is never reported as a client timeout.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  new URL("./ExportDoctor.tsx", import.meta.url),
  "utf8",
);

/** The JSX block for one test id: from its data-testid back to the owning onClick. */
function buttonBlock(testId: string): string {
  const idx = src.indexOf(`data-testid="${testId}"`);
  expect(idx, testId).toBeGreaterThan(-1);
  return src.slice(Math.max(0, idx - 1200), idx);
}

describe("button wiring", () => {
  it("First 20s + Audio Test calls the audio short test, not the lip-sync variant", () => {
    expect(buttonBlock("btn-doctor-audio-sync-short")).toContain(
      "onClick={exportAudioSyncShort}",
    );
    expect(buttonBlock("btn-doctor-audio-sync-short")).not.toContain(
      "onClick={exportAudioSyncShortLipSync}",
    );
  });
  it("the lip-sync offset test button still calls the lip-sync variant", () => {
    const lipSyncButtons = src.match(/onClick=\{exportAudioSyncShortLipSync\}/g) ?? [];
    expect(lipSyncButtons.length).toBe(1);
  });
  it("the short-test debug apparatus is reachable: its handler sets its state", () => {
    expect(src).toContain("setShortTestDebug({");
    expect(src).toContain("setAudioSyncShortResult(data)");
  });
});

describe("diagnostic clipEdits keying", () => {
  it("re-keys clipEdits by scene number for the sync diagnostic", () => {
    expect(src).toContain("[`scene-${i + 1}`, entry]");
    expect(src).toContain("[String(i + 1), entry]");
  });
});

describe("stale + expiry guards (multi-clip)", () => {
  it("fingerprints the downloaded clip set and gates on it", () => {
    expect(src).toContain("const multiKey = multiClips");
    expect(src).toContain("setTestedMultiKey(multiKey)");
    expect(src).toContain("testedMultiKey !== multiKey");
    expect(src).toContain("!multiStale &&");
    expect(src).toContain("!multiExpired");
  });
  it("expires gates at 29 minutes (server sweeps sessions at 30)", () => {
    expect(src).toContain("const SESSION_TTL_MS = 29 * 60 * 1000;");
    expect(src).toContain("nowTs - testedSceneAt > SESSION_TTL_MS");
    expect(src).toContain("nowTs - testedMultiAt > SESSION_TTL_MS");
  });
  it("URL-check results are fenced to the clip set they ran against", () => {
    expect(src).toContain("setTestedUrlKey(multiKey)");
    expect(src).toContain(
      "const urlDoctorCurrent = urlDoctorStale ? null : urlDoctorResult;",
    );
  });
  it("tells the user when results are stale or the session expired", () => {
    expect(src).toContain("the results below are stale and the export buttons are locked");
    expect(src).toContain("The downloaded-clips session has expired");
    expect(src).toContain("The Scene 1 download session has expired");
  });
});

describe("no unmeasured success claims", () => {
  it("the duration-match row is computed from per-clip durations", () => {
    expect(src).toContain(
      'clipAudioMap.every(\n                              (c) =>\n                                c.masterDuration === 0 ||',
    );
    expect(src).not.toContain(
      '"all export durations match master player",\n                      "yes ✓ — trims applied during normalization",\n                      true,',
    );
  });
  it("the export-order panel no longer renders an unverified green yes", () => {
    expect(src).not.toContain(
      '<span className="font-bold text-green-400">yes</span>',
    );
    expect(src).toContain("order as shown above");
  });
  it("a synthesized clipId fallback is not reported as resolved", () => {
    expect(src).toContain("no DB clipId — fallback label");
    expect(src).not.toContain("`yes ✓ (${resolvedClipId.slice(0, 18)})`");
  });
  it("the Replit row is a fact row, not an allowance verdict", () => {
    expect(src).toContain('"Scene 1 on Replit object storage"');
    expect(src).not.toContain('"Scene 1 Replit object storage allowed"');
  });
  it("short-test steps are labelled as timer estimates", () => {
    expect(src).toContain("estimated step (timer-based, not server-reported):");
    expect(src).toContain('"current step (estimated while running)"');
  });
  it("ffmpeg 'finished' is only claimed on an OK response", () => {
    expect(src).toContain("ffmpegFinished: res.ok,");
  });
  it("the lip-sync 'route called' flag is set after the call answers", () => {
    const dlIdx = src.indexOf('body: JSON.stringify({ projectId, url: lipSyncUrl })');
    const flagIdx = src.indexOf("setLipSyncDownloadCalled(true);", dlIdx);
    expect(dlIdx).toBeGreaterThan(-1);
    expect(flagIdx).toBeGreaterThan(dlIdx);
  });
});

describe("honest controls", () => {
  it("the clear-results button is labelled for what it does", () => {
    expect(src).toContain("Clear Audio Sync Test Results");
    expect(src).not.toContain("Reset Export Audio To Song Start");
    expect(src).toContain("setAudioSyncShortLipSyncResult(null);");
  });
  it("short tests allow 8 minutes, like the other doctor exports", () => {
    expect(src).not.toContain("CLIENT_TIMEOUT_MS = 2 * 60 * 1000");
    const eights = src.match(/CLIENT_TIMEOUT_MS = 8 \* 60 \* 1000/g) ?? [];
    expect(eights.length).toBe(2);
    expect(src).toContain("Export test timed out after 8 minutes.");
    expect(src).toContain("Lip sync offset test timed out after 8 minutes.");
  });
});
