/**
 * courses.ts — Creator Courses over REST.
 *
 *   GET   /api/courses/:productId            public sales outline
 *                                            (viewer-aware via optional
 *                                            auth: titles/structure only,
 *                                            content never rides along)
 *   GET   /api/courses/:productId/learn      auth: playback view —
 *                                            per-lesson content only for
 *                                            lessons open to this viewer
 *   GET   /api/courses/mine                  auth: My Courses shelf
 *                                            (bought + owned, progress)
 *   GET   /api/courses/mine/created          auth: creator's courses
 *   POST  /api/courses                       auth: create a course
 *                                            (creator-set price; draft)
 *   PATCH /api/courses/:productId            auth: edit / publish /
 *                                            unpublish (owner only)
 *   GET   /api/courses/:productId/curriculum auth: builder's full
 *                                            curriculum (owner only)
 *   PUT   /api/courses/:productId/curriculum auth: replace curriculum
 *                                            (owner only; array order
 *                                            IS the order)
 *   POST  /api/courses/:productId/lessons/:lessonId/progress
 *                                            auth: one progress beat
 *
 * Buying itself is NOT here: courses check out, verify, and claim ($0)
 * through routes/storefront.ts like every other store product, and a
 * completed store_orders row is the entitlement. All rules live in
 * lib/courses; this file is the HTTP shape only.
 *
 * PENDING MIGRATION: until the held courses migration lands, DB errors
 * from the missing tables/kind CHECK map to 503 COURSES_NOT_LIVE.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { resolveOptionalSession } from "../lib/optional-auth";
import { logger } from "../lib/logger";
import { detectWishlistPriceDrop } from "../lib/wishlists";
import {
  CourseError,
  isCourseNotLiveError,
  getCourseOutline,
  getCourseLearn,
  listMyCourses,
  createCourse,
  updateCourse,
  getCreatedCurriculum,
  replaceCurriculum,
  recordLessonProgress,
  listMyCreatedProducts,
  type CourseActor,
} from "../lib/courses";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function actor(req: Request): CourseActor {
  return { userId: req.userId!, email: req.userEmail ?? null };
}

function handleError(res: Response, err: unknown, what: string): void {
  if (err instanceof CourseError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (isCourseNotLiveError(err)) {
    res.status(503).json({
      error: "Courses aren't live yet — the course tables land with the next database update.",
      code: "COURSES_NOT_LIVE",
    });
    return;
  }
  logger.error({ err }, `[courses] ${what} failed`);
  res.status(500).json({ error: "Courses stumbled. Try again." });
}

function badId(res: Response): boolean {
  res.status(400).json({ error: "Invalid course id.", code: "BAD_ID" });
  return true;
}

/* ── creator reads (registered before /:productId) ──────────────────── */

router.get("/courses/mine", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json({ courses: await listMyCourses(req.userId!) });
  } catch (err) {
    handleError(res, err, "my courses read");
  }
});

router.get("/courses/mine/created", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json({ courses: await listMyCreatedProducts(actor(req)) });
  } catch (err) {
    handleError(res, err, "created courses read");
  }
});

/* ── public outline ─────────────────────────────────────────────────── */

router.get("/courses/:productId", publicApiLimiter, async (req: Request, res: Response) => {
  const productId = param(req, "productId");
  if (!UUID_RE.test(productId)) return void badId(res);
  try {
    await resolveOptionalSession(req);
    res.json({ course: await getCourseOutline(productId, req.userId ?? null) });
  } catch (err) {
    handleError(res, err, "outline read");
  }
});

/* ── learn / playback ───────────────────────────────────────────────── */

router.get("/courses/:productId/learn", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const productId = param(req, "productId");
  if (!UUID_RE.test(productId)) return void badId(res);
  try {
    res.json({ course: await getCourseLearn(productId, req.userId!) });
  } catch (err) {
    handleError(res, err, "learn read");
  }
});

/* ── creator writes ─────────────────────────────────────────────────── */

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().max(5000).optional(),
    /* The CREATOR's price, in whole cents. Required — no default is
       ever invented for a course. $0 = a free course (claim rail). */
    priceCents: z.number().int().nonnegative(),
  })
  .strict();

router.post("/courses", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "That course didn't pass the check.", code: "BAD_COURSE" });
    return;
  }
  try {
    const product = await createCourse(actor(req), parsed.data);
    res.status(201).json({ product });
  } catch (err) {
    handleError(res, err, "course create");
  }
});

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().max(5000).optional(),
    priceCents: z.number().int().nonnegative().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

router.patch("/courses/:productId", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const productId = param(req, "productId");
  if (!UUID_RE.test(productId)) return void badId(res);
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "That edit didn't pass the check.", code: "BAD_EDIT" });
    return;
  }
  try {
    const product = await updateCourse(actor(req), productId, parsed.data);
    if (parsed.data.priceCents !== undefined) {
      /* Wave 4 #38: a course IS a store product — a price edit here is
         a wishlist drop moment exactly like the storefront PATCH
         (lib/wishlists owns the price law and never throws). */
      await detectWishlistPriceDrop({
        itemKind: "store_product",
        itemId: product.id,
        newPriceCents: product.priceCents,
        title: product.title,
        link: `/storefront/product/${product.id}`,
      });
    }
    res.json({ product });
  } catch (err) {
    handleError(res, err, "course edit");
  }
});

router.get("/courses/:productId/curriculum", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const productId = param(req, "productId");
  if (!UUID_RE.test(productId)) return void badId(res);
  try {
    const curriculum = await getCreatedCurriculum(actor(req), productId);
    res.json({ curriculum });
  } catch (err) {
    handleError(res, err, "curriculum read");
  }
});

const curriculumSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(200),
            lessons: z
              .array(
                z
                  .object({
                    title: z.string().trim().min(1).max(200),
                    kind: z.enum(["video", "text"]).optional(),
                    videoId: z.string().uuid().nullable().optional(),
                    body: z.string().max(50000).optional(),
                    attachmentTitle: z.string().trim().max(200).nullable().optional(),
                    attachmentUrl: z.string().trim().max(2048).nullable().optional(),
                    dripDayOffset: z.number().int().min(0).max(3650).optional(),
                    isPreview: z.boolean().optional(),
                  })
                  .strict(),
              )
              .max(60),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

router.put("/courses/:productId/curriculum", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const productId = param(req, "productId");
  if (!UUID_RE.test(productId)) return void badId(res);
  const parsed = curriculumSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "That curriculum didn't pass the check.", code: "BAD_CURRICULUM" });
    return;
  }
  try {
    const curriculum = await replaceCurriculum(actor(req), productId, parsed.data.sections);
    res.json({ curriculum });
  } catch (err) {
    handleError(res, err, "curriculum replace");
  }
});

/* ── progress ───────────────────────────────────────────────────────── */

const progressSchema = z
  .object({
    positionSec: z.number().min(0).max(86400).optional(),
    complete: z.boolean().optional(),
    uncomplete: z.boolean().optional(),
    markCompleted: z.boolean().optional(),
  })
  .strict();

router.post(
  "/courses/:productId/lessons/:lessonId/progress",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    const productId = param(req, "productId");
    const lessonId = param(req, "lessonId");
    if (!UUID_RE.test(productId) || !UUID_RE.test(lessonId)) return void badId(res);
    const parsed = progressSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "That progress didn't pass the check.", code: "BAD_PROGRESS" });
      return;
    }
    try {
      const progress = await recordLessonProgress(req.userId!, productId, lessonId, parsed.data);
      res.json({ progress });
    } catch (err) {
      handleError(res, err, "progress write");
    }
  },
);

export default router;
