import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  db,
  loopExchangeLoopsTable,
  loopExchangeBuildsTable,
  creatorProfilesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  LoopExchangeError,
  loopExchangeReady,
  isMissingLoopExchangeStorage,
  validatePosterSharePct,
  validateBuildSplits,
  recordLoopSale,
  defaultRecordLoopSaleDeps,
  listOpenLoops,
  getLoop,
  getBuild,
  listBuildsForLoop,
  listLedgerForUser,
  listLoopsForPoster,
  listBuildsForBuilder,
} from "../lib/loop-exchange";

const router = Router();

/* ─── Loop Exchange (Stack-200 Wave 2, idea #168 — TRULY NEW) ─────────
   GET   /api/loop-exchange/loops            open loops anyone can
                                             build on (public)
   POST  /api/loop-exchange/loops            post a loop with your
                                             terms up front (auth)
   GET   /api/loop-exchange/loops/:id        one loop + its builds
   PATCH /api/loop-exchange/loops/:id        poster pauses / closes /
                                             reopens their loop (auth)
   POST  /api/loop-exchange/loops/:id/builds propose a build on a loop
                                             with full splits (auth) —
                                             validated on the EXISTING
                                             sale-splits rail; the
                                             poster must appear at >=
                                             their posted terms
   POST  /api/loop-exchange/builds/:id/decision
                                             poster accepts / declines
                                             the proposed terms (auth)
   POST  /api/loop-exchange/builds/:id/sales record a downstream sale
                                             (auth, the builder) — pays
                                             every split share exactly
                                             once, TEST MODE Visual
                                             Bucs only, never cash
   GET   /api/loop-exchange/mine             my loops, my builds, my
                                             split earnings (auth)

   Split terms are agreed UP FRONT and snapshotted on the build; only
   an 'agreed' build can record a sale. Pre-migration (provisional
   9999), writes answer 503 and reads degrade to empty — nothing is
   faked. */

function fail(res: Response, err: unknown, scope: string) {
  if (err instanceof LoopExchangeError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (isMissingLoopExchangeStorage(err)) {
    res.status(503).json({ error: "The Loop Exchange isn't open yet — check back soon.", code: "not_ready" });
    return;
  }
  logger.error({ err }, `[loop-exchange] ${scope} failed`);
  res.status(500).json({ error: "Something went wrong on our end." });
}

async function requireReady(res: Response): Promise<boolean> {
  if (await loopExchangeReady()) return true;
  res.status(503).json({ error: "The Loop Exchange isn't open yet — check back soon.", code: "not_ready" });
  return false;
}

async function profileIdForUser(userId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ id: creatorProfilesTable.id })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);
    return row?.id ?? null;
  } catch {
    return null;
  }
}

/* Public loop rows never leak anything beyond what the poster chose to
   publish; user ids ride along because the FE needs them to build the
   splits list (the same ids the sale-splits rail requires). */
function loopView(row: Awaited<ReturnType<typeof listOpenLoops>>[number]) {
  return {
    id: row.id,
    posterUserId: row.posterUserId,
    posterProfileId: row.posterProfileId,
    title: row.title,
    description: row.description,
    audioUrl: row.audioUrl,
    bpm: row.bpm,
    musicalKey: row.musicalKey,
    durationSeconds: row.durationSeconds,
    posterSharePct: Number(row.posterSharePct),
    status: row.status,
    createdAt: row.createdAt,
  };
}

function buildView(row: Awaited<ReturnType<typeof listBuildsForLoop>>[number]) {
  return {
    id: row.id,
    loopId: row.loopId,
    builderUserId: row.builderUserId,
    builderProfileId: row.builderProfileId,
    title: row.title,
    audioUrl: row.audioUrl,
    splits: row.splits,
    status: row.status,
    agreedAt: row.agreedAt,
    createdAt: row.createdAt,
  };
}

router.get("/loop-exchange/loops", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query["limit"] ?? 50);
    const rows = await listOpenLoops(Number.isFinite(limit) ? limit : 50);
    res.json({ loops: rows.map(loopView) });
  } catch (err) {
    if (isMissingLoopExchangeStorage(err)) { res.json({ loops: [] }); return; }
    fail(res, err, "list loops");
  }
});

const postLoopSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).optional(),
  audioUrl: z.string().trim().min(1).max(2048),
  bpm: z.number().int().min(20).max(400).optional(),
  musicalKey: z.string().trim().max(12).optional(),
  durationSeconds: z.number().int().min(1).max(3600).optional(),
  posterSharePct: z.number(),
});

router.post("/loop-exchange/loops", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  if (!(await requireReady(res))) return;
  const parsed = postLoopSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Give your loop a title, its audio, and your share — the percent of every downstream sale's net that goes to you." }); return; }
  try {
    const posterSharePct = validatePosterSharePct(parsed.data.posterSharePct);
    const posterProfileId = await profileIdForUser(req.userId!);
    const [row] = await db.insert(loopExchangeLoopsTable).values({
      posterUserId: req.userId!,
      posterProfileId,
      title: parsed.data.title,
      description: parsed.data.description ?? "",
      audioUrl: parsed.data.audioUrl,
      bpm: parsed.data.bpm ?? null,
      musicalKey: parsed.data.musicalKey ?? null,
      durationSeconds: parsed.data.durationSeconds ?? null,
      posterSharePct: String(posterSharePct),
      status: "open",
    }).returning();
    if (!row) throw new Error("loop insert returned no row");
    res.status(201).json({ loop: loopView(row) });
  } catch (err) { fail(res, err, "post loop"); }
});

router.get("/loop-exchange/loops/:id", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const loop = await getLoop(String(req.params["id"]));
    if (!loop) { res.status(404).json({ error: "That loop isn't here anymore.", code: "not_found" }); return; }
    const builds = await listBuildsForLoop(loop.id);
    res.json({ loop: loopView(loop), builds: builds.map(buildView) });
  } catch (err) {
    if (isMissingLoopExchangeStorage(err)) { res.status(404).json({ error: "That loop isn't here anymore.", code: "not_found" }); return; }
    fail(res, err, "get loop");
  }
});

const loopStatusSchema = z.object({ status: z.enum(["open", "paused", "closed"]) });

router.patch("/loop-exchange/loops/:id", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  if (!(await requireReady(res))) return;
  const parsed = loopStatusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  try {
    const loop = await getLoop(String(req.params["id"]));
    if (!loop) { res.status(404).json({ error: "That loop isn't here anymore.", code: "not_found" }); return; }
    if (loop.posterUserId !== req.userId) {
      throw new LoopExchangeError("not_poster", "Only the loop's poster can change its status.", 403);
    }
    const [row] = await db.update(loopExchangeLoopsTable)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(loopExchangeLoopsTable.id, loop.id))
      .returning();
    res.json({ loop: row ? loopView(row) : loopView(loop) });
  } catch (err) { fail(res, err, "loop status"); }
});

const proposeBuildSchema = z.object({
  title: z.string().trim().min(1).max(120),
  audioUrl: z.string().trim().max(2048).optional(),
  splits: z.array(z.object({
    userId: z.string().trim().min(1),
    sharePct: z.number(),
  })).min(1).max(20),
});

router.post("/loop-exchange/loops/:id/builds", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  if (!(await requireReady(res))) return;
  const parsed = proposeBuildSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Give your build a title and the full splits list — every share, totaling 100%." }); return; }
  try {
    const loop = await getLoop(String(req.params["id"]));
    if (!loop) { res.status(404).json({ error: "That loop isn't here anymore.", code: "not_found" }); return; }
    if (loop.status !== "open") {
      throw new LoopExchangeError("loop_not_open", "This loop isn't open for new builds right now.", 409);
    }
    if (loop.posterUserId === req.userId) {
      throw new LoopExchangeError("own_loop", "You can't build on your own loop — the Loop Exchange is for building on each other's work.");
    }
    const splits = validateBuildSplits({
      builderUserId: req.userId!,
      posterUserId: loop.posterUserId,
      posterSharePct: Number(loop.posterSharePct),
      splits: parsed.data.splits,
    });
    const builderProfileId = await profileIdForUser(req.userId!);
    const [row] = await db.insert(loopExchangeBuildsTable).values({
      loopId: loop.id,
      builderUserId: req.userId!,
      builderProfileId,
      title: parsed.data.title,
      audioUrl: parsed.data.audioUrl ?? null,
      splits,
      status: "pending_terms",
    }).returning();
    if (!row) throw new Error("build insert returned no row");
    res.status(201).json({ build: buildView(row) });
  } catch (err) { fail(res, err, "propose build"); }
});

const decisionSchema = z.object({ decision: z.enum(["agreed", "declined"]) });

router.post("/loop-exchange/builds/:id/decision", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  if (!(await requireReady(res))) return;
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  try {
    const build = await getBuild(String(req.params["id"]));
    if (!build) { res.status(404).json({ error: "That build isn't here anymore.", code: "not_found" }); return; }
    const loop = await getLoop(build.loopId);
    if (!loop) { res.status(404).json({ error: "That build's loop isn't here anymore.", code: "not_found" }); return; }
    if (loop.posterUserId !== req.userId) {
      throw new LoopExchangeError("not_poster", "Only the loop's poster can accept or decline a build's terms.", 403);
    }
    if (build.status !== "pending_terms") {
      throw new LoopExchangeError("already_decided", `This build's terms were already ${build.status} — the agreed deal can't be rewritten.`, 409);
    }
    const [row] = await db.update(loopExchangeBuildsTable)
      .set({
        status: parsed.data.decision,
        agreedAt: parsed.data.decision === "agreed" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(loopExchangeBuildsTable.id, build.id), eq(loopExchangeBuildsTable.status, "pending_terms")))
      .returning();
    if (!row) {
      throw new LoopExchangeError("already_decided", "This build's terms were just decided — refresh and you'll see the current state.", 409);
    }
    res.json({ build: buildView(row) });
  } catch (err) { fail(res, err, "build decision"); }
});

const recordSaleSchema = z.object({
  saleRef: z.string().trim().min(1).max(200),
  grossVb: z.number(),
  buyerUserId: z.string().trim().uuid().optional(),
});

router.post("/loop-exchange/builds/:id/sales", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  if (!(await requireReady(res))) return;
  const parsed = recordSaleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A downstream sale needs its sale reference and its price in Visual Bucs." }); return; }
  try {
    const build = await getBuild(String(req.params["id"]));
    if (!build) { res.status(404).json({ error: "That build isn't here anymore.", code: "not_found" }); return; }
    if (build.builderUserId !== req.userId) {
      throw new LoopExchangeError("not_builder", "Only the build's creator can record its downstream sales.", 403);
    }
    const loop = await getLoop(build.loopId);
    if (!loop) { res.status(404).json({ error: "That build's loop isn't here anymore.", code: "not_found" }); return; }
    const { outcome, sale, plan } = await recordLoopSale(defaultRecordLoopSaleDeps, {
      build: { id: build.id, loopId: build.loopId, builderUserId: build.builderUserId, status: build.status, splits: build.splits },
      posterUserId: loop.posterUserId,
      saleRef: parsed.data.saleRef,
      grossVb: parsed.data.grossVb,
      buyerUserId: parsed.data.buyerUserId ?? null,
      recordedByUserId: req.userId!,
    });
    res.status(outcome === "recorded" ? 201 : 200).json({
      outcome,
      sale: { id: sale.id, saleRef: sale.saleRef, grossVb: sale.grossVb, feeVb: sale.feeVb, netVb: sale.netVb },
      allocations: plan.allocations,
    });
  } catch (err) { fail(res, err, "record sale"); }
});

router.get("/loop-exchange/mine", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const [loops, builds, ledger] = await Promise.all([
      listLoopsForPoster(req.userId!),
      listBuildsForBuilder(req.userId!),
      listLedgerForUser(req.userId!),
    ]);
    res.json({
      loops: loops.map(loopView),
      builds: builds.map(buildView),
      earnings: ledger.map((r) => ({
        id: r.id,
        saleId: r.saleId,
        buildId: r.buildId,
        loopId: r.loopId,
        role: r.role,
        sharePct: Number(r.sharePct),
        amountVb: r.amountVb,
        createdAt: r.createdAt,
      })),
      totalEarnedVb: ledger.reduce((sum, r) => sum + r.amountVb, 0),
    });
  } catch (err) {
    if (isMissingLoopExchangeStorage(err)) {
      res.json({ loops: [], builds: [], earnings: [], totalEarnedVb: 0 });
      return;
    }
    fail(res, err, "mine");
  }
});

export default router;
