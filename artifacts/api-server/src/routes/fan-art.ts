import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { refreshSupabaseStorageUrlsDeep } from "../lib/objectStorage";
import {
  FanArtError,
  drizzleFanArtStore as store,
  submitFanArt,
  getPublicWall,
  listCreatorQueue,
  listMySubmissions,
  reviewPiece,
  FAN_ART_ACTIONS,
} from "../lib/fan-art";

const router = Router();

/* ─── Fan Art Wall (Stack-200 #157) ────────────────────────────────────
   POST  /api/creator-profiles/:slug/fan-art   a fan submits a piece
                                               (auth; born PENDING —
                                               nothing displays yet)
   GET   /api/creator-profiles/:slug/fan-art   the public wall
                                               (APPROVED pieces only,
                                               artist credit on each)
   GET   /api/creator-profiles/me/fan-art      the creator's review
                                               queue (auth, own wall,
                                               every state)
   PATCH /api/creator-profiles/me/fan-art/:id  per-piece decision:
                                               { action: approve |
                                                 reject | revoke }
   GET   /api/fan-art/mine                     the artist's own
                                               submissions + statuses

   Approval gates display; revocation removes; artist credit rides on
   every DTO in every state and is never stripped. No prices, no
   charges — fan art is free end to end. */

function fail(res: Response, err: unknown, scope: string) {
  if (err instanceof FanArtError) {
    const status =
      err.code === "not_found" ? 404 :
      err.code === "forbidden" ? 403 :
      err.code === "invalid_transition" ? 409 :
      err.code === "queue_full" ? 429 : 400;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  logger.error({ err }, `[fan-art] ${scope} failed`);
  res.status(500).json({ error: "Something went wrong on our end." });
}

/* The /me + /mine routes register BEFORE /:slug — Express matches in
   order and "me" would otherwise be captured as a creator slug. */
router.get("/creator-profiles/me/fan-art", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    const out = await listCreatorQueue(store, req.userId!);
    res.json(await refreshSupabaseStorageUrlsDeep({
      profile: { slug: out.creator.slug, displayName: out.creator.displayName },
      pieces: out.pieces,
      pendingCount: out.pieces.filter((p) => p.status === "pending").length,
    }));
  } catch (err) {
    fail(res, err, "queue");
  }
});

const reviewSchema = z.object({
  action: z.enum(FAN_ART_ACTIONS as unknown as [string, ...string[]]),
});

router.patch("/creator-profiles/me/fan-art/:pieceId", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = reviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Send one action: approve, reject, or revoke.", code: "validation" });
      return;
    }
    const piece = await reviewPiece(store, {
      ownerUserId: req.userId!,
      pieceId: String(req.params["pieceId"] ?? ""),
      action: parsed.data.action as "approve" | "reject" | "revoke",
    });
    res.json(await refreshSupabaseStorageUrlsDeep({ piece }));
  } catch (err) {
    fail(res, err, "review");
  }
});

router.get("/fan-art/mine", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    const pieces = await listMySubmissions(store, req.userId!);
    res.json(await refreshSupabaseStorageUrlsDeep({ pieces }));
  } catch (err) {
    fail(res, err, "mine");
  }
});

router.get("/creator-profiles/:slug/fan-art", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const wall = await getPublicWall(store, String(req.params["slug"] ?? ""));
    res.json(await refreshSupabaseStorageUrlsDeep({
      profile: { slug: wall.creator.slug, displayName: wall.creator.displayName },
      pieces: wall.pieces,
    }));
  } catch (err) {
    fail(res, err, "public wall");
  }
});

const submitSchema = z.object({
  title: z.string(),
  image_url: z.string(),
  note: z.string().optional(),
  /* The credit name the artist types when they have no profile yet —
     the service prefers their profile name and falls back to this,
     then to "A fan". The stored snapshot is never rewritten later. */
  artist_name: z.string().max(80).optional(),
});

router.post("/creator-profiles/:slug/fan-art", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = submitSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Send a title and an artwork link for your piece.", code: "validation" });
      return;
    }
    const piece = await submitFanArt(store, {
      slug: String(req.params["slug"] ?? ""),
      artistUserId: req.userId!,
      ...(parsed.data.artist_name ? { artistNameFallback: parsed.data.artist_name } : {}),
      input: {
        title: parsed.data.title,
        imageUrl: parsed.data.image_url,
        ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
      },
    });
    res.status(201).json(await refreshSupabaseStorageUrlsDeep({ piece, status: piece.status }));
  } catch (err) {
    fail(res, err, "submit");
  }
});

export default router;
