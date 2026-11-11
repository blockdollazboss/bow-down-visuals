/**
 * CoachPanels (the World Coach Money panels) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 2).
 *
 * - THE MONEY LEDGER: a non-ok read throws into loadFailed;
 *   entries record only from a proven payload, and the stats
 *   derive only when entries exist (entries null → stats null).
 * - THE PLAN PAIR (plan-numbers + action-items) settles PER LEG
 *   via Promise.allSettled: each leg records only from a
 *   fulfilled, ok, parseable response — a rejected leg, a
 *   non-ok leg, a declined confirmation (null), and a payload
 *   that parses to null EACH land on that leg's own failed flag
 *   (numbersFailed / itemsFailed). Neither leg's failure can
 *   dress up as the other's data, and neither paints an empty
 *   state.
 * - THE RELEASE PICKER rides the shared fetchReleaseOptions
 *   helper: an additive linking picker whose contract is
 *   fail-quiet (any failure returns no options; ledger entries
 *   still log unlinked) — classified, unchanged.
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panels = read("./CoachPanels.tsx");

describe("the money ledger: failure is a flag, never an empty ledger", () => {
  it("a non-ok read throws into loadFailed; success records + clears it", () => {
    expect(panels).toContain('if (!res.ok) throw new Error("money");');
    expect(panels).toContain("setEntries(parsed);");
    expect(panels).toContain("setLoadFailed(false);");
    expect(panels).toContain("if (!cancelled) setLoadFailed(true);");
  });

  it("stats derive only when entries actually landed", () => {
    expect(panels).toContain("const stats = entries ? ledgerStats(entries, monthKey) : null;");
  });
});

describe("the plan pair settles per leg, each with its own failed flag", () => {
  it("both legs ride allSettled so one failure cannot take the other down", () => {
    expect(panels).toContain("const [nRes, iRes] = await Promise.allSettled([");
  });

  it("numbers record only from a fulfilled ok parse — every other outcome fails the leg", () => {
    expect(panels).toContain('if (nRes.status === "fulfilled" && nRes.value && nRes.value.ok) {');
    expect(panels).toContain("setNumbers(parsed);");
    expect(panels).toContain("setNumbersFailed(false);");
    expect(panels).toContain("setNumbersFailed(true);");
  });

  it("items mirror it with itemsFailed", () => {
    expect(panels).toContain('if (iRes.status === "fulfilled" && iRes.value && iRes.value.ok) {');
    expect(panels).toContain("setItems(parsedItems);");
    expect(panels).toContain("setItemsFailed(false);");
    expect(panels).toContain("setItemsFailed(true);");
  });
});

describe("the release picker is an additive fail-quiet helper — classified", () => {
  it("the panel records whatever the helper lands, options or none", () => {
    expect(panels).toContain("const options = await fetchReleaseOptions(confirmedFetch);");
    expect(panels).toContain("if (!cancelled) setReleaseOptions(options);");
  });
});
