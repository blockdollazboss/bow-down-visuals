/**
 * group-ladder-truth.test.ts — source pins for the group ladder's
 * client side (stack1100 groups/forum truth lane).
 *
 * The contract: group clients render ONLY the controls the API's
 * ladder will honour, from caps the SERVER computes per member —
 * never from a locally re-derived ladder:
 *  - group-detail's Remove button rides the member row's can_remove
 *    (admin+ viewers, targets strictly below their rung) — not the
 *    old owner-only condition that hid the button from admins the
 *    ladder empowers, and not a bare role check.
 *  - GroupOnboarding's role buttons ride the member row's
 *    assignable_roles (canAssignRole, server-side) — not the old
 *    hardcoded role list that offered changes on the owner's row and
 *    on peers-or-above, every one of which could only 403.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync(new URL("./group-detail.tsx", import.meta.url), "utf8");
const onboarding = readFileSync(new URL("../components/trust/GroupOnboarding.tsx", import.meta.url), "utf8");

describe("group-detail — member removal rides the server cap", () => {
  it("the Remove button renders from the member's can_remove cap", () => {
    expect(detail).toContain("{m.can_remove && (");
    expect(detail).toContain("onClick={() => removeMember(m.user_id)}");
  });

  it("the moderation buttons ride the server caps, not an owner check", () => {
    /* Joined stack1400: this pin used to forbid the string
       'isOwner && m.role !== "owner"' outright — it was the old
       owner-only REMOVE condition. Ruling #10's ownership-transfer
       button legitimately carries that condition now (only the owner
       can hand over ownership; the server enforces it too). The
       invariant that matters: Remove and Ban open under their
       server-computed caps, and the row's only owner-gated button is
       the transfer. */
    const row = detail.slice(detail.indexOf("flex shrink-0 items-center gap-3"));
    const removeAt = row.indexOf("removeMember(m.user_id)");
    const banAt = row.indexOf("banMember(m.user_id)");
    const transferAt = row.indexOf("transferOwnership(m)");
    expect(removeAt).toBeGreaterThan(0);
    expect(banAt).toBeGreaterThan(0);
    expect(transferAt).toBeGreaterThan(0);
    expect(row.slice(Math.max(0, removeAt - 260), removeAt)).toContain("m.can_remove");
    expect(row.slice(Math.max(0, banAt - 260), banAt)).toContain("m.can_ban");
    expect(row.slice(Math.max(0, transferAt - 260), transferAt)).toContain("isOwner");
  });

  it("the Member contract carries the server-computed caps", () => {
    expect(detail).toContain("can_remove: boolean; assignable_roles: string[]");
  });
});

describe("GroupOnboarding — role buttons ride assignable_roles", () => {
  it("buttons are offered from the member's assignable_roles", () => {
    expect(onboarding).toContain("(m.assignable_roles ?? []).filter(");
    expect(onboarding).toContain("assignable_roles?: string[]");
  });

  it("the hardcoded every-role offer list is gone", () => {
    expect(onboarding).not.toContain('(["admin", "moderator", "member"] as const).filter(');
  });
});
