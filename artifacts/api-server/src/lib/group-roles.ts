/** group-roles.ts — group permission ladder (Stack 10 #7). Pure.
 *  Ladder: owner > admin > moderator > member. Legacy stored "mod"
 *  normalizes to "moderator". Every group action names the minimum
 *  rung it needs; enforcement is `canGroupAction(role, action)`. */
export type GroupRoleName = "owner" | "admin" | "moderator" | "member";
export const GROUP_ROLE_RANK: Record<GroupRoleName, number> = { owner: 4, admin: 3, moderator: 2, member: 1 };

export function normalizeGroupRole(v: unknown): GroupRoleName | null {
  if (v === "mod") return "moderator";
  if (v === "owner" || v === "admin" || v === "moderator" || v === "member") return v;
  return null;
}

export const GROUP_ACTIONS = {
  post: "member",
  deletePost: "moderator",       // own posts are handled by authorship, not this ladder
  reviewJoinRequests: "moderator",
  setJoinQuestions: "admin",
  removeMember: "admin",
  setMemberRole: "admin",
  transferOwnership: "owner",
  deleteGroup: "owner",
} as const satisfies Record<string, GroupRoleName>;
export type GroupAction = keyof typeof GROUP_ACTIONS;

export function canGroupAction(role: unknown, action: GroupAction): boolean {
  const r = normalizeGroupRole(role);
  if (!r) return false;
  return GROUP_ROLE_RANK[r] >= GROUP_ROLE_RANK[GROUP_ACTIONS[action]];
}

/** Roles an actor may assign: strictly below their own rung, and only
 *  an owner can touch the owner rung. */
export function canAssignRole(actorRole: unknown, targetRole: unknown, newRole: unknown): boolean {
  const actor = normalizeGroupRole(actorRole), target = normalizeGroupRole(targetRole), next = normalizeGroupRole(newRole);
  if (!actor || !target || !next) return false;
  if (!canGroupAction(actor, "setMemberRole")) return false;
  // Ownership itself only moves through the transfer flow, never a role edit.
  if (target === "owner" || next === "owner") return false;
  // You can only move people strictly below your own rung, to a rung
  // strictly below your own (an owner assigning admin is 3 < 4: fine).
  return GROUP_ROLE_RANK[target] < GROUP_ROLE_RANK[actor] && GROUP_ROLE_RANK[next] < GROUP_ROLE_RANK[actor];
}
