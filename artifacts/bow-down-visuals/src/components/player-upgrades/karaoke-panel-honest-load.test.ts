/**
 * KaraokePanel (karaoke take recording + save) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * Both of the panel's server legs gate on the full
 * proven-response condition `!res || !res.ok` — a declined
 * credit confirmation (null) and a refused response take
 * the same honest failure path, so a take is never shown as
 * loaded or saved on either. The save leg's failure copy
 * says exactly what didn't happen: "The take didn't save."
 * — the member is never left believing a take is stored
 * that isn't.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./KaraokePanel.tsx");

describe("null and non-ok take the same honest failure path", () => {
  it("both full-condition gates are pinned", () => {
    expect(src.split("if (!res || !res.ok)").length - 1).toBeGreaterThanOrEqual(2);
    expect(src).toContain('throw new Error(apiErrorMessage(data, "The take didn\'t save."));');
  });
});
