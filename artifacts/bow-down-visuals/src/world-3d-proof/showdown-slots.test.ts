/**
 * showdown-slots.test.ts — the two-slot scheme for generated guards
 * (2026-10-19): one slot per guard, so the male and female TRELLIS.2
 * bodies stand on the showdown stage at the same time.
 *
 * Pins the contract:
 *  (a) showdown.ts loads BOTH slot files — the primary
 *      /world/guard-gen.glb and the female /world/guard-gen-female.glb;
 *  (b) the posts mirror: male wired at x=-1.65 (his existing post,
 *      unchanged), female at x=+1.65 across the center body;
 *  (c) both slot files exist on disk as real bodies (multi-MB GLBs,
 *      not stubs), and the preserved Hunyuan evidence body is still
 *      there untouched beside them;
 *  (d) the evidence file is never a load target — nothing on the
 *      stage may stand the evidence body in a guard slot.
 *
 * Source-pin pattern (cf. site-mode-theme.test.ts): the stage is a
 * WebGL page with no DOM harness in this suite, so the wiring is
 * pinned by source and the assets by the filesystem.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = import.meta.dirname;
const stageSource = readFileSync(path.join(here, "showdown.ts"), "utf8");
const worldDir = path.resolve(here, "../../public/world");

describe("showdown stage — two generated-guard slots", () => {
  it("loads both slot files", () => {
    expect(stageSource).toContain('loadGlbFigure("/world/guard-gen.glb"');
    expect(stageSource).toContain('loadGlbFigure("/world/guard-gen-female.glb"');
  });

  it("stands the guards at mirrored posts, male's post unchanged", () => {
    expect(stageSource).toContain("wireFigure(fig, -1.65, true)");
    expect(stageSource).toContain("wireFigure(fig, 1.65, true)");
  });

  it("gives the female her own front correction (femrot), defaulted off the male's", () => {
    expect(stageSource).toContain('params.get("femrot")');
    expect(stageSource).toContain("genRot - Math.PI / 2");
  });

  it("has real bodies in both slots on disk", () => {
    for (const name of ["guard-gen.glb", "guard-gen-female.glb"]) {
      const st = statSync(path.join(worldDir, name));
      expect(st.size, `${name} should be a full GLB body`).toBeGreaterThan(1_000_000);
    }
  });

  it("keeps the Hunyuan evidence body preserved, and never loads it", () => {
    const st = statSync(path.join(worldDir, "guard-gen.hunyuan-evidence.glb"));
    expect(st.size).toBeGreaterThan(1_000_000);
    expect(stageSource).not.toContain("guard-gen.hunyuan-evidence.glb");
  });
});
