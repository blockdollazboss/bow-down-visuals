import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, buildChargeIdempotencyKey, voidChargeIdempotencyKey } from "../lib/credits";
import { findStoredGenerationResult, storeGenerationResult } from "../lib/generation-stored-results";

/* ─── Wave 8 — AI Ad-Lib Generator ─────────────────────────────────────────
   A vocal-production sidekick: feed it your lyrics (or just a song title +
   the artist's voice/personality from the vault), pick an energy, and it
   writes placement-mapped ad-libs, vocal stack recipes, and two contrasting
   takes (A/B) so the creator can audition directions before tracking.

   Endpoints (router mounted at /api — coordinator wires routes/index.ts):
     POST /wave8/adlib/generate   150 VB — full ad-lib pack (JSON, two takes)

   Credit discipline (standing): AI availability check BEFORE charging →
   charge BEFORE the model call → refund on ANY failure. No charge without
   delivery, ever. */

const router = Router();

const ADLIB_CREDITS = 150;

const REPLAY_NOTE =
  "These are the ad-libs you already made for this request — tweak the words for a fresh set.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetWave8AdlibReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}

const energySchema = z.enum(["chill", "hype", "dark"]);

const adlibRequestSchema = z.object({
  lyrics: z.string().trim().max(5000).optional().default(""),
  songTitle: z.string().trim().max(200).optional().default(""),
  vaultVoice: z.string().trim().max(800).optional().default(""),
  energy: energySchema.optional().default("hype"),
});

const adlibItemSchema = z.object({
  line: z.string().trim().min(1).max(120),
  placement: z.string().trim().min(1).max(120),
  delivery: z.string().trim().min(1).max(200),
});

const stackSchema = z.object({
  description: z.string().trim().min(1).max(200),
  voices: z.string().trim().min(1).max(120),
});

const takeSchema = z.object({
  style: z.string().trim().min(1).max(120),
  notes: z.string().trim().min(1).max(600),
});

const adlibResponseSchema = z.object({
  adlibs: z.array(adlibItemSchema).min(4).max(12),
  stacks: z.array(stackSchema).min(1).max(4),
  takeA: takeSchema,
  takeB: takeSchema,
});

type AdlibResponse = z.infer<typeof adlibResponseSchema>;

const ENERGY_DIRECTION: Record<z.infer<typeof energySchema>, string> = {
  chill:
    "CHILL — laid-back, whisper-close, smoked-out. Soft runs, airy harmonies, reverb-forward. Nothing shouted.",
  hype:
    "HYPE — maximum energy. Shouted call-and-response ad-libs, rapid-fire doubles, pitch-risers, stadium chants.",
  dark:
    "DARK — brooding and cinematic. Low octave doubles, detuned whispers, sparse but menacing, wide stereo.",
};

async function runWave8Adlib(
  userId: string,
  parsedData: z.infer<typeof adlibRequestSchema>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  /* 2) Charge BEFORE the model call. */
  let remaining: number;
  try {
    remaining = await chargeCredits(userId, ADLIB_CREDITS, {
      action: "AI Ad-Lib Generator",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        __status: 402,
        error: "out_of_credits",
        message: "Not enough Visual Bucs — top up to generate ad-libs.",
      };
    }
    throw err;
  }

  const { lyrics, songTitle, vaultVoice, energy } = parsedData;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            "You are the vocal producer for Bow Down Visuals — the cheat code for content " +
            "creators. You write ad-libs like a platinum vocal producer: every ad-lib maps to " +
            "a specific PLACEMENT in the song (which bar / section / which lyric line it rides " +
            "under), and every one carries a DELIVERY tip (whisper it, stack it, chant it, " +
            "slide it). Keep ad-lib lines short and singable — 1 to 6 syllables of hype, never " +
            "full verses. You must return ONLY valid JSON with this exact shape:\n" +
            '{ "adlibs": [ { "line": "<the ad-lib>", "placement": "<where it sits>", ' +
            '"delivery": "<how to perform it>" } ], ' +
            '"stacks": [ { "description": "<layering recipe>", "voices": "<e.g. low octave + whispers>" } ], ' +
            '"takeA": { "style": "<one-line style>", "notes": "<2-3 sentence direction>" }, ' +
            '"takeB": { "style": "<one-line style>", "notes": "<2-3 sentence direction>" } }\n' +
            "Rules: 6 to 10 adlibs; 2 to 3 stacks; takeA and takeB must be CONTRASTING " +
            "directions (different energy, different stack philosophy) so the creator can A/B " +
            "them; no fields outside this shape; plain text, no markdown.",
        },
        {
          role: "user",
          content:
            `Energy brief: ${ENERGY_DIRECTION[energy]}\n` +
            (songTitle ? `Song title: "${songTitle}"\n` : "") +
            (vaultVoice ? `Artist voice/personality: ${vaultVoice}\n` : "") +
            (lyrics
              ? `Lyrics to place ad-libs against:\n${lyrics}\n`
              : "No lyrics provided — write ad-libs against a generic verse/hook/bridge structure.\n") +
            "Write the ad-lib pack.",
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1600,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let pack: AdlibResponse;
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      pack = adlibResponseSchema.parse(json);
    } catch {
      throw new Error("Model returned an unusable ad-lib pack");
    }

    return {
      ...pack,
      creditsUsed: ADLIB_CREDITS,
      creditsRemaining: remaining,
    };
  } catch (err) {
    /* 3) Refund on ANY failure — no charge without delivery. */
    logger.error({ err, userId }, "[wave8-adlib] generate failed — refunding");
    let refunded = true;
    try {
      await refundCredits(userId, ADLIB_CREDITS, {
        action: "AI Ad-Lib Generator — Refund",
      });
    } catch (refundErr) {
      refunded = false;
      logger.error(
        { userId, refundErr },
        "[wave8-adlib] CRITICAL: refund failed after generation failure"
      );
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }
    return {
      __status: 500,
      error: "The ad-lib studio hiccupped — your Visual Bucs were refunded.",
      refunded: true,
    };
  }
}

/* ─── POST /wave8/adlib/generate — 150 VB ─── */
router.post("/wave8/adlib/generate", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = adlibRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid ad-lib request.",
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
        ? "OPENAI_API_KEY is not configured — the AI Ad-Lib Generator is unavailable."
        : "The AI Ad-Lib Generator is unavailable right now.",
    });
    return;
  }

  const idempotencyKey = buildChargeIdempotencyKey(
    "wave8-adlib", req.userId!, undefined,
    { lyrics: parsed.data.lyrics, songTitle: parsed.data.songTitle, vaultVoice: parsed.data.vaultVoice, energy: parsed.data.energy },
  );

  const durable = await findStoredGenerationResult("wave8-adlib", idempotencyKey, req.userId!);
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

  const run = runWave8Adlib(req.userId!, parsed.data, idempotencyKey);
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
    await storeGenerationResult("wave8-adlib", idempotencyKey, req.userId!, { ...body });
  } catch { /* storing is best-effort */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json({ ...postCharge.body, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  res.json(body);
});

export default router;
