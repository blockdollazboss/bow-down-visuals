import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  activationBlockers,
  assembleChecklist,
  assembleKit,
  drizzleDropDayKitStore,
  effectiveKitStatus,
  listKitReleases,
  readKitRelease,
  type KitRelease,
} from "../lib/drop-day-kit";
import { presaveUrl } from "../lib/presave-url";

const router = Router();

/* ─── Drop Day Kit (#169) ──────────────────────────────────────────────
   POST  /api/drop-day-kits { releaseId }      — ONE TAP: assemble (or
                                                 re-assemble) the kit
                                                 for the caller's own
                                                 release, as a DRAFT
   GET   /api/drop-day-kits/mine               — every release the
                                                 caller owns with its
                                                 kit (or null), the
                                                 release-day checklist,
                                                 and the announcement
                                                 state — the Promote
                                                 panel's one read
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
   time is the existing presave sweeper over presave_follows, the
   teaser/banners render in Create from the kit's links, and the
   launch announcement is scheduled by the creator in the Scheduler
   (its release-attributed posts are only READ here, for the
   checklist). */

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

/** The one kit view every surface reads: the kit payload (null when
 *  none is assembled), its effective status, the real presave
 *  capture count, the Scheduler announcement state for the release,
 *  and the derived release-day checklist. Built from a kit row the
 *  caller already holds, or fetched by release when row is omitted. */
async function buildKitView(release: KitRelease, row?: Record<string, unknown> | null) {
  const kitRow = row === undefined ? await drizzleDropDayKitStore.getByRelease(release.id) : row;
  const captures = await drizzleDropDayKitStore.captureCount(release.id);
  const announce = await drizzleDropDayKitStore.announceState(release.id, release.userId);
  const kit = kitRow ? (kitRow["kit"] as ReturnType<typeof assembleKit>) : null;
  const status = kitRow ? effectiveKitStatus(String(kitRow["status"]), release.releaseDate) : null;
  return {
    id: kitRow ? kitRow["id"] : null,
    releaseId: release.id,
    status,
    kit,
    captures,
    announce,
    checklist: assembleChecklist({ release, kit, kitStatus: status, captures, announce }),
    updatedAt: kitRow ? kitRow["updatedAt"] : null,
  };
}

async function kitView(release: KitRelease) {
  const row = await drizzleDropDayKitStore.getByRelease(release.id);
  if (!row) return null;
  return buildKitView(release, row);
}

function releaseSummary(release: KitRelease) {
  return {
    id: release.id,
    title: release.title,
    artistName: release.artistName,
    releaseDate: release.releaseDate,
    status: release.status,
    artworkUrl: release.artworkUrl,
    presaveUrl: release.presaveSlug ? presaveUrl(release.presaveSlug) : null,
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

/* Registered BEFORE /:releaseId — "mine" is a list door, not a
   release id. One read for the Promote panel: the caller's own
   releases (soonest drop first), each with its kit view or the
   checklist of a release that has no kit yet. */
router.get("/drop-day-kits/mine", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const releases = await listKitReleases(req.userId!);
    const kits = await drizzleDropDayKitStore.listKitsByUser(req.userId!);
    const kitByRelease = new Map(kits.map((k) => [String(k["releaseId"]), k]));
    const out = [];
    for (const release of releases) {
      out.push({
        release: releaseSummary(release),
        kit: await buildKitView(release, kitByRelease.get(release.id) ?? null),
      });
    }
    res.json({ releases: out });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[drop-day-kit] list failed");
    res.status(500).json({ error: "Could not load your Drop Day Kits" });
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
