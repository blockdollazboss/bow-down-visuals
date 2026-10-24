/* ─── Co-posts — DB-facing helpers (Stack-100 #3, #24) ──────────────────────
   The pure consent machine lives in lib/co-posts.ts; this module is the
   thin translation between `post_co_authors` rows and that machine, plus
   the profile summaries every co-post surface renders.

   The table exists only after held migration 0205 (.lane/MIGRATION-
   NEEDED.md). Read helpers here are GUARDED: a missing table means "no
   co-posts exist yet" and yields empty results, so Feed / profile reads
   behave exactly as before until the migration lands. Write paths use
   the unguarded loaders and let the caller translate 42P01 into the
   honest 503 (lib/co-posts CO_POST_NOT_READY). */

import { eq, inArray } from "drizzle-orm";
import {
  db,
  postCoAuthorsTable,
  creatorProfilesTable,
} from "@workspace/db";
import {
  isMissingCoPostTable,
  type CoPost,
  type CoPostSide,
} from "./co-posts";
import { logger } from "./logger";

type CoAuthorRow = typeof postCoAuthorsTable.$inferSelect;
type CreatorProfileRow = typeof creatorProfilesTable.$inferSelect;

export function rowsToCoPost(postId: string, rows: CoAuthorRow[]): CoPost | null {
  const mine = rows.filter((r) => r.post_id === postId);
  if (mine.length === 0) return null;
  const sides: CoPostSide[] = mine.map((r) => ({
    profileId: r.profile_id,
    userId: r.user_id,
    role: r.role === "author" ? "author" : "co_author",
    status: r.status as CoPostSide["status"],
    acceptedAt: r.accepted_at ?? null,
  }));
  /* The initiator's side always reads first — surfaces render
     "Author × Co-author" in a stable order. */
  sides.sort((a, b) => (a.role === b.role ? 0 : a.role === "author" ? -1 : 1));
  return { postId, sides };
}

/** Unguarded single-post load (write paths): throws on a missing table
 *  so the route can answer 503 co_post_not_ready. Null = not a co-post. */
export async function loadCoPost(postId: string): Promise<CoPost | null> {
  const rows = await db
    .select()
    .from(postCoAuthorsTable)
    .where(eq(postCoAuthorsTable.post_id, postId));
  return rowsToCoPost(postId, rows);
}

/** Probe used by the create route BEFORE any row is written: if the
 *  table isn't there yet, creation must fail cleanly with nothing
 *  created and nobody notified. */
export async function probeCoPostTable(): Promise<void> {
  await db.select({ id: postCoAuthorsTable.id }).from(postCoAuthorsTable).limit(1);
}

/** Guarded batch load for READ paths (Feed enrichment, visibility
 *  gates, profile lists). Co-post data is purely ADDITIVE enrichment
 *  on surfaces that existed before it: if the side table can't be
 *  read — table not migrated yet (42P01), a test fake that doesn't
 *  know the table, a transient DB error — the surface must degrade
 *  to exactly today's behaviour (no co-posts), never fail. One bad
 *  section never takes the whole feed down. The failure is logged,
 *  not silent. WRITE paths stay strict: they use the unguarded
 *  loaders and answer 503 co_post_not_ready. */
export async function loadCoPostsGuarded(postIds: string[]): Promise<Map<string, CoPost>> {
  const out = new Map<string, CoPost>();
  if (postIds.length === 0) return out;
  try {
    const rows = await db
      .select()
      .from(postCoAuthorsTable)
      .where(inArray(postCoAuthorsTable.post_id, postIds));
    const byPost = new Map<string, CoAuthorRow[]>();
    for (const r of rows) {
      const arr = byPost.get(r.post_id) ?? [];
      arr.push(r);
      byPost.set(r.post_id, arr);
    }
    for (const [postId, rs] of byPost) {
      const co = rowsToCoPost(postId, rs);
      if (co) out.set(postId, co);
    }
  } catch (err) {
    /* The not-migrated-yet state is EXPECTED until 0205 lands — debug
       level, or every feed load would spam the log. Anything else is
       a real read failure degrading a surface: warn. */
    if (isMissingCoPostTable(err)) {
      logger.debug("[co-posts] side table not present yet — serving posts without co-post data");
    } else {
      logger.warn({ err }, "[co-posts] side-table read failed — serving posts without co-post data");
    }
  }
  return out;
}

export interface CoAuthorSummary {
  profile_id: string;
  user_id: string;
  role: string;
  status: string;
  accepted_at: Date | string | null;
  display_name: string | null;
  slug: string | null;
  avatar_url: string | null;
  is_verified: boolean;
}

/** Render-ready author summaries for a co-post, in side order (initiator
 *  first). Profiles that have since been deleted render as nulls rather
 *  than dropping the side — the consent record still counts. */
export function coAuthorSummaries(
  co: CoPost,
  profilesById: Map<string, CreatorProfileRow>,
): CoAuthorSummary[] {
  return co.sides.map((s) => {
    const p = profilesById.get(s.profileId);
    return {
      profile_id: s.profileId,
      user_id: s.userId,
      role: s.role,
      status: s.status,
      accepted_at: s.acceptedAt,
      display_name: p?.displayName ?? null,
      slug: p?.slug ?? null,
      avatar_url: p?.avatarUrl ?? null,
      is_verified: p?.isVerified ?? false,
    };
  });
}

export async function fetchProfilesById(profileIds: string[]): Promise<Map<string, CreatorProfileRow>> {
  if (profileIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(creatorProfilesTable)
    .where(inArray(creatorProfilesTable.id, [...new Set(profileIds)]));
  return new Map(rows.map((r) => [r.id, r]));
}
