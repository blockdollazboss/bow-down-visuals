/**
 * playlist.ts — the floating widget's music playlist (R2-backed).
 *
 *  GET    /api/playlist          list tracks [{ name, url }] (public)
 *  POST   /api/playlist/upload   owner upload (multipart audio, ≤25MB)
 *  DELETE /api/playlist/:name    owner delete
 *
 * Tracks live in the R2 bucket under the `playlist/` prefix; the owner
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
import { r2Upload, r2Delete, r2List, r2PublicUrl } from "../lib/r2-client";

const router = Router();

export const PLAYLIST_BUCKET = "playlist";
const PLAYLIST_PREFIX = "playlist/";

const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "ogg", "flac"];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function publicUrlFor(path: string): string {
  return r2PublicUrl(`${PLAYLIST_PREFIX}${path}`);
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

/* ── GET /api/playlist (public) ───────────────────────────────────────── */
router.get("/playlist", async (req, res) => {
  try {
    const keys = await r2List(PLAYLIST_PREFIX);
    const tracks = keys
      .map((k) => k.slice(PLAYLIST_PREFIX.length))
      .filter((name) => name && !name.startsWith(".") && !name.includes("/"))
      .map((name) => ({ name, url: publicUrlFor(name) }))
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
    await r2Upload(`${PLAYLIST_PREFIX}${name}`, file.buffer, file.mimetype || "audio/mpeg");
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
    await r2Delete(`${PLAYLIST_PREFIX}${name}`);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "playlist: delete failed");
    res.status(500).json({ error: "Delete failed. Please try again." });
  }
});

export default router;
