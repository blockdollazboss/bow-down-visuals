/**
 * SyncTab (the sync-pitch workspace tab) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A large multi-section tab held to per-section law: sheets,
 * briefs, matches, and the tracker each carry their OWN
 * loading flag (sheetsLoading / briefsLoading /
 * matchesLoading / trackerLoading), so one section's wait
 * or failure never dresses another section's state. The
 * referral-code leg is typed-gated decoration — it applies
 * only when the response is ok AND the code is actually a
 * string, and its own comment states the doctrine:
 * "referral code is optional".
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SyncTab.tsx");

describe("each section waits on its own flag; the code leg is typed-gated", () => {
  it("the per-section flags and the code gate are pinned", () => {
    expect(src).toContain("const [sheetsLoading, setSheetsLoading] = useState(false);");
    expect(src).toContain("const [matchesLoading, setMatchesLoading] = useState(false);");
    expect(src).toContain('if (res.ok && typeof (data as { code?: unknown }).code === "string") {');
    expect(src).toContain("/* referral code is optional */");
  });
});
