/**
 * SponsorDashboardPanel (the sponsor money dashboard) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A money dashboard whose header states the doctrine
 * outright: never "paint a fake $0.00 / 0 / 0 during loading
 * or after a failure". The loader honors it — signed-out
 * settles loading without a fetch; non-ok throws the
 * server's message into the error state; the figures render
 * only from the proven dashboard payload. A sponsor's money
 * numbers are never zero-filled placeholders.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SponsorDashboardPanel.tsx");

describe("money figures render only from the proven payload", () => {
  it("the doctrine, the throw, and the signed-out settle are pinned", () => {
    expect(src).toContain("paint a fake $0.00 / 0 / 0 during loading or after a failure");
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("sponsorDashboard.errorLoadDashboard")));');
    expect(src).toContain("if (!user) { setLoading(false); return; }");
  });
});
