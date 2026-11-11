/**
 * PaidSeriesDropsDesk (the World paid-series + drops desk) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 2).
 *
 * - MY SERIES: a non-ok read throws, and a payload that parses
 *   to null throws too — both land on mineFailed; the list and
 *   its price inputs seed only from a proven payload.
 * - CREATE applies server truth only: the new row prepended to
 *   the shelf is the SERVER's parsed saved record — an ok
 *   response without a parseable series throws
 *   (seriesCreateEmpty) instead of shelving the form's guess,
 *   and the "created" note rides that proven row.
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./PaidSeriesDropsDesk.tsx");

describe("my series: non-ok and unparseable are both failures", () => {
  it("the read throws on non-ok and on a null parse before recording", () => {
    expect(desk).toContain('if (!res.ok) throw new Error("mine");');
    expect(desk).toContain("const parsed = parseMySeries(await res.json());");
    expect(desk).toContain('if (parsed === null) throw new Error("mine");');
    expect(desk).toContain("setMine(parsed);");
    expect(desk).toContain("setMineFailed(false);");
    expect(desk).toContain("if (!cancelled) setMineFailed(true);");
    expect(desk.indexOf("if (parsed === null)")).toBeLessThan(desk.indexOf("setMine(parsed);"));
  });
});

describe("create shelves the server's row, never the form's guess", () => {
  it("an ok without a parseable series throws; the note rides the proven row", () => {
    expect(desk).toContain("const saved = parseSavedSeries(data);");
    expect(desk).toContain('if (!saved) throw new Error(t("worldCommerceStands.seriesCreateEmpty"));');
    expect(desk).toContain("setMine((m) => (m ? [saved, ...m] : [saved]));");
    expect(desk).toContain('setSeriesNote(t("worldCommerceStands.seriesCreatedNote", { title: saved.title }));');
    expect(desk.indexOf("if (!saved) throw")).toBeLessThan(desk.indexOf("setMine((m) =>"));
  });
});
