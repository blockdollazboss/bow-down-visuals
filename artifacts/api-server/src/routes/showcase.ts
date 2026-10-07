import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { db, showcaseItemsTable, showcaseLikesTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";

const router = Router();

/* ─── Public showcase galleries ───
   Opt-in: creators publish their thumbnails, videos, songs to a public
   showcase. Each item gets an indexable /showcase/:slug page. Likes are
   deduped by voter fingerprint (no login required). */

const MEDIA_TYPES = ["image", "video", "song"] as const;

const PublishSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().default(""),
  mediaType: z.enum(MEDIA_TYPES),
  mediaUrl: z.string().trim().min(1).max(2048),
  thumbnailUrl: z.string().trim().max(2048).optional().nullable(),
  creatorName: z.string().trim().max(60).optional(),
});

function makeSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "creation";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

function voterKey(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string {
  const ip = req.ip ?? "unknown";
  const ua = req.headers["user-agent"] ?? "unknown";
  return createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 32);
}

/* POST /api/showcase/publish — opt-in publish (auth required) */
router.post("/showcase/publish", requireAuth, async (req, res) => {
  const parsed = PublishSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid showcase item", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;
  try {
    const [item] = await db
      .insert(showcaseItemsTable)
      .values({
        user_id: req.userId!,
        slug: makeSlug(d.title),
        title: d.title,
        description: d.description ?? "",
        media_type: d.mediaType,
        media_url: d.mediaUrl,
        thumbnail_url: d.thumbnailUrl ?? null,
        creator_name: d.creatorName?.trim() || "Anonymous Creator",
      })
      .returning();
    res.json({ item });
  } catch (err) {
    req.log.error({ err }, "[showcase] publish failed");
    res.status(500).json({ error: "Could not publish to showcase." });
  }
});

/* GET /api/showcase — public list, newest first, optional ?type= filter */
router.get("/showcase", async (req, res) => {
  const type = req.query.type as string | undefined;
  const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 24));
  try {
    const where = type && (MEDIA_TYPES as readonly string[]).includes(type)
      ? eq(showcaseItemsTable.media_type, type)
      : undefined;
    const items = await db
      .select()
      .from(showcaseItemsTable)
      .where(where)
      .orderBy(desc(showcaseItemsTable.created_at))
      .limit(limit);
    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "[showcase] list failed");
    res.status(500).json({ error: "Could not load showcase." });
  }
});

/* GET /api/showcase/:slug — public item detail; increments views */
router.get("/showcase/:slug", async (req, res) => {
  const { slug } = req.params as { slug: string };
  try {
    const [item] = await db
      .select()
      .from(showcaseItemsTable)
      .where(eq(showcaseItemsTable.slug, slug))
      .limit(1);
    if (!item) {
      res.status(404).json({ error: "Showcase item not found." });
      return;
    }
    // Fire-and-forget view count — never block the read.
    db.update(showcaseItemsTable)
      .set({ views: sql`${showcaseItemsTable.views} + 1` })
      .where(eq(showcaseItemsTable.id, item.id))
      .catch(() => {});
    res.json({ item: { ...item, views: item.views + 1 } });
  } catch (err) {
    req.log.error({ err }, "[showcase] detail failed");
    res.status(500).json({ error: "Could not load showcase item." });
  }
});

/* POST /api/showcase/:slug/like — public like, deduped by voter fingerprint */
router.post("/showcase/:slug/like", async (req, res) => {
  const { slug } = req.params as { slug: string };
  try {
    const [item] = await db
      .select({ id: showcaseItemsTable.id })
      .from(showcaseItemsTable)
      .where(eq(showcaseItemsTable.slug, slug))
      .limit(1);
    if (!item) {
      res.status(404).json({ error: "Showcase item not found." });
      return;
    }
    const key = voterKey(req);
    // Idempotent insert — duplicate voter is a no-op.
    await db
      .insert(showcaseLikesTable)
      .values({ item_id: item.id, voter_key: key })
      .onConflictDoNothing();
    // Recompute the count from the likes table (source of truth).
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(showcaseLikesTable)
      .where(eq(showcaseLikesTable.item_id, item.id));
    await db
      .update(showcaseItemsTable)
      .set({ likes: count })
      .where(eq(showcaseItemsTable.id, item.id));
    res.json({ likes: count });
  } catch (err) {
    req.log.error({ err }, "[showcase] like failed");
    res.status(500).json({ error: "Could not record like." });
  }
});

/* DELETE /api/showcase/:id — unpublish (owner only) */
router.delete("/showcase/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const [deleted] = await db
      .delete(showcaseItemsTable)
      .where(and(eq(showcaseItemsTable.id, id), eq(showcaseItemsTable.user_id, req.userId!)))
      .returning({ id: showcaseItemsTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Showcase item not found." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "[showcase] delete failed");
    res.status(500).json({ error: "Could not remove from showcase." });
  }
});

export default router;
