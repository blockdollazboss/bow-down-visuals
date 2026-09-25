/**
 * featured-songs.ts — the homepage "Featured Songs" playlist.
 *
 *  GET    /api/featured-songs            public: ordered track list
 *  POST   /api/featured-songs            owner-only: upload a track (multipart)
 *  PATCH  /api/featured-songs/reorder    owner-only: { ids: string[] }
 *  DELETE /api/featured-songs/:id        owner-only: remove a track
 *
 * Owner guard: ADMIN_EMAILS (comma-separated, case-insensitive). Fail closed.
 * Uploads are FREE (owner-only curation, not AI compute) and stored in the
 * site's Supabase media bucket via the shared objectStorage helper.
 * When the table is empty the playlist serves the built-in default —
 * the Bow Down Visuals theme song — so it never renders with zero tracks.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, featuredSongsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../lib/objectStorage";
import { logger } from "../lib/logger";

const router = Router();

/* ── owner guard (same pattern as routes/admin.ts) ───────────────────────── */

function adminEmails(): string[] {
  return (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const email = (req.userEmail ?? "").toLowerCase();
  if (!email || !adminEmails().includes(email)) {
    res.status(403).json({ error: "Not authorized." });
    return;
  }
  next();
}

/* ── built-in default (theme song, served from the site's public dir) ────── */

const THEME_BASE = (process.env["PUBLIC_BASE_URL"] ?? "").replace(/\/$/, "");
export const DEFAULT_TRACKS = [
  {
    id: "theme-song",
    title: "Bow Down Visuals (Theme Song)",
    artist: "Bow Down Visuals",
    audio_url: `${THEME_BASE}/audio/bow-down-visuals-theme.mp3`,
    audio_path: null as string | null,
    duration_label: null as string | null,
    position: 0,
  },
];

/* ── upload plumbing ─────────────────────────────────────────────────────── */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("audio/") ||
      /\.(mp3|wav|m4a|ogg|flac)$/i.test(file.originalname);
    cb(null, ok);
  },
});

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? m[1]!.toLowerCase() : "mp3";
}

/* ── GET /api/featured-songs ─────────────────────────────────────────────── */

router.get("/featured-songs", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(featuredSongsTable)
      .orderBy(asc(featuredSongsTable.position), asc(featuredSongsTable.created_at));

    if (rows.length === 0) {
      res.json({ tracks: DEFAULT_TRACKS, default: true });
      return;
    }
    res.json({
      tracks: rows.map((r) => ({
        id: r.id,
        title: r.title,
        artist: r.artist,
        audio_url: r.audio_url,
        audio_path: r.audio_path,
        duration_label: r.duration_label,
        position: r.position,
      })),
      default: false,
    });
  } catch (err) {
    /* Table missing (migration not run yet) — serve the default, don't 500. */
    logger.warn({ err }, "[featured-songs] list failed, serving default");
    res.json({ tracks: DEFAULT_TRACKS, default: true });
  }
});

/* ── POST /api/featured-songs ────────────────────────────────────────────── */

const UploadBody = z.object({
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().min(1).max(200).default("Bow Down Visuals"),
  duration_label: z.string().trim().max(16).optional(),
});

router.post(
  "/featured-songs",
  requireAuth,
  requireAdmin,
  upload.single("track"),
  async (req, res) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: "Upload an audio file.", code: "no_file" });
      return;
    }
    const parsed = UploadBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Title is required.", code: "bad_request" });
      return;
    }

    try {
      const objectName = `featured-songs/${randomUUID()}.${extOf(file.originalname)}`;
      const storageRef = await uploadMediaToSupabaseStorage(
        objectName,
        file.buffer,
        file.mimetype || "audio/mpeg",
      );
      const url = await refreshSupabaseStorageUrl(storageRef);

      const positions = await db
        .select({ position: featuredSongsTable.position })
        .from(featuredSongsTable);
      const nextPosition = positions.reduce((m, r) => Math.max(m, r.position), -1) + 1;

      const [row] = await db
        .insert(featuredSongsTable)
        .values({
          title: parsed.data.title,
          artist: parsed.data.artist,
          audio_url: url,
          audio_path: storageRef,
          duration_label: parsed.data.duration_label ?? null,
          position: nextPosition,
          created_by: req.userId ?? null,
        })
        .returning();

      res.status(201).json({
        track: {
          id: row!.id,
          title: row!.title,
          artist: row!.artist,
          audio_url: row!.audio_url,
          duration_label: row!.duration_label,
          position: row!.position,
        },
      });
    } catch (err) {
      logger.error({ err }, "[featured-songs] upload failed");
      res.status(502).json({ error: "Upload failed — try again.", code: "upload_failed" });
    }
  },
);

/* ── PATCH /api/featured-songs/reorder ───────────────────────────────────── */

const ReorderBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

router.patch("/featured-songs/reorder", requireAuth, requireAdmin, async (req, res) => {
  const parsed = ReorderBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "ids must be a non-empty array of track ids.", code: "bad_request" });
    return;
  }
  try {
    for (let i = 0; i < parsed.data.ids.length; i++) {
      await db
        .update(featuredSongsTable)
        .set({ position: i })
        .where(eq(featuredSongsTable.id, parsed.data.ids[i]!));
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[featured-songs] reorder failed");
    res.status(502).json({ error: "Reorder failed — try again.", code: "reorder_failed" });
  }
});

/* ── DELETE /api/featured-songs/:id ──────────────────────────────────────── */

router.delete("/featured-songs/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.delete(featuredSongsTable).where(eq(featuredSongsTable.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[featured-songs] delete failed");
    res.status(502).json({ error: "Delete failed — try again.", code: "delete_failed" });
  }
});

export default router;
