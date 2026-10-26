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
  RemixKingError,
  drizzleRemixKingStore as store,
  createEvent,
  updateDraftEvent,
  setEventStatus,
  submitEntry,
  toggleVote,
  shortlistEntry,
  selectWinner,
  getCurrentEvent,
  getEventView,
  createSplitPayments,
} from "../lib/remix-king";
import { defaultSplitPayDeps, processSplitPayments } from "../lib/remix-king-payments";

const router = Router();

/* ─── Remix the King (Stack-200 #152) ────────────────────────────────
   GET    /api/remix-king/current            current live event + entries
                                             + release (public; splits are
                                             published in writing up front)
   GET    /api/remix-king/events/:id         one event view (public)
   POST   /api/remix-king/events/:id/entries enter a remix (auth, one
                                             per member per event)
   POST   /api/remix-king/entries/:id/vote   toggle a vote (auth)
   GET    /api/remix-king/releases/:id/payments  the release's split
                                             payments (auth; payees + team
                                             see amounts — published terms)
   POST   /api/admin/remix-king/events       create the month's event
                                             WITH its written splits (admin)
   PATCH  /api/admin/remix-king/events/:id   draft edits incl. splits
                                             (admin; frozen once live)
   POST   /api/admin/remix-king/events/:id/status   lifecycle (admin)
   POST   /api/admin/remix-king/entries/:id/shortlist (admin)
   POST   /api/admin/remix-king/events/:id/winner   pick winner → the
                                             official release (admin)
   POST   /api/admin/remix-king/releases/:id/split-payments
                                             create a period's split rows
                                             + pay them, exactly once (admin)

   Money: Visual Bucs only, TEST MODE. Split payments are exactly-once
   (claim → grant → strict ledger row keyed remix-king-split:<id>). */

function fail(res: Response, err: unknown, scope: string) {
  if (err instanceof RemixKingError) {
    res.status(err.code === "not_found" ? 404 : 400).json({ error: err.message, code: err.code });
    return;
  }
  logger.error({ err }, `[remix-king] ${scope} failed`);
  res.status(500).json({ error: "Something went wrong on our end." });
}

async function resolveName(userId: string, typed?: string): Promise<string> {
  try {
    const rows = await db.select({ displayName: creatorProfilesTable.displayName })
      .from(creatorProfilesTable).where(eq(creatorProfilesTable.userId, userId)).limit(1);
    const fromProfile = rows[0]?.displayName?.trim();
    if (fromProfile) return fromProfile.slice(0, 40);
  } catch { /* typed name still files */ }
  return (typed ?? "").trim().slice(0, 40) || "Creator";
}

router.get("/remix-king/current", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    await resolveOptionalSession(req);
    res.json({ view: await getCurrentEvent(store, req.userId) });
  } catch (err) { fail(res, err, "current"); }
});

router.get("/remix-king/events/:id", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    await resolveOptionalSession(req);
    const view = await getEventView(store, String(req.params["id"]), req.userId);
    if (!view || view.event.status === "draft") { res.status(404).json({ error: "Event not found." }); return; }
    res.json({ view });
  } catch (err) { fail(res, err, "event view"); }
});

const entrySchema = z.object({
  remix_title: z.string().trim().min(1).max(120),
  audio_url: z.string().trim().min(1).max(1000),
  note: z.string().trim().max(500).optional(),
  creator_name: z.string().trim().max(40).optional(),
});

router.post("/remix-king/events/:id/entries", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Your remix needs a title and an audio link." }); return; }
  try {
    const entrantName = await resolveName(req.userId!, parsed.data.creator_name);
    const entry = await submitEntry(store, {
      eventId: String(req.params["id"]), userId: req.userId!, entrantName,
      remixTitle: parsed.data.remix_title, audioUrl: parsed.data.audio_url, note: parsed.data.note,
    });
    res.status(201).json({ entry });
  } catch (err) { fail(res, err, "entry submit"); }
});

router.post("/remix-king/entries/:id/vote", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json(await toggleVote(store, req.userId!, String(req.params["id"])));
  } catch (err) { fail(res, err, "vote"); }
});

router.get("/remix-king/releases/:id/payments", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json({ payments: await store.listPayments(String(req.params["id"])) });
  } catch (err) { fail(res, err, "payments list"); }
});

/* ─── Team surface (admin) ─────────────────────────────────────────── */

const splitSchema = z.object({
  role: z.enum(["winner", "king", "house"]),
  payeeName: z.string().trim().min(1).max(80),
  payeeUserId: z.string().trim().max(64).nullable().optional(),
  sharePct: z.number().int().min(1).max(100),
});

const createEventSchema = z.object({
  month_key: z.string().trim().min(7).max(7),
  title: z.string().trim().min(1).max(120),
  king_track_title: z.string().trim().min(1).max(160),
  king_track_audio_url: z.string().trim().max(1000).nullable().optional(),
  king_track_stems_url: z.string().trim().max(1000).nullable().optional(),
  description: z.string().trim().max(2000).optional(),
  splits: z.array(splitSchema).min(1).max(3),
  entries_open_at: z.string().trim().max(40).nullable().optional(),
  entries_close_at: z.string().trim().max(40).nullable().optional(),
});

router.post("/admin/remix-king/events", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const parsed = createEventSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "The event needs a month, a title, the King's track, and its splits in writing (adding up to 100%)." }); return; }
  try {
    const event = await createEvent(store, req.userId!, {
      monthKey: parsed.data.month_key, title: parsed.data.title, kingTrackTitle: parsed.data.king_track_title,
      kingTrackAudioUrl: parsed.data.king_track_audio_url ?? null, kingTrackStemsUrl: parsed.data.king_track_stems_url ?? null,
      description: parsed.data.description, splits: parsed.data.splits.map((s) => ({ ...s, payeeUserId: s.payeeUserId ?? null })),
      entriesOpenAt: parsed.data.entries_open_at ?? null, entriesCloseAt: parsed.data.entries_close_at ?? null,
    });
    res.status(201).json({ event });
  } catch (err) { fail(res, err, "admin create"); }
});

const patchEventSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  king_track_title: z.string().trim().min(1).max(160).optional(),
  king_track_audio_url: z.string().trim().max(1000).nullable().optional(),
  king_track_stems_url: z.string().trim().max(1000).nullable().optional(),
  description: z.string().trim().max(2000).optional(),
  splits: z.array(splitSchema).min(1).max(3).optional(),
  entries_open_at: z.string().trim().max(40).nullable().optional(),
  entries_close_at: z.string().trim().max(40).nullable().optional(),
});

router.patch("/admin/remix-king/events/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const parsed = patchEventSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  try {
    const d = parsed.data;
    const event = await updateDraftEvent(store, String(req.params["id"]), {
      title: d.title, kingTrackTitle: d.king_track_title,
      kingTrackAudioUrl: d.king_track_audio_url, kingTrackStemsUrl: d.king_track_stems_url,
      description: d.description,
      splits: d.splits?.map((s) => ({ ...s, payeeUserId: s.payeeUserId ?? null })),
      entriesOpenAt: d.entries_open_at, entriesCloseAt: d.entries_close_at,
    });
    res.json({ event });
  } catch (err) { fail(res, err, "admin patch"); }
});

const statusSchema = z.object({ status: z.enum(["draft", "open", "judging", "decided", "released", "cancelled"]) });

router.post("/admin/remix-king/events/:id/status", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  try {
    res.json({ event: await setEventStatus(store, String(req.params["id"]), parsed.data.status) });
  } catch (err) { fail(res, err, "admin status"); }
});

const shortlistSchema = z.object({ shortlisted: z.boolean() });

router.post("/admin/remix-king/entries/:id/shortlist", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const parsed = shortlistSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  try {
    res.json({ entry: await shortlistEntry(store, String(req.params["id"]), parsed.data.shortlisted) });
  } catch (err) { fail(res, err, "admin shortlist"); }
});

const winnerSchema = z.object({ entry_id: z.string().trim().min(1).max(64) });

router.post("/admin/remix-king/events/:id/winner", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const parsed = winnerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  try {
    res.json(await selectWinner(store, String(req.params["id"]), parsed.data.entry_id));
  } catch (err) { fail(res, err, "admin winner"); }
});

const splitPaySchema = z.object({
  period: z.string().trim().min(7).max(7),
  total_vb: z.number().int().min(0).max(10_000_000),
});

router.post("/admin/remix-king/releases/:id/split-payments", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const parsed = splitPaySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Give the period (2026-12) and the total Visual Bucs to split." }); return; }
  try {
    const payments = await createSplitPayments(store, String(req.params["id"]), parsed.data.period, parsed.data.total_vb);
    const result = await processSplitPayments(store, defaultSplitPayDeps, String(req.params["id"]));
    const fresh = await store.listPayments(String(req.params["id"]));
    res.json({ payments: fresh.filter((p) => payments.some((x) => x.id === p.id)), result });
  } catch (err) { fail(res, err, "admin split payments"); }
});

export default router;
