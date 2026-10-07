/**
 * albums.ts — Album/EP Builder (Suno library parity).
 *
 *  POST   /api/albums                  create a draft album (free)
 *  GET    /api/albums                  list the caller's albums (with track counts)
 *  GET    /api/albums/public/:slug     public published album detail (SEO/share surface)
 *  GET    /api/albums/:id              album detail with ordered tracks (owner)
 *  PATCH  /api/albums/:id              update title/notes/cover/type + reorder tracklist (free)
 *  DELETE /api/albums/:id              delete an album (tracks cascade)
 *  POST   /api/album-publish/:id       publish: charges 300 Visual Bucs, mints the
 *                                      public slug. Drafting stays free; publishing costs.
 *
 * Credit flow on publish: 402 pre-check via chargeCredits → charge 300 VB →
 * mark published + mint slug → refund on any failure after the charge.
 */
import { Router } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { db, albumsTable, albumTracksTable, songsTable } from "@workspace/db";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../lib/credits";
import { getSupabaseAdmin } from "../lib/supabase-admin";

const router = Router();

/** Visual Bucs to publish an album (drafting is free). ×100 scale. */
export const ALBUM_PUBLISH_COST = 300;

const ALBUM_TYPES = ["album", "ep"] as const;

const CreateAlbumSchema = z.object({
  title: z.string().trim().min(1).max(120),
  album_type: z.enum(ALBUM_TYPES).optional().default("album"),
  release_notes: z.string().trim().max(2000).optional().default(""),
  cover_art_url: z.string().trim().max(2048).optional().nullable(),
  song_ids: z.array(z.string().uuid()).max(30).optional().default([]),
});

const UpdateAlbumSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  album_type: z.enum(ALBUM_TYPES).optional(),
  release_notes: z.string().trim().max(2000).optional(),
  cover_art_url: z.string().trim().max(2048).nullable().optional(),
  /** Full replacement order — every song must belong to the caller. */
  song_ids: z.array(z.string().uuid()).max(30).optional(),
});

function makeSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "album";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

async function ownedSongs(userId: string, songIds: string[]) {
  if (songIds.length === 0) return [];
  const rows = await db
    .select({ id: songsTable.id })
    .from(songsTable)
    .where(and(eq(songsTable.user_id, userId), sql`${songsTable.id} IN (${sql.join(songIds.map((s) => sql`${s}`), sql`, `)})`));
  return rows.map((r) => r.id);
}

async function setTracklist(albumId: string, songIds: string[]) {
  await db.delete(albumTracksTable).where(eq(albumTracksTable.album_id, albumId));
  if (songIds.length === 0) return;
  await db.insert(albumTracksTable).values(
    songIds.map((songId, i) => ({ album_id: albumId, song_id: songId, position: i })),
  );
}

async function albumDetail(albumId: string) {
  const [album] = await db
    .select()
    .from(albumsTable)
    .where(eq(albumsTable.id, albumId))
    .limit(1);
  if (!album) return null;
  const tracks = await db
    .select({
      id: albumTracksTable.id,
      position: albumTracksTable.position,
      song_id: songsTable.id,
      title: songsTable.title,
      audio_url: songsTable.audio_url,
      source: songsTable.source,
    })
    .from(albumTracksTable)
    .innerJoin(songsTable, eq(albumTracksTable.song_id, songsTable.id))
    .where(eq(albumTracksTable.album_id, albumId))
    .orderBy(asc(albumTracksTable.position));
  return { ...album, tracks };
}

/* ── POST /api/albums — create a draft (free) ─────────────────────────── */
router.post("/albums", requireAuth, async (req, res) => {
  const parsed = CreateAlbumSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid album.", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;
  try {
    const valid = await ownedSongs(req.userId!, d.song_ids);
    if (valid.length !== d.song_ids.length) {
      res.status(400).json({ error: "One or more songs are not in your library." });
      return;
    }
    const [album] = await db
      .insert(albumsTable)
      .values({
        user_id: req.userId!,
        title: d.title,
        album_type: d.album_type,
        release_notes: d.release_notes ?? "",
        cover_art_url: d.cover_art_url ?? null,
        status: "draft",
      })
      .returning();
    await setTracklist(album.id, d.song_ids);
    res.json({ album: await albumDetail(album.id) });
  } catch (err) {
    req.log.error({ err }, "[albums] create failed");
    res.status(500).json({ error: "Could not create album." });
  }
});

/* ── GET /api/albums — list caller's albums ───────────────────────────── */
router.get("/albums", requireAuth, async (req, res) => {
  try {
    const albums = await db
      .select()
      .from(albumsTable)
      .where(eq(albumsTable.user_id, req.userId!))
      .orderBy(desc(albumsTable.updated_at));
    const withCounts = await Promise.all(
      albums.map(async (a) => {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(albumTracksTable)
          .where(eq(albumTracksTable.album_id, a.id));
        return { ...a, track_count: count };
      }),
    );
    res.json({ albums: withCounts });
  } catch (err) {
    req.log.error({ err }, "[albums] list failed");
    res.status(500).json({ error: "Could not load albums." });
  }
});

/* ── GET /api/albums/public/:slug — public published album (share surface) */
router.get("/albums/public/:slug", async (req, res) => {
  const { slug } = req.params as { slug: string };
  try {
    const [album] = await db
      .select()
      .from(albumsTable)
      .where(and(eq(albumsTable.slug, slug), eq(albumsTable.status, "published")))
      .limit(1);
    if (!album) {
      res.status(404).json({ error: "Album not found." });
      return;
    }
    const detail = await albumDetail(album.id);
    // Fire-and-forget view count — never block the read.
    db.update(albumsTable)
      .set({ views: sql`${albumsTable.views} + 1` })
      .where(eq(albumsTable.id, album.id))
      .catch(() => {});
    // Owner's referral code (read-only; never created here) so share links
    // carry ?ref=CODE and new signups credit the album owner.
    let referralCode: string | null = null;
    try {
      const supabase = getSupabaseAdmin();
      const { data } = await supabase
        .from("referral_codes")
        .select("code")
        .eq("user_id", album.user_id)
        .maybeSingle();
      referralCode = (data as { code?: string } | null)?.code ?? null;
    } catch {
      /* referral lookup is best-effort */
    }
    res.json({
      album: detail ? { ...detail, views: detail.views + 1 } : detail,
      referralCode,
    });
  } catch (err) {
    req.log.error({ err }, "[albums] public detail failed");
    res.status(500).json({ error: "Could not load album." });
  }
});

/* ── GET /api/albums/:id — owner detail ────────────────────────────────── */
router.get("/albums/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const detail = await albumDetail(id);
    if (!detail || detail.user_id !== req.userId) {
      res.status(404).json({ error: "Album not found." });
      return;
    }
    res.json({ album: detail });
  } catch (err) {
    req.log.error({ err }, "[albums] detail failed");
    res.status(500).json({ error: "Could not load album." });
  }
});

/* ── PATCH /api/albums/:id — update draft (free) ──────────────────────── */
router.patch("/albums/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  const parsed = UpdateAlbumSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid album update.", details: parsed.error.issues });
    return;
  }
  try {
    const [album] = await db
      .select()
      .from(albumsTable)
      .where(and(eq(albumsTable.id, id), eq(albumsTable.user_id, req.userId!)))
      .limit(1);
    if (!album) {
      res.status(404).json({ error: "Album not found." });
      return;
    }
    if (album.status === "published") {
      res.status(409).json({ error: "Published albums are locked. Unpublish flow is not yet supported." });
      return;
    }
    const d = parsed.data;
    if (d.song_ids) {
      const valid = await ownedSongs(req.userId!, d.song_ids);
      if (valid.length !== d.song_ids.length) {
        res.status(400).json({ error: "One or more songs are not in your library." });
        return;
      }
      await setTracklist(id, d.song_ids);
    }
    const updates: Partial<typeof albumsTable.$inferInsert> = { updated_at: new Date() };
    if (d.title !== undefined) updates.title = d.title;
    if (d.album_type !== undefined) updates.album_type = d.album_type;
    if (d.release_notes !== undefined) updates.release_notes = d.release_notes;
    if (d.cover_art_url !== undefined) updates.cover_art_url = d.cover_art_url;
    await db.update(albumsTable).set(updates).where(eq(albumsTable.id, id));
    res.json({ album: await albumDetail(id) });
  } catch (err) {
    req.log.error({ err }, "[albums] update failed");
    res.status(500).json({ error: "Could not update album." });
  }
});

/* ── DELETE /api/albums/:id ───────────────────────────────────────────── */
router.delete("/albums/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const result = await db
      .delete(albumsTable)
      .where(and(eq(albumsTable.id, id), eq(albumsTable.user_id, req.userId!)))
      .returning({ id: albumsTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Album not found." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "[albums] delete failed");
    res.status(500).json({ error: "Could not delete album." });
  }
});

/* ── POST /api/album-publish/:id — publish (300 Visual Bucs) ──────────── */
router.post("/album-publish/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const [album] = await db
      .select()
      .from(albumsTable)
      .where(and(eq(albumsTable.id, id), eq(albumsTable.user_id, req.userId!)))
      .limit(1);
    if (!album) {
      res.status(404).json({ error: "Album not found." });
      return;
    }
    if (album.status === "published") {
      res.status(409).json({ error: "Album is already published." });
      return;
    }
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(albumTracksTable)
      .where(eq(albumTracksTable.album_id, id));
    if (count === 0) {
      res.status(400).json({ error: "Add at least one song before publishing." });
      return;
    }

    // 402 pre-check + charge happen atomically inside chargeCredits.
    let creditsRemaining: number;
    try {
      creditsRemaining = await chargeCredits(req.userId!, ALBUM_PUBLISH_COST, {
        action: "Album Publish",
        projectId: id,
      });
    } catch (chargeErr) {
      if (chargeErr instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: `Publishing an album costs ${ALBUM_PUBLISH_COST} Visual Bucs — top up to publish.`,
        });
        return;
      }
      if (chargeErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "Credit ledger write failed — no credits were taken." });
        return;
      }
      throw chargeErr;
    }

    try {
      const slug = makeSlug(album.title);
      await db
        .update(albumsTable)
        .set({ status: "published", slug, updated_at: new Date() })
        .where(eq(albumsTable.id, id));
      const detail = await albumDetail(id);
      res.json({ album: detail, creditsRemaining });
    } catch (publishErr) {
      // Publish failed after the charge — refund so the user never pays for nothing.
      try {
        await refundCredits(req.userId!, ALBUM_PUBLISH_COST, {
          action: "Album Publish — refund (publish failed)",
          projectId: id,
        });
      } catch (refundErr) {
        req.log.error({ refundErr }, "[albums] publish failed AND refund failed — needs manual reconciliation");
      }
      req.log.error({ err: publishErr }, "[albums] publish failed after charge — refunded");
      res.status(500).json({ error: "Could not publish album. Your credits were refunded." });
    }
  } catch (err) {
    req.log.error({ err }, "[albums] publish failed");
    res.status(500).json({ error: "Could not publish album." });
  }
});

export default router;
