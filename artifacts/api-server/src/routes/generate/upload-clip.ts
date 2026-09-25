import { randomUUID } from "crypto";
import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middlewares/require-auth";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();

/** Cap user uploads at 80 MB. Enforced here at the app level — the bucket
 *  itself carries no file_size_limit (Supabase rejected it with 413, see
 *  PR #5), so this multer cap is the guard. */
const UPLOAD_CLIP_MAX_BYTES = 80 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_CLIP_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

/**
 * POST /upload-clip
 *
 * Authenticated user clip upload. The frontend used to upload straight from
 * the browser to a Supabase bucket named "clips" that does not exist
 * ("Bucket not found"). This endpoint instead stores the file in the private
 * `generated-clips` bucket through the same storage helpers the rest of the
 * pipeline uses, and returns a fresh signed preview URL plus the stable
 * `supabase://` ref.
 *
 * Pair with PATCH /projects/:projectId/scene-clip to attach the clip to an
 * existing scene. No credits are charged for uploads.
 */
router.post("/upload-clip", requireAuth, upload.single("clip"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No video file provided" });
    return;
  }
  try {
    const rawExt = (req.file.originalname.split(".").pop() ?? "mp4").toLowerCase();
    const ext = rawExt.replace(/[^a-z0-9]/g, "") || "mp4";
    const objectName = `uploads/${req.userId}/${Date.now()}-${randomUUID()}.${ext}`;
    const ref = await uploadMediaToSupabaseStorage(
      objectName,
      req.file.buffer,
      req.file.mimetype || "video/mp4",
    );
    const url = await refreshSupabaseStorageUrl(ref);
    res.json({ url, ref });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload failed";
    req.log.error({ err: msg }, "[upload-clip] upload failed");
    res.status(500).json({ error: msg });
  }
});

/** Turn multer upload errors into clean JSON the frontend can display. */
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message:
          "This clip exceeds the 80 MB upload limit. Please use a smaller video file.",
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

export default router;
