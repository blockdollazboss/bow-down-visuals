/* ─── Co-releases — DB-facing helpers (Stack-100 #3 Wave 3) ────────────────
   Thin translation between `co_releases` + `co_release_sides` rows and
   the pure consent machine (lib/co-releases.ts), following the phase-1
   co-posts-db.ts pattern exactly:
   - WRITE paths use the unguarded loaders and let the route translate
     a missing table (42P01) into the honest 503 CO_RELEASE_NOT_READY.
   - READ paths are GUARDED: any side-table failure degrades to
     "no co-releases yet", so enrichment can never 500 a surface
     (resilience law — one bad section never takes a page down). */

import { eq, inArray } from "drizzle-orm";
import { db, coReleasesTable, coReleaseSidesTable, creatorProfilesTable } from "@workspace/db";
import { isMissingCoReleaseTable, type CoRelease, type CoReleaseSide } from "./co-releases";
import { logger } from "./logger";

type CoReleaseRow = typeof coReleasesTable.$inferSelect;
type SideRow = typeof coReleaseSidesTable.$inferSelect;
type CreatorProfileRow = typeof creatorProfilesTable.$inferSelect;

export function rowsToCoRelease(head: CoReleaseRow, rows: SideRow[]): CoRelease | null {
  const mine = rows.filter((r) => r.co_release_id === head.id);
  if (mine.length === 0) return null;
  const sides: CoReleaseSide[] = mine.map((r) => ({
    profileId: r.profile_id,
    userId: r.user_id,
    role: r.role === "author" ? "author" : "co_author",
    status: r.status as CoReleaseSide["status"],
    sharePct: Number(r.share_pct),
    acceptedAt: r.accepted_at ?? null,
  }));
  sides.sort((a, b) => (a.role === b.role ? 0 : a.role === "author" ? -1 : 1));
  /* The agreed split is reconstructed ONLY from the frozen columns —
     never from the (pre-publish, mutable) proposed shares. */
  const agreedShares =
    head.published_at && mine.every((r) => r.agreed_share_pct !== null && r.agreed_share_pct !== undefined)
      ? mine
          .slice()
          .sort((a, b) => (a.role === b.role ? 0 : a.role === "author" ? -1 : 1))
          .map((r) => ({ profileId: r.profile_id, sharePct: Number(r.agreed_share_pct) }))
      : null;
  return {
    id: head.id,
    itemKind: head.item_kind === "product" ? "product" : "release",
    itemId: head.item_id,
    sides,
    agreedShares,
    publishedAt: head.published_at ?? null,
  };
}

/** Unguarded single load (write paths): throws on a missing table so
 *  the route can answer 503. Null = no such co-release. */
export async function loadCoRelease(id: string): Promise<{ head: CoReleaseRow; co: CoRelease } | null> {
  const [head] = await db.select().from(coReleasesTable).where(eq(coReleasesTable.id, id)).limit(1);
  if (!head) return null;
  const rows = await db.select().from(coReleaseSidesTable).where(eq(coReleaseSidesTable.co_release_id, id));
  const co = rowsToCoRelease(head, rows);
  return co ? { head, co } : null;
}

/** Probe used by WRITE routes BEFORE any row is written: if the tables
 *  aren't there yet, the write must fail cleanly with nothing created
 *  and nobody notified. */
export async function probeCoReleaseTables(): Promise<void> {
  await db.select({ id: coReleasesTable.id }).from(coReleasesTable).limit(1);
  await db.select({ id: coReleaseSidesTable.id }).from(coReleaseSidesTable).limit(1);
}

/** Guarded batch load for READ paths — degrades to empty on ANY
 *  failure (not migrated yet, test fake, transient error). */
export async function loadCoReleasesGuarded(
  ids: string[],
): Promise<Map<string, { head: CoReleaseRow; co: CoRelease }>> {
  const out = new Map<string, { head: CoReleaseRow; co: CoRelease }>();
  if (ids.length === 0) return out;
  try {
    const heads = await db.select().from(coReleasesTable).where(inArray(coReleasesTable.id, ids));
    if (heads.length === 0) return out;
    const rows = await db
      .select()
      .from(coReleaseSidesTable)
      .where(inArray(coReleaseSidesTable.co_release_id, heads.map((h) => h.id)));
    for (const head of heads) {
      const co = rowsToCoRelease(head, rows);
      if (co) out.set(head.id, { head, co });
    }
  } catch (err) {
    if (isMissingCoReleaseTable(err)) {
      logger.debug("[co-releases] tables not present yet — serving without co-release data");
    } else {
      logger.warn({ err }, "[co-releases] read failed — serving without co-release data");
    }
  }
  return out;
}

export interface CoReleaseSideSummary {
  profile_id: string;
  user_id: string;
  role: string;
  status: string;
  share_pct: number;
  agreed_share_pct: number | null;
  accepted_at: Date | string | null;
  display_name: string | null;
  slug: string | null;
  avatar_url: string | null;
  is_verified: boolean;
}

export function coReleaseSideSummaries(
  co: CoRelease,
  profilesById: Map<string, CreatorProfileRow>,
): CoReleaseSideSummary[] {
  const agreed = new Map((co.agreedShares ?? []).map((s) => [s.profileId, s.sharePct]));
  return co.sides.map((s) => {
    const p = profilesById.get(s.profileId);
    return {
      profile_id: s.profileId,
      user_id: s.userId,
      role: s.role,
      status: s.status,
      share_pct: s.sharePct,
      agreed_share_pct: agreed.get(s.profileId) ?? null,
      accepted_at: s.acceptedAt,
      display_name: p?.displayName ?? null,
      slug: p?.slug ?? null,
      avatar_url: p?.avatarUrl ?? null,
      is_verified: p?.isVerified ?? false,
    };
  });
}

export async function fetchProfilesByIdCoRelease(
  profileIds: string[],
): Promise<Map<string, CreatorProfileRow>> {
  if (profileIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(creatorProfilesTable)
    .where(inArray(creatorProfilesTable.id, [...new Set(profileIds)]));
  return new Map(rows.map((r) => [r.id, r]));
}
