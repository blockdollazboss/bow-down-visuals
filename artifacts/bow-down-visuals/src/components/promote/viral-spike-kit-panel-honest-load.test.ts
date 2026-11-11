/**
 * ViralSpikeKitPanel (viral-spike kits) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * The settings-family load machine: loadError state with
 * its own rendered card (promote.viralSpike.loadError)
 * ahead of the loading line, a throw on non-ok ("load
 * failed") into it — and the RESULT's own status is
 * rendered as itself, including the proven "disabled"
 * state: a kit that the server says is disabled shows as
 * disabled, never as active. A failed load never paints
 * kit defaults as the member's saved kits.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ViralSpikeKitPanel.tsx");

describe("load failure is a card; the result status renders as itself", () => {
  it("the machine and the disabled branch are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain("if (!cancelled) setLoadError(true);");
    expect(src).toContain('t("promote.viralSpike.loadError")');
    expect(src).toContain('result.status === "disabled"');
  });
});
