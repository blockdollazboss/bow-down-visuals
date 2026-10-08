/**
 * POST /api/publish/* — Creator Streaming Platform: upload & publish content.
 *
 * Mount (coordinator): router.use("/publish", publishRouter) — i.e. register
 * this file in routes/index.ts under the "/publish" prefix.
 *
 * Built against Worker 1's contract:
 *   profile_tracks(profile_id, title, audio_url, artwork_url, genre, tags,
 *                  isrc, duration_sec, download_price_cents, is_published)
 *   profile_videos(profile_id, title, video_url, thumbnail_url, duration_sec,
 *                  description, is_published)
 *   GET/POST/PUT /api/creator-profiles (slug + ownership, Worker 1)
 *
 * Content-type agnostic: the `category` (music/video/podcast/gaming/fitness/
 * education) is a creator vertical stored in `tags`; the audio/video split
 * only decides which contract table the row lives in.
 *
 * Credits: uploading/publishing is FREE (it's the creator's own content).
 * Only AI extras (artwork generation) charge per the credit registry.
 */
import { NextFunction, Request, Response, Router } from "express";
import { randomUUID } from "crypto";
import multer from "multer";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../lib/objectStorage";

const router = Router();

/* ─── File upload (reuses the Supabase storage pipeline) ─────────────────── */

/** 80 MB cap matches the bucket-level guard used by /upload-clip (PR #5). */
const PUBLISH_UPLOAD_MAX_BYTES = 80 * 1024 * 1024;
const ARTWORK_MAX_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PUBLISH_UPLOAD_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("audio/") ||
      file.mimetype.startsWith("video/") ||
      file.mimetype.startsWith("image/");
    if (ok) cb(null, true);
    else cb(new Error("Only audio, video, or image files are allowed"));
  },
});

/**
 * POST /publish/upload
 * Multipart field "file". Returns { url, ref }.
 * Images are capped at 10 MB (artwork/thumbnails); audio+video at 80 MB.
 */
router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }
  try {
    if (req.file.mimetype.startsWith("image/") && req.file.size > ARTWORK_MAX_BYTES) {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: "Artwork images must be 10 MB or smaller.",
      });
      return;
    }
    const rawExt = (req.file.originalname.split(".").pop() ?? "bin").toLowerCase();
    const ext = rawExt.replace(/[^a-z0-9]/g, "") || "bin";
    const kind = req.file.mimetype.startsWith("audio/")
      ? "audio"
      : req.file.mimetype.startsWith("video/")
        ? "video"
        : "artwork";
    const objectName = `publish/${req.userId}/${kind}/${Date.now()}-${randomUUID()}.${ext}`;
    const ref = await uploadMediaToSupabaseStorage(
      objectName,
      req.file.buffer,
      req.file.mimetype || "application/octet-stream",
    );
    const url = await refreshSupabaseStorageUrl(ref);
    req.log.info({ objectName, bytes: req.file.size, kind }, "[publish] file uploaded");
    res.json({ url, ref });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload failed";
    req.log.error({ err: msg }, "[publish] upload failed");
    res.status(500).json({ error: msg });
  }
});

/** Turn multer upload errors into clean JSON the frontend can display. */
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: "This file exceeds the 80 MB upload limit. Please use a smaller file.",
      });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
});

/* ─── Profile ownership (Worker 1 contract: /api/creator-profiles) ───────── */

interface CreatorProfileRef {
  id: string;
  slug?: string | null;
}

/**
 * Verify that `profileId` belongs to the authenticated user, using Worker 1's
 * GET /api/creator-profiles (handles array-or-single-object responses).
 * Throws a human-readable error when the profiles API isn't reachable —
 * publish routes fail closed with a clear message instead of leaking data.
 */
async function getMyProfiles(req: Request): Promise<CreatorProfileRef[]> {
  const base = `${req.protocol}://${req.get("host")}`;
  const res = await fetch(`${base}/api/creator-profiles`, {
    headers: { Authorization: req.headers["authorization"] ?? "" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(
      `Creator profiles are not available yet (GET /api/creator-profiles → ${res.status}).`,
    );
  }
  const json = (await res.json()) as unknown;
  if (!json || typeof json !== "object") return [];
  if (Array.isArray(json)) {
    return (json as CreatorProfileRef[]).filter((p) => p && typeof p.id === "string");
  }
  const obj = json as { profiles?: unknown; id?: unknown };
  if (Array.isArray(obj.profiles)) {
    return (obj.profiles as CreatorProfileRef[]).filter((p) => p && typeof p.id === "string");
  }
  if (typeof obj.id === "string") return [{ id: obj.id }];
  return [];
}

async function requireOwnedProfile(req: Request, profileId: string): Promise<void> {
  const mine = await getMyProfiles(req);
  if (!mine.some((p) => p.id === profileId)) {
    const err = new Error("This profile does not belong to your account.") as Error & {
      status?: number;
    };
    err.status = 403;
    throw err;
  }
}

async function ownedProfileIds(req: Request): Promise<string[]> {
  return (await getMyProfiles(req)).map((p) => p.id);
}

function publishError(res: Response, req: Request, err: unknown, ctx: string): void {
  const msg = err instanceof Error ? err.message : "Request failed";
  const status =
    err instanceof Error && "status" in err && typeof (err as { status?: number }).status === "number"
      ? ((err as { status?: number }).status as number)
      : undefined;
  // Worker 1's tables may not exist yet — surface that as 503, not a crash.
  if (/relation .* does not exist|undefined_table/i.test(msg)) {
    req.log.warn({ ctx, msg }, "[publish] contract tables not ready yet");
    res.status(503).json({
      error: "publish_not_ready",
      message: "The creator platform tables are still being set up. Try again in a moment.",
    });
    return;
  }
  req.log.error({ ctx, err: msg }, "[publish] failed");
  res.status(status ?? 500).json({ error: msg });
}

/* ─── Validation ─────────────────────────────────────────────────────────── */

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function posInt(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1) return null;
  return Math.min(9999, Math.floor(v));
}

/**
 * Do profile_videos rows carry season/episode (film & tv verticals)? The
 * contract schema may gain these columns after Worker 1's migration lands;
 * probe once and cache so both POST and PUT build valid SQL either way.
 */
let seasonColsKnown: boolean | null = null;
async function profileVideosHasSeason(): Promise<boolean> {
  if (seasonColsKnown !== null) return seasonColsKnown;
  try {
    const r = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'profile_videos' AND column_name IN ('season', 'episode')
    `);
    seasonColsKnown = ((r.rows[0] as { n?: number } | undefined)?.n ?? 0) === 2;
  } catch {
    seasonColsKnown = false;
  }
  return seasonColsKnown;
}

function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32))
    .filter(Boolean)
    .slice(0, 12);
}

/* ─── Tracks (audio content) ─────────────────────────────────────────────── */

/**
 * POST /publish/track
 * Body: { profile_id, title, audio_url, artwork_url?, genre?, category?,
 *         tags?, isrc?, duration_sec?, download_price_cents?, is_published? }
 * Free — no credits charged.
 */
router.post("/track", requireAuth, async (req: Request, res: Response) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const profileId = cleanStr(b["profile_id"], 64);
    const title = cleanStr(b["title"], 160);
    const audioUrl = cleanStr(b["audio_url"], 2048);
    if (!profileId || !title || !audioUrl) {
      res.status(400).json({ error: "profile_id, title, and audio_url are required" });
      return;
    }
    await requireOwnedProfile(req, profileId);

    const category = cleanStr(b["category"], 32)?.toLowerCase();
    const tags = cleanTags(b["tags"]);
    if (category && !tags.includes(category)) tags.unshift(category);

    const result = await db.execute(sql`
      INSERT INTO profile_tracks
        (profile_id, title, audio_url, artwork_url, genre, tags, isrc,
         duration_sec, download_price_cents, is_published)
      VALUES
        (${profileId}, ${title}, ${audioUrl},
         ${cleanStr(b["artwork_url"], 2048)}, ${cleanStr(b["genre"], 60)},
         ${tags.length ? sql`ARRAY[${sql.join(tags.map((t) => sql`${t}`), sql`, `)}]` : sql`'{}'`},
         ${cleanStr(b["isrc"], 32)},
         ${typeof b["duration_sec"] === "number" && b["duration_sec"] >= 0 ? Math.round(b["duration_sec"]) : null},
         ${typeof b["download_price_cents"] === "number" && b["download_price_cents"] >= 0 ? Math.round(b["download_price_cents"]) : 0},
         ${b["is_published"] === true})
      RETURNING id, profile_id, title, audio_url, artwork_url, genre, tags,
                isrc, duration_sec, download_price_cents, is_published
    `);
    res.status(201).json({ track: result.rows[0] });
  } catch (err) {
    publishError(res, req, err, "POST /publish/track");
  }
});

/** GET /publish/tracks — my tracks across all my profiles (drafts + published). */
router.get("/tracks", requireAuth, async (req: Request, res: Response) => {
  try {
    const ids = await ownedProfileIds(req);
    if (!ids.length) {
      res.json({ tracks: [] });
      return;
    }
    const result = await db.execute(sql`
      SELECT id, profile_id, title, audio_url, artwork_url, genre, tags, isrc,
             duration_sec, download_price_cents, is_published
      FROM profile_tracks
      WHERE profile_id = ANY(${sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]`})
      ORDER BY id DESC
      LIMIT 200
    `);
    res.json({ tracks: result.rows });
  } catch (err) {
    publishError(res, req, err, "GET /publish/tracks");
  }
});

/** PUT /publish/track/:id — update metadata / publish state. */
router.put("/track/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const current = await db.execute(sql`
      SELECT profile_id FROM profile_tracks WHERE id = ${id} LIMIT 1
    `);
    const row = current.rows[0] as { profile_id?: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "Content not found" });
      return;
    }
    await requireOwnedProfile(req, row.profile_id as string);

    const category = cleanStr(b["category"], 32)?.toLowerCase();
    const tags = cleanTags(b["tags"]);
    if (category && !tags.includes(category)) tags.unshift(category);

    const result = await db.execute(sql`
      UPDATE profile_tracks SET
        title = COALESCE(${cleanStr(b["title"], 160)}, title),
        audio_url = COALESCE(${cleanStr(b["audio_url"], 2048)}, audio_url),
        artwork_url = COALESCE(${cleanStr(b["artwork_url"], 2048)}, artwork_url),
        genre = COALESCE(${cleanStr(b["genre"], 60)}, genre),
        tags = ${tags.length ? sql`ARRAY[${sql.join(tags.map((t) => sql`${t}`), sql`, `)}]` : sql`tags`},
        isrc = COALESCE(${cleanStr(b["isrc"], 32)}, isrc),
        duration_sec = COALESCE(${
          typeof b["duration_sec"] === "number" && b["duration_sec"] >= 0
            ? Math.round(b["duration_sec"])
            : null
        }, duration_sec),
        download_price_cents = COALESCE(${
          typeof b["download_price_cents"] === "number" && b["download_price_cents"] >= 0
            ? Math.round(b["download_price_cents"])
            : null
        }, download_price_cents),
        is_published = COALESCE(${typeof b["is_published"] === "boolean" ? b["is_published"] : null}, is_published)
      WHERE id = ${id}
      RETURNING id, profile_id, title, audio_url, artwork_url, genre, tags,
                isrc, duration_sec, download_price_cents, is_published
    `);
    res.json({ track: result.rows[0] });
  } catch (err) {
    publishError(res, req, err, "PUT /publish/track/:id");
  }
});

/** DELETE /publish/track/:id */
router.delete("/track/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const current = await db.execute(sql`
      SELECT profile_id FROM profile_tracks WHERE id = ${id} LIMIT 1
    `);
    const row = current.rows[0] as { profile_id?: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "Content not found" });
      return;
    }
    await requireOwnedProfile(req, row.profile_id as string);
    await db.execute(sql`DELETE FROM profile_tracks WHERE id = ${id}`);
    res.json({ deleted: id });
  } catch (err) {
    publishError(res, req, err, "DELETE /publish/track/:id");
  }
});

/* ─── Videos ─────────────────────────────────────────────────────────────── */

/**
 * POST /publish/video
 * Body: { profile_id, title, video_url, thumbnail_url?, category?,
 *         duration_sec?, description?, is_published? }
 * Videos stream on the profile; downloads are free (paid downloads are a
 * tracks-only feature per the contract schema).
 */
router.post("/video", requireAuth, async (req: Request, res: Response) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const profileId = cleanStr(b["profile_id"], 64);
    const title = cleanStr(b["title"], 160);
    const videoUrl = cleanStr(b["video_url"], 2048);
    if (!profileId || !title || !videoUrl) {
      res.status(400).json({ error: "profile_id, title, and video_url are required" });
      return;
    }
    await requireOwnedProfile(req, profileId);

    const season = posInt(b["season"]);
    const episode = posInt(b["episode"]);
    const hasSeason = await profileVideosHasSeason();

    const result = hasSeason
      ? await db.execute(sql`
          INSERT INTO profile_videos
            (profile_id, title, video_url, thumbnail_url, duration_sec,
             description, is_published, season, episode)
          VALUES
            (${profileId}, ${title}, ${videoUrl},
             ${cleanStr(b["thumbnail_url"], 2048)},
             ${typeof b["duration_sec"] === "number" && b["duration_sec"] >= 0 ? Math.round(b["duration_sec"]) : null},
             ${cleanStr(b["description"], 2000)},
             ${b["is_published"] === true},
             ${season}, ${episode})
          RETURNING id, profile_id, title, video_url, thumbnail_url, duration_sec,
                    description, is_published, season, episode
        `)
      : await db.execute(sql`
          INSERT INTO profile_videos
            (profile_id, title, video_url, thumbnail_url, duration_sec,
             description, is_published)
          VALUES
            (${profileId}, ${title}, ${videoUrl},
             ${cleanStr(b["thumbnail_url"], 2048)},
             ${typeof b["duration_sec"] === "number" && b["duration_sec"] >= 0 ? Math.round(b["duration_sec"]) : null},
             ${cleanStr(b["description"], 2000)},
             ${b["is_published"] === true})
          RETURNING id, profile_id, title, video_url, thumbnail_url, duration_sec,
                    description, is_published
        `);
    res.status(201).json({ video: result.rows[0] });
  } catch (err) {
    publishError(res, req, err, "POST /publish/video");
  }
});

/** GET /publish/videos — my videos across all my profiles. */
router.get("/videos", requireAuth, async (req: Request, res: Response) => {
  try {
    const ids = await ownedProfileIds(req);
    if (!ids.length) {
      res.json({ videos: [] });
      return;
    }
    const result = await db.execute(sql`
      SELECT id, profile_id, title, video_url, thumbnail_url, duration_sec,
             description, is_published
      FROM profile_videos
      WHERE profile_id = ANY(${sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]`})
      ORDER BY id DESC
      LIMIT 200
    `);
    res.json({ videos: result.rows });
  } catch (err) {
    publishError(res, req, err, "GET /publish/videos");
  }
});

/** PUT /publish/video/:id */
router.put("/video/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const current = await db.execute(sql`
      SELECT profile_id FROM profile_videos WHERE id = ${id} LIMIT 1
    `);
    const row = current.rows[0] as { profile_id?: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "Content not found" });
      return;
    }
    await requireOwnedProfile(req, row.profile_id as string);

    const hasSeason = await profileVideosHasSeason();
    const season = posInt(b["season"]);
    const episode = posInt(b["episode"]);
    const result = hasSeason
      ? await db.execute(sql`
          UPDATE profile_videos SET
            title = COALESCE(${cleanStr(b["title"], 160)}, title),
            video_url = COALESCE(${cleanStr(b["video_url"], 2048)}, video_url),
            thumbnail_url = COALESCE(${cleanStr(b["thumbnail_url"], 2048)}, thumbnail_url),
            duration_sec = COALESCE(${
              typeof b["duration_sec"] === "number" && b["duration_sec"] >= 0
                ? Math.round(b["duration_sec"])
                : null
            }, duration_sec),
            description = COALESCE(${cleanStr(b["description"], 2000)}, description),
            is_published = COALESCE(${typeof b["is_published"] === "boolean" ? b["is_published"] : null}, is_published),
            season = COALESCE(${season}, season),
            episode = COALESCE(${episode}, episode)
          WHERE id = ${id}
          RETURNING id, profile_id, title, video_url, thumbnail_url, duration_sec,
                    description, is_published, season, episode
        `)
      : await db.execute(sql`
          UPDATE profile_videos SET
            title = COALESCE(${cleanStr(b["title"], 160)}, title),
            video_url = COALESCE(${cleanStr(b["video_url"], 2048)}, video_url),
            thumbnail_url = COALESCE(${cleanStr(b["thumbnail_url"], 2048)}, thumbnail_url),
            duration_sec = COALESCE(${
              typeof b["duration_sec"] === "number" && b["duration_sec"] >= 0
                ? Math.round(b["duration_sec"])
                : null
            }, duration_sec),
            description = COALESCE(${cleanStr(b["description"], 2000)}, description),
            is_published = COALESCE(${typeof b["is_published"] === "boolean" ? b["is_published"] : null}, is_published)
          WHERE id = ${id}
          RETURNING id, profile_id, title, video_url, thumbnail_url, duration_sec,
                    description, is_published
        `);
    res.json({ video: result.rows[0] });
  } catch (err) {
    publishError(res, req, err, "PUT /publish/video/:id");
  }
});

/** DELETE /publish/video/:id */
router.delete("/video/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const current = await db.execute(sql`
      SELECT profile_id FROM profile_videos WHERE id = ${id} LIMIT 1
    `);
    const row = current.rows[0] as { profile_id?: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "Content not found" });
      return;
    }
    await requireOwnedProfile(req, row.profile_id as string);
    await db.execute(sql`DELETE FROM profile_videos WHERE id = ${id}`);
    res.json({ deleted: id });
  } catch (err) {
    publishError(res, req, err, "DELETE /publish/video/:id");
  }
});

export default router;
