/**
 * tutorials.ts — Tutorials V1 over REST (tutorials-scope.md rollout V1):
 *
 *   GET   /api/tutorials                  the catalog: published
 *                                         tutorials grouped by series
 *                                         (+ standalones). Public —
 *                                         profiles are public
 *                                         storefronts and the shelf
 *                                         must render for guests.
 *                                         ?profile=<slug> scopes to
 *                                         one creator's shelf; ?q=
 *                                         is the plain-language search.
 *   GET   /api/tutorials/mine/progress    the caller's progress map
 *                                         (auth) — merged client-side
 *                                         over the public catalog.
 *   GET   /api/tutorials/:slug            one tutorial in full
 *                                         (public): chapters,
 *                                         resources, the video when
 *                                         production has landed, and
 *                                         the three doors (Watch it /
 *                                         Walk me through it / Try it
 *                                         now targets).
 *   POST  /api/tutorials/designate        turn a published profile
 *                                         video into a tutorial
 *                                         (auth; the video's owner or
 *                                         an admin; official is
 *                                         admin-only).
 *   POST  /api/tutorials/series           create a series (auth;
 *                                         official is admin-only).
 *   PATCH /api/tutorials/:id              edit metadata (auth; owner
 *                                         or admin; official flips
 *                                         are admin-only).
 *   PUT   /api/tutorials/:id/chapters     replace the ordered chapter
 *                                         set (auth; owner or admin).
 *   PUT   /api/tutorials/:id/resources    replace the resource set
 *                                         (auth; owner or admin).
 *   POST  /api/tutorials/:id/progress     record one progress beat
 *                                         (auth) — started / chapter
 *                                         done / position / finish.
 *                                         Status is derived server-
 *                                         side; the response is the
 *                                         resume point.
 *
 * All rules live in lib/tutorials; this file is the HTTP shape only.
 * The official seed (the five flow-path series + the pilot) is
 * ensured lazily on catalog/detail reads. FREE throughout: no route
 * here touches credits.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  TutorialError,
  ensureOfficialSeed,
  listCatalog,
  getTutorialDetail,
  getMyProgress,
  recordProgress,
  designateTutorial,
  createSeries,
  updateTutorial,
  replaceChapters,
  replaceResources,
  TUTORIAL_CATEGORY_KEYS,
  type TutorialActor,
  type DesignateInput,
  type CreateSeriesInput,
  type UpdateTutorialInput,
} from "../lib/tutorials";

const router = Router();

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function actor(req: Request): TutorialActor {
  return { userId: req.userId!, email: req.userEmail ?? null };
}

function handleError(res: Response, err: unknown, what: string): void {
  if (err instanceof TutorialError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  logger.error({ err }, `[tutorials] ${what} failed`);
  res.status(500).json({ error: "Tutorials stumbled. Try again." });
}

/** Seeding must never take a read down: the official structure is a
    convenience, the catalog is the product. */
async function seedQuietly(): Promise<void> {
  try {
    await ensureOfficialSeed();
  } catch (err) {
    logger.error({ err }, "[tutorials] official seed failed");
  }
}

const categorySchema = z.enum(TUTORIAL_CATEGORY_KEYS as unknown as [string, ...string[]]);
const routeSchema = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v.startsWith("/") && !v.startsWith("//"), "Routes must be site-internal paths.")
  .nullable()
  .optional();

router.get("/tutorials", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    await seedQuietly();
    const profile = typeof req.query.profile === "string" ? req.query.profile.slice(0, 120) : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : undefined;
    res.json({ catalog: await listCatalog({ profileSlug: profile, q }) });
  } catch (err) {
    handleError(res, err, "catalog read");
  }
});

router.get("/tutorials/mine/progress", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json({ progress: await getMyProgress(req.userId!) });
  } catch (err) {
    handleError(res, err, "progress read");
  }
});

router.get("/tutorials/:slug", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    await seedQuietly();
    res.json({ tutorial: await getTutorialDetail(param(req, "slug")) });
  } catch (err) {
    handleError(res, err, "detail read");
  }
});

const designateSchema = z
  .object({
    videoId: z.string().uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    category: categorySchema.optional(),
    seriesId: z.string().uuid().nullable().optional(),
    position: z.number().int().min(0).max(10000).optional(),
    isOfficial: z.boolean().optional(),
    guideRoute: routeSchema,
    tryRoute: routeSchema,
    transcript: z.string().max(100000).nullable().optional(),
  })
  .strict();

router.post("/tutorials/designate", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = designateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "That designation didn't pass the check.", code: "BAD_DESIGNATION" });
    return;
  }
  try {
    const tutorial = await designateTutorial(actor(req), parsed.data as DesignateInput);
    res.status(201).json({ tutorial });
  } catch (err) {
    handleError(res, err, "designate");
  }
});

const seriesSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional(),
    category: categorySchema.optional(),
    isOfficial: z.boolean().optional(),
    position: z.number().int().min(0).max(10000).optional(),
  })
  .strict();

router.post("/tutorials/series", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = seriesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "That series didn't pass the check.", code: "BAD_SERIES" });
    return;
  }
  try {
    const series = await createSeries(actor(req), parsed.data as CreateSeriesInput);
    res.status(201).json({ series });
  } catch (err) {
    handleError(res, err, "series create");
  }
});

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    category: categorySchema.optional(),
    seriesId: z.string().uuid().nullable().optional(),
    position: z.number().int().min(0).max(10000).optional(),
    isOfficial: z.boolean().optional(),
    isPublished: z.boolean().optional(),
    guideRoute: routeSchema,
    tryRoute: routeSchema,
    transcript: z.string().max(100000).nullable().optional(),
    videoId: z.string().uuid().nullable().optional(),
  })
  .strict();

router.patch("/tutorials/:id", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "That edit didn't pass the check.", code: "BAD_EDIT" });
    return;
  }
  try {
    const tutorial = await updateTutorial(actor(req), param(req, "id"), parsed.data as UpdateTutorialInput);
    res.json({ tutorial });
  } catch (err) {
    handleError(res, err, "edit");
  }
});

const chaptersSchema = z
  .object({
    chapters: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(200),
            startSec: z.number().int().min(0).max(86400).nullable().optional(),
            body: z.string().max(20000).optional(),
          })
          .strict(),
      )
      .max(60),
  })
  .strict();

router.put("/tutorials/:id/chapters", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = chaptersSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Those chapters didn't pass the check.", code: "BAD_CHAPTERS" });
    return;
  }
  try {
    const chapters = await replaceChapters(actor(req), param(req, "id"), parsed.data.chapters);
    res.json({ chapters });
  } catch (err) {
    handleError(res, err, "chapters replace");
  }
});

const resourcesSchema = z
  .object({
    resources: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(200),
            url: z.string().trim().min(1).max(2000),
            kind: z.enum(["download", "link"]).optional(),
            chapterId: z.string().uuid().nullable().optional(),
          })
          .strict(),
      )
      .max(60),
  })
  .strict();

router.put("/tutorials/:id/resources", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = resourcesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Those resources didn't pass the check.", code: "BAD_RESOURCES" });
    return;
  }
  try {
    const resources = await replaceResources(actor(req), param(req, "id"), parsed.data.resources);
    res.json({ resources });
  } catch (err) {
    handleError(res, err, "resources replace");
  }
});

const progressSchema = z
  .object({
    chapterId: z.string().uuid().nullable().optional(),
    positionSec: z.number().min(0).max(86400).optional(),
    completeChapterId: z.string().uuid().optional(),
    uncompleteChapterId: z.string().uuid().optional(),
    markCompleted: z.boolean().optional(),
  })
  .strict();

router.post("/tutorials/:id/progress", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = progressSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "That progress didn't pass the check.", code: "BAD_PROGRESS" });
    return;
  }
  try {
    const progress = await recordProgress(req.userId!, param(req, "id"), parsed.data);
    res.json({ progress });
  } catch (err) {
    handleError(res, err, "progress write");
  }
});

export default router;
