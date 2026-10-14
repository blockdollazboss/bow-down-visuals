/**
 * POST /api/mirror-media — mirror-on-save for client-side save paths.
 *
 * Most save paths live in the api-server and mirror external media URLs
 * server-side at write time (lib/mirrorMedia.ts). A few saves are driven
 * from the client with a URL the server route would otherwise store
 * verbatim (profile_tracks / profile_videos via /api/publish — the
 * publish routes mirror too, this endpoint is the client-side half of
 * the same law). The client calls this BEFORE saving so the value it
 * stores is the permanent storage ref, never an expiring signed URL or
 * a provider URL that can vanish.
 *
 * Contract:
 *   Body: { url: string, kind?: "image" | "video" | "audio" }
 *   200:  { url: string,   // playable URL (fresh-signed when ref-backed)
 *           ref: string,   // the value to STORE (r2:// / supabase:// ref,
 *                          //  or the original URL when mirroring failed)
 *           mirrored: boolean }
 *
 * Owner-scoped: mirrored objects land under mirrored/<userId>/… in our
 * own storage; the endpoint touches no one's rows. Best-effort like the
 * helper it wraps — a dead or oversize source returns the original URL
 * with mirrored:false instead of failing the save.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { generationLimiter } from "../lib/rate-limit";
import {
  isExternalHttpUrl,
  isPermanentMediaValue,
  mirrorExternalMediaUrl,
} from "../lib/mirrorMedia";
import { refreshSupabaseStorageUrl } from "../lib/objectStorage";

const router = Router();

type MediaKind = "image" | "video" | "audio";

function inferKind(url: string): MediaKind {
  try {
    const ext = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
    if (ext && ["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac"].includes(ext)) return "audio";
    if (ext && ["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(ext)) return "image";
  } catch { /* fall through */ }
  return "video";
}

router.post("/mirror-media", requireAuth, generationLimiter, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const url = typeof b["url"] === "string" ? b["url"].trim() : "";
  if (!url) {
    res.status(400).json({ error: "A media URL is required." });
    return;
  }
  try {
    /* Already permanent (a ref the client echoed back): nothing to
       download — just hand back a fresh playable URL. */
    if (isPermanentMediaValue(url)) {
      res.json({ url: await refreshSupabaseStorageUrl(url), ref: url, mirrored: false });
      return;
    }
    if (!isExternalHttpUrl(url)) {
      res.status(400).json({ error: "A valid http(s) media URL is required." });
      return;
    }
    const kind: MediaKind =
      b["kind"] === "image" || b["kind"] === "video" || b["kind"] === "audio"
        ? b["kind"]
        : inferKind(url);
    const ref = (await mirrorExternalMediaUrl(url, { kind, ownerKey: req.userId! })) ?? url;
    res.json({
      url: await refreshSupabaseStorageUrl(ref),
      ref,
      mirrored: ref !== url,
    });
  } catch (err) {
    /* The helper is best-effort and shouldn't throw; if it ever does,
       the save must not break — return the original value. */
    req.log.error({ err }, "[mirror-media] mirror failed — returning original URL");
    res.json({ url, ref: url, mirrored: false });
  }
});

export default router;
