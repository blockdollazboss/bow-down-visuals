import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();

/* ─── Fan Decoder ──────────────────────────────────────────────────────────
   POST /api/fan-decoder/decode — 100 Visual Bucs.
   Paste 1-30 comments/DMs and GPT-6 Sol decodes what the audience actually
   wants next: ranked wants (each with supporting quotes from the input),
   concrete content directions, and tone notes. */

const DECODE_CREDITS =
  Number(process.env["FAN_DECODER_CREDITS"]) || 100;

const decodeSchema = z.object({
  comments: z
    .array(z.string().min(1).max(500))
    .min(1, "Add at least one comment.")
    .max(30, "Keep it to 30 comments at a time."),
  niche: z.string().max(120).optional().default(""),
});

interface AudienceWant {
  want: string;
  quotes: string[];
  priority: number; // 1 = strongest signal
}

interface DecodedJson {
  wants?: unknown;
  contentDirections?: unknown;
  toneNotes?: unknown;
}

function parseWants(raw: unknown): AudienceWant[] {
  if (!Array.isArray(raw)) return [];
  const out: AudienceWant[] = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    const e = w as Record<string, unknown>;
    const want = String(e["want"] ?? "").trim().slice(0, 300);
    if (!want) continue;
    const quotes = Array.isArray(e["quotes"])
      ? e["quotes"]
          .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
          .map((q) => q.trim().slice(0, 300))
          .slice(0, 4)
      : [];
    let priority = typeof e["priority"] === "number" ? Math.round(e["priority"]) : out.length + 1;
    if (typeof e["priority"] === "string") {
      const p = e["priority"].toLowerCase();
      priority = p.includes("high") ? 1 : p.includes("low") ? 5 : 3;
    }
    priority = Math.max(1, Math.min(5, priority));
    out.push({ want, quotes, priority });
    if (out.length >= 5) break;
  }
  return out.sort((a, b) => a.priority - b.priority);
}

function parseStringList(raw: unknown, max: number, len: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().slice(0, len))
    .slice(0, max);
}

/* POST /api/fan-decoder/decode { comments[1-30], niche? }
   → 200 { wants[{want, quotes[], priority}], contentDirections[], toneNotes, creditsUsed, creditsRemaining }
   Paid: 100 Visual Bucs. Refund on failure. */
router.post("/fan-decoder/decode", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = decodeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid decode request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < DECODE_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs — Fan Decoder costs 100 Visual Bucs.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, DECODE_CREDITS, {
      action: "Fan Decoder",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs — Fan Decoder costs 100 Visual Bucs.",
      });
      return;
    }
    throw err;
  }

  const refundAndFail = async (status: number, message: string) => {
    try {
      await refundCredits(req.userId!, DECODE_CREDITS, { action: "Fan Decoder — Refund" });
    } catch (refundErr) {
      logger.error({ err: refundErr, userId: req.userId }, "[fan-decoder] refund failed after decode error");
    }
    res.status(status).json({ error: message, refunded: true });
  };

  const { comments, niche } = parsed.data;
  const commentList = comments.map((c, i) => `${i + 1}. "${c.trim()}"`).join("\n");

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are an audience researcher for independent creators. A creator pastes their ` +
            `fans' comments/DMs; you decode the signal: what does this audience actually want ` +
            `next? Read every comment. Cluster repeat themes. Rank the top 3-5 wants by signal ` +
            `strength (frequency + specificity + enthusiasm), each with 1-4 short supporting ` +
            `quotes copied VERBATIM from the input — never invent quotes. Then give concrete ` +
            `content directions: specific video/content ideas that serve those wants (filmable ` +
            `concepts with a hook, not vague advice). Then toneNotes: 2-4 sentences on how the ` +
            `audience talks and what tone will land with them (their slang, their humor, their ` +
            `pain points).\n\n` +
            `Return ONLY JSON:\n` +
            `{"wants": [{"want": "<what they want>", "quotes": ["<verbatim quote>", ...], ` +
            `"priority": <1-5, 1 = strongest signal>}], ` +
            `"contentDirections": ["<concrete content idea>", ...], ` +
            `"toneNotes": "<2-4 sentences>"}\n` +
            `3-5 wants, 4-8 content directions.`,
        },
        {
          role: "user",
          content:
            `Decode my audience.\n` +
            (niche.trim() ? `My niche: ${niche.trim()}\n` : "") +
            `Comments/DMs:\n${commentList}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2000,
      temperature: 0.6,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let wants: AudienceWant[] = [];
    let contentDirections: string[] = [];
    let toneNotes = "";
    try {
      const j = JSON.parse(raw) as DecodedJson;
      wants = parseWants(j.wants);
      contentDirections = parseStringList(j.contentDirections, 8, 300);
      toneNotes = typeof j.toneNotes === "string" ? j.toneNotes.trim().slice(0, 1200) : "";
    } catch { /* fall through to the empty check below */ }
    if (wants.length === 0) {
      throw new Error("The decoder found no usable audience signal in those comments.");
    }

    res.json({
      wants,
      contentDirections,
      toneNotes,
      creditsUsed: DECODE_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fan Decoder failed";
    logger.error({ err, userId: req.userId }, "[fan-decoder] decode failed");
    await refundAndFail(502, msg);
  }
});

export default router;
