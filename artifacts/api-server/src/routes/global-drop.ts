import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { isUndefinedColumn } from "../lib/pg-errors";
import { readKitRelease, type KitRelease } from "../lib/drop-day-kit";
import {
  GLOBAL_DROP_LANGUAGES,
  assemblePackage,
  drizzleGlobalDropStore,
  isHttpUrl,
  mergeLanguageDestinations,
  publishableVersions,
  type GlobalDropLanguageCode,
  type GlobalDropVersions,
} from "../lib/global-drop";

const router = Router();

/* ─── Global Drop (#165) ───────────────────────────────────────────────
   POST  /api/global-drop { releaseId }            — ONE TAP: assemble
                                                     the five-language
                                                     package (drafts)
   GET   /api/global-drop/:releaseId               — the package
   PATCH /api/global-drop/:releaseId/languages/:code
                                                   — the per-version
                                                     REVIEW: translated
                                                     title, destination
                                                     URL, approve/unapprove
   POST  /api/global-drop/:releaseId/publish       — write approved
                                                     versions' URLs
                                                     into the release's
                                                     smartlink language
                                                     routing

   Nothing publishes unreviewed, and no translation is invented: the
   translated title and URL are the creator's own, from their work on
   the Translate & Dub rail. */

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

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0]! : v!;
}

async function packageView(releaseId: string) {
  const row = await drizzleGlobalDropStore.getByRelease(releaseId);
  if (!row) return null;
  return {
    id: row["id"],
    releaseId,
    status: row["status"],
    versions: row["versions"] as GlobalDropVersions,
    updatedAt: row["updatedAt"],
  };
}

const assembleSchema = z.object({ releaseId: z.string().uuid() });

router.post("/global-drop", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = assembleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const release = await ownRelease(req, res, parsed.data.releaseId);
    if (!release) return;
    const existing = await drizzleGlobalDropStore.getByRelease(release.id);
    if (!existing) {
      const versions = assemblePackage(release);
      await drizzleGlobalDropStore.upsertPackage({ userId: req.userId!, releaseId: release.id, versions });
    }
    /* Re-assembling NEVER wipes reviews: an existing package is
       returned as-is (assembly is the birth of the package, not a
       reset). */
    res.json(await packageView(release.id));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[global-drop] assemble failed");
    res.status(500).json({ error: "Could not assemble the Global Drop package" });
  }
});

router.get("/global-drop/:releaseId", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const release = await ownRelease(req, res, param(req, "releaseId"));
    if (!release) return;
    const view = await packageView(release.id);
    if (!view) {
      res.status(404).json({ error: "No Global Drop package assembled for this release yet" });
      return;
    }
    res.json(view);
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[global-drop] read failed");
    res.status(500).json({ error: "Could not load the Global Drop package" });
  }
});

const reviewSchema = z.object({
  translatedTitle: z.string().trim().max(300).nullable().optional(),
  url: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["draft", "approved"]).optional(),
});

router.patch(
  "/global-drop/:releaseId/languages/:code",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    const code = param(req, "code") as GlobalDropLanguageCode;
    if (!(GLOBAL_DROP_LANGUAGES as readonly { code: string }[]).some((l) => l.code === code)) {
      res.status(400).json({ error: "Unknown language for Global Drop" });
      return;
    }
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    if (parsed.data.url != null && parsed.data.url !== "" && !isHttpUrl(parsed.data.url)) {
      res.status(400).json({ error: "The version URL must be an http(s) link" });
      return;
    }
    try {
      const release = await ownRelease(req, res, param(req, "releaseId"));
      if (!release) return;
      const row = await drizzleGlobalDropStore.getByRelease(release.id);
      if (!row) {
        res.status(404).json({ error: "No Global Drop package assembled for this release yet" });
        return;
      }
      const versions = { ...(row["versions"] as GlobalDropVersions) };
      const current = versions[code];
      if (!current) {
        res.status(404).json({ error: "That language is not in this package" });
        return;
      }
      versions[code] = {
        ...current,
        ...(parsed.data.translatedTitle !== undefined
          ? { translatedTitle: parsed.data.translatedTitle || null }
          : {}),
        ...(parsed.data.url !== undefined ? { url: parsed.data.url || null } : {}),
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      };
      const saved = await drizzleGlobalDropStore.saveVersions(String(row["id"]), req.userId!, versions);
      if (!saved) {
        res.status(404).json({ error: "Package not found" });
        return;
      }
      res.json(await packageView(release.id));
    } catch (err) {
      logger.error({ err, userId: req.userId }, "[global-drop] review failed");
      res.status(500).json({ error: "Could not save the review" });
    }
  },
);

router.post("/global-drop/:releaseId/publish", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const release = await ownRelease(req, res, param(req, "releaseId"));
    if (!release) return;
    const row = await drizzleGlobalDropStore.getByRelease(release.id);
    if (!row) {
      res.status(404).json({ error: "No Global Drop package assembled for this release yet" });
      return;
    }
    const versions = row["versions"] as GlobalDropVersions;
    const { routable, titleOnly } = publishableVersions(versions);
    if (routable.length === 0) {
      res.status(409).json({
        error:
          "Nothing to route yet — approve at least one language version with a destination URL. " +
          (titleOnly.length > 0
            ? `Approved but URL-less: ${titleOnly.join(", ")}.`
            : "No version is approved yet."),
        titleOnly,
      });
      return;
    }
    try {
      const existing = await drizzleGlobalDropStore.readLanguageDestinations(release.id);
      const merged = mergeLanguageDestinations(existing, routable);
      await drizzleGlobalDropStore.writeLanguageDestinations(release.id, merged);
    } catch (err) {
      if (isUndefinedColumn(err)) {
        /* The routing column's migration is held — the package and
           its reviews are saved; only the routing write waits. */
        res.status(409).json({
          error:
            "Language routing isn't live on releases yet — your package and reviews are saved, and publishing will land the moment the routing rail opens.",
        });
        return;
      }
      throw err;
    }
    await drizzleGlobalDropStore.setStatus(String(row["id"]), req.userId!, "active");
    const view = await packageView(release.id);
    res.json({ ...view, routed: routable.map((r) => r.code), titleOnly });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[global-drop] publish failed");
    res.status(500).json({ error: "Could not publish the Global Drop package" });
  }
});

export default router;
