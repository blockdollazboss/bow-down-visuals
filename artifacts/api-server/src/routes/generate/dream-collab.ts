import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
} from "../../lib/credits";

/* ─── Dream Collab ────────────────────────────────────────────────────────
   /api/dream-collab/concept — 2 credits: "what if I collabed with X" —
   the AI generates a full video concept: logline, full concept, style
   blend of the creator's style with the collaborator's, AI video
   generation prompts (prompt-level, ready for the existing video pipeline),
   and a song concept for the collab. */

const router = Router();

/* 2 credits per concept — env-overridable without a deploy. A full concept
   package with generation prompts is a long structured GPT-6 Sol
   completion; 2 credits holds a deep margin — and honors the standing rule
   that every AI feature costs a fee. */
const CONCEPT_CREDITS = Number(process.env["DREAM_COLLAB_CONCEPT_CREDITS"]) || 200;

const conceptSchema = z.object({
  collaborator: z.string().min(1, "Name a collaborator.").max(120),
  userStyle: z.string().min(1, "Describe your style.").max(200),
  songTheme: z.string().max(300).optional().default(""),
});

interface ConceptJson {
  logline?: unknown;
  concept?: unknown;
  styleBlend?: unknown;
  videoPrompts?: unknown;
  songConcept?: unknown;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function parsePrompts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, 8);
}

async function refundOnFailure(userId: string, amount: number, label: string) {
  try {
    await refundCredits(userId, amount, {
      action: `${label} — Refund (generation failed)`,
    });
  } catch (refundErr) {
    logger.error({ err: refundErr, userId }, "[dream-collab] refund failed after generation error");
  }
}

/* POST /api/dream-collab/concept { collaborator, userStyle, songTheme? }
   → 200 { logline, concept, styleBlend, videoPrompts[], songConcept, creditsUsed, creditsRemaining }
   Paid: 2 credits. Auth required; credits deducted BEFORE the model call.
   Provider failure or unusable output → refund + 502. */
router.post("/dream-collab/concept", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = conceptSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid dream-collab request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < CONCEPT_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to dream up your collab.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, CONCEPT_CREDITS, { action: "Dream Collab — Concept" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to dream up your collab.",
      });
      return;
    }
    throw err;
  }

  const { collaborator, userStyle, songTheme } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a creative director for independent creators. A creator fantasizes: "what if I ` +
            `collabed with ${collaborator.trim()}?" They give you their own style. You generate the full ` +
            `fantasy collab package:\n` +
            `- logline: one punchy sentence selling the concept\n` +
            `- concept: the full video concept, 3-5 paragraphs — the premise, the arc, the moments that ` +
            `make it shareable, how it opens and how it ends\n` +
            `- styleBlend: how the collaborator's signature style fuses with the creator's style — ` +
            `specific, visual, exciting\n` +
            `- videoPrompts: 4-6 PROMPT-LEVEL text-to-video prompts (array of strings) a creator could ` +
            `paste into an AI video generator to visualize key scenes — cinematic detail: subject, action, ` +
            `camera, lighting, mood\n` +
            `- songConcept: a song concept for the collab — title, genre, mood, and what the song is about ` +
            `(2-4 sentences)\n` +
            `RULES: this is a fantasy concept for the creator's own content — frame it as "the video you ` +
            `would make", never imply the collaborator agreed to anything. Never promise virality. ` +
            `Return ONLY JSON: {"logline": "...", "concept": "...", "styleBlend": "...", ` +
            `"videoPrompts": ["...", ...], "songConcept": "..."}.`,
        },
        {
          role: "user",
          content:
            `Dream up my fantasy collab.\n` +
            `Collaborator: ${collaborator.trim()}\n` +
            `My style: ${userStyle.trim()}` +
            (songTheme.trim() ? `\nSong theme: ${songTheme.trim()}` : ""),
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 3000,
      temperature: 0.85,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let logline = "";
    let concept = "";
    let styleBlend = "";
    let videoPrompts: string[] = [];
    let songConcept = "";
    try {
      const j = JSON.parse(raw) as ConceptJson;
      logline = str(j.logline).slice(0, 300);
      concept = str(j.concept).slice(0, 4000);
      styleBlend = str(j.styleBlend).slice(0, 2000);
      videoPrompts = parsePrompts(j.videoPrompts);
      songConcept = str(j.songConcept).slice(0, 2000);
    } catch {
      /* fall through to the empty check below */
    }
    if (!logline || !concept || videoPrompts.length === 0) {
      throw new Error("Model returned no usable collab concept");
    }

    res.json({
      logline,
      concept,
      styleBlend,
      videoPrompts,
      songConcept,
      creditsUsed: CONCEPT_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure(req.userId!, CONCEPT_CREDITS, "Dream Collab — Concept");
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[dream-collab] OpenAI rate limit / quota");
      res.status(503).json({ error: "The dream collab is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[dream-collab] concept generation failed");
    res.status(502).json({ error: "The dream collab hiccupped — your Visual Bucs were refunded." });
  }
});

export default router;
