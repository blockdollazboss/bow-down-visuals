/**
 * ReachWatchPanel (the live-watch progress / loyalty / raid
 * panel) — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * - THE HEARTBEAT is the exemplar: a malformed success is a
 *   load failure, never a fake budget — the payload is
 *   normalized-or-thrown into the catch, which lands on the
 *   progressError state (the source cites the DTO guard).
 * - THE RAID POLL settles its two halves independently
 *   (allSettled): one endpoint hiccupping never discards the
 *   other half's fresh state; a failed poll is silent BY
 *   DESIGN (the next 3s poll retries, and stale raid state
 *   is never dressed as fresh).
 * - THE OWNERSHIP SELF-CHECK fails toward viewer-side: a
 *   failed check never claims ownership it couldn't prove.
 * - THE LOYALTY READS keep the last proven state on failure
 *   (normalize-or-undefined), never a fabricated zero.
 * - FIX (this tranche): THE RAID-TARGET LIST dressed a
 *   failed load as a fact about the world — a non-ok or
 *   thrown read left the select empty under the copy
 *   "Nobody else is live right now", which a failure cannot
 *   prove. The load now records raidTargetsFailed, and the
 *   empty-select line splits: proven-empty keeps the
 *   nobody-live copy; failed shows a couldn't-load line.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ReachWatchPanel.tsx");

describe("the heartbeat treats a malformed success as a load failure", () => {
  it("normalize-or-throw lands failures on the progress-error state", () => {
    expect(src).toContain('if (!p) throw new Error("malformed watch progress");');
    expect(src).toContain("if (!cancelled) setProgressError(true);");
    expect(src).toContain("setProgressError(false);");
  });
});

describe("the raid poll settles its halves independently", () => {
  it("one half's failure never discards the other's fresh state", () => {
    expect(src).toContain("const [outR, incR] = await Promise.allSettled([");
    expect(src).toContain('if (incR.status === "fulfilled") setIncoming(incR.value.raid);');
    expect(src).toContain("/* a failed poll is silent — the next one retries */");
  });
});

describe("FIX: the raid-target list separates failed from proven-empty", () => {
  it("the load records failure in its own state", () => {
    expect(src).toContain("const [raidTargetsFailed, setRaidTargetsFailed] = useState(false);");
    expect(src).toContain("if (!res.ok) { setRaidTargetsFailed(true); return; }");
    expect(src).toContain("setRaidTargetsFailed(false);");
  });

  it("the empty-select line splits proven-empty from failed", () => {
    expect(src).toContain("Nobody else is live right now — a raid needs a live target.");
    expect(src).toContain("Couldn&apos;t load who&apos;s live right now");
  });
});
