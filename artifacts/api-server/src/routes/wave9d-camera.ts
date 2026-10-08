import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";

/* ─── Wave 9D — Camera Move Planner ─────────────────────────────────────────
   PURE PROMPT ENRICHMENT over the existing Scene Studio generation pipeline.
   Pick a camera move + intensity; the text model weaves the move into an
   image-to-video prompt, which is PREVIEWED before anything is generated.
   The creator then injects it into the existing Scene Studio prompt field.
   NO generation happens here. NO new video model is added or used.

   Endpoint (router mounted at /api — coordinator wires routes/index.ts):
     POST /wave9d/camera/prompt   100 VB — enriched prompt (previewed, not generated)

   Credit discipline (standing): AI availability check BEFORE charging →
   charge BEFORE the model call → refund on ANY failure. No charge without
   delivery, ever. */

const router = Router();

const CAMERA_PROMPT_CREDITS = 100;

const moveSchema = z.enum(["dolly-in", "orbit", "crane-up", "handheld", "static-wide"]);
const intensitySchema = z.enum(["subtle", "natural", "dramatic"]);

const cameraPromptRequestSchema = z.object({
  move: moveSchema,
  intensity: intensitySchema.optional().default("natural"),
  basePrompt: z.string().trim().min(1).max(2000),
  sceneContext: z.string().trim().max(500).optional().default(""),
});

const MOVE_DIRECTION: Record<z.infer<typeof moveSchema>, string> = {
  "dolly-in": "DOLLY IN — the camera glides steadily toward the subject, closing distance with smooth, cinematic intent.",
  orbit: "ORBIT — the camera arcs in a slow circle around the subject, revealing them in three dimensions.",
  "crane-up": "CRANE UP — the camera rises and tilts down, swelling from intimate framing to an epic wide reveal.",
  handheld: "HANDHELD — intimate, imperfect, alive: subtle shake and drift like an operator's shoulder rig. Never nauseating.",
  "static-wide": "STATIC WIDE — the camera never moves. Locked-off master shot; all motion comes from the subject and the world.",
};

const INTENSITY_DIRECTION: Record<z.infer<typeof intensitySchema>, string> = {
  subtle: "SUBTLE — the camera movement is felt more than seen: gentle, restrained, tasteful.",
  natural: "NATURAL — confident, balanced camera motion that serves the scene without showboating.",
  dramatic: "DRAMATIC — bold, sweeping camera motion: maximum cinematic energy, make it a moment.",
};

/* ─── POST /wave9d/camera/prompt — 100 VB ─── */
router.post("/wave9d/camera/prompt", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = cameraPromptRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid camera prompt request.",
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
        ? "OPENAI_API_KEY is not configured — the Camera Move Planner is unavailable."
        : "The Camera Move Planner is unavailable right now.",
    });
    return;
  }

  /* 2) Charge BEFORE the model call. */
  let remaining: number;
  try {
    remaining = await chargeCredits(req.userId!, CAMERA_PROMPT_CREDITS, {
      action: "Camera Move Planner",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs — top up to build a camera prompt.",
      });
      return;
    }
    throw err;
  }

  const { move, intensity, basePrompt, sceneContext } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            "You are a cinematography prompt specialist for Bow Down Visuals. Your job is " +
            "to take an image-to-video prompt and weave a specific CAMERA MOVE into it so " +
            "the video model performs that camera motion. This is PROMPT ENRICHMENT only — " +
            "you never generate video.\n\n" +
            "Rules:\n" +
            "- Preserve the subject, action, lighting, and mood of the base prompt — " +
            "  enrich it, never replace it.\n" +
            "- Express the camera move with concrete video-model vocabulary " +
            "  (e.g. 'slow dolly push-in', 'smooth orbital arc', 'gentle rising crane').\n" +
            "- Match the requested INTENSITY — do not escalate a subtle move into a dramatic one.\n" +
            "- One paragraph, 60–150 words, present tense, comma-separated descriptive " +
            "  phrases. Plain text only, no markdown, no commentary.\n" +
            "Return ONLY the enriched prompt text, nothing else.",
        },
        {
          role: "user",
          content:
            `Camera move: ${MOVE_DIRECTION[move]}\n` +
            `Intensity: ${INTENSITY_DIRECTION[intensity]}\n` +
            (sceneContext ? `Scene context: ${sceneContext}\n` : "") +
            `Base prompt:\n${basePrompt}\n\n` +
            "Enrich the base prompt with the camera move.",
        },
      ],
      max_completion_tokens: 400,
      temperature: 0.6,
    });

    const enrichedPrompt = (completion.choices[0]?.message?.content ?? "").trim();
    if (!enrichedPrompt) throw new Error("Model returned an empty camera prompt");

    res.json({
      enrichedPrompt,
      move,
      intensity,
      creditsUsed: CAMERA_PROMPT_CREDITS,
      creditsRemaining: remaining,
    });
  } catch (err) {
    /* 3) Refund on ANY failure — no charge without delivery. */
    logger.error({ err, userId: req.userId }, "[wave9d-camera] prompt failed — refunding");
    try {
      await refundCredits(req.userId!, CAMERA_PROMPT_CREDITS, {
        action: "Camera Move Planner — Refund",
      });
    } catch (refundErr) {
      logger.error(
        { userId: req.userId, refundErr },
        "[wave9d-camera] CRITICAL: refund failed after prompt failure"
      );
    }
    res.status(500).json({
      error: "The camera planner hiccupped — your Visual Bucs were refunded.",
      refunded: true,
    });
  }
});

export default router;
