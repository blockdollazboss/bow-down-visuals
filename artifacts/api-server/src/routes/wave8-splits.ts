import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, buildChargeIdempotencyKey, voidChargeIdempotencyKey } from "../lib/credits";
import { findStoredGenerationResult, storeGenerationResult } from "../lib/generation-stored-results";
import { db, wave8RoyaltySplitsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";

const router = Router();

/* ─── Royalty Split Sheets (Wave 8) ───────────────────────────────────────
   Split-sheet CRUD is free (pure DB). Finalizing a sheet for the printable
   PDF costs 50 Visual Bucs — the charge pays for the final validation +
   audit-trail artifact (sheet code + finalized timestamp); the frontend
   renders the actual PDF client-side with jspdf. Refund on any failure.

   GET    /api/wave8/splits      — list this user's sheets, newest first
   POST   /api/wave8/splits      — create a sheet (splits must sum to 100%)
   PATCH  /api/wave8/splits/:id  — rename / edit collaborators (re-validated)
   DELETE /api/wave8/splits/:id  — delete one of the user's sheets
   POST   /api/wave8/splits/pdf  — 50 VB: finalize + return the audited sheet */

const PDF_CREDITS = 50;

const REPLAY_NOTE =
  "This is the split sheet you already finalized for this request \u2014 it has not been charged again.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetWave8SplitsReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}
/* Allow tiny float drift (e.g. 33.33 + 33.33 + 33.34) without forcing
   the creator to type 100.000001. */
const PCT_EPSILON = 0.001;

const collaboratorSchema = z.object({
  name: z.string().trim().min(1, "Each collaborator needs a name.").max(80),
  role: z.string().trim().max(40).optional().default(""),
  pct: z.number().min(0, "Percent can't be negative.").max(100, "Percent can't exceed 100."),
});

type Collaborator = z.infer<typeof collaboratorSchema>;

function totalPct(collaborators: Collaborator[]): number {
  return collaborators.reduce((sum, c) => sum + c.pct, 0);
}

function pctSumsToHundred(collaborators: Collaborator[]): boolean {
  return Math.abs(totalPct(collaborators) - 100) < PCT_EPSILON;
}

const createSchema = z.object({
  songTitle: z.string().trim().min(1, "Give the song a title.").max(120),
  collaborators: z
    .array(collaboratorSchema)
    .min(1, "Add at least one collaborator.")
    .max(20, "Twenty collaborators max per sheet.")
    .refine(pctSumsToHundred, { message: "Splits must add up to exactly 100%." }),
});

const patchSchema = z
  .object({
    songTitle: z.string().trim().min(1).max(120).optional(),
    collaborators: z
      .array(collaboratorSchema)
      .min(1)
      .max(20)
      .refine(pctSumsToHundred, { message: "Splits must add up to exactly 100%." })
      .optional(),
  })
  .refine((d) => d.songTitle !== undefined || d.collaborators !== undefined, {
    message: "Nothing to update.",
  });

const pdfSchema = z.object({
  splitId: z.string().trim().min(1, "splitId is required."),
});

type SplitRow = typeof wave8RoyaltySplitsTable.$inferSelect;

function toPublic(row: SplitRow) {
  const collaborators = (Array.isArray(row.collaborators) ? row.collaborators : []) as Collaborator[];
  return {
    id: row.id,
    songTitle: row.song_title,
    collaborators,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadOwnedSheet(userId: string, id: string): Promise<SplitRow | null> {
  const rows = await db
    .select()
    .from(wave8RoyaltySplitsTable)
    .where(and(eq(wave8RoyaltySplitsTable.id, id), eq(wave8RoyaltySplitsTable.user_id, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Deterministic audit reference — stable per sheet so a finalized PDF can
    always be matched back to its sheet (no migration needed for storage). */
function sheetCode(id: string): string {
  const stamp = new Date();
  const ymd = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}`;
  return `BDV-SPLIT-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}-${ymd}`;
}

/* GET /api/wave8/splits — list sheets, newest first */
router.get("/wave8/splits", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(wave8RoyaltySplitsTable)
      .where(eq(wave8RoyaltySplitsTable.user_id, req.userId!))
      .orderBy(desc(wave8RoyaltySplitsTable.created_at));
    res.json({ sheets: rows.map(toPublic) });
  } catch (err) {
    logger.error({ err }, "[wave8-splits] list failed");
    res.status(500).json({ error: "Could not load your split sheets." });
  }
});

/* POST /api/wave8/splits — create a sheet (free) */
router.post("/wave8/splits", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid split sheet.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  try {
    const [row] = await db
      .insert(wave8RoyaltySplitsTable)
      .values({
        user_id: req.userId!,
        song_title: parsed.data.songTitle,
        collaborators: parsed.data.collaborators,
      })
      .returning();
    res.status(201).json({ sheet: toPublic(row) });
  } catch (err) {
    logger.error({ err }, "[wave8-splits] create failed");
    res.status(500).json({ error: "Could not save the split sheet." });
  }
});

/* PATCH /api/wave8/splits/:id — rename or edit collaborators (free) */
router.patch("/wave8/splits/:id", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id) {
    res.status(400).json({ error: "Sheet id is required." });
    return;
  }
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid split sheet update.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  try {
    const owned = await loadOwnedSheet(req.userId!, id);
    if (!owned) {
      res.status(404).json({ error: "Split sheet not found." });
      return;
    }
    const [row] = await db
      .update(wave8RoyaltySplitsTable)
      .set({
        ...(parsed.data.songTitle !== undefined ? { song_title: parsed.data.songTitle } : {}),
        ...(parsed.data.collaborators !== undefined ? { collaborators: parsed.data.collaborators } : {}),
        updated_at: new Date(),
      })
      .where(and(eq(wave8RoyaltySplitsTable.id, id), eq(wave8RoyaltySplitsTable.user_id, req.userId!)))
      .returning();
    res.json({ sheet: toPublic(row) });
  } catch (err) {
    logger.error({ err }, "[wave8-splits] update failed");
    res.status(500).json({ error: "Could not update the split sheet." });
  }
});

/* DELETE /api/wave8/splits/:id — delete a sheet (free) */
router.delete("/wave8/splits/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id) {
    res.status(400).json({ error: "Sheet id is required." });
    return;
  }
  try {
    const deleted = await db
      .delete(wave8RoyaltySplitsTable)
      .where(and(eq(wave8RoyaltySplitsTable.id, id), eq(wave8RoyaltySplitsTable.user_id, req.userId!)))
      .returning({ id: wave8RoyaltySplitsTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Split sheet not found." });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    logger.error({ err }, "[wave8-splits] delete failed");
    res.status(500).json({ error: "Could not delete the split sheet." });
  }
});

async function runWave8SplitsPdf(
  userId: string,
  parsedData: z.infer<typeof pdfSchema>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  let creditsRemaining: number;
  try {
    creditsRemaining = await chargeCredits(userId, PDF_CREDITS, {
      action: "Royalty Split Sheet PDF \u2014 finalization",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        __status: 402,
        error: "out_of_credits",
        message: "You're out of Visual Bucs \u2014 top up to finalize a split sheet PDF.",
      };
    }
    throw err;
  }

  try {
    const sheet = await loadOwnedSheet(userId, parsedData.splitId);
    if (!sheet) {
      throw Object.assign(new Error("Split sheet not found."), { status: 404 });
    }
    const collaborators = (Array.isArray(sheet.collaborators) ? sheet.collaborators : []) as Collaborator[];
    if (!pctSumsToHundred(collaborators)) {
      throw Object.assign(
        new Error("This sheet no longer sums to 100% \u2014 edit it so the splits total 100%."),
        { status: 422 },
      );
    }
    const finalizedAt = new Date().toISOString();
    return {
      songTitle: sheet.song_title,
      collaborators,
      totalPct: Number(totalPct(collaborators).toFixed(2)),
      finalizedAt,
      sheetCode: sheetCode(sheet.id),
      creditsUsed: PDF_CREDITS,
      creditsRemaining,
    };
  } catch (err) {
    /* The charge was taken before finalization \u2014 give it back so a failed
       finalization never costs the creator. */
    let refunded = true;
    try {
      await refundCredits(userId, PDF_CREDITS, {
        action: "Royalty Split Sheet PDF \u2014 Refund (finalization failed)",
      });
    } catch (refundErr) {
      refunded = false;
      logger.error(
        { err: refundErr, userId },
        "[wave8-splits] refund failed after PDF finalization failure",
      );
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return { __status: 404, error: "Split sheet not found." };
    }
    if (status === 422) {
      return { __status: 422, error: (err as Error).message };
    }
    logger.error({ err }, "[wave8-splits] pdf finalization failed");
    return { __status: 502, error: "Could not finalize the split sheet \u2014 try again." };
  }
}

/* POST /api/wave8/splits/pdf \u2014 50 Visual Bucs: final validation + audited
   sheet data. The frontend renders the PDF from this payload (client-side
   jspdf), so the server never stores binary. Charge upfront, refund on any
   failure \u2014 the creator never pays for a failed finalization.
   CA-7 note: the charge fires BEFORE the sheet is loaded/validated (as
   today), so the replay pre-check also sits at the charge point, before
   that validation \u2014 a replay serves the stored finalization and the
   sheet is not re-loaded. */
router.post("/wave8/splits/pdf", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = pdfSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid PDF request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < PDF_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs \u2014 top up to finalize a split sheet PDF.",
    });
    return;
  }

  const idempotencyKey = buildChargeIdempotencyKey(
    "wave8-splits", req.userId!, undefined,
    { splitId: parsed.data.splitId },
  );

  const durable = await findStoredGenerationResult("wave8-splits", idempotencyKey, req.userId!);
  if (durable) {
    res.json({ ...durable, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  const stored = storedResults.get(idempotencyKey);
  if (stored) {
    res.json({ ...stored.body, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  const pending = inFlight.get(idempotencyKey);
  if (pending) {
    const twinBody = await pending.catch(() => null);
    if (twinBody && typeof twinBody["__status"] !== "number") {
      res.json({ ...twinBody, replayed: true, replayNote: REPLAY_NOTE });
      return;
    }
  }

  const run = runWave8SplitsPdf(req.userId!, parsed.data, idempotencyKey);
  inFlight.set(idempotencyKey, run);
  let body: Record<string, unknown>;
  try {
    body = await run;
  } finally {
    if (inFlight.get(idempotencyKey) === run) inFlight.delete(idempotencyKey);
  }

  const status = typeof body["__status"] === "number" ? (body["__status"] as number) : 200;
  if (status !== 200) {
    const { __status: _ignored, ...errorBody } = body;
    res.status(status).json(errorBody);
    return;
  }

  try {
    if (storedResults.size >= MAX_STORED_RESULTS) {
      const oldest = storedResults.keys().next().value as string | undefined;
      if (oldest !== undefined) storedResults.delete(oldest);
    }
    storedResults.set(idempotencyKey, { body, at: Date.now() });
    await storeGenerationResult("wave8-splits", idempotencyKey, req.userId!, { ...body });
  } catch { /* storing is best-effort */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json({ ...postCharge.body, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  res.json(body);
});

export default router;
