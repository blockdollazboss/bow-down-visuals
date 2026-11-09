import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits, refundCredits, OutOfCreditsError,
  buildChargeIdempotencyKey, voidChargeIdempotencyKey,
} from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";
import { BIO_COST } from "./bio-pricing";

/* Re-exported so existing importers (public API) keep one source:
   the constant itself lives in ./bio-pricing (pure, route-free). */
export { BIO_COST };

/* Served with a replayed result on the website surface (C-36
   honesty): the stored bios come back verbatim and say an identical
   ask cannot be re-bought. */
export const BIO_REPLAY_NOTE = "These are the bios you already made for this request — tweak the words for a fresh set.";

const router = Router();

/* ─── AI social media bio generator ───
   Generates optimized profile bios for Instagram, TikTok, Twitter/X, and
   YouTube from a niche, personality traits, and achievements — each platform
   bio respects that platform's character limit.
   100 Visual Bucs — priced by BIO_COST in ./bio-pricing, the source of
   truth for this rail's price (do not restate a different figure here). */

/** Character limits enforced per platform (generous-safe margins). */
export const PLATFORM_LIMITS = {
  instagram: { limit: 150, label: "Instagram" },
  tiktok: { limit: 80, label: "TikTok" },
  twitter: { limit: 160, label: "Twitter/X" },
  youtube: { limit: 400, label: "YouTube" },
} as const;

type PlatformId = keyof typeof PLATFORM_LIMITS;

export const bioSchema = z.object({
  /** Creator's niche / content vertical. */
  niche: z.string().trim().min(2).max(120),
  /** Personality traits / vibe words, e.g. funny, bold, luxury. */
  personality: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  /** Achievements, stats, or proof points to brag about. */
  achievements: z.array(z.string().trim().min(1).max(120)).max(6).optional().default([]),
  /** Optional call-to-action line (link in bio, booking, etc.). */
  cta: z.string().trim().min(1).max(120).optional(),
  /** Optional name/handle to mention. */
  handle: z.string().trim().min(1).max(60).optional(),
});

interface PlatformBio {
  platform: string;
  bio: string;
  charCount: number;
  limit: number;
}

router.get("/bio-platforms", requireAuth, (_req, res) => {
  res.json({
    platforms: Object.entries(PLATFORM_LIMITS).map(([id, meta]) => ({
      id,
      label: meta.label,
      charLimit: meta.limit,
    })),
  });
});

interface BioGenerationResult {
  bios: PlatformBio[];
  creditsRemaining: number;
  /** True when this result was served from the stored-result row
      (migration 0333) instead of a fresh generation — no charge and
      no provider call happened for it. */
  replayed?: boolean;
}

/**
 * The Bio Generator rail's charging core — shared VERBATIM by the website
 * route below and the Public Creator API (POST /api/v1/generate/bio), so
 * both surfaces charge the SAME BIO_COST from this one constant, through
 * the SAME ledger, with the SAME refund-on-failure behaviour. The price
 * is never client-supplied on either surface.
 *
 * Charge discipline (mirrors the operator-hands law):
 * - chargeCredits() lands exactly one ledger row per completed call;
 *   OutOfCreditsError propagates BEFORE any generation runs, so a key
 *   (or click) can never spend past the owner's balance.
 * - Any generation failure refunds in full under "<action> — Refund"
 *   and VOIDS the charge's idempotency key when the refund lands, so
 *   the retry charges fresh instead of being suppressed as a replay.
 * - `action` is the ledger label: the website passes "Bio Generator";
 *   the API passes "API: Bio Generator" so every API charge is
 *   identifiable as API-originated in the ledger/activity.
 * - `idempotencyKey`, when given, is threaded VERBATIM (public-API
 *   `api:<keyId>:<header>` and operator `operator:<pendingId>` keys
 *   keep their shapes). When absent, the key is derived from the
 *   request INTENT — every call carries a real key, so the ledger
 *   dedups identical re-asks.
 * - Durable stored results (migration 0333): before any funding, a
 *   landed key's stored result is served back with `replayed: true`
 *   — no charge, no provider call, even after a server restart. A
 *   success persists its result under the key before returning.
 *   Storage reads/writes are fail-open.
 */
export async function generateBiosForUser(
  userId: string,
  data: z.infer<typeof bioSchema>,
  opts: { action: string; idempotencyKey?: string | null },
): Promise<BioGenerationResult> {
  const suppliedKey = typeof opts.idempotencyKey === "string" && opts.idempotencyKey.length > 0
    ? opts.idempotencyKey
    : null;
  const idempotencyKey = suppliedKey ?? buildChargeIdempotencyKey(
    "bio-generator", userId, null,
    {
      niche: data.niche,
      personality: data.personality,
      achievements: data.achievements ?? [],
      cta: data.cta ?? null,
      handle: data.handle ?? null,
    },
  );

  /* Stored-result pre-check BEFORE any funding (see header). A
     malformed stored payload is treated as a miss, never served. */
  const stored = await findStoredGenerationResult("bio-generator", idempotencyKey, userId);
  if (stored && Array.isArray(stored["bios"])) {
    return {
      bios: stored["bios"] as PlatformBio[],
      creditsRemaining: typeof stored["creditsRemaining"] === "number" ? stored["creditsRemaining"] : 0,
      replayed: true,
    };
  }

  const creditsAfter = await chargeCredits(userId, BIO_COST, { action: opts.action }, {
    idempotencyKey,
  });

  try {
    const model = getTextModel();
    const { niche, personality, achievements, cta, handle } = data;

    const achievementLine = achievements.length > 0
      ? `Achievements / proof to weave in: ${achievements.join(" \u2022 ")}\n`
      : "";
    const ctaLine = cta ? `Call to action to include where it fits: ${cta}\n` : "";
    const handleLine = handle ? `Handle/name: ${handle}\n` : "";

    const prompt =
      `You are a social media branding expert. Write optimized profile bios for a creator.\n\n` +
      `Niche: ${niche}\n` +
      `Personality: ${personality.join(", ")}\n` +
      `${achievementLine}` +
      `${ctaLine}` +
      `${handleLine}\n` +
      `Write ONE bio per platform, each respecting its hard character limit (including spaces and emojis):\n` +
      `- instagram: max ${PLATFORM_LIMITS.instagram.limit} characters \u2014 punchy, line breaks allowed, 1-2 emojis\n` +
      `- tiktok: max ${PLATFORM_LIMITS.tiktok.limit} characters \u2014 ultra short, hooky, Gen-Z energy\n` +
      `- twitter: max ${PLATFORM_LIMITS.twitter.limit} characters \u2014 witty, keyword-rich\n` +
      `- youtube: max ${PLATFORM_LIMITS.youtube.limit} characters \u2014 slightly longer channel bio, what viewers get\n\n` +
      `Rules:\n` +
      `- Never exceed a platform's character limit \u2014 shorten rather than overflow\n` +
      `- Make each bio distinct; do not copy-paste the same bio across platforms\n` +
      `- No hashtags in bios unless they fit naturally on TikTok/Instagram\n` +
      `- Keep it honest to the niche and achievements provided\n\n` +
      `Return ONLY valid JSON: {"instagram": "...", "tiktok": "...", "twitter": "...", "youtube": "..."}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) throw new Error("Bio generation failed.");
    const respData = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = respData.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty bio generation result.");

    const parsedContent = JSON.parse(content) as Record<string, unknown>;

    const bios: PlatformBio[] = (Object.keys(PLATFORM_LIMITS) as PlatformId[]).map((id) => {
      const meta = PLATFORM_LIMITS[id];
      const raw = String(parsedContent[id] ?? "").trim();
      // Hard-enforce the platform limit server-side (trim at a word boundary).
      let bio = raw;
      if (bio.length > meta.limit) {
        const cut = bio.slice(0, meta.limit);
        const lastSpace = cut.lastIndexOf(" ");
        bio = (lastSpace > meta.limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
      }
      if (!bio) throw new Error(`No bio was generated for ${meta.label}.`);
      return {
        platform: meta.label,
        bio,
        charCount: bio.length,
        limit: meta.limit,
      };
    });

    const result: BioGenerationResult = { bios, creditsRemaining: creditsAfter };
    /* Persist BEFORE returning: the row is what a post-restart replay
       is served from. Fail-open inside the helper — a storage failure
       never fails this paid success. */
    await storeGenerationResult("bio-generator", idempotencyKey, userId, {
      bios: result.bios,
      creditsRemaining: result.creditsRemaining,
    });
    return result;
  } catch (err) {
    // Failed generations do NOT keep the charge — full refund, exactly as
    // the website rail has always behaved. When the refund lands, the
    // charge's key is voided too: without the void the refunded
    // attempt's key still reads as "already charged", so the retry is
    // suppressed as a replay and generates FREE.
    let refunded = true;
    try {
      await refundCredits(userId, BIO_COST, {
        action: `${opts.action} \u2014 Refund`,
      });
    } catch {
      refunded = false;
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }
    throw err;
  }
}

router.post("/generate-bio", requireAuth, async (req, res) => {
  const parsed = bioSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < BIO_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  try {
    const result = await generateBiosForUser(req.userId!, parsed.data, {
      action: "Bio Generator",
    });
    res.json({
      bios: result.bios,
      niche: parsed.data.niche,
      creditsRemaining: result.creditsRemaining,
      ...(result.replayed ? { replayed: true, replayNote: BIO_REPLAY_NOTE } : {}),
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    const message = err instanceof Error ? err.message : "Bio generation failed.";
    req.log.error({ err: message }, "[bio-generator] failed");
    res.status(500).json({ error: message });
  }
});

export default router;
