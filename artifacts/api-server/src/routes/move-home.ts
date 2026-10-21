/**
 * move-home.ts — "Move Home" concierge onboarding over REST:
 *
 *   GET   /api/move-home                  the caller's checklist status
 *                                         (auth; lazily creates the row,
 *                                         so leaving and coming back
 *                                         resumes exactly where they were)
 *   PUT   /api/move-home/answers          save intake answers (their words)
 *   POST  /api/move-home/draft            run the one drafting pass —
 *                                         drafts from answers + existing
 *                                         content + CONNECTED accounts only
 *   PATCH /api/move-home/drafts/:step     edit one draft before approving
 *   POST  /api/move-home/steps/:step/approve
 *                                         THE approval door: applies that
 *                                         one draft to its real rail.
 *                                         Nothing publishes, charges, or
 *                                         goes live anywhere else.
 *   POST  /api/move-home/steps/:step/skip park a step (resumable)
 *   POST  /api/move-home/steps/:step/reopen
 *                                         un-park a skipped step
 *
 * All rules live in lib/move-home; this file is the HTTP shape only.
 * Members-only throughout (requireAuth): the checklist is personal.
 * The flow is free — no route here touches credits.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  MOVE_HOME_STEP_KEYS,
  MoveHomeError,
  getMoveHomeStatus,
  saveAnswers,
  runDrafting,
  updateDraft,
  approveStep,
  skipStep,
  reopenStep,
} from "../lib/move-home";
import type { MoveHomeStepKey } from "@workspace/db";

const router = Router();

const stepParam = z.enum(MOVE_HOME_STEP_KEYS as unknown as [string, ...string[]]);

function parseStep(req: Request, res: Response): MoveHomeStepKey | null {
  const parsed = stepParam.safeParse(req.params.step);
  if (!parsed.success) {
    res.status(400).json({ error: "Unknown Move Home step.", code: "BAD_STEP" });
    return null;
  }
  return parsed.data as MoveHomeStepKey;
}

function handleError(res: Response, err: unknown, what: string): void {
  if (err instanceof MoveHomeError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  logger.error({ err }, `[move-home] ${what} failed`);
  res.status(500).json({ error: "Move Home stumbled. Try again." });
}

const answersSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    vertical: z
      .enum(["music", "video", "gaming", "podcast", "film", "tv", "influencer", "education", "other"])
      .optional(),
    genre: z.string().trim().max(60).optional(),
    bioSeed: z.string().trim().max(600).optional(),
    tagline: z.string().trim().max(160).optional(),
    location: z.string().trim().max(80).optional(),
    handle: z.string().trim().max(40).optional(),
    socialLinks: z.record(z.string().max(40), z.string().trim().max(500)).optional(),
    starterProductTitle: z.string().trim().max(120).optional(),
  })
  .strict();

router.get("/move-home", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json({ moveHome: await getMoveHomeStatus(req.userId!) });
  } catch (err) {
    handleError(res, err, "status read");
  }
});

router.put("/move-home/answers", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = answersSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Those answers didn't pass the check.",
      code: "BAD_ANSWERS",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  try {
    await saveAnswers(req.userId!, parsed.data);
    res.json({ moveHome: await getMoveHomeStatus(req.userId!) });
  } catch (err) {
    handleError(res, err, "answers save");
  }
});

router.post("/move-home/draft", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json({ moveHome: await runDrafting(req.userId!) });
  } catch (err) {
    handleError(res, err, "drafting");
  }
});

/* ── Per-step draft edits (pre-approval only; the lib seals approved) ── */

const draftPatchSchemas: Record<MoveHomeStepKey, z.ZodTypeAny> = {
  profile: z
    .object({
      displayName: z.string().trim().min(1).max(80).optional(),
      vertical: z
        .enum(["music", "video", "gaming", "podcast", "film", "tv", "influencer", "education", "other"])
        .optional(),
      bio: z.string().trim().max(1200).optional(),
      slug: z
        .string()
        .trim()
        .min(3)
        .max(30)
        .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
        .optional(),
      socialLinks: z.record(z.string().max(40), z.string().trim().max(500)).optional(),
    })
    .strict(),
  store: z
    .object({
      products: z
        .array(
          z.object({
            kind: z.enum(["download", "digital"]),
            title: z.string().trim().min(1).max(160),
            description: z.string().trim().max(2000),
            priceCents: z.number().int().min(1).max(100_000_00),
            sourceTrackId: z.string().uuid().optional(),
            suggestedPrice: z.boolean(),
          }),
        )
        .min(1)
        .max(3),
    })
    .strict(),
  press_kit: z
    .object({
      handle: z.string().trim().min(3).max(30).optional(),
      artistName: z.string().trim().min(1).max(120).optional(),
      tagline: z.string().trim().max(200).optional(),
      bio: z.string().trim().max(3000).optional(),
      genre: z.string().trim().max(60).optional(),
      location: z.string().trim().max(80).optional(),
      instagramUrl: z.string().trim().max(500).optional(),
      tiktokUrl: z.string().trim().max(500).optional(),
      youtubeUrl: z.string().trim().max(500).optional(),
    })
    .strict(),
  email_list: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      handle: z
        .string()
        .trim()
        .min(3)
        .max(40)
        .regex(/^[a-z0-9-]+$/)
        .optional(),
      description: z.string().trim().max(500).optional(),
      welcomeSubject: z.string().trim().min(1).max(200).optional(),
      welcomeBody: z.string().trim().min(1).max(5000).optional(),
    })
    .strict(),
  launch_posts: z
    .object({
      posts: z
        .array(
          z.object({
            platform: z.enum(["instagram", "tiktok", "facebook"]),
            accountId: z.string().uuid(),
            accountLabel: z.string().max(160),
            caption: z.string().trim().max(2200),
            hashtags: z.string().trim().max(500),
            mediaUrl: z.string().trim().max(2000).nullable(),
            mediaType: z.enum(["video", "image"]),
          }),
        )
        .max(3),
    })
    .strict(),
};

router.patch(
  "/move-home/drafts/:step",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    const step = parseStep(req, res);
    if (!step) return;
    const parsed = draftPatchSchemas[step].safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "That draft edit didn't pass the check.",
        code: "BAD_DRAFT",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    try {
      res.json({ moveHome: await updateDraft(req.userId!, step, parsed.data as Record<string, unknown>) });
    } catch (err) {
      handleError(res, err, "draft edit");
    }
  },
);

router.post(
  "/move-home/steps/:step/approve",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    const step = parseStep(req, res);
    if (!step) return;
    try {
      res.json({ moveHome: await approveStep(req.userId!, step) });
    } catch (err) {
      handleError(res, err, "approve");
    }
  },
);

router.post(
  "/move-home/steps/:step/skip",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    const step = parseStep(req, res);
    if (!step) return;
    try {
      res.json({ moveHome: await skipStep(req.userId!, step) });
    } catch (err) {
      handleError(res, err, "skip");
    }
  },
);

router.post(
  "/move-home/steps/:step/reopen",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    const step = parseStep(req, res);
    if (!step) return;
    try {
      res.json({ moveHome: await reopenStep(req.userId!, step) });
    } catch (err) {
      handleError(res, err, "reopen");
    }
  },
);

export default router;
