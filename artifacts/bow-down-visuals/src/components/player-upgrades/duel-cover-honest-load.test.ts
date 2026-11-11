/**
 * DuelCover (the showcase A/B duel cover wrapper) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * An ok-gated enhancement wrapper, pinned as-is: the duel
 * cover replaces the wrapped (normal) cover ONLY from an ok
 * response carrying a duel entry — any failure leaves the
 * children rendering exactly as they were, so a failed duel
 * read can never blank or mislabel a public showcase cover.
 * The click beacon exists only once a duel cover is
 * actually served (handleClick returns without one) and is
 * fire-and-forget with keepalive — analytics, never a gate.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./DuelCover.tsx");

describe("the duel cover serves only from a proven duel entry", () => {
  it("the ok gate and the click guard are pinned", () => {
    expect(src).toContain(".then((r) => (r.ok ? r.json() : null))");
    expect(src).toContain("if (live && d?.duel) setServed({ cover: d.duel.cover, coverUrl: d.duel.coverUrl });");
    expect(src).toContain("if (!served) return;");
  });
});
