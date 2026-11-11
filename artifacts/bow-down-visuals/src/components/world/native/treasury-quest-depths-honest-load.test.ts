/**
 * TreasuryQuestDepths — honest load standard (deep-pins tranche 3,
 * batch 9). The depths' boards load INDEPENDENTLY (the quest-marks
 * effect's own comment: "one board failing never takes the other
 * down with it"). The main bundle: history throws on a misshapen
 * payload into historyFailed, while the streak and daily-bonus legs
 * are gated reads — an ok answer with a shaped payload lands, a
 * non-ok answer simply leaves them unset (the history rides on its
 * own track). The standings board and the quest-marks board each
 * throw on non-ok AND on a misshapen payload into their OWN failed
 * flag (boardFailed / marksFailed), retryable per the failed-state
 * family. States settle only from parsed payloads.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TreasuryQuestDepths.tsx");

describe("the boards — independent failures, parsed-only states", () => {
  it("history failure is its own flag; the streak/bonus legs are gated on ok", () => {
    expect(src).toContain("if (!normalized) throw new Error(\"history payload\");");
    expect(src).toContain("if (!cancelled) setHistoryFailed(true);");
    expect(src).toContain("if (streakRes.ok) {");
    expect(src).toContain("if (bonusRes.ok) {");
  });

  it("standings and quest-marks each throw into their own failed flag", () => {
    expect(src).toContain("its own fetch, its own honest states; one board failing never");
    expect(src).toContain("if (!res.ok) throw new Error(\"leaderboard\");");
    expect(src).toContain("if (!normalized) throw new Error(\"leaderboard payload\");");
    expect(src).toContain("if (!cancelled) setBoardFailed(true);");
    expect(src).toContain("if (!res.ok) throw new Error(\"quest marks\");");
    expect(src).toContain("if (!normalized) throw new Error(\"quest marks payload\");");
    expect(src).toContain("if (!cancelled) setMarksFailed(true);");
  });
});
