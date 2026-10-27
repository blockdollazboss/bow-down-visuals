import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  activationBlockers,
  assembleKit,
  drizzleDropDayKitStore,
  effectiveKitStatus,
  readKitRelease,
  type KitRelease,
} from "../lib/drop-day-kit";

const router = Router();

/* ─── Drop Day Kit (#169) ──────────────────────────────────────────────
   POST  /api/drop-day-kits { releaseId }      — ONE TAP: assemble (or
                                                 re-assemble) the kit
                                                 for the caller's own
                                                 release, as a DRAFT
   GET   /api/drop-day-kits/:releaseId         — the kit + the real
                                                 presave capture count
                                                 (the land-time
                                                 heads-up audience)
   PATCH /api/drop-day-kits/:releaseId/status { status: "active" }
                                               — the creator's review
                                                 gate: activation is
                                                 refused while the kit
                                                 lacks a release date
                                                 or a presave page

   Nothing here sends, posts, or publishes: the fan heads-up at land
   time is the existing presave sweeper over presave_follows, and the
   teaser/banners render in Create from the kit's links. */

async function ownRelease(req: Request, res: Response, releaseId: string): Promise<KitRelease | null> {
  const release = await readKitRelease(releaseId);
  if (!release) {
    res.status(404).json({ error: "Release not found" });
    return null;
  }
  if (release.userId !== req.userId) {
    res.status(403).json({ error: "That release belongs to another creator" });
    return null;
  }
  return release;
}

async function kitView(release: KitRelease) {
  const row = await drizzleDropDayKitStore.getByRelease(release.id);
  if (!row) return null;
  const captures = await drizzleDropDayKitStore.captureCount(release.id);
  const kit = row["kit"] as ReturnType<typeof assembleKit>;
  return {
    id: row["id"],
    releaseId: release.id,
    status: effectiveKitStatus(String(row["status"]), release.releaseDate),
    kit,
    captures,
    updatedAt: row["updatedAt"],
  };
}

const assembleSchema = z.object({ releaseId: z.string().uuid() });

router.post("/drop-day-kits", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = assembleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const release = await ownRelease(req, res, parsed.data.releaseId);
    if (!release) return;
    const kit = assembleKit(release);
    await drizzleDropDayKitStore.upsertKit({ userId: req.userId!, releaseId: release.id, kit });
    res.json(await kitView(release));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[drop-day-kit] assemble failed");
    res.status(500).json({ error: "Could not assemble the Drop Day Kit" });
  }
});

router.get("/drop-day-kits/:releaseId", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const releaseId = Array.isArray(req.params.releaseId) ? req.params.releaseId[0]! : req.params.releaseId;
  try {
    const release = await ownRelease(req, res, releaseId);
    if (!release) return;
    const view = await kitView(release);
    if (!view) {
      res.status(404).json({ error: "No Drop Day Kit assembled for this release yet" });
      return;
    }
    res.json(view);
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[drop-day-kit] read failed");
    res.status(500).json({ error: "Could not load the Drop Day Kit" });
  }
});

const statusSchema = z.object({ status: z.literal("active") });

router.patch("/drop-day-kits/:releaseId/status", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const releaseId = Array.isArray(req.params.releaseId) ? req.params.releaseId[0]! : req.params.releaseId;
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const release = await ownRelease(req, res, releaseId);
    if (!release) return;
    const row = await drizzleDropDayKitStore.getByRelease(release.id);
    if (!row) {
      res.status(404).json({ error: "No Drop Day Kit assembled for this release yet" });
      return;
    }
    const kit = row["kit"] as ReturnType<typeof assembleKit>;
    const blockers = activationBlockers(kit);
    if (blockers.length > 0) {
      res.status(409).json({
        error: "The kit can't go live yet — it still needs: " + blockers.join(", ").replaceAll("_", " "),
        blockers,
      });
      return;
    }
    const flipped = await drizzleDropDayKitStore.setStatus(String(row["id"]), req.userId!, "active");
    if (!flipped) {
      res.status(409).json({ error: "The kit is not in draft anymore" });
      return;
    }
    res.json(await kitView(release));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[drop-day-kit] activate failed");
    res.status(500).json({ error: "Could not activate the Drop Day Kit" });
  }
});

export default router;
