import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";
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

/* ─── POST /wave9d/director/plan — 150 VB ─── */
router.post("/wave9d/director/plan", publicApiLimiter, requireAuth, async (req, res) => {
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

  /* 2) Charge BEFORE the model call. */
  let remaining: number;
  try {
    remaining = await chargeCredits(req.userId!, DIRECTOR_PLAN_CREDITS, {
      action: "Character Director — Shot Plan",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs — top up to plan your shots.",
      });
      return;
    }
    throw err;
  }

  const { name, cast, shots, sceneStyle } = parsed.data;

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
      temperature: 0.7,
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
        user_id: req.userId!,
        name: name || `Director Plan — ${new Date().toISOString().slice(0, 10)}`,
        castMembers: cast,
        shots: mergedShots,
      })
      .returning({ id: wave9dDirectorPlansTable.id });

    res.json({
      planId: saved?.id ?? null,
      shots: mergedShots,
      creditsUsed: DIRECTOR_PLAN_CREDITS,
      creditsRemaining: remaining,
    });
  } catch (err) {
    /* 3) Refund on ANY failure — no charge without delivery. */
    logger.error({ err, userId: req.userId }, "[wave9d-director] plan failed — refunding");
    try {
      await refundCredits(req.userId!, DIRECTOR_PLAN_CREDITS, {
        action: "Character Director — Refund",
      });
    } catch (refundErr) {
      logger.error(
        { userId: req.userId, refundErr },
        "[wave9d-director] CRITICAL: refund failed after plan failure"
      );
    }
    res.status(500).json({
      error: "The director hiccupped — your Visual Bucs were refunded.",
      refunded: true,
    });
  }
});

/* ─── GET /wave9d/director/plans — free (saved plans list) ─── */
router.get("/wave9d/director/plans", publicApiLimiter, requireAuth, async (req, res) => {
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
