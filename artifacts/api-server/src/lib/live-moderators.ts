import { eq, and } from "drizzle-orm";
import { db, liveChannelModeratorsTable } from "@workspace/db";

/* ── Channel moderators ──────────────────────────────────────────────────
   Appointed per creator PROFILE (migration 0133), so a moderator's
   powers ride every stream that creator runs — not just one show.
   The moderation rules built on this (enforced in live-chat):
     - the owner can delete any message and mute any chatter
       (never themselves);
     - a moderator can delete messages and mute chatters, but can
       never mute or delete messages of the owner, and cannot mute
       another moderator — only the owner moderates the moderators;
     - appointment and removal belong to the owner alone. */

export async function getModeratorIds(profileId: string): Promise<string[]> {
  const rows = await db
    .select({ moderatorUserId: liveChannelModeratorsTable.moderator_user_id })
    .from(liveChannelModeratorsTable)
    .where(eq(liveChannelModeratorsTable.profile_id, profileId));
  return rows.map((r) => r.moderatorUserId);
}

export async function isChannelModerator(profileId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ moderatorUserId: liveChannelModeratorsTable.moderator_user_id })
    .from(liveChannelModeratorsTable)
    .where(
      and(
        eq(liveChannelModeratorsTable.profile_id, profileId),
        eq(liveChannelModeratorsTable.moderator_user_id, userId),
      ),
    )
    .limit(1);
  return !!rows[0];
}

export type ChatRole = "owner" | "moderator" | "viewer";

/** A caller's role on a stream: owner of the stream, an appointed
 *  moderator of the stream owner's channel, or a regular viewer. */
export async function chatRoleFor(
  stream: { user_id: string; profile_id: string },
  userId: string,
): Promise<ChatRole> {
  if (stream.user_id === userId) return "owner";
  return (await isChannelModerator(stream.profile_id, userId)) ? "moderator" : "viewer";
}
