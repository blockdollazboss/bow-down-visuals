/**
 * LiveDesksPanel (the in-World live desks registry panel) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A classification pin: this panel owns NO load of its own
 * — it is the registry/composition surface that mounts the
 * live desks, each of which loads and proves its own data
 * (the desks' own pins carry their machines; the panel's
 * copy says so itself: each desk is "registry-priced
 * through confirmedFetch"). There is no fetch, no state
 * built from a response, and therefore no surface here that
 * could dress a failure as data — the honest-load surface
 * of this file is exactly that absence.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LiveDesksPanel.tsx");

describe("the panel owns no load — data honesty lives in the desks it mounts", () => {
  it("no fetch exists in this file to dress anything up", () => {
    expect(src).not.toContain("fetch(");
    expect(src).not.toContain("confirmedFetch(");
    expect(src).toContain("registry-priced through confirmedFetch");
  });
});
