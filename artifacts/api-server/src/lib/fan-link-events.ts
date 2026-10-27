/* ─── Fan Link event recording (N17, DB side) ─────────────────────────────
   The write path behind lib/fan-links.ts' pure decisions. Every helper
   is best-effort by contract: callers fire-and-forget, and a fan-link
   failure must NEVER break the surface that carried the code (a play, a
   redirect, a signup). Helpers return whether a row actually landed. */

import { eq } from "drizzle-orm";
import {
  db,
  fanLinksTable,
  fanLinkEventsTable,
  creatorProfilesTable,
  profileTracksTable,
  profileVideosTable,
} from "@workspace/db";
import {
  shouldRecordArrival,
  shouldRecordSignup,
  playKindForContentType,
} from "./fan-links";

export async function loadFanLinkByCode(code: string) {
  const rows = await db
    .select()
    .from(fanLinksTable)
    .where(eq(fanLinksTable.code, code))
    .limit(1);
  return rows[0] ?? null;
}

export async function recordFanLinkClick(args: {
  fanLinkId: string;
  visitorUserId: string | null;
}): Promise<boolean> {
  try {
    await db.insert(fanLinkEventsTable).values({
      fan_link_id: args.fanLinkId,
      kind: "click",
      visitor_user_id: args.visitorUserId,
    });
    return true;
  } catch {
    return false;
  }
}

/* Who owns a piece of media: profile_tracks/profile_videos carry
   profile_id = creator_profiles.id; the profile names the user. */
async function mediaOwnerUserId(kind: "track" | "video", mediaId: string): Promise<string | null> {
  try {
    const mediaRows =
      kind === "track"
        ? await db.select({ profileId: profileTracksTable.profileId }).from(profileTracksTable).where(eq(profileTracksTable.id, mediaId)).limit(1)
        : await db.select({ profileId: profileVideosTable.profileId }).from(profileVideosTable).where(eq(profileVideosTable.id, mediaId)).limit(1);
    const profileId = mediaRows[0]?.profileId;
    if (!profileId) return null;
    const profiles = await db
      .select({ userId: creatorProfilesTable.userId })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.id, profileId))
      .limit(1);
    return profiles[0]?.userId ?? null;
  } catch {
    return null;
  }
}

/* Record an arrival for a play that carried a fan code. Returns true
   only when a row landed. Creator-level links (no content id) require
   the played media to actually belong to the link's creator — proven
   by ownership, never assumed. */
export async function recordFanLinkArrival(args: {
  code: string;
  kind: string;
  mediaId: string;
  userId: string | null;
}): Promise<boolean> {
  try {
    const link = await loadFanLinkByCode(args.code);
    if (!link) return false;
    const kind = playKindForContentType(link.content_type);
    if (!kind || args.kind !== kind) return false;
    if (!link.content_id) {
      const owner = await mediaOwnerUserId(kind, args.mediaId);
      if (!owner || owner !== link.creator_user_id) return false;
    }
    const ok = shouldRecordArrival({
      link: { fanUserId: link.fan_user_id, contentType: link.content_type, contentId: link.content_id },
      play: { kind: args.kind, mediaId: args.mediaId, userId: args.userId },
    });
    if (!ok) return false;
    await db.insert(fanLinkEventsTable).values({
      fan_link_id: link.id,
      kind: "arrival",
      visitor_user_id: args.userId,
    });
    return true;
  } catch {
    return false;
  }
}

/* Attribute the caller's signup to a fan link. Exactly-once per new
   account is enforced by the fan_link_events_signup_once_uidx partial
   unique index — a repeat call lands on the index and reports
   already-attributed instead of double-counting. */
export async function attributeFanLinkSignup(args: {
  code: string;
  newUserId: string;
}): Promise<"recorded" | "already" | "refused"> {
  try {
    const link = await loadFanLinkByCode(args.code);
    if (!link) return "refused";
    if (!shouldRecordSignup({ fanUserId: link.fan_user_id, newUserId: args.newUserId })) {
      return "refused";
    }
    await db.insert(fanLinkEventsTable).values({
      fan_link_id: link.id,
      kind: "signup",
      visitor_user_id: args.newUserId,
    });
    return "recorded";
  } catch {
    return "already";
  }
}
