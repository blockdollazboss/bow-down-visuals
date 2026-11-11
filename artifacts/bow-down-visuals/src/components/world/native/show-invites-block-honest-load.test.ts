/**
 * ShowInvitesBlock (the in-World show invites block) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE MY-EVENTS load throws on non-ok ("mine failed")
 *   into its own catch, and its payload parse is null-safe
 *   (res.json().catch(() => null)) — invites render only
 *   from a proven payload, never from an error body read as
 *   an empty invite list.
 * - THE MEMBERS leg has its own loading line
 *   (invMembersLoading) — the block never paints a member
 *   list, or its absence, before that leg proves.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ShowInvitesBlock.tsx");

describe("invites load proven or not at all", () => {
  it("the throw, the null-safe parse, and the members loading line are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error("mine failed");');
    expect(src).toContain("const payload: unknown = await res.json().catch(() => null);");
    expect(src).toContain('t("worldScheduleRelease.invMembersLoading")');
  });
});
