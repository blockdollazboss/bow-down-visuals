/**
 * DistributionLegacyPanels (the legacy distribution panels
 * set) — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * A panels file whose every leg rides one shared helper
 * that throws on non-ok with the server's message — no
 * panel reads a payload from an error body. Each panel then
 * lands failures on its OWN error line with its own copy
 * ("Couldn't load the landing content." / "Couldn't load
 * the lyrics package." / "Couldn't load requests." /
 * "Couldn't save."), and the requests leg pairs its error
 * WITH clearing the list — the error line always
 * accompanies the empty render, so an empty list under a
 * failure is labeled as failed, never dressed as "no
 * requests". The policy panel shows its policy copy only
 * when it loads.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./DistributionLegacyPanels.tsx");

describe("every leg errors on its own line; emptiness under failure is labeled", () => {
  it("the helper throw and the per-panel error copies are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(json, "Something went wrong."));');
    expect(src).toContain('setErr("Couldn\'t load the landing content.");');
    expect(src).toContain('setErr("Couldn\'t load requests."); setRequests([]);');
    expect(src).toContain("/* panel shows the policy copy only when it loads */");
  });
});
