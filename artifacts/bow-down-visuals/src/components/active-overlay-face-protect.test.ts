import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-100 #3 Lane D (D-04) — the Effects tab's "Protect face / center"
 * toggle wrote settings.overlayProtectFace but NOTHING consumed it: the
 * control lied. It is now wired: the editor page passes the setting into
 * ActiveOverlayEffects, which masks the visual-effects layer out of a
 * soft upper-center ellipse. These pins keep the wire from being cut again.
 */
const overlay = readFileSync(new URL("./ActiveOverlayEffects.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../pages/video-editor.tsx", import.meta.url), "utf8");

describe("Protect face / center is wired end to end", () => {
  it("ActiveOverlayEffects accepts and applies overlayProtectFace as a mask", () => {
    expect(overlay).toContain("overlayProtectFace?: boolean");
    expect(overlay).toContain("FACE_PROTECT_MASK");
    expect(overlay).toContain("maskImage: FACE_PROTECT_MASK");
    expect(overlay).toContain('data-face-protect={overlayProtectFace ? "on" : "off"}');
  });

  it("the mask wraps the visual effects, not the watermark", () => {
    const wrapAt = overlay.indexOf('data-face-protect={overlayProtectFace ? "on" : "off"}');
    const rainAt = overlay.indexOf('show.includes("Rain")');
    const watermarkAt = overlay.indexOf('show.includes("Logo / Watermark")');
    expect(wrapAt).toBeGreaterThan(-1);
    expect(rainAt).toBeGreaterThan(wrapAt);
    expect(watermarkAt).toBeGreaterThan(rainAt);
    // the wrapper closes before the watermark render
    const closeAt = overlay.indexOf("</div>", rainAt);
    expect(closeAt).toBeLessThan(watermarkAt);
  });

  it("the editor page passes the setting through", () => {
    expect(page).toContain("overlayProtectFace={settings.overlayProtectFace ?? true}");
  });
});
