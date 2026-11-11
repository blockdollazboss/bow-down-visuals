/**
 * GamesPanels (the World game-room panels: arcade cabinet,
 * challenges, party) — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 2).
 *
 * - MY BESTS is a documented additive strip: it records only on
 *   ok, and a failed read leaves it quiet ("Non-fatal, as on
 *   the page") — no best is ever invented.
 * - THE SHARK DROP RAIL fails SILENT in the honest direction:
 *   an offer surfaces only from an ok response that parses to
 *   a real drop — "The rail stays silent on failure — no fake
 *   offers." Silence, never a fabricated reward.
 * - THE SCORE POST narrates from its checked response: non-ok
 *   throws the server's message; the saved outcome (and the
 *   board refresh) ride only the proven save.
 * - THE CHALLENGES PANEL is null-state per leg with a combined
 *   failure flag: weekly and hall-of-fame record independently
 *   and only on ok; the failed flag sets only when BOTH legs
 *   failed (or the read threw) — a partial landing keeps its
 *   data and the missing leg stays null rather than painting
 *   an empty contest. The standings leg is additive: "The
 *   contest card stands without its standings."
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panels = read("./GamesPanels.tsx");

describe("additive strips record only on proof", () => {
  it("my bests record only on ok; failure stays quiet by design", () => {
    expect(panels).toContain("if (!res.ok) return;");
    expect(panels).toContain("setMyBests(parseArcadeMe(await res.json()));");
    expect(panels).toContain("/* Non-fatal, as on the page: the bests strip just stays quiet. */");
  });

  it("a drop offer surfaces only from an ok parse — silence on failure, never a fake offer", () => {
    expect(panels).toContain("const drop = parseSharkDrop(await res.json());");
    expect(panels).toContain('if (drop) setDropState({ kind: "offer", drop });');
    expect(panels).toContain("/* The rail stays silent on failure — no fake offers. */");
  });
});

describe("the score post claims a save only from a proven response", () => {
  it("non-ok throws the server's message before the outcome records", () => {
    expect(panels).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldPrimitives.gmSaveFailedError")));');
    expect(panels).toContain("setOutcomes((prev) => ({ ...prev, [result.game]: outcomeForSavedScore(result.score, data) }));");
    expect(panels.indexOf("if (!res.ok) throw new Error(apiErrorMessage(data")).toBeLessThan(panels.indexOf("outcomeForSavedScore(result.score, data)"));
  });
});

describe("the challenges panel: per-leg nulls, failure only when both legs fail", () => {
  it("each leg records only on its own ok", () => {
    expect(panels).toContain("if (weeklyRes.ok) {");
    expect(panels).toContain("if (fameRes.ok && !cancelled) {");
    expect(panels).toContain("setCircle(parseHallOfFame(await fameRes.json()));");
  });

  it("the failed flag requires both legs down", () => {
    expect(panels).toContain("if (!weeklyRes.ok && !fameRes.ok && !cancelled) setFailed(true);");
  });

  it("the standings leg is additive — the card stands without it", () => {
    expect(panels).toContain("/* The contest card stands without its standings. */");
    expect(panels).toContain("if (detailRes.ok && !cancelled) {");
  });
});
