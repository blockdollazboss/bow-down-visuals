/**
 * SocialProofBand — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The band renders REAL platform
 * aggregates from GET /api/public/stats on the homepage and other
 * marketing surfaces. Its honesty contract is quiet-by-design: the
 * load resolves to null on ANY failure (non-ok or network), and the
 * band renders NOTHING until real data with at least one creator
 * has arrived — it never displays invented numbers, a fake "0
 * creators" state, or placeholder stats. Individual zero stats are
 * dropped from the grid rather than printed as dead zeros.
 *
 * The FE suite runs in node (no DOM), so — like the sibling
 * honest-load pins — these tests pin the state machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const band = read("./SocialProofBand.tsx");

describe("failure path — a failed stats load never reads as real numbers", () => {
  it("the shared fetch maps a non-ok response to null", () => {
    expect(band).toContain('fetch("/api/public/stats", { credentials: "same-origin" })');
    expect(band).toContain(".then((r) => (r.ok ? (r.json() as Promise<PublicStats>) : null))");
  });

  it("a network failure resolves to null in the catch", () => {
    expect(band).toContain(".catch(() => null)");
  });

  it("a failed load clears the module cache so a later mount can retry", () => {
    expect(band).toContain("if (!d) statsPromise = null;");
  });

  it("the hook state starts at null and only ever receives the fetch result", () => {
    expect(band).toContain("useState<PublicStats | null>(null)");
    expect(band).toContain("if (live) setStats(d);");
  });
});

describe("the band renders only from a successful, non-empty load", () => {
  it("readiness requires real stats with at least one creator", () => {
    expect(band).toContain("const ready = stats !== null && stats.creators > 0;");
  });

  it("the whole band returns null before it is ready — no empty state, no zeros", () => {
    expect(band).toContain("if (!ready) return null;");
  });

  it("every displayed count is fed by the loaded stats, gated on ready", () => {
    expect(band).toContain("useCountUp(ready ? stats.creators : null, inView && ready)");
    expect(band).toContain("useCountUp(ready ? stats.plays : null, inView && ready)");
    expect(band).toContain("useCountUp(ready ? stats.referral_bucs_awarded : null, inView && ready)");
  });

  it("zero-valued stats are dropped from the grid instead of printed as dead zeros", () => {
    expect(band).toContain("].filter((s) => s.raw > 0);");
  });
});
