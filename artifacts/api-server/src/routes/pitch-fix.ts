import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { resolveOptionalSession } from "../lib/optional-auth";
import { requireAdmin } from "./admin";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { db, creatorProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  PitchFixError,
  drizzlePitchFixStore as store,
  submitPitch,
  submitFix,
  submitFeedback,
  getPublicBoard,
  listMySubmissions,
  togglePitchVote,
  listModerationQueue,
  moderateSubmission,
  getFeedbackPrefs,
  setFeedbackEnabled,
  getFeedbackEligibility,
  recordPromptShown,
  markDuplicate,
  getRewardPoolState,
} from "../lib/pitch-fix";
import {
  defaultRewardPayDeps,
  processRewardQueue,
  setStatusAndProcessRewards,
} from "../lib/pitch-fix-rewards";

const router = Router();

/* ─── Pitch & Fix (Stack-200 UPGRADES 196 + 180) ───────────────────────
   GET    /api/pitch-fix/board            public boards (APPROVED rows
                                          only — the moderation gate)
   POST   /api/pitch-fix/pitches          Pitch an idea door (auth)
   POST   /api/pitch-fix/fixes            Report a fix door (auth)
   POST   /api/pitch-fix/feedback         Feedback Pop-Up submit (auth)
   GET    /api/pitch-fix/mine             the caller's own submissions
                                          (incl. still-pending ones)
   POST   /api/pitch-fix/:id/vote         toggle an upvote (auth)
   GET    /api/pitch-fix/feedback-prefs   pop-up toggle + cap state
   PATCH  /api/pitch-fix/feedback-prefs   { enabled } Settings toggle
   GET    /api/pitch-fix/feedback-prompt/eligibility
   POST   /api/pitch-fix/feedback-prompt/shown   stamp a showing (cap)
   GET    /api/admin/pitch-fix/queue      team review queue (admin) —
                                          opening it first processes
                                          the reward queue (weekly
                                          roll-over pays here)
   PATCH  /api/admin/pitch-fix/:id        { moderation } and/or
                                          { status } and/or
                                          { duplicate_of } (admin)
   POST   /api/admin/pitch-fix/rewards/process
                                          run the reward queue now
                                          (the 3x/day intake checks)

   Submissions land PENDING: nothing posts publicly until the team
   approves it. NO PRICES exist anywhere in this section — no charge
   rail, no price copy. REWARDS (owner ruling, Oct 25, 18:12 EDT):
   the team-set Shipped/Fixed transition queues a VB reward (pitch
   500; fix/feedback 100, blocks_me 250) paid exactly once, first
   voice only, from a shared 1,000 VB/week pool with over-cap items
   queued into next week — see lib/pitch-fix-rewards.ts. There is NO
   self-serve claim path: only this admin surface moves statuses. */

function fail(res: Response, err: unknown, scope: string) {
  if (err instanceof PitchFixError) {
    const status = err.code === "not_found" ? 404 : 400;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  logger.error({ err }, `[pitch-fix] ${scope} failed`);
  res.status(500).json({ error: "Something went wrong on our end." });
}

/** Display name for the board credit: the creator profile's name when
 *  one exists, else the name the submitter typed, else "Creator". */
async function resolveSubmitterName(userId: string, typed?: string): Promise<string> {
  try {
    const rows = await db
      .select({ displayName: creatorProfilesTable.displayName })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);
    const fromProfile = rows[0]?.displayName?.trim();
    if (fromProfile) return fromProfile.slice(0, 40);
  } catch {
    /* profile lookup is a nicety — the typed name still files */
  }
  return (typed ?? "").trim().slice(0, 40) || "Creator";
}

router.get("/pitch-fix/board", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    /* Public board; a valid Bearer session (never required) only adds
       the caller's own voted-ids so their upvotes render pressed. */
    await resolveOptionalSession(req);
    res.json(await getPublicBoard(store, req.userId));
  } catch (err) {
    fail(res, err, "board");
  }
});

const pitchSchema = z.object({
  title: z.string().trim().min(1).max(90),
  body: z.string().trim().min(1).max(400),
  why: z.string().trim().max(400).optional(),
  category: z.enum(["create", "world", "money", "social", "other"]),
  creator_name: z.string().trim().max(40).optional(),
});

router.post("/pitch-fix/pitches", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = pitchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Give your pitch a title, a line on what it is, and a category." }); return; }
  try {
    const submitterName = await resolveSubmitterName(req.userId!, parsed.data.creator_name);
    const row = await submitPitch(store, {
      userId: req.userId!, submitterName,
      title: parsed.data.title, body: parsed.data.body, why: parsed.data.why, category: parsed.data.category,
    });
    res.status(201).json({ submission: row, moderationStatus: row.moderationStatus });
  } catch (err) { fail(res, err, "pitch submit"); }
});

const fixSchema = z.object({
  title: z.string().trim().min(1).max(90),
  body: z.string().trim().max(400).optional(),
  page: z.enum(["video_editor", "make_song_video", "audio_studio", "thumbnail_studio", "branding_kit", "the_world", "go_live", "earnings", "profile", "somewhere_else"]),
  severity: z.enum(["blocks_me", "annoying", "small"]),
  creator_name: z.string().trim().max(40).optional(),
});

router.post("/pitch-fix/fixes", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = fixSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Tell us what's broken, where it is, and how bad it is." }); return; }
  try {
    const submitterName = await resolveSubmitterName(req.userId!, parsed.data.creator_name);
    const row = await submitFix(store, {
      userId: req.userId!, submitterName,
      title: parsed.data.title, body: parsed.data.body, page: parsed.data.page, severity: parsed.data.severity,
    });
    res.status(201).json({ submission: row, moderationStatus: row.moderationStatus });
  } catch (err) { fail(res, err, "fix submit"); }
});

const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(400).optional(),
  creator_name: z.string().trim().max(40).optional(),
});

router.post("/pitch-fix/feedback", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Pick a star rating (1–5); the line of text is optional." }); return; }
  try {
    const submitterName = await resolveSubmitterName(req.userId!, parsed.data.creator_name);
    const row = await submitFeedback(store, {
      userId: req.userId!, submitterName, rating: parsed.data.rating, text: parsed.data.text,
    });
    res.status(201).json({ submission: row, moderationStatus: row.moderationStatus });
  } catch (err) { fail(res, err, "feedback submit"); }
});

router.get("/pitch-fix/mine", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json({ submissions: await listMySubmissions(store, req.userId!) });
  } catch (err) { fail(res, err, "mine"); }
});

router.post("/pitch-fix/:id/vote", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json(await togglePitchVote(store, req.userId!, String(req.params["id"])));
  } catch (err) { fail(res, err, "vote"); }
});

/* ─── Feedback Pop-Up prefs / cap ──────────────────────────────────── */

router.get("/pitch-fix/feedback-prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const prefs = await getFeedbackPrefs(store, req.userId!);
    res.json({ ...prefs, eligibility: await getFeedbackEligibility(store, req.userId!) });
  } catch (err) { fail(res, err, "feedback prefs read"); }
});

const feedbackPrefsSchema = z.object({ enabled: z.boolean() });

router.patch("/pitch-fix/feedback-prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = feedbackPrefsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  try {
    const prefs = await setFeedbackEnabled(store, req.userId!, parsed.data.enabled);
    res.json({ ...prefs, eligibility: await getFeedbackEligibility(store, req.userId!) });
  } catch (err) { fail(res, err, "feedback prefs write"); }
});

router.get("/pitch-fix/feedback-prompt/eligibility", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json(await getFeedbackEligibility(store, req.userId!));
  } catch (err) { fail(res, err, "feedback eligibility"); }
});

router.post("/pitch-fix/feedback-prompt/shown", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const result = await recordPromptShown(store, req.userId!);
    res.status(result.recorded ? 200 : 409).json(result);
  } catch (err) { fail(res, err, "feedback shown"); }
});

/* ─── Team review queue (admin) ────────────────────────────────────── */

router.get("/admin/pitch-fix/queue", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    /* Opening the bench is a processing trigger: rewards queued in a
       prior week pay when the new week's pool opens, without waiting
       for a status change. A processing failure never hides the queue
       — the bench renders and the failure is logged. */
    try {
      await processRewardQueue(store, defaultRewardPayDeps);
    } catch (err) {
      logger.error({ err }, "[pitch-fix] reward processing on queue open failed (queue still served)");
    }
    const pool = await getRewardPoolState(store);
    res.json({
      submissions: await listModerationQueue(store),
      rewardPool: {
        weekStart: pool.weekStart,
        capVb: pool.capVb,
        spentVb: pool.spentVb,
        remainingVb: pool.remainingVb,
        queuedIds: pool.queued.map((q) => q.id),
      },
    });
  } catch (err) { fail(res, err, "admin queue"); }
});

router.post("/admin/pitch-fix/rewards/process", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rewards = await processRewardQueue(store, defaultRewardPayDeps);
    const pool = await getRewardPoolState(store);
    res.json({ rewards, rewardPool: { weekStart: pool.weekStart, capVb: pool.capVb, spentVb: pool.spentVb, remainingVb: pool.remainingVb, queuedIds: pool.queued.map((q) => q.id) } });
  } catch (err) { fail(res, err, "admin rewards process"); }
});

const adminPatchSchema = z.object({
  moderation: z.enum(["approved", "rejected"]).optional(),
  status: z.string().trim().min(1).max(20).optional(),
  duplicate_of: z.string().trim().min(1).max(64).optional(),
});

router.patch("/admin/pitch-fix/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const parsed = adminPatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  try {
    let row = null;
    let rewards = null;
    if (parsed.data.moderation) {
      row = await moderateSubmission(store, req.userId!, String(req.params["id"]), parsed.data.moderation);
    }
    if (parsed.data.duplicate_of) {
      row = await markDuplicate(store, String(req.params["id"]), parsed.data.duplicate_of);
    }
    if (parsed.data.status) {
      /* The status transition is the ONLY reward trigger: it queues
         on Shipped/Fixed and the queue processes in the same action. */
      const result = await setStatusAndProcessRewards(store, defaultRewardPayDeps, String(req.params["id"]), parsed.data.status);
      row = result.submission;
      rewards = result.rewards;
    }
    if (!row) { res.status(400).json({ error: "Nothing to update." }); return; }
    res.json({ submission: row, ...(rewards ? { rewards } : {}) });
  } catch (err) { fail(res, err, "admin patch"); }
});

export default router;
