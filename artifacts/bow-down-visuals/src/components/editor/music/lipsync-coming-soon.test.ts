import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-28 #43 (A1-01) — Lip Sync's two single-source buttons.
 * UPDATED by Stack-100 #3 Lane D (D-02/D-03): the #43 premise expired.
 * The per-scene rail POST /api/lip-sync/scene-test (+ GET poll) now exists
 * (the editor's LipSyncSection drives it) and LipSyncStudio loads the
 * project's scenes by projectId, so "Lip Sync Selected Video Clip" is
 * WIRED and must never regress to a disabled placeholder.
 * UPDATED AGAIN by Stack-100 #3 W3 Lane 7 (at the join): the still→clip
 * rail now exists (still-to-lipsync.ts rides /api/generate-runway-clip
 * then /api/lip-sync/preview), so the single-IMAGE button is WIRED too —
 * gated on its real inputs (canStill) and honest about cost in its
 * title. Neither button may regress to a "Coming soon" placeholder.
 * The old "Lip Sync not connected yet" banner (which named rival services)
 * must also never come back — lip sync is connected.
 */
const src = readFileSync(new URL("./LipSyncStudio.tsx", import.meta.url), "utf8");
const helper = readFileSync(new URL("./still-to-lipsync.ts", import.meta.url), "utf8");

describe("LipSyncStudio single-source actions (Stack-28 #43, updated Stack-100 #3)", () => {
  it("the artist-image button is enabled and wired to the still→clip→lip-sync flow", () => {
    const at = src.indexOf('data-testid="btn-lipsync-from-image"');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, at - 600), at + 200);
    expect(block).toContain("onClick={() => void startStillToLipSync()}");
    /* Gated on real inputs, not bare-enabled and not bare-disabled. */
    expect(block).toContain("disabled={!canStill || stillBusy}");
    expect(block).not.toContain("Coming soon");
    /* The component actually calls the orchestration helper, which
       rides both existing rails. */
    expect(src).toContain("runStillToLipSync({");
    expect(helper).toContain('"/api/generate-runway-clip"');
    expect(helper).toContain('"/api/lip-sync/preview"');
    expect(helper).toContain("referenceImageUrl: imageUrl");
    expect(helper).toContain("clipUrl,");
  });

  it("the selected-clip button is wired to the per-scene rail, not disabled", () => {
    const at = src.indexOf('data-testid="btn-lipsync-from-clip"');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, at - 700), at + 100);
    expect(block).toContain("onClick");
    expect(block).not.toContain("cursor-not-allowed");
    expect(src).toContain('"/api/lip-sync/scene-test"');
    expect(src).toContain("computeSceneTimings");
    expect(src).toContain('data-testid="lipsync-clip-scene-select"');
  });

  it("the false 'not connected' banner and rival-service names stay gone", () => {
    expect(src).not.toContain("Lip Sync not connected yet");
    expect(src).not.toContain("Hedra");
    expect(src).not.toContain("Sync.so");
    expect(src).not.toContain("D-ID");
    expect(src).not.toContain("HeyGen");
    expect(src).toContain("Lip Sync is connected");
  });

  it("the run-all confirm states the real export charge (D-01)", () => {
    expect(src).toContain("400 Visual Bucs");
    expect(src).not.toContain("5 site Visual Bucs");
  });
});
