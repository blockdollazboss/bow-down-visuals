import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-28 #43 (A1-01) — Lip Sync's two single-source buttons.
 * They cannot be wired to the component's only rail (the run-all flow
 * syncs every scene of a saved project; the component takes no image or
 * selected-clip input), so they must stay disabled AND honestly labelled
 * "Coming soon" with an explanatory title — never bare-disabled.
 */
const src = readFileSync(new URL("./LipSyncStudio.tsx", import.meta.url), "utf8");

describe("LipSyncStudio single-source buttons (Stack-28 #43)", () => {
  it("both buttons carry a Coming soon label and title", () => {
    for (const id of ["btn-lipsync-from-image", "btn-lipsync-from-clip"]) {
      const at = src.indexOf(`data-testid="${id}"`);
      expect(at).toBeGreaterThan(-1);
      const block = src.slice(Math.max(0, at - 400), at + 200);
      expect(block).toContain("disabled");
      expect(block).toContain('title="Coming soon');
    }
    expect(src.match(/Coming soon/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
