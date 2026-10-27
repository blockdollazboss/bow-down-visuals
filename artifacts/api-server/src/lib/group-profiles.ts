/**
 * group-profiles.ts — Duo/Group Profiles (Stack-200 UPGRADE N20): the
 * PUBLIC half of a team.
 *
 * What already exists and is NOT rebuilt here:
 *  - the internal team (lib/teams.ts + routes/teams.ts): creation,
 *    invites, roles, the shared credit pool;
 *  - the money half (lib/sale-splits.ts): a product's `splits` list
 *    dividing its net at fulfillment — flat 5% platform fee off the top
 *    first, shares snapshot at sale time, refunds reverse both sides.
 *
 * The delta: a duo/group as a first-class public creator identity —
 * ONE public profile page under the group name, ONE shared store,
 * members credited on the page, and the group's WRITTEN split terms
 * driving the existing sale-splits rail: creating a group store
 * product stamps the group's terms onto the product's `splits`, so
 * sales divide by the terms the group published. No second money path.
 *
 * Rules the write path enforces (the read path stays defensive):
 *  - split terms validate through the SAME sum-to-100 machine as
 *    product splits (validateProductSplits — owner holds a share,
 *    shares in (0, 100], ≤ 2 decimals, no duplicates);
 *  - every account in the terms must be an ACTIVE member of the bound
 *    team — a group can only promise shares to its own members;
 *  - the profile is a draft until published; unpublished = no public
 *    page, no public store listing.
 *
 * Pre-migration posture (0292_group_profiles not yet applied): reads
 * degrade to "no group profile" and writes answer 503 — the team and
 * storefront surfaces behave exactly as they did before N20.
 */
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  db,
  groupProfilesTable,
  teamMembersTable,
  teamsTable,
  creatorProfilesTable,
  storeProductsTable,
  type GroupProfile,
} from "@workspace/db";
import { validateProductSplits, SaleSplitError, type ProductSplit } from "./sale-splits";
import { logger } from "./logger";

export { SaleSplitError };

export class GroupProfileError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/* ── Pure helpers (unit-tested without a DB) ────────────────────────── */

export const GROUP_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

/** Normalize a proposed public handle. Returns null when the handle
 *  can never be a group slug (the DB check constraint agrees). */
export function normalizeGroupSlug(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const slug = input.trim().toLowerCase();
  return GROUP_SLUG_RE.test(slug) ? slug : null;
}

/**
 * Validate a group's written split terms: the product-splits machine
 * (sum to exactly 100, owner included) PLUS the group rule — every
 * account named must be an active member of the team. Returns the
 * normalized list, or null for "no written terms" (empty input, or a
 * lone owner at 100%, which the machine collapses to off). Throws
 * SaleSplitError / GroupProfileError with a member-facing message.
 */
export function validateGroupSplitTerms(
  ownerUserId: string,
  activeMemberUserIds: ReadonlySet<string>,
  input: unknown,
): ProductSplit[] | null {
  const valid = validateProductSplits(ownerUserId, input);
  if (!valid) return null;
  for (const row of valid) {
    if (!activeMemberUserIds.has(row.userId)) {
      throw new GroupProfileError(
        "split_member_missing",
        "Every share in the group's split terms must go to an active member of the team.",
      );
    }
  }
  return valid;
}

export interface GroupMemberCredit {
  userId: string;
  role: string;
  displayName: string;
  slug: string | null;
  avatarUrl: string | null;
  sharePct: number | null;
}

/**
 * The members-credited list for the public page: active members with a
 * creator profile resolve to their public identity; a member without
 * one is credited by role only (never invented a name). The share each
 * member holds under the group's written terms rides along — the page
 * shows the terms and the people they name in one place.
 */
export function buildMemberCredits(
  members: Array<{ userId: string | null; role: string; status: string }>,
  profilesByUserId: ReadonlyMap<string, { displayName: string; slug: string; avatarUrl: string | null }>,
  splitTerms: ProductSplit[] | null,
): GroupMemberCredit[] {
  const shareByUser = new Map((splitTerms ?? []).map((s) => [s.userId, s.sharePct]));
  const out: GroupMemberCredit[] = [];
  for (const m of members) {
    if (m.status !== "active" || !m.userId) continue;
    const profile = profilesByUserId.get(m.userId);
    out.push({
      userId: m.userId,
      role: m.role,
      displayName: profile?.displayName ?? "Team member",
      slug: profile?.slug ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
      sharePct: shareByUser.get(m.userId) ?? null,
    });
  }
  /* Owner first, then admins, then members — the credit order the
     group's own page presents. Stable within a role. */
  const rank: Record<string, number> = { owner: 0, admin: 1, member: 2 };
  return out.sort((a, b) => (rank[a.role] ?? 3) - (rank[b.role] ?? 3));
}

/* ── Probes (pre-migration posture) ─────────────────────────────────── */

let groupTableKnown: boolean | null = null;
export async function groupProfilesReady(): Promise<boolean> {
  if (groupTableKnown !== null) return groupTableKnown;
  try {
    const r = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'group_profiles' LIMIT 1
    `);
    groupTableKnown = r.rows.length > 0;
  } catch {
    groupTableKnown = false;
  }
  return groupTableKnown;
}

let groupColumnKnown: boolean | null = null;
export async function storeProductsHaveGroupColumn(): Promise<boolean> {
  if (groupColumnKnown !== null) return groupColumnKnown;
  try {
    const r = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'store_products' AND column_name = 'group_profile_id'
      LIMIT 1
    `);
    groupColumnKnown = r.rows.length > 0;
  } catch {
    groupColumnKnown = false;
  }
  return groupColumnKnown;
}

/* ── DB reads ───────────────────────────────────────────────────────── */

export async function getGroupProfileByTeam(teamId: string): Promise<GroupProfile | null> {
  if (!(await groupProfilesReady())) return null;
  const [row] = await db
    .select()
    .from(groupProfilesTable)
    .where(eq(groupProfilesTable.teamId, teamId))
    .limit(1);
  return row ?? null;
}

export async function getGroupProfileBySlug(slug: string): Promise<GroupProfile | null> {
  if (!(await groupProfilesReady())) return null;
  const [row] = await db
    .select()
    .from(groupProfilesTable)
    .where(eq(groupProfilesTable.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function getTeamRow(teamId: string) {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId)).limit(1);
  return team ?? null;
}

export async function listActiveMemberUserIds(teamId: string): Promise<Set<string>> {
  const rows = await db
    .select({ userId: teamMembersTable.userId })
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.status, "active")));
  return new Set(rows.map((r) => r.userId).filter((u): u is string => !!u));
}

/** Members credited for the public page, resolved against creator
 *  profiles. Defensive: any failure degrades to an empty credit list —
 *  the group page itself still renders. */
export async function creditedMembers(group: GroupProfile): Promise<GroupMemberCredit[]> {
  try {
    const members = await db
      .select()
      .from(teamMembersTable)
      .where(eq(teamMembersTable.teamId, group.teamId));
    const userIds = members.map((m) => m.userId).filter((u): u is string => !!u);
    const profiles = userIds.length
      ? await db
          .select({
            userId: creatorProfilesTable.userId,
            displayName: creatorProfilesTable.displayName,
            slug: creatorProfilesTable.slug,
            avatarUrl: creatorProfilesTable.avatarUrl,
          })
          .from(creatorProfilesTable)
          .where(inArray(creatorProfilesTable.userId, userIds))
      : [];
    const byUser = new Map(profiles.map((p) => [p.userId, p]));
    return buildMemberCredits(members, byUser, group.splitTerms ?? null);
  } catch (err) {
    logger.warn({ err, groupId: group.id }, "[group-profiles] member credits degraded");
    return [];
  }
}

/** The shared store: active products sold under the group name. */
export async function listGroupStoreProducts(groupId: string) {
  if (!(await storeProductsHaveGroupColumn())) return [];
  const rows = await db
    .select()
    .from(storeProductsTable)
    .where(and(eq(storeProductsTable.groupProfileId, groupId), eq(storeProductsTable.isActive, true)));
  return rows.map((p) => ({
    id: p.id,
    kind: p.kind,
    title: p.title,
    description: p.description,
    priceCents: p.priceCents,
    compareAtCents: p.compareAtCents,
    inventory: p.inventory,
    mediaUrls: p.mediaUrls,
    splits: p.splits ?? null,
  }));
}
