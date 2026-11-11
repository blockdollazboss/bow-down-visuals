/**
 * LookRailsPanel (the SceneStudio director-look rails) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A SceneStudio sibling of EffectsRail: the look proposal
 * applies only from an ok response carrying the proposal
 * (`!res.ok || !data.proposal` routes to the failure path)
 * — a look rail never populates from an error body or an
 * ok-but-empty answer, so the director's rails always show
 * a real proposed look or an honest failure.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LookRailsPanel.tsx");

describe("the look applies only from an ok response carrying the proposal", () => {
  it("the gate is pinned", () => {
    expect(src).toContain("if (!res.ok || !data.proposal) {");
  });
});
