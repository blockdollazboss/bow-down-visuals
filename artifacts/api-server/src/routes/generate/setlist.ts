import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

/* ─── Setlist Builder — AI flow suggestions ──────────────────────────────────
   The builder itself (add songs, reorder, timing) is pure UI and free —
   per the standing pricing rule, interface costs nothing. Only the AI setlist
   flow suggestion burns compute, so only it charges credits: 1 per suggestion.
   Charged BEFORE the model call, refunded on any failure. */

/* 1 credit per AI flow suggestion — env-overridable without a deploy. */
export const SETLIST_FLOW_CREDIT_COST = Number(process.env["SETLIST_FLOW_CREDIT_COST"]) || 1;

export const MAX_SETLIST_SONGS = 40;

const setlistSongSchema = z.object({
  title: z.string().min(1, "Song title is required.").max(200),
  artist: z.string().max(200).optional().default(""),
  /* Planned performance duration in seconds. 0/unknown = AI estimates pacing only. */
  durationSec: z.number().int().min(0).max(3600).optional().default(0),
  /* Energy 1 (slow/ballad) → 5 (peak banger). 0 = unknown. */
  energy: z.number().int().min(0).max(5).optional().default(0),
});

export type SetlistSongInput = z.infer<typeof setlistSongSchema>;

const setlistFlowSchema = z.object({
  songs: z.array(setlistSongSchema).min(1, "Add at least one song.").max(MAX_SETLIST_SONGS),
  showNotes: z.string().max(500).optional().default(""),
});

export interface SetlistSlot {
  /** Index into the submitted songs array. */
  index: number;
  /** Where this song sits in the arc: opener | build | peak | breather | closer | encore */
  slot: string;
  /** One-line stage note for this placement. */
  note: string;
}

export interface SetlistFlow {
  order: SetlistSlot[];
  flowNotes: string;
}

const VALID_SLOTS = ["opener", "build", "peak", "breather", "closer", "encore"] as const;

function cleanStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/* Build the prompt — pure function so tests can assert the song data is woven in. */
export function buildSetlistFlowPrompt(songs: SetlistSongInput[], showNotes: string): string {
  const lines = songs.map((s, i) => {
    const bits: string[] = [`${i + 1}. "${s.title}"`];
    if (s.artist.trim()) bits.push(`by ${s.artist.trim()}`);
    if (s.durationSec > 0) {
      const m = Math.floor(s.durationSec / 60);
      const sec = String(s.durationSec % 60).padStart(2, "0");
      bits.push(`${m}:${sec}`);
    }
    if (s.energy >= 1) bits.push(`energy ${s.energy}/5`);
    return bits.join(" — ");
  });
  const notesLine = showNotes.trim() ? `\nShow context: "${showNotes.trim()}"\n` : "";
  return (
    `You are a veteran live-show director for independent music artists. ` +
    `Order these ${songs.length} songs into a show-stopping live setlist with a real energy arc: ` +
    `a confident opener, a rising build, well-placed peak moments, a breather before the finale, ` +
    `an undeniable closer, and an optional encore pick.\n` +
    `${notesLine}\nSongs:\n${lines.join("\n")}\n\n` +
    `Rules: every input song appears exactly once in "order". Slot must be one of: ` +
    `opener, build, peak, breather, closer, encore. Give the encore slot to at most 2 songs ` +
    `(the strongest unplayed-feeling closers). Each note is one punchy stage-direction line ` +
    `(max 25 words): why this placement works, a transition idea, or a crowd-work cue.\n` +
    `Return ONLY JSON: {"order": [{"index": <0-based song index>, "slot": "<slot>", "note": "<...>"}], ` +
    `"flowNotes": "<3-5 sentences on the overall arc, pacing, and one thing to watch out for>"}.`
  );
}

/* Parse + validate the model's JSON. Throws when unusable — caller refunds. */
export function parseSetlistFlow(raw: string, songCount: number): SetlistFlow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Model returned invalid JSON");
  }
  const root = parsed as { order?: unknown; flowNotes?: unknown };
  const flowNotes = cleanStr(root.flowNotes, 1200);
  const items: unknown[] = Array.isArray(root.order) ? root.order : [];
  const order: SetlistSlot[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    const o = item as { index?: unknown; slot?: unknown; note?: unknown };
    const index = typeof o.index === "number" ? Math.floor(o.index) : -1;
    const slot = cleanStr(o.slot, 20).toLowerCase();
    const note = cleanStr(o.note, 200);
    if (index < 0 || index >= songCount || seen.has(index)) continue;
    if (!(VALID_SLOTS as readonly string[]).includes(slot)) continue;
    if (!note) continue;
    seen.add(index);
    order.push({ index, slot, note });
  }
  if (order.length === 0 || !flowNotes) {
    throw new Error("Model returned no usable setlist flow");
  }
  /* Every song must appear exactly once — if the model dropped any, fail loudly
     instead of silently losing songs from the setlist. */
  if (order.length !== songCount) {
    throw new Error(`Model ordered ${order.length} of ${songCount} songs`);
  }
  return { order, flowNotes };
}

const router = Router();

/* POST /api/setlist/flow → 200 { order, flowNotes, creditsUsed, creditsRemaining }
   Paid: 1 credit per suggestion. Auth required; 402 when broke; refund on failure. */
router.post("/setlist/flow", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = setlistFlowSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid setlist request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { songs, showNotes } = parsed.data;

  const balance = req.userCredits ?? 0;
  if (balance < SETLIST_FLOW_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to get an AI setlist flow.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, SETLIST_FLOW_CREDIT_COST, {
      action: "AI Setlist Flow",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to get an AI setlist flow.",
      });
      return;
    }
    throw err;
  }

  async function refund() {
    try {
      await refundCredits(req.userId!, SETLIST_FLOW_CREDIT_COST, {
        action: "AI Setlist Flow — Refund (generation failed)",
      });
    } catch (refundErr) {
      void refundErr; // logged inside refundCredits; don't mask the original failure
    }
  }

  try {
    const prompt = buildSetlistFlowPrompt(songs, showNotes);
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            "You are a veteran live-show director for independent music artists. " +
            "You build setlists with real energy arcs — never random order, never filler transitions. " +
            "Return ONLY the requested JSON.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let flow: SetlistFlow;
    try {
      flow = parseSetlistFlow(raw, songs.length);
    } catch {
      await refund();
      logger.warn("[setlist] model returned unusable flow — refunded");
      res.status(502).json({ error: "The AI fumbled the setlist — credit refunded, try again." });
      return;
    }

    res.json({
      order: flow.order,
      flowNotes: flow.flowNotes,
      creditsUsed: SETLIST_FLOW_CREDIT_COST,
      creditsRemaining,
    });
  } catch (err) {
    await refund();
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[setlist] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[setlist] flow generation failed");
    res.status(502).json({ error: "The studio hiccupped — credit refunded, try again." });
  }
});

export default router;
