import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import {
  chargeCredits, refundCredits, OutOfCreditsError, buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../lib/generation-stored-results";
import { db, wave9dDirectorPlansTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

/* ─── Wave 9D — Character Director ─────────────────────────────────────────
   A PLANNING layer over the existing Scene Studio generation pipeline
   (Runway/Seedance). Cast 2+ characters from your vault, assign shots per
   character, and the text model turns the cast + shot list into per-shot
   generation prompts that drop straight into the existing Scene Studio
   flow. NO new video model is added or used here.

   Endpoints (router mounted at /api — coordinator wires routes/index.ts):
     POST /wave9d/director/plan   150 VB — per-shot prompt plan (persists)
     GET  /wave9d/director/plans  free   — list saved plans

   Credit discipline (standing): AI availability check BEFORE charging →
   charge BEFORE the model call → refund on ANY failure. No charge without
   delivery, ever. */

const router = Router();

const DIRECTOR_PLAN_CREDITS = 150;

const REPLAY_NOTE =
  "This is the shot plan you already made for this request — tweak the cast or shots for a fresh one.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetWave9dDirectorReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}

const castMemberSchema = z.object({
  vaultId: z.string().max(100).optional().default(""),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).optional().default(""),
});

const shotInputSchema = z.object({
  index: z.number().int().min(1).max(100),
  characters: z.array(z.string().trim().min(1).max(120)).min(1).max(6),
  action: z.string().trim().min(1).max(500),
  cameraNote: z.string().trim().max(300).optional().default(""),
});

const directorPlanRequestSchema = z.object({
  name: z.string().trim().max(120).optional().default(""),
  cast: z.array(castMemberSchema).min(2).max(8),
  shots: z.array(shotInputSchema).min(1).max(30),
  sceneStyle: z.string().trim().max(300).optional().default(""),
});

const plannedShotSchema = z.object({
  shotIndex: z.number().int().min(1),
  prompt: z.string().trim().min(1).max(1500),
});

const directorPlanResponseSchema = z.object({
  shots: z.array(plannedShotSchema).min(1).max(30),
});

type PlannedShot = z.infer<typeof plannedShotSchema>;

async function runDirectorPlan(
  userId: string,
  data: z.infer<typeof directorPlanRequestSchema>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  /* Charge BEFORE the model call, under the CA-KEY idempotency key. */
  let remaining: number;
  try {
    remaining = await chargeCredits(userId, DIRECTOR_PLAN_CREDITS, {
      action: "Character Director — Shot Plan",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        __status: 402,
        error: "out_of_credits",
        message: "Not enough Visual Bucs — top up to plan your shots.",
      };
    }
    throw err;
  }

  const { name, cast, shots, sceneStyle } = data;

  try {
    const castBlock = cast
      .map((c, i) => `CHARACTER ${i + 1}: "${c.name}" — ${c.description || "no description provided"}`)
      .join("\n");

    const shotBlock = shots
      .sort((a, b) => a.index - b.index)
      .map(
        (s) =>
          `SHOT ${s.index}: characters in frame: ${s.characters.join(", ")}; ` +
          `action: ${s.action}; camera note: ${s.cameraNote || "director's choice"}`
      )
      .join("\n");

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            "You are a shot-list cinematographer for Bow Down Visuals — the cheat code " +
            "for content creators. You turn a cast + shot list into per-shot IMAGE-TO-VIDEO " +
            "generation prompts that feed an existing music-video scene pipeline. This is " +
            "PLANNING only — you never generate video yourself.\n\n" +
            "For each shot, write one generation-ready prompt: start with WHO is in frame " +
            "(use the exact character names; describe their look from the cast descriptions), " +
            "then WHAT they do (the shot's action), then the CAMERA and LIGHTING language " +
            "(use the camera note, sharpened with real camera vocabulary). Keep every " +
            "character's identity distinct and consistent across shots. Keep each prompt " +
            "under 200 words, cinematic, present tense, comma-separated descriptive " +
            "phrases. No markdown, no commentary, plain text only.\n\n" +
            'You must return ONLY valid JSON with this exact shape:\n' +
            '{ "shots": [ { "shotIndex": <number>, "prompt": "<generation prompt>" } ] }\n' +
            "One entry per input shot, in shot order. No fields outside this shape.",
        },
        {
          role: "user",
          content:
            `CAST:\n${castBlock}\n\n` +
            `SHOT LIST:\n${shotBlock}\n` +
            (sceneStyle ? `\nOverall scene style: ${sceneStyle}\n` : "") +
            "\nWrite the per-shot generation prompts.",
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 3000,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let planned: { shots: PlannedShot[] };
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      planned = directorPlanResponseSchema.parse(json);
    } catch {
      throw new Error("Model returned an unusable shot plan");
    }

    /* Merge generated prompts back onto the input shots, in input order. */
    const byIndex = new Map(planned.shots.map((s) => [s.shotIndex, s.prompt]));
    const mergedShots = shots
      .sort((a, b) => a.index - b.index)
      .map((s) => ({
        index: s.index,
        characters: s.characters,
        action: s.action,
        cameraNote: s.cameraNote,
        generatedPrompt: byIndex.get(s.index) ?? "",
      }));

    /* Persist the plan — free, no extra charge. */
    const [saved] = await db
      .insert(wave9dDirectorPlansTable)
      .values({
        user_id: userId,
        name: name || `Director Plan — ${new Date().toISOString().slice(0, 10)}`,
        castMembers: cast,
        shots: mergedShots,
      })
      .returning({ id: wave9dDirectorPlansTable.id });

    return {
      planId: saved?.id ?? null,
      shots: mergedShots,
      creditsUsed: DIRECTOR_PLAN_CREDITS,
      creditsRemaining: remaining,
    };
  } catch (err) {
    /* Refund on ANY failure — no charge without delivery. When the
       refund lands, VOID the charge's idempotency key so the retry
       charges fresh instead of being suppressed as a replay. */
    logger.error({ err, userId }, "[wave9d-director] plan failed — refunding");
    let refunded = true;
    try {
      await refundCredits(userId, DIRECTOR_PLAN_CREDITS, {
        action: "Character Director — Refund",
      });
    } catch (refundErr) {
      refunded = false;
      logger.error(
        { userId, refundErr },
        "[wave9d-director] CRITICAL: refund failed after plan failure"
      );
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey).catch(() => false);
    }
    return {
      __status: 500,
      error: "The director hiccupped — your Visual Bucs were refunded.",
      refunded: true,
    };
  }
}

/* ─── POST /wave9d/director/plan — 150 VB ─── */
router.post("/wave9d/director/plan", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = directorPlanRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid director plan request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  /* 1) AI availability check BEFORE charging. */
  try {
    getOpenAI();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      error: "ai_unavailable",
      message: msg.includes("OPENAI_API_KEY")
        ? "OPENAI_API_KEY is not configured — the Character Director is unavailable."
        : "The Character Director is unavailable right now.",
    });
    return;
  }

  /* CA-KEY: the server derives the key itself on EVERY call — this
     schema accepts no client idempotencyKey, so the key is the
     {name, cast, shots, sceneStyle} intent hash (cast is free-text on
     this surface and hashes as written). An identical ask can never
     be re-bought: a replay serves the stored plan with replayed: true
     and REPLAY_NOTE instead of charging again. */
  const idempotencyKey = buildChargeIdempotencyKey(
    "wave9d-director", req.userId!, undefined,
    {
      name: parsed.data.name,
      cast: parsed.data.cast,
      shots: parsed.data.shots,
      sceneStyle: parsed.data.sceneStyle,
    },
  );

  /* Stored-result pre-check (migration 0333) BEFORE any funding:
     durable first, then the in-process cache, then an in-flight twin. */
  const durable = await findStoredGenerationResult("wave9d-director", idempotencyKey, req.userId!);
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
    /* The twin failed (refunded + key voided) — fall through fresh. */
  }

  const run = runDirectorPlan(req.userId!, parsed.data, idempotencyKey);
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

  /* Store BEFORE answering, fail-open. (The plan row itself is also
     persisted by the run, exactly as before; this replay row is keyed
     by the charge key so a re-ask never pays or plans twice.) */
  try {
    if (storedResults.size >= MAX_STORED_RESULTS) {
      const oldest = storedResults.keys().next().value as string | undefined;
      if (oldest !== undefined) storedResults.delete(oldest);
    }
    storedResults.set(idempotencyKey, { body, at: Date.now() });
    await storeGenerationResult("wave9d-director", idempotencyKey, req.userId!, { ...body });
  } catch { /* storing is best-effort */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json({ ...postCharge.body, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  res.json(body);
});

/* ─── GET /wave9d/director/plans — free (saved plans list) ─── */
router.get("/wave9d/director/plans", requireAuth, publicApiLimiter, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: wave9dDirectorPlansTable.id,
        name: wave9dDirectorPlansTable.name,
        cast: wave9dDirectorPlansTable.castMembers,
        shots: wave9dDirectorPlansTable.shots,
        created_at: wave9dDirectorPlansTable.created_at,
      })
      .from(wave9dDirectorPlansTable)
      .where(eq(wave9dDirectorPlansTable.user_id, req.userId!))
      .orderBy(desc(wave9dDirectorPlansTable.created_at))
      .limit(50);
    res.json({ plans: rows });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[wave9d-director] list plans failed");
    res.status(500).json({ error: "Could not load saved plans." });
  }
});

export default router;
