/**
 * LiveBattlesPanel (live battles on a stream) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A live-poll surface, pinned on the poll doctrine (the
 * CheatCodeJackpot status shape): every read is ok-gated —
 * the crown read returns silently on non-ok, and the battle
 * reads set state ONLY inside `if (res.ok)` — so a failed
 * poll holds the last proven battle state exactly as it
 * was. A live surface never blanks real, current data over
 * a transient failure, and never fabricates a battle from
 * an error body.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LiveBattlesPanel.tsx");

describe("every poll read is ok-gated; failure holds the proven state", () => {
  it("the gates are pinned", () => {
    expect(src).toContain("if (!res.ok) return;");
    expect(src).toContain("if (res.ok) setStreamBattle((data.battle as LiveBattle | null) ?? null);");
    expect(src).toContain("if (res.ok) setMine((data.battles as LiveBattle[]) ?? []);");
  });
});
