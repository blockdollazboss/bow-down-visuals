import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/* ── Follower fan-out — the POST /notify contract, as a shared lib ─────
   POST /api/notify { kind, title, body?, link?, profileId } fans a
   notification out to every follower of a creator profile. That
   fan-out used to exist ONLY as HTTP handler code with zero callers —
   publishing flows that were supposed to announce (per the endpoint's
   own header docs: "on every publish") never did, because firing it
   needed a client round-trip back into the same server.
 *
 * This is that endpoint's fan-out branch, extracted with its behavior
 * intact — same ownership rule (the profile must belong to the
 * caller), same follower read (follows.profile_id, 5,000 cap), same
 *  self-exclusion, same chunked bulk insert — so the endpoint and any
 *  server-side publisher share ONE implementation. Server flows (the
 *  distribution release submit is the first) call it in-process; the
 *  endpoint keeps its exact HTTP contract on top.
 */

export interface FollowerFanOutInput {
  /** The creator profile whose followers are notified. */
  profileId: string;
  /** The profile's owner — the fan-out only fires for their own profile. */
  ownerUserId: string;
  kind: string;
  title: string;
  body?: string;
  link?: string;
}

export type FollowerFanOutResult =
  | { ok: true; notified: number }
  | { ok: false; reason: "profile_not_owned" };

export async function fanOutToFollowers(
  input: FollowerFanOutInput,
): Promise<FollowerFanOutResult> {
  const { profileId, ownerUserId, kind, title } = input;
  const body = input.body ?? "";
  const link = input.link ?? "";

  /* Ownership: the profile must be the caller's own. (The endpoint's
     check ran through the query builder; the predicate is identical —
     raw SQL keeps this lib on the pg-mem-safe pattern the rest of the
     fan-out already uses.) */
  const owned = await db.execute(sql`
    SELECT id FROM creator_profiles
    WHERE id = ${profileId}::uuid AND user_id = ${ownerUserId}::uuid
    LIMIT 1`);
  if (!owned.rows.length) {
    return { ok: false, reason: "profile_not_owned" };
  }

  const followers = (await db.execute(sql`
    SELECT follower_user_id AS uid FROM follows
    WHERE profile_id = ${profileId}::uuid
    LIMIT 5000`)).rows as unknown as Array<{ uid: string }>;
  const targets = followers.map((f) => f.uid).filter((uid) => uid !== ownerUserId);
  if (!targets.length) {
    return { ok: true, notified: 0 };
  }

  /* Chunked bulk insert keeps the fan-out to a couple of round-trips. */
  for (let i = 0; i < targets.length; i += 500) {
    const chunk = targets.slice(i, i + 500);
    await db.execute(sql`
      INSERT INTO notifications (user_id, kind, title, body, link)
      SELECT u, ${kind}, ${title}, ${body}, ${link}
      FROM unnest(${sql.raw(`ARRAY[${chunk.map((u) => `'${u}'::uuid`).join(",")}]`)}) AS u`);
  }
  return { ok: true, notified: targets.length };
}
