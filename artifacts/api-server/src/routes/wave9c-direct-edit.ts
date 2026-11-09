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

/* ─── Wave 9C — Voice-Directed Edits ──────────────────────────────────────────
   A natural-language edit director: the creator types (or speaks) a command
   like "make the chorus hit harder", "cut the pauses", or "trim the first
   5 seconds". The model reads a compact timeline summary the client sends
   and returns a PLANNED list of edit operations — nothing is applied on the
   server. The client shows "Here's what I'll change:" with per-op confirm
   toggles, and only the confirmed ops run client-side. Never applies blindly.

   The op vocabulary is FIXED and zod-validated server-side; anything outside
   it is rejected with a 502 + full refund. Every param references the
   timeline the client sent (scene ids, seconds), so ops can't hallucinate
   clips that don't exist.

   Endpoints (router mounted at /api — coordinator wires routes/index.ts):
     POST /wave9c/direct/edit   150 VB — planned op list for one command

   Credit discipline (standing): AI availability check BEFORE charging →
   charge BEFORE the model call → refund on ANY failure. No charge without
   delivery, ever. */

const router = Router();

const DIRECT_EDIT_CREDITS = 150;

const REPLAY_NOTE =
  "This is the edit plan you already made for this request — tweak the command or timeline for a fresh one.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetWave9cReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}

/* ── Fixed op vocabulary ─────────────────────────────────────────────────
   split        — cut one clip into two at an absolute timeline second
   trim         — trim seconds off a clip's start and/or end (edit-plan style)
   delete-range — remove everything (clips) overlapping a time range
   add-marker   — drop a chapter/marker at a time with a short title
   move-clip    — reorder: move a clip to a new timeline index
   set-volume   — set a clip's audio volume 0–100                                  */

const sceneRefSchema = z.string().trim().min(1).max(120);

const splitOpSchema = z.object({
  op: z.literal("split"),
  sceneId: sceneRefSchema,
  atSec: z.number().finite().min(0).max(24 * 3600),
  reason: z.string().trim().min(1).max(200),
});

const trimOpSchema = z.object({
  op: z.literal("trim"),
  sceneId: sceneRefSchema,
  trimStart: z.number().finite().min(0).max(3600).optional().default(0),
  trimEnd: z.number().finite().min(0).max(3600).optional().default(0),
  reason: z.string().trim().min(1).max(200),
});

const deleteRangeOpSchema = z.object({
  op: z.literal("delete-range"),
  startSec: z.number().finite().min(0).max(24 * 3600),
  endSec: z.number().finite().min(0).max(24 * 3600),
  reason: z.string().trim().min(1).max(200),
});

const addMarkerOpSchema = z.object({
  op: z.literal("add-marker"),
  title: z.string().trim().min(1).max(80),
  atSec: z.number().finite().min(0).max(24 * 3600),
  durationSec: z.number().finite().min(1).max(600).optional().default(5),
  reason: z.string().trim().min(1).max(200),
});

const moveClipOpSchema = z.object({
  op: z.literal("move-clip"),
  sceneId: sceneRefSchema,
  toIndex: z.number().int().min(0).max(10000),
  reason: z.string().trim().min(1).max(200),
});

const setVolumeOpSchema = z.object({
  op: z.literal("set-volume"),
  sceneId: sceneRefSchema,
  volume: z.number().int().min(0).max(100),
  reason: z.string().trim().min(1).max(200),
});

const editOpSchema = z.discriminatedUnion("op", [
  splitOpSchema,
  trimOpSchema,
  deleteRangeOpSchema,
  addMarkerOpSchema,
  moveClipOpSchema,
  setVolumeOpSchema,
]);

const directEditResponseSchema = z.object({
  planSummary: z.string().trim().min(1).max(400),
  ops: z.array(editOpSchema).min(1).max(8),
});

export type DirectEditPlan = z.infer<typeof directEditResponseSchema>;

/* ── Request ──────────────────────────────────────────────────────────────── */

const timelineClipSchema = z.object({
  id: sceneRefSchema,
  index: z.number().int().min(0),
  section: z.string().trim().max(60).optional().default(""),
  startSec: z.number().finite().min(0).max(24 * 3600),
  endSec: z.number().finite().min(0).max(24 * 3600),
  volume: z.number().int().min(0).max(100).optional().default(100),
});

const directEditRequestSchema = z.object({
  command: z.string().trim().min(2).max(500),
  timeline: z.array(timelineClipSchema).min(1).max(200),
  totalDurationSec: z.number().finite().min(0).max(24 * 3600).optional().default(0),
  projectTitle: z.string().trim().max(200).optional().default(""),
});

async function runDirectEdit(
  userId: string,
  data: z.infer<typeof directEditRequestSchema>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  /* Charge BEFORE the model call, under the CA-KEY idempotency key. */
  let remaining: number;
  try {
    remaining = await chargeCredits(userId, DIRECT_EDIT_CREDITS, {
      action: "Voice-Directed Edits",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        __status: 402,
        error: "out_of_credits",
        message: "Not enough Visual Bucs — top up to use Voice-Directed Edits.",
      };
    }
    throw err;
  }

  const { command, timeline, totalDurationSec, projectTitle } = data;
  const knownIds = new Set(timeline.map((c) => c.id));

  const timelineBlock = timeline
    .map(
      (c) =>
        `#${c.index} id="${c.id}" ${c.section ? `section="${c.section}" ` : ""}` +
        `start=${c.startSec.toFixed(1)}s end=${c.endSec.toFixed(1)}s volume=${c.volume}`
    )
    .join("\n");

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            "You are the edit director inside Bow Down Visuals — the cheat code for content " +
            "creators. The creator gives a plain-language edit command (e.g. \"make the chorus hit " +
            "harder\", \"cut the pauses\", \"trim the first 5 seconds\"). You read their timeline " +
            "and translate the command into a small, safe list of edit operations.\n\n" +
            "You may ONLY use these six operations, exactly as shaped below. Inventing any other " +
            "operation, any other field name, or any scene id not listed in the timeline is " +
            "FORBIDDEN and the response will be rejected:\n" +
            '- { "op": "split", "sceneId": "<id>", "atSec": <absolute timeline second>, "reason": "<why>" }\n' +
            '- { "op": "trim", "sceneId": "<id>", "trimStart": <sec from clip start, default 0>, ' +
            '"trimEnd": <sec from clip end, default 0>, "reason": "<why>" }\n' +
            '- { "op": "delete-range", "startSec": <absolute sec>, "endSec": <absolute sec>, "reason": "<why>" }\n' +
            '- { "op": "add-marker", "title": "<short label>", "atSec": <absolute sec>, ' +
            '"durationSec": <default 5>, "reason": "<why>" }\n' +
            '- { "op": "move-clip", "sceneId": "<id>", "toIndex": <new timeline position>, "reason": "<why>" }\n' +
            '- { "op": "set-volume", "sceneId": "<id>", "volume": <0-100>, "reason": "<why>" }\n\n' +
            "Rules:\n" +
            "• atSec for split must lie strictly INSIDE the clip's start/end (not on the edges).\n" +
            "• trim amounts must be smaller than the clip's own duration.\n" +
            "• delete-range: use only when the command clearly asks to remove a section; prefer " +
            "trim when the cut is at a clip edge.\n" +
            "• Every op needs a plain-language \"reason\" — the creator reads it before approving.\n" +
            "• 1 to 8 ops, most commands need 1 to 3. planSummary is one sentence of what changed.\n" +
            "• If the command is vague or impossible (e.g. references something not in the timeline), " +
            "return the SMALLEST reasonable interpretation and say so in the reasons — never " +
            "invent clips, sections, or timestamps.\n" +
            "• Return ONLY valid JSON: { \"planSummary\": \"<one sentence>\", \"ops\": [ ... ] }. " +
            "No markdown, no commentary.",
        },
        {
          role: "user",
          content:
            (projectTitle ? `Project: "${projectTitle}"\n` : "") +
            `Total timeline duration: ${totalDurationSec.toFixed(1)}s\n\n` +
            `Timeline (indices are current order):\n${timelineBlock}\n\n` +
            `Edit command: "${command}"\n\n` +
            "Return the edit plan JSON.",
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1200,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let plan: DirectEditPlan;
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      plan = directEditResponseSchema.parse(json);
    } catch {
      throw new Error("Model returned an unusable edit plan");
    }

    /* Server-side sanity: ops must reference real clips and sane seconds. */
    for (const op of plan.ops) {
      if ("sceneId" in op && !knownIds.has(op.sceneId)) {
        throw new Error(`Model referenced an unknown clip id: ${op.sceneId}`);
      }
      if (op.op === "delete-range" && op.endSec <= op.startSec) {
        throw new Error("Model returned an empty delete-range");
      }
      if (op.op === "trim" && op.trimStart === 0 && op.trimEnd === 0) {
        throw new Error("Model returned a no-op trim");
      }
    }

    return {
      ...plan,
      creditsUsed: DIRECT_EDIT_CREDITS,
      creditsRemaining: remaining,
    };
  } catch (err) {
    /* Refund on ANY failure — no charge without delivery. When the
       refund lands, VOID the charge's idempotency key so the retry
       charges fresh instead of being suppressed as a replay. */
    logger.error({ err, userId }, "[wave9c-direct-edit] plan failed — refunding");
    let refunded = true;
    try {
      await refundCredits(userId, DIRECT_EDIT_CREDITS, {
        action: "Voice-Directed Edits — Refund",
      });
    } catch (refundErr) {
      refunded = false;
      logger.error(
        { userId, refundErr },
        "[wave9c-direct-edit] CRITICAL: refund failed after plan failure"
      );
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey).catch(() => false);
    }
    return {
      __status: 500,
      error: "Voice-Directed Edits hiccupped — your Visual Bucs were refunded.",
      refunded: true,
    };
  }
}

/* ── POST /wave9c/direct/edit — 150 VB ─────────────────────────────────────── */
router.post("/wave9c/direct/edit", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = directEditRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid edit command.",
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
        ? "OPENAI_API_KEY is not configured — Voice-Directed Edits is unavailable."
        : "Voice-Directed Edits is unavailable right now.",
    });
    return;
  }

  /* CA-KEY: the server derives the key itself on EVERY call — this
     schema accepts no client idempotencyKey, so the key is the
     {command, timeline, totalDurationSec, projectTitle} intent hash.
     An identical ask can never be re-bought: a replay serves the
     stored plan with replayed: true and REPLAY_NOTE instead of
     charging again. */
  const idempotencyKey = buildChargeIdempotencyKey(
    "wave9c-direct-edit", req.userId!, undefined,
    {
      command: parsed.data.command,
      timeline: parsed.data.timeline,
      totalDurationSec: parsed.data.totalDurationSec,
      projectTitle: parsed.data.projectTitle,
    },
  );

  /* Stored-result pre-check (migration 0333) BEFORE any funding:
     durable first, then the in-process cache, then an in-flight twin. */
  const durable = await findStoredGenerationResult("wave9c-direct-edit", idempotencyKey, req.userId!);
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

  const run = runDirectEdit(req.userId!, parsed.data, idempotencyKey);
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

  /* Store BEFORE answering, fail-open. */
  try {
    if (storedResults.size >= MAX_STORED_RESULTS) {
      const oldest = storedResults.keys().next().value as string | undefined;
      if (oldest !== undefined) storedResults.delete(oldest);
    }
    storedResults.set(idempotencyKey, { body, at: Date.now() });
    await storeGenerationResult("wave9c-direct-edit", idempotencyKey, req.userId!, { ...body });
  } catch { /* storing is best-effort */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json({ ...postCharge.body, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  res.json(body);
});

export default router;
