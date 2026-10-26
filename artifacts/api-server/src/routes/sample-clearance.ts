import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { isMissingSchemaError } from "../lib/pg-errors";
import { SAMPLE_CLEARANCE_STATUSES, SAMPLE_USE_KINDS } from "@workspace/db";
import {
  SampleClearanceError,
  acknowledgeDeclaration,
  declareSample,
  drizzleSampleClearanceStore as store,
  getAlternatives,
  listDeclarations,
  listMyDeclarations,
  preShipCheckForRelease,
  removeDeclaration,
  summarizeForCredits,
  updateDeclaration,
} from "../lib/sample-clearance";

const router = Router();

/* ─── Sample Clearance Lane (Stack-200 N2) ───────────────────────────
   POST   /api/sample-clearance/songs/:songId/declarations   declare a
          sample on YOUR OWN track (ownership verified server-side)
   GET    /api/sample-clearance/songs/:songId/declarations   your
          declarations for the track, each with its plain-words flag
   PATCH  /api/sample-clearance/declarations/:id             edit yours
          (editing clears any earlier ship acknowledgement)
   DELETE /api/sample-clearance/declarations/:id             remove yours
   POST   /api/sample-clearance/declarations/:id/acknowledge record the
          explicit pre-ship acknowledgement of the flags
   GET    /api/sample-clearance/songs/:songId/alternatives   cleared-loop
          offers from the Beats Marketplace catalog (offers, never swaps)
   GET    /api/sample-clearance/releases/:releaseId/pre-ship  the flags
          standing between this release and shipping
   GET    /api/sample-clearance/songs/:songId/credits-summary  the N1
          join surface: declaration lines that ride the track's credits

   Honesty rules: clearance is creator-stated, never platform-verified;
   flags warn in plain words; NO money moves in this lane.
   Pre-migration (provisional 9999): writes answer an honest 503 and
   reads degrade to empty/not-ready instead of 500s. */

const param = (req: Request, name: string): string => String(req.params[name] ?? "");

const NOT_READY = "Sample declarations aren't switched on yet — try again shortly.";

function fail(res: Response, err: unknown, scope: string) {
  if (err instanceof SampleClearanceError) {
    const status = err.code === "not_found" ? 404 : err.code === "not_owner" ? 403 : 400;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  if (isMissingSchemaError(err)) {
    res.status(503).json({ error: NOT_READY, code: "not_ready" });
    return;
  }
  logger.error({ err }, `[sample-clearance] ${scope} failed`);
  res.status(500).json({ error: "Something went wrong on our end." });
}

const declareSchema = z.object({
  sourceDescription: z.string().min(3).max(500),
  useKind: z.enum(SAMPLE_USE_KINDS),
  clearanceStatus: z.enum(SAMPLE_CLEARANCE_STATUSES),
  recognizable: z.boolean(),
});

const patchSchema = declareSchema.partial();

router.post("/sample-clearance/songs/:songId/declarations", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = declareSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Tell us what you sampled, how it's used, and your clearance status.", code: "validation" });
      return;
    }
    const declaration = await declareSample(store, req.userId!, param(req, "songId"), parsed.data);
    res.status(201).json({ declaration });
  } catch (err) {
    fail(res, err, "declare");
  }
});

router.get("/sample-clearance/songs/:songId/declarations", requireAuth, async (req: Request, res: Response) => {
  try {
    const declarations = await listMyDeclarations(store, req.userId!, param(req, "songId"));
    res.json({ declarations });
  } catch (err) {
    if (isMissingSchemaError(err)) {
      res.json({ declarations: [], notReady: true });
      return;
    }
    fail(res, err, "list");
  }
});

router.patch("/sample-clearance/declarations/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "That edit doesn't look right — check the fields and try again.", code: "validation" });
      return;
    }
    const declaration = await updateDeclaration(store, req.userId!, param(req, "id"), parsed.data);
    res.json({ declaration });
  } catch (err) {
    fail(res, err, "update");
  }
});

router.delete("/sample-clearance/declarations/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await removeDeclaration(store, req.userId!, param(req, "id"));
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, "remove");
  }
});

router.post("/sample-clearance/declarations/:id/acknowledge", requireAuth, async (req: Request, res: Response) => {
  try {
    const declaration = await acknowledgeDeclaration(store, req.userId!, param(req, "id"));
    res.json({ declaration });
  } catch (err) {
    fail(res, err, "acknowledge");
  }
});

router.get("/sample-clearance/songs/:songId/alternatives", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await getAlternatives(store, req.userId!, param(req, "songId"));
    res.json(result);
  } catch (err) {
    fail(res, err, "alternatives");
  }
});

router.get("/sample-clearance/releases/:releaseId/pre-ship", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await preShipCheckForRelease(store, req.userId!, param(req, "releaseId"));
    if (!result.releaseFound) {
      res.status(404).json({ error: "Release not found." });
      return;
    }
    res.json({ ok: result.ok, blocking: result.blocking, warnings: result.warnings });
  } catch (err) {
    if (isMissingSchemaError(err)) {
      /* Degrade open with the truth stated: the check could not run. */
      res.json({ ok: true, blocking: [], warnings: [], checkUnavailable: true });
      return;
    }
    fail(res, err, "pre-ship");
  }
});

/* The N1 join surface — intentionally readable by any signed-in user:
   credits travel with the song publicly, and this summary carries only
   what the credits themselves will show (the creator's own declared
   lines, labelled creator-declared). */
router.get("/sample-clearance/songs/:songId/credits-summary", requireAuth, async (req: Request, res: Response) => {
  try {
    const songId = param(req, "songId");
    const declarations = await listDeclarations(store, songId);
    res.json({ credits: summarizeForCredits(songId, declarations) });
  } catch (err) {
    if (isMissingSchemaError(err)) {
      res.json({ credits: { songId: param(req, "songId"), samplesDeclared: false, lines: [], worstFlagLevel: "none" }, notReady: true });
      return;
    }
    fail(res, err, "credits-summary");
  }
});

export default router;
