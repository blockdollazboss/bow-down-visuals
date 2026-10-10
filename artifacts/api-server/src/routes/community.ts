import { Router, type Request } from "express";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db } from "@workspace/db";
import {
  groupsTable,
  groupMembersTable,
  groupPostsTable,
  eventsTable,
  eventRsvpsTable,
  conversationsTable,
  messagesTable,
  creatorProfilesTable,
  profileVideosTable,
  followsTable,
  notificationsTable,
  EVENT_KINDS,
  type Conversation,
} from "@workspace/db";
import { eq, and, or, desc, asc, sql, ne, gt, gte, lt, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { createClient } from "@supabase/supabase-js";

const router = Router();

/** Optional auth: sets req.userId when a valid Bearer token is present, never 401s. */
async function optionalAuth(req: Request): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) return;
  try {
    const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
    const key = process.env["SUPABASE_ANON_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"] ?? "";
    const client = createClient(url, key, { auth: { persistSession: false } });
    const { data: { user } } = await client.auth.getUser(authHeader.slice(7));
    if (user) req.userId = user.id;
  } catch {
    /* viewer stays anonymous */
  }
}

/** Express types route params as string | string[] — collapse to a single string. */
function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

/* ─── Creator Streaming Platform — Groups / Events / DMs (Worker 9) ──────
   Route contract (mounted under /api by the parent when adding
   `router.use(communityRouter)` to routes/index.ts):

     Groups:
       POST   /groups                       (auth) create a group
       GET    /groups                       browse (public) — ?q=&mine=<user_id>&member=<user_id>
       GET    /groups/:slug                 group detail + member feed preview
       POST   /groups/:slug/join            (auth)
       POST   /groups/:slug/leave           (auth)
       GET    /groups/:slug/feed            group posts (auth for private)
       POST   /groups/:slug/posts           (auth; member only)
       DELETE /groups/:slug/posts/:postId   (auth; owner/mod or post author)
       DELETE /groups/:slug/members/:userId (auth; owner only)
     Events:
       POST   /events            (auth; must own a creator_profiles row)
       GET    /events            upcoming (public)
       GET    /events/:id        detail (public)
       POST   /events/:id/rsvp   (auth)
       POST   /events/:id/unrsvp (auth)
     DMs:
       GET    /dm/conversations              (auth) — { inbox, requests }
       POST   /dm/start          { user_id } (auth)
       GET    /dm/:id/messages               (auth; participant only)
       POST   /dm/:id/send       { body }    (auth; participant; rate-limited)
       POST   /dm/:id/accept                 (auth; request recipient)
       POST   /dm/:id/decline                (auth; request recipient)
       POST   /dm/:id/block                  (auth; participant)
     Explore:
       GET    /explore  blended trending payload (public)
     Profiles (link-graph glue):
       GET    /profiles/resolve?slug=  slug -> user_id for "Message" deep-links
*/

/* ── Zod schemas ─────────────────────────────────────────────────────────── */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const slugSchema = z.string().trim().toLowerCase().regex(SLUG_RE,
  "Slug must be 3-40 chars: lowercase letters, numbers, hyphens; no leading/trailing hyphen.");
const uuidSchema = z.string().uuid();

const createGroupSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional().default(""),
  cover_url: z.string().url().max(500).optional().nullable(),
  is_public: z.boolean().optional().default(true),
});

const groupPostSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

const createEventSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(5000).optional().default(""),
  starts_at: z.string().datetime({ offset: true }),
  kind: z.enum(EVENT_KINDS).optional().default("other"),
  cover_url: z.string().url().max(500).optional().nullable(),
  destination_url: z.string().url().max(500).optional().nullable(),
  ticket_url: z.string().url().max(500).optional().nullable(),
});

const dmStartSchema = z.object({ user_id: uuidSchema });
const dmSendSchema = z.object({ body: z.string().trim().min(1).max(2000) });

/* ── Helpers ─────────────────────────────────────────────────────────────── */

async function notify(opts: { userId: string; kind: string; title: string; body?: string; link?: string }) {
  try {
    await db.insert(notificationsTable).values({
      userId: opts.userId,
      kind: opts.kind,
      title: opts.title,
      body: opts.body ?? "",
      link: opts.link ?? "",
    });
  } catch (err) {
    // Notifications are fire-and-forget: never fail the main action.
    console.error("[community] notify failed", err);
  }
}

/** Map user ids -> creator profile cards (for link-graph profile links). */
async function profileCards(userIds: string[]): Promise<Record<string, { slug: string; displayName: string; avatarUrl: string | null }>> {
  const uniq = [...new Set(userIds)];
  if (uniq.length === 0) return {};
  const rows = await db.select({
    userId: creatorProfilesTable.userId,
    slug: creatorProfilesTable.slug,
    displayName: creatorProfilesTable.displayName,
    avatarUrl: creatorProfilesTable.avatarUrl,
  })
    .from(creatorProfilesTable)
    .where(inArray(creatorProfilesTable.userId, uniq));
  const out: Record<string, { slug: string; displayName: string; avatarUrl: string | null }> = {};
  for (const r of rows) out[r.userId] = { slug: r.slug, displayName: r.displayName, avatarUrl: r.avatarUrl };
  return out;
}

/** Canonical participant pair: smaller UUID first (DB CHECK enforces this). */
function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function getGroupBySlug(slug: string) {
  const rows = await db.select().from(groupsTable).where(eq(groupsTable.slug, slug)).limit(1);
  return rows[0] ?? null;
}

async function membershipRole(groupId: string, userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  const rows = await db.select({ role: groupMembersTable.role })
    .from(groupMembersTable)
    .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId)))
    .limit(1);
  return rows[0]?.role ?? null;
}

async function getMyProfile(userId: string) {
  const rows = await db.select().from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId)).limit(1);
  return rows[0] ?? null;
}

/* ── GROUPS ──────────────────────────────────────────────────────────────── */

/** Create a group. The creator becomes owner (member row role='owner'). */
router.post("/groups", requireAuth, async (req, res) => {
  try {
    const body = createGroupSchema.parse(req.body);
    const userId = req.userId!;
    const profile = await getMyProfile(userId);
    const existing = await getGroupBySlug(body.slug);
    if (existing) {
      res.status(409).json({ error: "That group slug is taken — remix it, don't steal it." });
      return;
    }
    const [group] = await db.insert(groupsTable).values({
      slug: body.slug,
      name: body.name,
      description: body.description ?? "",
      coverUrl: body.cover_url ?? null,
      ownerProfileId: profile?.id ?? null,
      isPublic: body.is_public ?? true,
    }).returning();
    await db.insert(groupMembersTable).values({ groupId: group.id, userId, role: "owner" });
    await db.update(groupsTable).set({ memberCount: 1 }).where(eq(groupsTable.id, group.id));
    res.status(201).json({ group });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.issues[0]?.message ?? "Invalid input." }); return; }
    console.error("[community] POST /groups failed", err);
    res.status(500).json({ error: "Couldn't start the group — try again." });
  }
});

/** Browse groups. ?q= search, ?mine=<user_id> owned by, ?member=<user_id> joined. */
router.get("/groups", async (req, res) => {
  try {
    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
    const mine = typeof req.query["mine"] === "string" ? req.query["mine"] : "";
    const member = typeof req.query["member"] === "string" ? req.query["member"] : "";
    let rows = await db.select().from(groupsTable).orderBy(desc(groupsTable.memberCount)).limit(100);
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((g) => g.name.toLowerCase().includes(needle) || g.slug.includes(needle) || g.description.toLowerCase().includes(needle));
    }
    if (member) {
      const memRows = await db.select({ groupId: groupMembersTable.groupId })
        .from(groupMembersTable).where(eq(groupMembersTable.userId, member));
      const ids = new Set(memRows.map((r) => r.groupId));
      rows = rows.filter((g) => ids.has(g.id));
    }
    // ?mine=<user_id>: groups whose owner profile belongs to the user
    if (mine) {
      const profiles = await db.select({ id: creatorProfilesTable.id })
        .from(creatorProfilesTable).where(eq(creatorProfilesTable.userId, mine));
      const pids = new Set(profiles.map((p) => p.id));
      rows = rows.filter((g) => g.ownerProfileId != null && pids.has(g.ownerProfileId));
    }
    res.json({ groups: rows });
  } catch (err) {
    console.error("[community] GET /groups failed", err);
    res.status(500).json({ error: "Couldn't load groups — try again." });
  }
});

/** Group detail: about, owner profile link, member preview, viewer role. */
router.get("/groups/:slug", async (req, res) => {
  try {
    await optionalAuth(req);
    const group = await getGroupBySlug(param(req, "slug"));
    if (!group) { res.status(404).json({ error: "Group not found." }); return; }
    const viewerRole = await membershipRole(group.id, req.userId);
    // Private groups hide everything from non-members.
    if (!group.isPublic && !viewerRole) {
      res.status(403).json({ error: "This crew runs private — join to see inside." });
      return;
    }
    // Owner profile card (link graph: group -> owner profile)
    let ownerProfile: { slug: string; displayName: string } | null = null;
    if (group.ownerProfileId) {
      const pr = await db.select({ slug: creatorProfilesTable.slug, displayName: creatorProfilesTable.displayName })
        .from(creatorProfilesTable).where(eq(creatorProfilesTable.id, group.ownerProfileId)).limit(1);
      ownerProfile = pr[0] ?? null;
    }
    const memberRows = await db.select({ userId: groupMembersTable.userId, role: groupMembersTable.role, joinedAt: groupMembersTable.joinedAt })
      .from(groupMembersTable).where(eq(groupMembersTable.groupId, group.id))
      .orderBy(asc(groupMembersTable.joinedAt)).limit(24);
    const cards = await profileCards(memberRows.map((m) => m.userId));
    res.json({
      group,
      owner_profile: ownerProfile,
      members: memberRows.map((m) => ({
        user_id: m.userId, role: m.role, joined_at: m.joinedAt,
        profile: cards[m.userId] ?? null,
      })),
      viewer_role: viewerRole,
    });
  } catch (err) {
    console.error("[community] GET /groups/:slug failed", err);
    res.status(500).json({ error: "Couldn't load the group — try again." });
  }
});

/* ── GROUPS: membership ─────────────────────────────────────────────────── */

/** Join a group. */
router.post("/groups/:slug/join", requireAuth, async (req, res) => {
  try {
    const group = await getGroupBySlug(param(req, "slug"));
    if (!group) { res.status(404).json({ error: "Group not found." }); return; }
    const userId = req.userId!;
    const existing = await membershipRole(group.id, userId);
    if (existing) { res.status(409).json({ error: "You're already in this crew." }); return; }
    await db.insert(groupMembersTable).values({ groupId: group.id, userId, role: "member" });
    await db.update(groupsTable)
      .set({ memberCount: sql`${groupsTable.memberCount} + 1` })
      .where(eq(groupsTable.id, group.id));
    // Notification to the owner (follows-on-content: group_join).
    if (group.ownerProfileId) {
      const pr = await db.select({ userId: creatorProfilesTable.userId })
        .from(creatorProfilesTable).where(eq(creatorProfilesTable.id, group.ownerProfileId)).limit(1);
      if (pr[0] && pr[0].userId !== userId) {
        const myCard = await profileCards([userId]);
        const who = myCard[userId]?.displayName ?? "Someone";
        await notify({
          userId: pr[0].userId,
          kind: "group_join",
          title: `🦈 ${who} joined your group "${group.name}"`,
          body: "Your crew is growing — give them a shout.",
          link: `/groups/${group.slug}`,
        });
      }
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[community] POST /groups/:slug/join failed", err);
    res.status(500).json({ error: "Couldn't join — try again." });
  }
});

/** Leave a group (owners can't abandon their own group). */
router.post("/groups/:slug/leave", requireAuth, async (req, res) => {
  try {
    const group = await getGroupBySlug(param(req, "slug"));
    if (!group) { res.status(404).json({ error: "Group not found." }); return; }
    const userId = req.userId!;
    const role = await membershipRole(group.id, userId);
    if (!role) { res.status(404).json({ error: "You're not in this group." }); return; }
    if (role === "owner") {
      res.status(400).json({ error: "Owners can't ghost their own crew — hand off ownership first." });
      return;
    }
    await db.delete(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, group.id), eq(groupMembersTable.userId, userId)));
    await db.update(groupsTable)
      .set({ memberCount: sql`GREATEST(0, ${groupsTable.memberCount} - 1)` })
      .where(eq(groupsTable.id, group.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[community] POST /groups/:slug/leave failed", err);
    res.status(500).json({ error: "Couldn't leave — try again." });
  }
});

/* ── GROUPS: feed ───────────────────────────────────────────────────────── */

/** Group feed. Private groups require membership; members-only posting. */
router.get("/groups/:slug/feed", async (req, res) => {
  try {
    await optionalAuth(req);
    const group = await getGroupBySlug(param(req, "slug"));
    if (!group) { res.status(404).json({ error: "Group not found." }); return; }
    const role = await membershipRole(group.id, req.userId);
    if (!group.isPublic && !role) { res.status(403).json({ error: "Private crew — join to see the feed." }); return; }
    const posts = await db.select().from(groupPostsTable)
      .where(eq(groupPostsTable.groupId, group.id))
      .orderBy(desc(groupPostsTable.createdAt)).limit(50);
    const cards = await profileCards(posts.map((p) => p.authorUserId));
    res.json({
      posts: posts.map((p) => ({
        id: p.id, body: p.body, like_count: p.likeCount, created_at: p.createdAt,
        author_user_id: p.authorUserId, author: cards[p.authorUserId] ?? null,
        can_delete: req.userId != null && (role === "owner" || role === "mod" || p.authorUserId === req.userId),
      })),
      viewer_role: role,
    });
  } catch (err) {
    console.error("[community] GET /groups/:slug/feed failed", err);
    res.status(500).json({ error: "Couldn't load the feed — try again." });
  }
});

/** Post to the group (members + owner). */
router.post("/groups/:slug/posts", requireAuth, async (req, res) => {
  try {
    const group = await getGroupBySlug(param(req, "slug"));
    if (!group) { res.status(404).json({ error: "Group not found." }); return; }
    const userId = req.userId!;
    const role = await membershipRole(group.id, userId);
    if (!role) { res.status(403).json({ error: "Join the group before you talk in it." }); return; }
    const body = groupPostSchema.parse(req.body);
    const [post] = await db.insert(groupPostsTable).values({
      groupId: group.id, authorUserId: userId, body: body.body,
    }).returning();
    res.status(201).json({ post });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.issues[0]?.message ?? "Invalid input." }); return; }
    console.error("[community] POST /groups/:slug/posts failed", err);
    res.status(500).json({ error: "Couldn't post — try again." });
  }
});

/** Delete a group post: owner, mod, or the post's author. */
router.delete("/groups/:slug/posts/:postId", requireAuth, async (req, res) => {
  try {
    const group = await getGroupBySlug(param(req, "slug"));
    if (!group) { res.status(404).json({ error: "Group not found." }); return; }
    const userId = req.userId!;
    const role = await membershipRole(group.id, userId);
    const rows = await db.select().from(groupPostsTable)
      .where(and(eq(groupPostsTable.id, param(req, "postId")), eq(groupPostsTable.groupId, group.id))).limit(1);
    const post = rows[0];
    if (!post) { res.status(404).json({ error: "Post not found." }); return; }
    if (role !== "owner" && role !== "mod" && post.authorUserId !== userId) {
      res.status(403).json({ error: "Only the crew leads or the author can remove this." });
      return;
    }
    await db.delete(groupPostsTable).where(eq(groupPostsTable.id, post.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[community] DELETE /groups/:slug/posts/:postId failed", err);
    res.status(500).json({ error: "Couldn't delete — try again." });
  }
});

/** Owner moderation: remove a member (can't remove self). */
router.delete("/groups/:slug/members/:userId", requireAuth, async (req, res) => {
  try {
    const group = await getGroupBySlug(param(req, "slug"));
    if (!group) { res.status(404).json({ error: "Group not found." }); return; }
    const userId = req.userId!;
    const role = await membershipRole(group.id, userId);
    if (role !== "owner") { res.status(403).json({ error: "Only the group owner can remove members." }); return; }
    const target = z.string().uuid().parse(param(req, "userId"));
    if (target === userId) { res.status(400).json({ error: "You can't remove yourself — transfer the group instead." }); return; }
    const targetRole = await membershipRole(group.id, target);
    if (!targetRole) { res.status(404).json({ error: "They're not in this group." }); return; }
    await db.delete(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, group.id), eq(groupMembersTable.userId, target)));
    await db.update(groupsTable)
      .set({ memberCount: sql`GREATEST(0, ${groupsTable.memberCount} - 1)` })
      .where(eq(groupsTable.id, group.id));
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: "Invalid user id." }); return; }
    console.error("[community] DELETE /groups/:slug/members failed", err);
    res.status(500).json({ error: "Couldn't remove them — try again." });
  }
});

/* ── EVENTS ─────────────────────────────────────────────────────────────── */

/** Create an event. Creator only: caller must own a creator_profiles row. */
router.post("/events", requireAuth, async (req, res) => {
  try {
    const body = createEventSchema.parse(req.body);
    const userId = req.userId!;
    const profile = await getMyProfile(userId);
    if (!profile) {
      res.status(403).json({ error: "Only creators can host events — set up your creator profile first." });
      return;
    }
    const [event] = await db.insert(eventsTable).values({
      profileId: profile.id,
      title: body.title,
      description: body.description ?? "",
      startsAt: new Date(body.starts_at),
      kind: body.kind ?? "other",
      coverUrl: body.cover_url ?? null,
      destinationUrl: body.destination_url ?? null,
      ticketUrl: body.ticket_url ?? null,
    }).returning();
    res.status(201).json({ event });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.issues[0]?.message ?? "Invalid input." }); return; }
    console.error("[community] POST /events failed", err);
    res.status(500).json({ error: "Couldn't create the event — try again." });
  }
});

/** Upcoming events (public), soonest first. */
router.get("/events", async (req, res) => {
  try {
    const now = new Date();
    const rows = await db.select({
      event: eventsTable,
      hostSlug: creatorProfilesTable.slug,
      hostName: creatorProfilesTable.displayName,
      hostAvatar: creatorProfilesTable.avatarUrl,
    })
      .from(eventsTable)
      .innerJoin(creatorProfilesTable, eq(eventsTable.profileId, creatorProfilesTable.id))
      .where(gte(eventsTable.startsAt, now))
      .orderBy(asc(eventsTable.startsAt)).limit(60);
    res.json({
      events: rows.map((r) => ({
        ...r.event,
        host: { slug: r.hostSlug, display_name: r.hostName, avatar_url: r.hostAvatar },
      })),
    });
  } catch (err) {
    console.error("[community] GET /events failed", err);
    res.status(500).json({ error: "Couldn't load events — try again." });
  }
});

/** Event detail: host card (link graph -> profile), viewer RSVP state. */
router.get("/events/:id", async (req, res) => {
  try {
    await optionalAuth(req);
    const rows = await db.select({
      event: eventsTable,
      hostSlug: creatorProfilesTable.slug,
      hostName: creatorProfilesTable.displayName,
      hostAvatar: creatorProfilesTable.avatarUrl,
      hostUserId: creatorProfilesTable.userId,
    })
      .from(eventsTable)
      .innerJoin(creatorProfilesTable, eq(eventsTable.profileId, creatorProfilesTable.id))
      .where(eq(eventsTable.id, z.string().uuid().parse(param(req, "id")))).limit(1);
    const row = rows[0];
    if (!row) { res.status(404).json({ error: "Event not found." }); return; }
    let rsvped = false;
    if (req.userId) {
      const r = await db.select().from(eventRsvpsTable)
        .where(and(eq(eventRsvpsTable.eventId, row.event.id), eq(eventRsvpsTable.userId, req.userId))).limit(1);
      rsvped = r.length > 0;
    }
    res.json({
      event: row.event,
      host: { slug: row.hostSlug, display_name: row.hostName, avatar_url: row.hostAvatar },
      host_is_viewer: row.hostUserId === req.userId,
      rsvped,
    });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: "Invalid event id." }); return; }
    console.error("[community] GET /events/:id failed", err);
    res.status(500).json({ error: "Couldn't load the event — try again." });
  }
});

/** RSVP: increments count, notifies the host (event_rsvp) and drops a
    reminder notification (event_reminder, link=/events/:id) for the RSVPer. */
router.post("/events/:id/rsvp", requireAuth, async (req, res) => {
  try {
    const eventId = z.string().uuid().parse(param(req, "id"));
    const userId = req.userId!;
    const evRows = await db.select({
      event: eventsTable,
      hostUserId: creatorProfilesTable.userId,
    })
      .from(eventsTable)
      .innerJoin(creatorProfilesTable, eq(eventsTable.profileId, creatorProfilesTable.id))
      .where(eq(eventsTable.id, eventId)).limit(1);
    const ev = evRows[0];
    if (!ev) { res.status(404).json({ error: "Event not found." }); return; }
    const existing = await db.select().from(eventRsvpsTable)
      .where(and(eq(eventRsvpsTable.eventId, eventId), eq(eventRsvpsTable.userId, userId))).limit(1);
    if (existing.length > 0) { res.status(409).json({ error: "You're already on the list." }); return; }
    await db.insert(eventRsvpsTable).values({ eventId, userId });
    await db.update(eventsTable)
      .set({ rsvpCount: sql`${eventsTable.rsvpCount} + 1` })
      .where(eq(eventsTable.id, eventId));
    // Reminder for the RSVPer — the bell renders it, linking back to the event.
    await notify({
      userId,
      kind: "event_reminder",
      title: `🦈 Reminder set: "${ev.event.title}"`,
      body: "Don't miss it — the reminder lives in your bell.",
      link: `/events/${eventId}`,
    });
    // Confirmation for the host (follows-on-content: event_rsvp).
    if (ev.hostUserId !== userId) {
      const myCard = await profileCards([userId]);
      const who = myCard[userId]?.displayName ?? "Someone";
      await notify({
        userId: ev.hostUserId,
        kind: "event_rsvp",
        title: `🦈 ${who} RSVP'd to "${ev.event.title}"`,
        body: "Your crowd is building — keep the hype going.",
        link: `/events/${eventId}`,
      });
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: "Invalid event id." }); return; }
    console.error("[community] POST /events/:id/rsvp failed", err);
    res.status(500).json({ error: "Couldn't RSVP — try again." });
  }
});

/** Cancel an RSVP. */
router.post("/events/:id/unrsvp", requireAuth, async (req, res) => {
  try {
    const eventId = z.string().uuid().parse(param(req, "id"));
    const userId = req.userId!;
    const existing = await db.select().from(eventRsvpsTable)
      .where(and(eq(eventRsvpsTable.eventId, eventId), eq(eventRsvpsTable.userId, userId))).limit(1);
    if (existing.length === 0) { res.status(404).json({ error: "No RSVP to cancel." }); return; }
    await db.delete(eventRsvpsTable)
      .where(and(eq(eventRsvpsTable.eventId, eventId), eq(eventRsvpsTable.userId, userId)));
    await db.update(eventsTable)
      .set({ rsvpCount: sql`GREATEST(0, ${eventsTable.rsvpCount} - 1)` })
      .where(eq(eventsTable.id, eventId));
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: "Invalid event id." }); return; }
    console.error("[community] POST /events/:id/unrsvp failed", err);
    res.status(500).json({ error: "Couldn't cancel — try again." });
  }
});

/* ── DMs ────────────────────────────────────────────────────────────────── */

const dmSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => (req as unknown as { userId?: string }).userId ?? ipKeyGenerator(req.ip ?? "127.0.0.1"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Slow down, shark — you're sending too fast. Try again in a few." },
});

const broadcastLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => (req as unknown as { userId?: string }).userId ?? ipKeyGenerator(req.ip ?? "127.0.0.1"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Broadcast limit reached for this hour — pace the drops." },
});

/** Get conversation by id, enforcing participant access. */
async function getConversation(id: string, userId: string) {
  const rows = await db.select().from(conversationsTable)
    .where(eq(conversationsTable.id, id)).limit(1);
  const c = rows[0];
  if (!c) return { error: 404 as const };
  if (c.participantA !== userId && c.participantB !== userId) return { error: 403 as const };
  return { conv: c };
}

function otherParticipant(conv: Conversation, me: string) {
  return conv.participantA === me ? conv.participantB : conv.participantA;
}

async function isMutual(aUserId: string, bUserId: string): Promise<boolean> {
  const [aProf, bProf] = await Promise.all([getMyProfile(aUserId), getMyProfile(bUserId)]);
  if (!aProf || !bProf) return false;
  const rows = await db.select().from(followsTable).where(or(
    and(eq(followsTable.followerUserId, aUserId), eq(followsTable.profileId, bProf.id)),
    and(eq(followsTable.followerUserId, bUserId), eq(followsTable.profileId, aProf.id)),
  ));
  const aFollowsB = rows.some((r) => r.followerUserId === aUserId && r.profileId === bProf.id);
  const bFollowsA = rows.some((r) => r.followerUserId === bUserId && r.profileId === aProf.id);
  return aFollowsB && bFollowsA;
}

/** Inbox + request lists. Other participant resolves to a profile card (link graph). */
router.get("/dm/conversations", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const convs = await db.select().from(conversationsTable)
      .where(or(eq(conversationsTable.participantA, userId), eq(conversationsTable.participantB, userId)))
      .orderBy(sql`${conversationsTable.lastMessageAt} DESC NULLS LAST`)
      .limit(100);
    const otherIds = convs.map((c) => otherParticipant(c, userId));
    const cards = await profileCards(otherIds);
    const convIds = convs.map((c) => c.id);
    let previews: Record<string, { body: string; createdAt: Date | null; senderUserId: string }> = {};
    let unread: Record<string, number> = {};
    if (convIds.length > 0) {
      const lastMsgs = await db.select().from(messagesTable)
        .where(inArray(messagesTable.conversationId, convIds))
        .orderBy(desc(messagesTable.createdAt));
      for (const m of lastMsgs) {
        if (!previews[m.conversationId]) {
          previews[m.conversationId] = { body: m.body, createdAt: m.createdAt, senderUserId: m.senderUserId };
        }
        if (m.senderUserId !== userId && !m.isRead) {
          unread[m.conversationId] = (unread[m.conversationId] ?? 0) + 1;
        }
      }
    }
    const shape = (c: Conversation) => {
      const otherId = otherParticipant(c, userId);
      const card = cards[otherId] ?? null;
      return {
        id: c.id,
        status: c.status,
        requested_by_me: c.requestedBy === userId,
        other: { user_id: otherId, profile: card },
        last_message: previews[c.id] ?? null,
        unread: unread[c.id] ?? 0,
        last_message_at: c.lastMessageAt,
      };
    };
    res.json({
      inbox: convs.filter((c) => c.status === "inbox").map(shape),
      requests: convs.filter((c) => c.status === "request").map(shape),
      blocked: convs.filter((c) => c.status === "blocked").map(shape),
    });
  } catch (err) {
    console.error("[community] GET /dm/conversations failed", err);
    res.status(500).json({ error: "Couldn't load your DMs — try again." });
  }
});

/** Start a DM. Mutual followers land in the inbox; everyone else goes to requests. */
router.post("/dm/start", requireAuth, async (req, res) => {
  try {
    const { user_id: targetId } = dmStartSchema.parse(req.body);
    const userId = req.userId!;
    if (targetId === userId) { res.status(400).json({ error: "You can't DM yourself — journal instead." }); return; }
    const [a, b] = canonicalPair(userId, targetId);
    const existing = await db.select().from(conversationsTable)
      .where(and(eq(conversationsTable.participantA, a), eq(conversationsTable.participantB, b))).limit(1);
    if (existing[0]) {
      if (existing[0].status === "blocked") { res.status(403).json({ error: "This conversation is blocked." }); return; }
      res.json({ conversation: existing[0], existing: true });
      return;
    }
    const mutual = await isMutual(userId, targetId);
    const status = mutual ? "inbox" : "request";
    const [conv] = await db.insert(conversationsTable).values({
      participantA: a, participantB: b, status, requestedBy: userId,
    }).returning();
    if (status === "request") {
      const myCard = await profileCards([userId]);
      const who = myCard[userId]?.displayName ?? "Someone";
      await notify({
        userId: targetId,
        kind: "dm_request",
        title: `🦈 ${who} sent you a message request`,
        body: mutual ? "" : "You don't follow each other — it's sitting in your requests.",
        link: "/messages",
      });
    }
    res.status(201).json({ conversation: conv, existing: false });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: "Invalid user id." }); return; }
    console.error("[community] POST /dm/start failed", err);
    res.status(500).json({ error: "Couldn't start the conversation — try again." });
  }
});

/** Thread messages (paginated). Opening a thread marks incoming read. */
router.get("/dm/:id/messages", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const { conv, error } = await getConversation(param(req, "id"), userId);
    if (error || !conv) { res.status(error ?? 404).json({ error: "Conversation not found." }); return; }
    const limit = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 50) || 50));
    const before = typeof req.query["before"] === "string" ? new Date(req.query["before"]) : null;
    const conds = [eq(messagesTable.conversationId, conv.id)];
    if (before && !Number.isNaN(before.getTime())) conds.push(lt(messagesTable.createdAt, before));
    const rows = await db.select().from(messagesTable)
      .where(and(...conds))
      .orderBy(desc(messagesTable.createdAt)).limit(limit);
    // Mark incoming as read (fire-and-forget semantics, awaited for correctness).
    await db.update(messagesTable)
      .set({ isRead: true })
      .where(and(
        eq(messagesTable.conversationId, conv.id),
        ne(messagesTable.senderUserId, userId),
        eq(messagesTable.isRead, false),
      ));
    res.json({ messages: rows.reverse(), status: conv.status });
  } catch (err) {
    console.error("[community] GET /dm/:id/messages failed", err);
    res.status(500).json({ error: "Couldn't load messages — try again." });
  }
});

/** Send a message. Rate-limited (anti-spam), 2000 chars max. */
router.post("/dm/:id/send", requireAuth, dmSendLimiter, async (req, res) => {
  try {
    const userId = req.userId!;
    const { conv, error } = await getConversation(param(req, "id"), userId);
    if (error || !conv) { res.status(error ?? 404).json({ error: "Conversation not found." }); return; }
    if (conv.status === "blocked") { res.status(403).json({ error: "This conversation is blocked." }); return; }
    if (conv.status === "request" && conv.requestedBy !== userId) {
      res.status(403).json({ error: "Accept the request before you reply." });
      return;
    }
    const { body } = dmSendSchema.parse(req.body);
    const [msg] = await db.insert(messagesTable).values({
      conversationId: conv.id, senderUserId: userId, body,
    }).returning();
    await db.update(conversationsTable)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversationsTable.id, conv.id));
    res.status(201).json({ message: msg });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.issues[0]?.message ?? "Keep it under 2000 characters." }); return; }
    console.error("[community] POST /dm/:id/send failed", err);
    res.status(500).json({ error: "Couldn't send — try again." });
  }
});

/** Accept a message request (moves it to the inbox). */
router.post("/dm/:id/accept", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const { conv, error } = await getConversation(param(req, "id"), userId);
    if (error || !conv) { res.status(error ?? 404).json({ error: "Conversation not found." }); return; }
    if (conv.status !== "request") { res.status(400).json({ error: "Nothing to accept here." }); return; }
    if (conv.requestedBy === userId) { res.status(400).json({ error: "You sent this request — the other side accepts." }); return; }
    await db.update(conversationsTable).set({ status: "inbox" }).where(eq(conversationsTable.id, conv.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[community] POST /dm/:id/accept failed", err);
    res.status(500).json({ error: "Couldn't accept — try again." });
  }
});

/** Decline a message request (deletes the conversation + thread). */
router.post("/dm/:id/decline", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const { conv, error } = await getConversation(param(req, "id"), userId);
    if (error || !conv) { res.status(error ?? 404).json({ error: "Conversation not found." }); return; }
    if (conv.status !== "request") { res.status(400).json({ error: "Nothing to decline here." }); return; }
    if (conv.requestedBy === userId) { res.status(400).json({ error: "You sent this request — cancel it by blocking instead." }); return; }
    await db.delete(conversationsTable).where(eq(conversationsTable.id, conv.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[community] POST /dm/:id/decline failed", err);
    res.status(500).json({ error: "Couldn't decline — try again." });
  }
});

/** Block a conversation. */
router.post("/dm/:id/block", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const { conv, error } = await getConversation(param(req, "id"), userId);
    if (error || !conv) { res.status(error ?? 404).json({ error: "Conversation not found." }); return; }
    await db.update(conversationsTable).set({ status: "blocked" }).where(eq(conversationsTable.id, conv.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[community] POST /dm/:id/block failed", err);
    res.status(500).json({ error: "Couldn't block — try again." });
  }
});

/* ── GROUPS: broadcast DMs (5-6 star power tool, owner only) ────────────── */

/** Broadcast one message to every member as a DM (owner only, capped, rate-limited). */
router.post("/groups/:slug/broadcast", requireAuth, broadcastLimiter, async (req, res) => {
  try {
    const group = await getGroupBySlug(param(req, "slug"));
    if (!group) { res.status(404).json({ error: "Group not found." }); return; }
    const userId = req.userId!;
    const role = await membershipRole(group.id, userId);
    if (role !== "owner") { res.status(403).json({ error: "Only the group owner can broadcast." }); return; }
    const { body } = dmSendSchema.parse(req.body);
    const members = await db.select({ userId: groupMembersTable.userId })
      .from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, group.id), ne(groupMembersTable.userId, userId)))
      .limit(200);
    let sent = 0;
    const now = new Date();
    for (const m of members) {
      const [a, b] = canonicalPair(userId, m.userId);
      let convRows = await db.select().from(conversationsTable)
        .where(and(eq(conversationsTable.participantA, a), eq(conversationsTable.participantB, b))).limit(1);
      let conv = convRows[0];
      if (!conv) {
        const ins = await db.insert(conversationsTable).values({
          participantA: a, participantB: b, status: "inbox", requestedBy: userId,
        }).returning();
        conv = ins[0]!;
      }
      if (conv.status === "blocked") continue;
      await db.insert(messagesTable).values({ conversationId: conv.id, senderUserId: userId, body });
      await db.update(conversationsTable).set({ lastMessageAt: now }).where(eq(conversationsTable.id, conv.id));
      sent++;
    }
    res.json({ ok: true, sent });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.issues[0]?.message ?? "Invalid input." }); return; }
    console.error("[community] POST /groups/:slug/broadcast failed", err);
    res.status(500).json({ error: "Couldn't broadcast — try again." });
  }
});

/* ── EVENTS: host analytics (4-6 star power tool, host only) ─────────────── */

/** RSVP analytics for the host: total + signups per day (last 30 days). */
router.get("/events/:id/stats", requireAuth, async (req, res) => {
  try {
    const eventId = z.string().uuid().parse(param(req, "id"));
    const userId = req.userId!;
    const profile = await getMyProfile(userId);
    const evRows = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId)).limit(1);
    const ev = evRows[0];
    if (!ev) { res.status(404).json({ error: "Event not found." }); return; }
    if (!profile || ev.profileId !== profile.id) {
      res.status(403).json({ error: "Only the host can see event analytics." });
      return;
    }
    const byDay = await db.select({
      day: sql<string>`to_char(${eventRsvpsTable.createdAt}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
      .from(eventRsvpsTable)
      .where(and(
        eq(eventRsvpsTable.eventId, eventId),
        gte(eventRsvpsTable.createdAt, sql`now() - interval '30 days'`),
      ))
      .groupBy(sql`to_char(${eventRsvpsTable.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${eventRsvpsTable.createdAt}, 'YYYY-MM-DD')`);
    res.json({ total: ev.rsvpCount, by_day: byDay });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: "Invalid event id." }); return; }
    console.error("[community] GET /events/:id/stats failed", err);
    res.status(500).json({ error: "Couldn't load stats — try again." });
  }
});

/* ── EXPLORE ─────────────────────────────────────────────────────────────── */

/** Blended "best of everything" payload. Every card deep-links to its destination. */
router.get("/explore", async (req, res) => {
  try {
    const shortRows = await db.select({
      video: profileVideosTable,
      hostSlug: creatorProfilesTable.slug,
      hostName: creatorProfilesTable.displayName,
      hostAvatar: creatorProfilesTable.avatarUrl,
    })
      .from(profileVideosTable)
      .innerJoin(creatorProfilesTable, eq(profileVideosTable.profileId, creatorProfilesTable.id))
      .where(and(
        eq(creatorProfilesTable.isPublic, true),
        sql`${profileVideosTable.durationSec} > 0`,
        sql`${profileVideosTable.durationSec} <= 65`,
      ))
      .orderBy(desc(profileVideosTable.viewCount)).limit(10);

    const creatorRows = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.isPublic, true))
      .orderBy(desc(creatorProfilesTable.followerCount)).limit(10);

    const postRows = await db.select({
      post: groupPostsTable,
      groupSlug: groupsTable.slug,
      groupName: groupsTable.name,
    })
      .from(groupPostsTable)
      .innerJoin(groupsTable, eq(groupPostsTable.groupId, groupsTable.id))
      .where(eq(groupsTable.isPublic, true))
      .orderBy(desc(groupPostsTable.likeCount)).limit(10);
    const postCards = await profileCards(postRows.map((r) => r.post.authorUserId));

    const now = new Date();
    const eventRows = await db.select({
      event: eventsTable,
      hostSlug: creatorProfilesTable.slug,
      hostName: creatorProfilesTable.displayName,
      hostAvatar: creatorProfilesTable.avatarUrl,
    })
      .from(eventsTable)
      .innerJoin(creatorProfilesTable, eq(eventsTable.profileId, creatorProfilesTable.id))
      .where(gte(eventsTable.startsAt, now))
      .orderBy(asc(eventsTable.startsAt)).limit(8);

    const groupRows = await db.select().from(groupsTable)
      .where(eq(groupsTable.isPublic, true))
      .orderBy(desc(groupsTable.memberCount)).limit(8);

    res.json({
      shorts: shortRows.map((r) => ({
        id: r.video.id, title: r.video.title, thumbnail_url: r.video.thumbnailUrl,
        view_count: r.video.viewCount, duration_sec: r.video.durationSec,
        creator: { slug: r.hostSlug, display_name: r.hostName, avatar_url: r.hostAvatar },
      })),
      creators: creatorRows.map((c) => ({
        id: c.id, slug: c.slug, display_name: c.displayName, avatar_url: c.avatarUrl,
        vertical: c.vertical, follower_count: c.followerCount,
      })),
      posts: postRows.map((r) => ({
        id: r.post.id, body: r.post.body, like_count: r.post.likeCount, created_at: r.post.createdAt,
        group: { slug: r.groupSlug, name: r.groupName },
        author: postCards[r.post.authorUserId] ?? null,
      })),
      events: eventRows.map((r) => ({
        id: r.event.id, title: r.event.title, kind: r.event.kind, starts_at: r.event.startsAt,
        cover_url: r.event.coverUrl, rsvp_count: r.event.rsvpCount,
        host: { slug: r.hostSlug, display_name: r.hostName, avatar_url: r.hostAvatar },
      })),
      groups: groupRows.map((g) => ({
        id: g.id, slug: g.slug, name: g.name, description: g.description,
        cover_url: g.coverUrl, member_count: g.memberCount,
      })),
    });
  } catch (err) {
    console.error("[community] GET /explore failed", err);
    res.status(500).json({ error: "Couldn't load Explore — try again." });
  }
});

/* ── Profile resolution (link-graph glue) ─────────────────────────────────
   GET /api/profiles/resolve?slug= — maps a creator slug to its user_id so
   any surface (groups, events, explore, profiles) can deep-link
   "Message" -> /messages?to=<user_id>. Kept here (not in creator-platform)
   so all cross-surface wiring lives in one contract.
   Privacy: only resolves PUBLIC profiles. Private profiles return 404 so
   their user_id can't be enumerated via slug guessing. */
router.get("/profiles/resolve", async (req, res) => {
  try {
    const slug = typeof req.query["slug"] === "string" ? req.query["slug"].trim().toLowerCase() : "";
    if (!slug) { res.status(400).json({ error: "slug is required." }); return; }
    const rows = await db.select({
      userId: creatorProfilesTable.userId,
      slug: creatorProfilesTable.slug,
      displayName: creatorProfilesTable.displayName,
      avatarUrl: creatorProfilesTable.avatarUrl,
    })
      .from(creatorProfilesTable)
      .where(and(
        eq(creatorProfilesTable.slug, slug),
        eq(creatorProfilesTable.isPublic, true),
      ))
      .limit(1);
    const p = rows[0];
    if (!p) { res.status(404).json({ error: "Creator not found." }); return; }
    res.json({ user_id: p.userId, slug: p.slug, display_name: p.displayName, avatar_url: p.avatarUrl });
  } catch (err) {
    console.error("[community] GET /profiles/resolve failed", err);
    res.status(500).json({ error: "Couldn't resolve the profile — try again." });
  }
});

export default router;
