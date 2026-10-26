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
  CommunityGrantError,
  drizzleCommunityGrantStore as store,
  defaultGrantPayDeps,
  getGrantsSurface,
  openRound,
  submitProject,
  castVote,
  withdrawVote,
  postReportBack,
  settleRound,
  updateRoundWindows,
  isGrantsNotReady,
} from "../lib/community-grants";

const router = Router();

/* ─── Community Grants (Stack-200 N15) ────────────────────────────────
   GET    /api/community-grants                 public surface: the
                                                current round (pool,
                                                candidates in their own
                                                words, live tallies,
                                                result, report-back)
                                                + past rounds. No round
                                                ⇒ current: null, the
                                                honest empty state.
   POST   /api/community-grants/:id/projects    submit YOUR project
                                                (auth; one per creator
                                                per round)
   POST   /api/community-grants/:id/vote        cast or CHANGE your one
                                                vote (auth; one row per
                                                member per round)
   DELETE /api/community-grants/:id/vote        withdraw your vote (auth)
   POST   /api/community-grants/:id/report-back the funded creator's
                                                report-back (auth,
                                                winner only, after pay)
   POST   /api/admin/community-grants/rounds    open a round (ADMIN —
                                                the pool size in VB is
                                                entered here, recorded
                                                on the round, never a
                                                code constant)
   PATCH  /api/admin/community-grants/rounds/:id
                                                adjust windows (ADMIN;
                                                also the tie-resolution
                                                path — extending voting
                                                reopens a tied round)
   POST   /api/admin/community-grants/rounds/:id/settle
                                                settle after voting
                                                closes (ADMIN): winner
                                                paid the pool in VB
                                                exactly once; a tie pays
                                                nobody and holds.

   Guests can read everything and can never vote (vote routes are
   requireAuth). Visual Bucs ONLY — no cash path exists here.
   Pre-migration (9999 not yet applied): reads degrade to the empty
   surface; writes answer an honest 503. */

function fail(res: Response, err: unknown, scope: string) {
  if (isGrantsNotReady(err)) {
    res.status(503).json({ error: "Community Grants are not switched on yet.", code: "not_ready" });
    return;
  }
  if (err instanceof CommunityGrantError) {
    const status = err.code === "not_found" ? 404 : err.code === "not_ready" ? 503 : 400;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  logger.error({ err }, `[community-grants] ${scope} failed`);
  res.status(500).json({ error: "Something went wrong on our end." });
}

/** Display name from the creator's real profile (the pitch-fix rule). */
async function resolveCreatorName(userId: string): Promise<string> {
  try {
    const rows = await db
      .select({ displayName: creatorProfilesTable.displayName })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);
    const fromProfile = rows[0]?.displayName?.trim();
    if (fromProfile) return fromProfile.slice(0, 60);
  } catch {
    /* a profile lookup must never block a submission */
  }
  return "Creator";
}

router.get("/community-grants", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    await resolveOptionalSession(req);
    res.json(await getGrantsSurface(store, req.userId));
  } catch (err) {
    if (isGrantsNotReady(err)) {
      /* Reads degrade: the honest empty surface, never a fake round. */
      res.json({ current: null, past: [] });
      return;
    }
    fail(res, err, "surface");
  }
});

const projectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
});

router.post("/community-grants/:id/projects", requireAuth, async (req: Request, res: Response) => {
  const parsed = projectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Your project needs a title and a description in your own words.", code: "validation" });
    return;
  }
  try {
    const name = await resolveCreatorName(req.userId!);
    const candidate = await submitProject(store, String(req.params["id"]), req.userId!, name, parsed.data);
    res.status(201).json({ candidate });
  } catch (err) {
    fail(res, err, "submit project");
  }
});

const voteSchema = z.object({
  candidateId: z.string().trim().min(1),
});

router.post("/community-grants/:id/vote", requireAuth, async (req: Request, res: Response) => {
  const parsed = voteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Say which project you are voting for.", code: "validation" });
    return;
  }
  try {
    const result = await castVote(store, String(req.params["id"]), req.userId!, parsed.data.candidateId);
    res.json({ voted: true, ...result });
  } catch (err) {
    fail(res, err, "cast vote");
  }
});

router.delete("/community-grants/:id/vote", requireAuth, async (req: Request, res: Response) => {
  try {
    await withdrawVote(store, String(req.params["id"]), req.userId!);
    res.json({ voted: false });
  } catch (err) {
    fail(res, err, "withdraw vote");
  }
});

const reportBackSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

router.post("/community-grants/:id/report-back", requireAuth, async (req: Request, res: Response) => {
  const parsed = reportBackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Write your report-back in your own words.", code: "validation" });
    return;
  }
  try {
    const candidate = await postReportBack(store, String(req.params["id"]), req.userId!, parsed.data.body);
    res.json({ candidate });
  } catch (err) {
    fail(res, err, "report back");
  }
});

/* ─── Admin: open / adjust / settle rounds ─────────────────────────── */

const openRoundSchema = z.object({
  monthKey: z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "monthKey must be YYYY-MM"),
  poolVb: z.number().int().positive(),
  submissionsOpenAt: z.string().min(1),
  submissionsCloseAt: z.string().min(1),
  votingOpenAt: z.string().min(1),
  votingCloseAt: z.string().min(1),
});

router.post("/admin/community-grants/rounds", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const parsed = openRoundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A round needs a month (YYYY-MM), a positive whole-number VB pool, and four window timestamps.", code: "validation" });
    return;
  }
  try {
    const round = await openRound(store, req.userId!, parsed.data);
    res.status(201).json({ round });
  } catch (err) {
    fail(res, err, "open round");
  }
});

const windowsSchema = z.object({
  submissionsOpenAt: z.string().min(1).optional(),
  submissionsCloseAt: z.string().min(1).optional(),
  votingOpenAt: z.string().min(1).optional(),
  votingCloseAt: z.string().min(1).optional(),
});

router.patch("/admin/community-grants/rounds/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const parsed = windowsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send the window timestamps you want to change.", code: "validation" });
    return;
  }
  try {
    const round = await updateRoundWindows(store, String(req.params["id"]), parsed.data);
    res.json({ round });
  } catch (err) {
    fail(res, err, "update windows");
  }
});

router.post("/admin/community-grants/rounds/:id/settle", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await settleRound(store, defaultGrantPayDeps, String(req.params["id"]));
    res.json(result);
  } catch (err) {
    fail(res, err, "settle round");
  }
});

export default router;
