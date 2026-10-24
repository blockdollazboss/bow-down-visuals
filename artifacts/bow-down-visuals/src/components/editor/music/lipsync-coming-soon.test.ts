import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * LipSyncStudio single-source buttons.
 *
 * Stack-28 #43 pinned both buttons disabled: no per-image / per-clip
 * rail existed. Stack-100 #3 W3 Lane 7 built the still→clip rail on
 * the existing rails (still-to-lipsync.ts: the photo is animated on
 * /api/generate-runway-clip, the produced clip goes to
 * /api/lip-sync/preview), so the IMAGE button is now enabled and wired
 * to that flow — gated on its real inputs (canStill) and honest about
 * cost in its title. The selected-CLIP button still has no
 * selected-clip input in this component, so it must stay disabled AND
 * honestly labelled "Coming soon" with an explanatory title — never
 * bare-disabled, and never pointed at the image flow.
 */
const src = readFileSync(new URL("./LipSyncStudio.tsx", import.meta.url), "utf8");
const helper = readFileSync(new URL("./still-to-lipsync.ts", import.meta.url), "utf8");

describe("LipSyncStudio single-source buttons (Stack-28 #43 → W3 Lane 7)", () => {
  it("the from-image button is enabled and wired to the still→clip→lip-sync flow", () => {
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

  it("the from-clip button stays disabled and honestly labelled", () => {
    const at = src.indexOf('data-testid="btn-lipsync-from-clip"');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, at - 400), at + 200);
    expect(block).toContain("disabled");
    expect(block).toContain('title="Coming soon');
    expect(src.match(/Coming soon/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
