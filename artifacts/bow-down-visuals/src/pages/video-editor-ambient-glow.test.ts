import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack500 Lane V-glow — theme gate for the master player's ambient glow
 * (vault-guards diagnosis §7B). The ambient mirror layer behind the player
 * frame used a hardcoded dark filter (brightness 0.5); on the cream light
 * page its 40–56px bleed rendered as a dark grey-brown slab, visible
 * through the near-transparent Panels strip under the player. These pins
 * guard: (1) the page root's isLight is plumbed into MasterPreviewPlayer,
 * (2) light theme re-tints the glow while dark keeps the original halo
 * values in exactly one place, and (3) the Panels strip carries an opaque
 * marble ground in light theme only.
 */
const editor = readFileSync(new URL("./video-editor.tsx", import.meta.url), "utf8");

const DARK_FILTER = "blur(70px) brightness(0.5) saturate(1.3)";
const LIGHT_FILTER = "blur(70px) brightness(1.65) saturate(1.1)";

describe("master player ambient glow — theme gate (V-glow)", () => {
  it("plumbs the page root's isLight into MasterPreviewPlayer", () => {
    const callStart = editor.indexOf("<MasterPreviewPlayer");
    const callBlock = editor.slice(callStart, editor.indexOf("/>", callStart));
    expect(callBlock).toContain("isLight={isLight}");
    // Optional prop, defaulting to dark so any other mount keeps the halo.
    expect(editor).toContain("isLight = false,");
    expect(editor).toContain("isLight?: boolean;");
  });

  it("selects the glow filter on isLight — light washes bright, dark is the original halo", () => {
    const gate = editor.slice(editor.indexOf("const ambientGlowFilter"));
    expect(gate).toContain(`const ambientGlowFilter = isLight`);
    expect(gate).toContain(`? "${LIGHT_FILTER}"`);
    expect(gate).toContain(`: "${DARK_FILTER}";`);
    // The dark halo value lives in exactly one place (the gate) — the old
    // hardcoded inline style on the <video> is gone, so dark can't drift.
    expect(editor.split(DARK_FILTER).length - 1).toBe(1);
    expect(editor).not.toContain(
      `style={{ filter: "${DARK_FILTER}", transform: "scale(1.06)" }}`,
    );
  });

  it("light glow is laid at half strength; dark gets no opacity override", () => {
    expect(editor).toContain("filter: ambientGlowFilter,");
    expect(editor).toContain("opacity: isLight ? 0.5 : undefined,");
  });

  it("light glow sits over a faint gold radial backdrop; dark gets none", () => {
    const gate = editor.slice(editor.indexOf("const ambientGlowBackdrop"));
    expect(gate).toContain("radial-gradient(ellipse 72% 68% at 50% 50%");
    expect(gate).toContain("rgba(201,168,76,0.20)");
    expect(gate).toContain(": undefined;");
    expect(editor).toContain("style={{ zIndex: 0, background: ambientGlowBackdrop }}");
  });

  it("Panels strip: opaque vv-marble-panel ground in light, gold fade kept in dark", () => {
    expect(editor).toContain(
      'isLight ? "vv-marble-panel" : "bg-gradient-to-b from-[#C9A84C]/[0.06] to-transparent"',
    );
    // The ground class must actually resolve in this page's own chrome:
    // the utility is defined in the page-root <style> block and the light
    // value of --vv-marble-panel is an opaque cream marble gradient.
    expect(editor).toContain(".vv-marble-panel { background: var(--vv-marble-panel); }");
    const panelVar = editor.slice(editor.indexOf('"--vv-marble-panel": isLight'));
    expect(panelVar).toContain("#FFFDF9");
    expect(panelVar).toContain("#F0E6CF");
  });
});
