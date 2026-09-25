/**
 * playlist.ts — the floating widget's music playlist (Supabase-backed).
 *
 *  GET    /api/playlist          list tracks [{ name, url }] (public)
 *  POST   /api/playlist/upload   owner upload (multipart audio, ≤25MB)
 *  DELETE /api/playlist/:name    owner delete
 *
 * Tracks live in the public `playlist` Supabase storage bucket; the owner
 * uploads more songs over time from the widget. The built-in theme song is
 * frontend-bundled and is NOT part of this list.
 *
 * Pure listing/playback costs nothing to run — no credit charges anywhere
 * in this flow.
 */
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/require-auth";
import { requireAdmin } from "./admin";
import { getSupabaseAdmin } from "../lib/supabase-admin";

const router = Router();

export const PLAYLIST_BUCKET = "playlist";

const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "ogg", "flac"];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/* ── bucket self-heal ───────────────────────────────────────────────────
 * Same proven REST pattern as ensureSupabaseClipsBucket (objectStorage.ts):
 * create via the Storage REST API — never the supabase-js bucket helpers,
 * which have silently failed before — then verify-after-create and throw
 * LOUDLY if the bucket is still missing. */
let bucketEnsured: Promise<void> | null = null;

async function ensurePlaylistBucket(): Promise<void> {
  const url = (
    process.env["SUPABASE_URL"] ??
    process.env["VITE_SUPABASE_URL"] ??
    ""
  ).replace(/\/$/, "");
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured — cannot ensure playlist bucket.",
    );
  }
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  const getBucket = () =>
    fetch(`${url}/storage/v1/bucket/${PLAYLIST_BUCKET}`, { headers });

  if ((await getBucket()).ok) return; // already exists

  const createRes = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: PLAYLIST_BUCKET,
      name: PLAYLIST_BUCKET,
      public: true, // direct <audio> playback needs public URLs
    }),
  });
  const createText = await createRes.text().catch(() => "");
  const alreadyExists =
    createRes.status === 409 || /already exists/i.test(createText);
  if (!createRes.ok && !alreadyExists) {
    throw new Error(
      `Failed to create Supabase bucket "${PLAYLIST_BUCKET}": ${createRes.status} ${createText.slice(0, 300)}`,
    );
  }

  // Verify it actually exists now — never silently continue into a doomed upload.
  const verifyRes = await getBucket();
  if (!verifyRes.ok) {
    const verifyText = await verifyRes.text().catch(() => "");
    throw new Error(
      `Supabase bucket "${PLAYLIST_BUCKET}" still missing after create attempt ` +
        `(create: ${createRes.status} ${createText.slice(0, 120)}; ` +
        `verify: ${verifyRes.status} ${verifyText.slice(0, 120)})`,
    );
  }
}

function ensurePlaylistBucketCached(): Promise<void> {
  if (!bucketEnsured) {
    bucketEnsured = ensurePlaylistBucket().catch((err) => {
      bucketEnsured = null; // let the next request retry
      throw err;
    });
  }
  return bucketEnsured;
}

/** Strip path trickery; allow only safe audio filenames. Returns "" if invalid. */
export function sanitizeTrackName(raw: string): string {
  let name = "";
  try {
    name = decodeURIComponent(raw ?? "");
  } catch {
    return "";
  }
  // Drop any directory components.
  name = name.split("/").pop()!.split("\\").pop()!;
  name = name.trim();
  if (!name || name.length > 200) return "";
  if (!/^[\w][\w\-. ()]*$/.test(name)) return "";
  const ext = name.split(".").pop()!.toLowerCase();
  if (!AUDIO_EXTENSIONS.includes(ext)) return "";
  return name;
}

function publicUrlFor(path: string): string {
  const { data } = getSupabaseAdmin()
    .storage.from(PLAYLIST_BUCKET)
    .getPublicUrl(path);
  return data.publicUrl;
}

/* ── GET /api/playlist (public) ───────────────────────────────────────── */
router.get("/playlist", async (req, res) => {
  try {
    await ensurePlaylistBucketCached();
    const { data, error } = await getSupabaseAdmin()
      .storage.from(PLAYLIST_BUCKET)
      .list("", { limit: 500, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    const tracks = (data ?? [])
      .filter((f) => f.name && !f.name.startsWith("."))
      .map((f) => ({ name: f.name, url: publicUrlFor(f.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ tracks });
  } catch (err) {
    req.log.error({ err }, "playlist: list failed");
    res.status(500).json({ error: "Could not load the playlist. Please try again." });
  }
});

/* ── upload plumbing ──────────────────────────────────────────────────── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("audio/") ||
      new RegExp(`\\.(${AUDIO_EXTENSIONS.join("|")})$`, "i").test(file.originalname);
    cb(null, ok);
  },
});

function runUpload(req: any, res: any): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single("track")(req, res, (err: any) => (err ? reject(err) : resolve()));
  });
}

/* ── POST /api/playlist/upload (owner only) ───────────────────────────── */
router.post("/playlist/upload", requireAuth, requireAdmin, async (req, res) => {
  try {
    await runUpload(req, res);
  } catch (err: any) {
    if (err?.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large — 25 MB max.", code: "too_large" });
      return;
    }
    res.status(400).json({ error: "Upload failed.", code: "upload_error" });
    return;
  }

  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) {
    res.status(400).json({
      error: "Upload an audio file (mp3, wav, m4a, ogg, flac).",
      code: "no_file",
    });
    return;
  }

  const name = sanitizeTrackName(file.originalname);
  if (!name) {
    res.status(400).json({ error: "That filename is not allowed.", code: "bad_name" });
    return;
  }

  try {
    await ensurePlaylistBucketCached();
    const { error } = await getSupabaseAdmin()
      .storage.from(PLAYLIST_BUCKET)
      .upload(name, file.buffer, {
        contentType: file.mimetype || "audio/mpeg",
        upsert: true,
      });
    if (error) throw error;
    res.status(201).json({ track: { name, url: publicUrlFor(name) } });
  } catch (err) {
    req.log.error({ err }, "playlist: upload failed");
    res.status(500).json({ error: "Upload failed. Please try again." });
  }
});

/* ── DELETE /api/playlist/:name (owner only) ───────────────────────────── */
router.delete("/playlist/:name", requireAuth, requireAdmin, async (req, res) => {
  const rawName = req.params["name"];
  const name = sanitizeTrackName(
    Array.isArray(rawName) ? (rawName[0] ?? "") : (rawName ?? ""),
  );
  if (!name) {
    res.status(400).json({ error: "Invalid track name.", code: "bad_name" });
    return;
  }
  try {
    await ensurePlaylistBucketCached();
    const { error } = await getSupabaseAdmin()
      .storage.from(PLAYLIST_BUCKET)
      .remove([name]);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "playlist: delete failed");
    res.status(500).json({ error: "Delete failed. Please try again." });
  }
});

export default router;
