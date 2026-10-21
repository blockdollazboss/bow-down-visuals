import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  liveStreamsTable,
  liveChannelModeratorsTable,
  creatorProfilesTable,
  type CreatorProfile,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { getModeratorIds, chatRoleFor } from "../lib/live-moderators";

/* ── Channel moderator appointments ──────────────────────────────────────
   GET    /live/moderators            (auth, creator) my appointed mods
   POST   /live/moderators            (auth, creator) appoint by the
                                      moderator's creator-profile slug
   DELETE /live/moderators/:userId    (auth, creator) remove
   GET    /live/:id/chat/my-role      (auth) my role on a stream +
                                      the stream's moderator ids (the
                                      chat panel renders badges and
                                      moderation controls from this)

   Appointment state is a real table (live_channel_moderators,
   migration 0133) keyed by the creator's profile, so it survives
   across all of that creator's streams. Only the creator appoints
   or removes — a moderator cannot appoint anyone, including
   themselves. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

async function getProfileByUserId(userId: string): Promise<CreatorProfile | null> {
  const rows = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export interface ModeratorDto {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  slug: string | null;
  appointedAt: string;
}

async function moderatorDtos(profileId: string): Promise<ModeratorDto[]> {
  const rows = await db
    .select()
    .from(liveChannelModeratorsTable)
    .where(eq(liveChannelModeratorsTable.profile_id, profileId));
  if (!rows.length) return [];
  const profiles = await db
    .select({
      userId: creatorProfilesTable.userId,
      displayName: creatorProfilesTable.displayName,
      avatarUrl: creatorProfilesTable.avatarUrl,
      slug: creatorProfilesTable.slug,
    })
    .from(creatorProfilesTable)
    .where(inArray(creatorProfilesTable.userId, rows.map((r) => r.moderator_user_id)));
  const byUser = new Map(profiles.map((p) => [p.userId, p]));
  return rows.map((r) => {
    const p = byUser.get(r.moderator_user_id);
    return {
      userId: r.moderator_user_id,
      displayName: p?.displayName ?? "Someone",
      avatarUrl: p?.avatarUrl ?? null,
      slug: p?.slug ?? null,
      appointedAt: new Date(r.created_at).toISOString(),
    };
  });
}

router.get("/live/moderators", requireAuth, async (req: Request, res: Response) => {
  try {
    const profile = await getProfileByUserId(req.userId!);
    if (!profile) {
      res.status(400).json({ error: "Create your creator profile first — moderators belong to your channel.", code: "NO_PROFILE" });
      return;
    }
    res.json({ moderators: await moderatorDtos(profile.id) });
  } catch (err) {
    logger.error({ err }, "live moderators list failed");
    res.status(500).json({ error: "Moderators couldn't load. Try again." });
  }
});

const appointSchema = z.object({ profileSlug: z.string().trim().min(1).max(120) });

router.post("/live/moderators", requireAuth, async (req: Request, res: Response) => {
  try {
    const profile = await getProfileByUserId(req.userId!);
    if (!profile) {
      res.status(400).json({ error: "Create your creator profile first — moderators belong to your channel.", code: "NO_PROFILE" });
      return;
    }
    const parsed = appointSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Give the creator profile name of the person you're appointing." });
      return;
    }
    const slug = parsed.data.profileSlug.replace(/^@/, "").toLowerCase();
    const targetRows = await db
      .select()
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.slug, slug))
      .limit(1);
    const target = targetRows[0];
    if (!target) {
      res.status(404).json({ error: "No creator profile goes by that name." });
      return;
    }
    if (target.userId === req.userId) {
      res.status(400).json({ error: "You're the channel owner — you already hold every power a moderator has." });
      return;
    }
    await db
      .insert(liveChannelModeratorsTable)
      .values({
        profile_id: profile.id,
        moderator_user_id: target.userId,
        appointed_by_user_id: req.userId!,
      })
      .onConflictDoNothing();
    res.status(201).json({ moderators: await moderatorDtos(profile.id) });
  } catch (err) {
    logger.error({ err }, "live moderator appoint failed");
    res.status(500).json({ error: "That moderator couldn't be appointed. Try again." });
  }
});

router.delete("/live/moderators/:userId", requireAuth, async (req: Request, res: Response) => {
  try {
    const profile = await getProfileByUserId(req.userId!);
    if (!profile) {
      res.status(400).json({ error: "Create your creator profile first — moderators belong to your channel.", code: "NO_PROFILE" });
      return;
    }
    if (!UUID_RE.test(param(req, "userId"))) {
      res.status(404).json({ error: "That moderator isn't appointed here." });
      return;
    }
    await db
      .delete(liveChannelModeratorsTable)
      .where(
        and(
          eq(liveChannelModeratorsTable.profile_id, profile.id),
          eq(liveChannelModeratorsTable.moderator_user_id, param(req, "userId")),
        ),
      );
    res.json({ moderators: await moderatorDtos(profile.id) });
  } catch (err) {
    logger.error({ err }, "live moderator remove failed");
    res.status(500).json({ error: "That moderator couldn't be removed. Try again." });
  }
});

router.get("/live/:id/chat/my-role", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to do that." });
      return;
    }
    const id = param(req, "id");
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    const rows = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, id)).limit(1);
    const stream = rows[0];
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    const role = await chatRoleFor(stream, userId);
    const moderatorIds = await getModeratorIds(stream.profile_id).catch(() => [] as string[]);
    res.json({ streamId: stream.id, role, moderatorIds, ownerId: stream.user_id });
  } catch (err) {
    logger.error({ err }, "live chat my-role failed");
    res.status(500).json({ error: "Your chat role couldn't load." });
  }
});

export default router;
