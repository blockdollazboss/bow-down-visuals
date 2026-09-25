/**
 * locations.ts — the user's locations library.
 *
 *  GET    /api/locations          list the caller's locations
 *  POST   /api/locations          save a location {label, image_url}
 *  POST   /api/locations/upload   upload a location image file (+ label)
 *  DELETE /api/locations/:id      remove a location (row only — the storage
 *                                 object is never touched; PR #27 lesson)
 *
 * Locations are scene/video-making assets: strictly user-scoped, with no
 * relation to artist vaults.
 *
 * Queries use raw SQL via db.execute(sql``) rather than the drizzle query
 * builder: pg-mem (used by the vitest suite) cannot handle the driver's
 * rowMode:'array' for builder queries. Raw SQL works identically against
 * real Postgres and pg-mem.
 */
import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/require-auth";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../lib/objectStorage";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif)$/i.test(file.originalname);
    cb(null, ok);
  },
});

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? m[1]!.toLowerCase() : "png";
}

const CreateLocationSchema = z.object({
  label: z.string().trim().min(1).max(120),
  image_url: z.string().trim().min(1).max(2000),
});

interface LocationRow {
  id: string;
  user_id: string;
  label: string;
  image_url: string;
  image_path: string | null;
  created_at: string;
}

/* ── GET /api/locations ────────────────────────────────────────────────── */
router.get("/locations", requireAuth, async (req, res) => {
  const result = await db.execute(sql`
    SELECT id, user_id, label, image_url, image_path, created_at
    FROM locations
    WHERE user_id = ${req.userId!}
    ORDER BY created_at DESC
    LIMIT 200
  `);
  res.json({ locations: result.rows as unknown as LocationRow[] });
});

/* ── POST /api/locations ───────────────────────────────────────────────── */
router.post("/locations", requireAuth, async (req, res) => {
  const parsed = CreateLocationSchema.safeParse(req.body);
  if (!parsed.success || !isHttpUrl(parsed.data.image_url)) {
    res.status(400).json({
      error: "Invalid location: label is required and image_url must be an http(s) URL.",
      code: "invalid_location",
    });
    return;
  }
  const id = randomUUID();
  const result = await db.execute(sql`
    INSERT INTO locations (id, user_id, label, image_url)
    VALUES (${id}, ${req.userId!}, ${parsed.data.label}, ${parsed.data.image_url})
    RETURNING id, user_id, label, image_url, image_path, created_at
  `);
  res.status(201).json({ location: result.rows[0] as unknown as LocationRow });
});

/* ── POST /api/locations/upload ────────────────────────────────────────── */
router.post("/locations/upload", requireAuth, upload.single("image"), async (req, res) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) {
    res.status(400).json({ error: "Upload an image file.", code: "no_file" });
    return;
  }
  const label =
    (typeof req.body?.["label"] === "string" && req.body["label"].trim().slice(0, 120)) ||
    file.originalname.replace(/\.[a-z0-9]+$/i, "") ||
    "Untitled location";

  try {
    const objectName = `locations/${req.userId}/${randomUUID()}.${extOf(file.originalname)}`;
    const storageRef = await uploadMediaToSupabaseStorage(
      objectName,
      file.buffer,
      file.mimetype || "image/png",
    );
    const url = await refreshSupabaseStorageUrl(storageRef);

    const id = randomUUID();
    const result = await db.execute(sql`
      INSERT INTO locations (id, user_id, label, image_url, image_path)
      VALUES (${id}, ${req.userId!}, ${label}, ${url}, ${storageRef})
      RETURNING id, user_id, label, image_url, image_path, created_at
    `);
    res.status(201).json({ location: result.rows[0] as unknown as LocationRow });
  } catch (err) {
    req.log.error({ err }, "locations: upload failed");
    res.status(500).json({ error: "Location upload failed. Please try again." });
  }
});

/* ── DELETE /api/locations/:id ───────────────────────────────────────────
   Row delete only — the storage object (if any) is deliberately left alone. */
router.delete("/locations/:id", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);
  const result = await db.execute(sql`
    DELETE FROM locations
    WHERE id = ${id} AND user_id = ${req.userId!}
    RETURNING id
  `);
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Location not found." });
    return;
  }
  res.json({ deleted: (result.rows[0] as { id: string }).id });
});

export default router;
