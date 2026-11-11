/**
 * WidgetsDeskPanel (embed widgets desk) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE WIDGETS LOAD is a three-state surface: the loading
 *   line renders only while `!mine && !loadFailed`; a
 *   non-ok or thrown load lands on loadFailed with its own
 *   copy ("Couldn't load your widgets just now — refresh
 *   the page and they'll be here.") — the desk never paints
 *   an empty widget set as the member's proven one.
 * - THE REFCODE leg degrades alone and honestly: the code
 *   prefills only from an ok response carrying a string
 *   code, and its failure is commented with its doctrine —
 *   "the code simply goes out without a ref — never a
 *   blocker" — an embed is never held hostage by its
 *   tracking decoration.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./WidgetsDeskPanel.tsx");

describe("loading, failed, and proven are three separate renders", () => {
  it("the state split and the refcode doctrine are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error("mine failed");');
    expect(src).toContain("{!mine && !loadFailed && (");
    expect(src).toContain("Couldn't load your widgets just now — refresh the page and they'll be here.");
    expect(src).toContain("/* the code simply goes out without a ref — never a blocker */");
  });
});
