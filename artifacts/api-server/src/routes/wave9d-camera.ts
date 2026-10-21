import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";
import {
  CAMERA_CATEGORIES,
  CAMERA_INTENSITIES,
  CAMERA_PRESETS,
  INTENSITY_DIRECTION,
  LEGACY_MOVE_IDS,
  MAX_STACK,
  STACK_RULE_TEXT,
  buildStackBlock,
  conflictsWith,
  resolveCameraStack,
  sanitizeDesignerStack,
  type CameraIntensity,
  type ResolvedCameraEntry,
} from "../lib/camera-deck";

/* ─── Wave 9D — Camera Move Planner + Director's Camera Deck ───────────────
   PURE PROMPT ENRICHMENT over the existing Scene Studio generation pipeline.
   Pick camera moves from the deck (lib/camera-deck.ts) — one move, or a
   stack of up to 3 — and the text model weaves them into an image-to-video
   prompt, which is PREVIEWED before anything is generated. The creator then
   injects it into the existing Scene Studio prompt field.
   NO generation happens here. NO new video model is added or used.

   Endpoints (router mounted at /api — coordinator wires routes/index.ts):
     GET  /wave9d/camera/presets   free  — the deck (47 named presets,
                                          categories, conflict map, rules)
     POST /wave9d/camera/prompt    100 VB — enriched prompt (previewed)
     POST /wave9d/camera/design    free  — Turbo Shot Designer: AI proposes
                                          a move stack + one-line reasons;
                                          a proposal only, never applied

   Credit discipline (standing): AI availability check BEFORE charging →
   charge BEFORE the model call → refund on ANY failure. No charge without
   delivery, ever. The Designer charges nothing: the 100 VB lands only when
   the creator builds a prompt, exactly as the planner always worked.

   Legacy contract: the original request shape ({ move, intensity }) — and
   a single legacy move sent through the stack shape — builds the model
   input BYTE-IDENTICALLY to the pre-deck route (pinned by tests). */

const router = Router();

const CAMERA_PROMPT_CREDITS = 100;

const moveSchema = z.enum(LEGACY_MOVE_IDS);
const intensitySchema = z.enum(CAMERA_INTENSITIES);

const stackEntrySchema = z.object({
  preset: z.string().trim().min(1).max(60),
  intensity: intensitySchema.optional(),
});

const cameraPromptRequestSchema = z.object({
  move: moveSchema.optional(),
  moves: z.array(stackEntrySchema).min(1).max(MAX_STACK).optional(),
  intensity: intensitySchema.optional().default("natural"),
  basePrompt: z.string().trim().min(1).max(2000),
  sceneContext: z.string().trim().max(500).optional().default(""),
});

const SYSTEM_PROMPT =
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
  "Return ONLY the enriched prompt text, nothing else.";

const STACK_SYSTEM_ADDENDUM =
  "\n\nThis request carries a CAMERA STACK: several moves numbered in performance " +
  "order. Weave them as ONE continuous camera path — the shot begins with the first " +
  "move and blends into each next move without cuts or resets, so the whole clip " +
  "reads as a single choreographed camera journey.";

/* ─── GET /wave9d/camera/presets — free ─── */
router.get("/wave9d/camera/presets", publicApiLimiter, requireAuth, (_req, res) => {
  res.json({
    presets: CAMERA_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      blurb: p.blurb,
      locked: p.locked ?? false,
      conflictsWith: conflictsWith(p.id),
    })),
    categories: CAMERA_CATEGORIES,
    intensities: CAMERA_INTENSITIES,
    maxStack: MAX_STACK,
    stackRule: STACK_RULE_TEXT,
    buildCredits: CAMERA_PROMPT_CREDITS,
  });
});

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
  const { move, moves, intensity, basePrompt, sceneContext } = parsed.data;

  if (move && moves) {
    res.status(400).json({
      error: "Send either a single move or a stack of moves, not both.",
    });
    return;
  }

  /* Resolve + validate the stack BEFORE charging — conflicts and unknown
     moves are refused here, never charged for. */
  const resolution = resolveCameraStack(
    move ? [{ preset: move }] : (moves ?? []).map((m) => ({ preset: m.preset, intensity: m.intensity ?? null })),
  );
  if (!resolution.ok) {
    res.status(400).json({ error: resolution.error });
    return;
  }
  const entries: ResolvedCameraEntry[] = resolution.entries;
  const stacked = entries.length > 1;
  /* Byte-stability: a single legacy move with no per-move override takes
     the exact legacy message shape. (The block composer below produces it;
     the flag documents the contract the tests pin.) */
  const single = entries.length === 1 ? entries[0] : null;
  const effectiveIntensity: CameraIntensity = single
    ? (single.intensity ?? intensity)
    : intensity;

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

  try {
    const cameraBlock = stacked
      ? buildStackBlock(entries, intensity)
      : `Camera move: ${single!.preset.direction}\nIntensity: ${INTENSITY_DIRECTION[effectiveIntensity]}`;
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content: stacked ? SYSTEM_PROMPT + STACK_SYSTEM_ADDENDUM : SYSTEM_PROMPT,
        },
        {
          role: "user",
          content:
            `${cameraBlock}\n` +
            (sceneContext ? `Scene context: ${sceneContext}\n` : "") +
            `Base prompt:\n${basePrompt}\n\n` +
            (stacked
              ? "Enrich the base prompt with the camera stack."
              : "Enrich the base prompt with the camera move."),
        },
      ],
      max_completion_tokens: 400,
      temperature: 0.6,
    });

    const enrichedPrompt = (completion.choices[0]?.message?.content ?? "").trim();
    if (!enrichedPrompt) throw new Error("Model returned an empty camera prompt");

    res.json({
      enrichedPrompt,
      move: entries[0].preset.id,
      moves: entries.map((e) => ({
        preset: e.preset.id,
        name: e.preset.name,
        intensity: e.intensity ?? intensity,
      })),
      stacked,
      intensity: effectiveIntensity,
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

/* ─── POST /wave9d/camera/design — free (Turbo Shot Designer) ──────────────
   The AI reads the scene and PROPOSES a move stack — preset ids, an
   intensity per move, and a one-line reason each — for the creator to
   accept or edit in the planner. It applies nothing and charges nothing:
   the proposal is data until the creator loads it into their stack and
   builds (the existing 100 VB weave). Proposals that break the deck's
   rules are adjusted openly via sanitizeDesignerStack's notes. */

const designRequestSchema = z.object({
  basePrompt: z.string().trim().min(1).max(2000),
  sceneContext: z.string().trim().max(500).optional().default(""),
});

const designResponseSchema = z.object({
  stack: z
    .array(
      z.object({
        preset: z.string().trim().min(1).max(60),
        intensity: intensitySchema.optional(),
        reason: z.string().trim().max(300).optional().default(""),
      }),
    )
    .min(1)
    .max(6),
  summary: z.string().trim().max(300).optional().default(""),
});

router.post("/wave9d/camera/design", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = designRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid shot design request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  try {
    getOpenAI();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      error: "ai_unavailable",
      message: msg.includes("OPENAI_API_KEY")
        ? "OPENAI_API_KEY is not configured — the Shot Designer is unavailable."
        : "The Shot Designer is unavailable right now.",
    });
    return;
  }

  const { basePrompt, sceneContext } = parsed.data;
  const deckList = CAMERA_PRESETS.map((p) => `- ${p.id}: ${p.name} — ${p.blurb}`).join("\n");

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            "You are the Turbo Shot Designer for Bow Down Visuals — a director of " +
            "photography who reads a scene and chooses the camera moves for it. " +
            "You PROPOSE a stack of 1 to 3 camera moves from the deck below; the " +
            "creator reviews and approves — you never apply anything.\n\n" +
            "Rules:\n" +
            "- Choose ONLY preset ids from the deck list, spelled exactly.\n" +
            "- Never pair moves that move the camera in opposite directions " +
            "  (in vs out, up vs down, left vs right, zoom in vs zoom out).\n" +
            "- A static move (static-wide, static-close) always stands alone.\n" +
            "- Order matters: the stack performs in the order you list it, as one " +
            "  continuous camera path. Open on the move that serves the scene's " +
            "  first beat.\n" +
            "- Give each move an intensity (subtle, natural, or dramatic) and a " +
            "  reason of ONE short line in plain creator language — why THIS move " +
            "  serves THIS scene. No jargon walls.\n" +
            "- Add a one-line summary of the shot's journey.\n" +
            "Return ONLY JSON, no markdown, in this exact shape:\n" +
            '{"stack":[{"preset":"dolly-in","intensity":"natural","reason":"..."}],' +
            '"summary":"..."}\n\n' +
            `THE DECK:\n${deckList}`,
        },
        {
          role: "user",
          content:
            (sceneContext ? `Scene context: ${sceneContext}\n` : "") +
            `Scene prompt:\n${basePrompt}\n\n` +
            "Propose the camera stack for this scene.",
        },
      ],
      max_completion_tokens: 700,
      temperature: 0.7,
    });

    const rawText = (completion.choices[0]?.message?.content ?? "").trim();
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(jsonText);
    } catch {
      throw new Error("Shot Designer returned an unparseable proposal");
    }
    const design = designResponseSchema.safeParse(rawJson);
    if (!design.success) throw new Error("Shot Designer returned a malformed proposal");

    const reasons = new Map(
      design.data.stack.map((s) => [s.preset, (s.reason ?? "").slice(0, 160)]),
    );
    const { entries, notes } = sanitizeDesignerStack(
      design.data.stack.map((s) => ({ preset: s.preset, intensity: s.intensity ?? null })),
    );
    if (entries.length === 0) throw new Error("Shot Designer proposed no usable moves");

    res.json({
      proposal: {
        moves: entries.map((e) => ({
          preset: e.preset.id,
          name: e.preset.name,
          intensity: e.intensity ?? "natural",
          reason: reasons.get(e.preset.id) ?? "",
        })),
        summary: design.data.summary ?? "",
      },
      adjusted: notes.length > 0,
      notes,
      creditsUsed: 0,
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[wave9d-camera] shot designer failed");
    res.status(502).json({
      error: "The Shot Designer couldn't read this scene — nothing was charged.",
    });
  }
});

export default router;
