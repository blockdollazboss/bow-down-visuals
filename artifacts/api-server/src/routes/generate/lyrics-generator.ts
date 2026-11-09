import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import {
  chargeCredits, refundCredits, OutOfCreditsError,
  buildChargeIdempotencyKey, voidChargeIdempotencyKey,
} from "../../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";

const router = Router();

/* ─── AI lyrics generator (Suno parity) ───
   Generates full song lyrics from a theme/prompt. 100 Visual Bucs. */

const LYRICS_COST = Number(process.env["LYRICS_GENERATOR_CREDITS"]) || 100;

const lyricsSchema = z.object({
  theme: z.string().trim().min(3).max(500),
  genre: z.string().trim().max(60).optional().default(""),
  mood: z.string().trim().max(60).optional().default(""),
  /** verse-chorus, AABA, etc. */
  structure: z.string().trim().max(60).optional().default("verse-chorus"),
  /** Explicit content filter */
  explicit: z.boolean().optional().default(false),
});

const STRUCTURES: Record<string, string> = {
  "verse-chorus": "Verse 1, Chorus, Verse 2, Chorus, Bridge, Final Chorus",
  "AABA": "A section, A section, B section (bridge), A section",
  "verse-only": "Three verses, no chorus",
  "edm": "Intro, Build, Drop, Breakdown, Build, Drop, Outro",
};

/* ── CA-3 replay protection (charge audit C-38) ───────────────────────
   This rail used to charge with NO idempotency key: a retry of a
   SUCCESSFUL request (client timeout, double-tap) re-charged 100 and
   re-ran the model. Now the server derives the key from the request
   intent on EVERY call, a stored-result pre-check (durable table,
   migration 0333, then the in-process cache) answers a replay with
   no charge and no provider call, and a failed attempt refunds AND
   voids its key so a genuine retry charges fresh. The intent-hash
   trade-off is the C-36 ruling's: an identical ask serves the stored
   lyrics with replayed: true instead of charging again. */
const LYRICS_SCOPE = "lyrics-generator";
const LYRICS_REPLAY_NOTE =
  "These are the lyrics you already made for this request — tweak the theme, genre or mood for a fresh set.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetLyricsGeneratorReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}

/**
 * Serve one replayable run: durable + in-process stored-result
 * pre-checks before any funding, the in-flight twin wait for a
 * concurrent duplicate, then the run itself. A success is stored
 * BEFORE answering (contracts / post-assist pattern); an error body
 * (carrying __status) is answered bare and never stored.
 */
async function serveReplayableRun(args: {
  res: Response;
  userId: string;
  idempotencyKey: string;
  run: () => Promise<Record<string, unknown>>;
}): Promise<void> {
  const { res, userId, idempotencyKey } = args;
  const replayOf = (body: Record<string, unknown>) => ({
    ...body, replayed: true, replayNote: LYRICS_REPLAY_NOTE,
  });

  const durable = await findStoredGenerationResult(LYRICS_SCOPE, idempotencyKey, userId);
  if (durable) {
    res.json(replayOf(durable));
    return;
  }
  const stored = storedResults.get(idempotencyKey);
  if (stored) {
    res.json(replayOf(stored.body));
    return;
  }
  const pending = inFlight.get(idempotencyKey);
  if (pending) {
    const twinBody = await pending.catch(() => null);
    if (twinBody && typeof twinBody["__status"] !== "number") {
      res.json(replayOf(twinBody));
      return;
    }
    /* The twin failed (refunded + key voided) — fall through fresh. */
  }

  const runPromise = args.run();
  inFlight.set(idempotencyKey, runPromise);
  let body: Record<string, unknown>;
  try {
    body = await runPromise;
  } finally {
    if (inFlight.get(idempotencyKey) === runPromise) inFlight.delete(idempotencyKey);
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
    await storeGenerationResult(LYRICS_SCOPE, idempotencyKey, userId, { ...body });
  } catch { /* storing is best-effort — never fail a paid success over it */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json(replayOf(postCharge.body));
    return;
  }
  res.json(body);
}

async function runLyricsGeneration(
  userId: string,
  userCredits: number,
  data: z.infer<typeof lyricsSchema>,
  idempotencyKey: string,
  log: { error: (obj: object, msg: string) => void },
): Promise<Record<string, unknown>> {
  if (userCredits < LYRICS_COST) {
    return {
      __status: 402,
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    };
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(userId, LYRICS_COST, {
      action: "AI Lyrics Generator",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return { __status: 402, error: "out_of_credits", message: "Not enough Visual Bucs." };
    }
    throw err;
  }

  try {
    const { theme, genre, mood, structure, explicit } = data;
    const structureDesc = STRUCTURES[structure] ?? STRUCTURES["verse-chorus"];

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content: `You are a professional songwriter. Write complete, original song lyrics. ${explicit ? "" : "Keep it clean — no profanity, no explicit content."} Use vivid imagery, strong rhymes, and memorable hooks. Format with clear section headers like [Verse 1], [Chorus], etc.`,
        },
        {
          role: "user",
          content: `Write song lyrics about: "${theme}"${genre ? `\nGenre: ${genre}` : ""}${mood ? `\nMood: ${mood}` : ""}\nStructure: ${structureDesc}\n\nMake the chorus catchy and repeatable. Keep verses distinct from each other.`,
        },
      ],
      max_completion_tokens: 2000,
    });

    const lyrics = completion.choices[0]?.message?.content?.trim();
    if (!lyrics) throw new Error("Lyrics generation returned empty.");

    return {
      lyrics,
      creditsRemaining: creditsAfter,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lyrics generation failed.";
    log.error({ err: message }, "[generate-lyrics] failed");
    /* Refund + VOID: without the void, the refunded attempt's key
       still reads as "already charged", so the retry would be
       suppressed as a replay and generate FREE. The void claim only
       runs when the refund actually landed. */
    let refunded = true;
    try {
      await refundCredits(userId, LYRICS_COST, {
        action: "AI Lyrics Generator — Refund",
      });
    } catch {
      refunded = false;
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }
    return { __status: 500, error: message };
  }
}

router.post("/generate-lyrics", requireAuth, async (req, res) => {
  const parsed = lyricsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  /* Idempotency (CA-3): the server derives the key from the request
     intent on EVERY call — a replay of the same ask is served from
     the stored result instead of charging again. */
  const idempotencyKey = buildChargeIdempotencyKey(
    LYRICS_SCOPE, req.userId!, undefined,
    {
      theme: parsed.data.theme, genre: parsed.data.genre, mood: parsed.data.mood,
      structure: parsed.data.structure, explicit: parsed.data.explicit,
    },
  );

  await serveReplayableRun({
    res,
    userId: req.userId!,
    idempotencyKey,
    run: () => runLyricsGeneration(
      req.userId!, req.userCredits ?? 0, parsed.data, idempotencyKey, req.log,
    ),
  });
});

export default router;
