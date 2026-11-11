/**
 * Wave8MusicBenches (the in-World wave8 music benches —
 * ad-lib leg) — honest action states (Stack-400 C-28
 * components residual, deep-pins tranche 6).
 *
 * A native-bench twin of the 2D wave8 tools: credits get
 * their own branch (402 status or the body's out_of_credits
 * code), and the result renders only from `!res.ok ||
 * !parsed` inverted — a parsed proven payload. The hub-tray
 * save after success is wrapped non-fatal with its reason
 * stated ("the hub tray is a bonus, not the result") — the
 * proven result is already on the bench; the bonus save
 * never errors over it.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./Wave8MusicBenches.tsx");

describe("the result requires a parsed proven payload", () => {
  it("the taxonomy and the parse gate are pinned", () => {
    expect(src).toContain("res.status === 402 ||");
    expect(src).toContain("if (!res.ok || !parsed) {");
    expect(src).toContain("/* non-fatal — the hub tray is a bonus, not the result */");
  });
});
