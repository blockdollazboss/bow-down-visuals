/**
 * tom-friendship.ts — the Tom move 🦈
 *
 * Thy Cheat Code is the official Bow Down Visuals profile (creator_profiles
 * row flagged is_official, slug "thy-cheat-code", seeded by migration 0125)
 * and every creator's first friend — MySpace-Tom style:
 *
 *   direction 1: the user follows Thy  → his posts land in their feed
 *                (/api/feed reads the follows table)
 *   direction 2: Thy follows the user back → mutual from day one
 *
 * ensureTomFriendship(userId) is idempotent (insert-or-nothing + count
 * bumps only on rows actually inserted) and NEVER throws — it is called
 * from auth/profile provisioning paths that must not fail over a social
 * nicety. Call sites:
 *   - middlewares/require-auth.ts — when a brand-new Supabase profile row
 *     is provisioned (every new signup's first authenticated request)
 *   - routes/creator-platform.ts  — when a creator profile is created
 *     (direction 2 becomes possible the moment a profile exists)
 *   - routes/creator-tiers.ts     — when checkout auto-creates a profile
 * Existing accounts were backfilled by migration 0125 itself.
 *
 * Unfollowing stays fully possible: nothing re-adds a follow after the
 * one-time provisioning hooks above have fired for a user.
 */
import { eq, sql } from "drizzle-orm";
import { db, creatorProfilesTable, followsTable } from "@workspace/db";
import { logger } from "./logger";

/** Fixed sentinel UUID of the house account that owns the official
    profile. Never authenticates. MUST match migration 0125. */
export const THY_CHEAT_CODE_USER_ID = "00000000-0000-4000-8000-000000000001";
export const THY_CHEAT_CODE_SLUG = "thy-cheat-code";

interface OfficialProfileRef { id: string; userId: string }

/* The official profile is seeded by migration before the server boots and
   never changes identity, so a positive lookup is cached for the process.
   A miss is NOT cached — the next call retries. */
let cachedOfficial: OfficialProfileRef | null = null;

async function getOfficialProfile(): Promise<OfficialProfileRef | null> {
  if (cachedOfficial) return cachedOfficial;
  const [row] = await db
    .select({ id: creatorProfilesTable.id, userId: creatorProfilesTable.userId })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.isOfficial, true))
    .limit(1);
  if (row) cachedOfficial = row;
  return row ?? null;
}

async function insertFollow(followerUserId: string, profileId: string): Promise<boolean> {
  const inserted = await db
    .insert(followsTable)
    .values({ followerUserId, profileId })
    .onConflictDoNothing({ target: [followsTable.followerUserId, followsTable.profileId] })
    .returning({ profileId: followsTable.profileId });
  if (inserted.length === 0) return false;
  await db
    .update(creatorProfilesTable)
    .set({ followerCount: sql`${creatorProfilesTable.followerCount} + 1`, updatedAt: new Date() })
    .where(eq(creatorProfilesTable.id, profileId));
  return true;
}

/** Make Thy Cheat Code the given user's first friend (mutual). Safe to
    call any number of times, for any user, at any point in their life. */
export async function ensureTomFriendship(userId: string): Promise<void> {
  try {
    if (!userId || userId === THY_CHEAT_CODE_USER_ID) return;
    const thy = await getOfficialProfile();
    if (!thy) {
      logger.warn("tom-friendship: no official profile found (migration 0125 not applied yet?)");
      return;
    }
    // Direction 1: the user follows Thy — his posts land in their feed.
    await insertFollow(userId, thy.id);
    // Direction 2: Thy follows back — possible once the user has a
    // creator profile of their own.
    const [mine] = await db
      .select({ id: creatorProfilesTable.id })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);
    if (mine && mine.id !== thy.id) {
      await insertFollow(thy.userId, mine.id);
    }
  } catch (err) {
    // Social graph is a nicety, never a blocker: provisioning and
    // profile creation must succeed even if this fails.
    logger.warn({ err, userId }, "tom-friendship: ensure failed (non-fatal)");
  }
}
