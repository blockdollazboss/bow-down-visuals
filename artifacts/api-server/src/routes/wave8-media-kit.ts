import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";
import { db, artistVaultsTable } from "@workspace/db";
import { eq, and, isNull, desc } from "drizzle-orm";

const router = Router();

/* ─── Wave 8: AI Media Kit Builder ─────────────────────────────────────────
   One-click media kit from the creator's artist vault: punchy 150-word bio
   written in the vault's voice + suggested rate-card tiers for bookings.
   No PDF is generated server-side — the frontend builds the PDF client-side
   with jsPDF so this stays a pure AI endpoint.

   Pricing: 100 Visual Bucs per generated kit. */

export const MEDIA_KIT_GENERATE_CREDIT_COST = Number(process.env["MEDIA_KIT_GENERATE_CREDIT_COST"]) || 100;

const generateSchema = z.object({
  vaultId: z.string().uuid().optional(),
});

export type MediaKitGenerateRequest = z.infer<typeof generateSchema>;

export interface MediaKitRate {
  tier: string;
  price: string;
}

export interface MediaKit {
  artistName: string;
  tagline: string;
  bio: string;
  audience: string;
  rates: MediaKitRate[];
  contact: string;
  stats: {
    genre: string;
    artistType: string;
    visualStyle: string;
    voiceStyle: string;
  };
  generatedAt: string;
}

function clampText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.slice(0, max);
}

function clampRate(value: unknown): MediaKitRate | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const tier = clampText(v.tier, 80);
  const price = clampText(v.price, 60);
  if (!tier || !price) return null;
  return { tier, price };
}

/** Parse + sanitize the model's JSON output. Returns null when unusable (triggers refund). */
export function parseMediaKit(raw: string, fallbackName: string): MediaKit | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;

  const artistName = clampText(o.artistName, 120) || fallbackName;
  const tagline = clampText(o.tagline, 160);
  const bio = clampText(o.bio, 1200);
  const audience = clampText(o.audience, 400);
  const contact = clampText(o.contact, 160);
  const rates = (Array.isArray(o.rates) ? o.rates : [])
    .map(clampRate)
    .filter((r): r is MediaKitRate => r !== null)
    .slice(0, 5);

  const stats = (o.stats ?? {}) as Record<string, unknown>;

  /* The bio is the whole point of the kit — it must exist. */
  if (!bio || rates.length === 0) return null;

  return {
    artistName,
    tagline,
    bio,
    audience,
    rates,
    contact,
    stats: {
      genre: clampText(stats.genre, 80),
      artistType: clampText(stats.artistType, 80),
      visualStyle: clampText(stats.visualStyle, 120),
      voiceStyle: clampText(stats.voiceStyle, 120),
    },
    generatedAt: new Date().toISOString(),
  };
}

function aiUnavailable(res: { status: (c: number) => { json: (b: unknown) => void } }): boolean {
  /* getOpenAI() throws naming OPENAI_API_KEY when the key is missing. */
  try {
    getOpenAI();
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      error: "ai_unavailable",
      message: msg.includes("OPENAI_API_KEY")
        ? "OPENAI_API_KEY is not configured — the Media Kit Builder is unavailable."
        : "The Media Kit Builder is unavailable right now.",
    });
    return true;
  }
}

/* POST /api/wave8/media-kit/generate — 100 VB. Reads the user's artist
   vault (optional specific vault) and returns a structured media kit. */
router.post("/wave8/media-kit/generate", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = generateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid media kit request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  if (aiUnavailable(res)) return;

  const balance = req.userCredits ?? 0;
  if (balance < MEDIA_KIT_GENERATE_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to build your media kit.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, MEDIA_KIT_GENERATE_CREDIT_COST, {
      action: "AI Media Kit Builder",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to build your media kit.",
      });
      return;
    }
    throw err;
  }

  async function refund() {
    try {
      await refundCredits(req.userId!, MEDIA_KIT_GENERATE_CREDIT_COST, {
        action: "AI Media Kit Builder — Refund (generation failed)",
      });
    } catch (refundErr) {
      void refundErr; // logged inside refundCredits; don't mask the original failure
    }
  }

  try {
    /* Load the vault: a specific one when vaultId is given, otherwise the
       most recent active vault. Soft-deleted vaults never count. */
    const vaultWhere = parsed.data.vaultId
      ? and(
          eq(artistVaultsTable.id, parsed.data.vaultId),
          eq(artistVaultsTable.user_id, req.userId!),
          isNull(artistVaultsTable.deleted_at),
        )
      : and(eq(artistVaultsTable.user_id, req.userId!), isNull(artistVaultsTable.deleted_at));

    const vaults = await db
      .select()
      .from(artistVaultsTable)
      .where(vaultWhere)
      .orderBy(desc(artistVaultsTable.created_at))
      .limit(1);
    const vault = vaults[0] ?? null;

    const voiceLine = vault?.voice_style
      ? ` Voice style: ${vault.voice_style}.`
      : "";
    const personalityLine = vault?.personality
      ? ` Personality: ${vault.personality}.`
      : "";
    const identityLine = vault
      ? `Artist: ${vault.artist_name}${vault.artist_type ? ` (${vault.artist_type})` : ""}${vault.genre ? ` — genre: ${vault.genre}` : ""}.${voiceLine}${personalityLine}${vault.visual_style ? ` Visual style: ${vault.visual_style}.` : ""}${vault.brand_colors ? ` Brand colors: ${vault.brand_colors}.` : ""}${vault.description ? ` Public bio on file: ${vault.description}` : ""}`
      : "No artist vault on file — write for an independent creator building their brand from scratch.";

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      max_completion_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a booking agent writing one-page media kits for independent creators. Write like a confident promoter: punchy, specific, no filler, no hype words like 'world-class' or 'unparalleled'. The bio must read in the artist's own voice and stay at or under 150 words. Rate tiers must be realistic for an independent creator (suggest USD prices). No emojis. Respond with JSON only.",
        },
        {
          role: "user",
          content:
            `${identityLine}\n\n` +
            `Write this creator's media kit as JSON with exactly these keys:\n` +
            `- "artistName": string\n` +
            `- "tagline": string (one line, under 20 words — the hook a booker reads first)\n` +
            `- "bio": string (150 words MAX, punchy, written in the artist's voice — who they are, what they do, why bookers care)\n` +
            `- "audience": string (under 60 words: who their fans are — age, vibe, where they hang out)\n` +
            `- "rates": array of 3–4 objects { "tier": string (e.g. "Club Set", "Festival Headline", "Brand Collab"), "price": string (e.g. "$500–$1,000") }\n` +
            `- "contact": string (booking contact line; use "bookings@…" only if a real address is known from the data above, otherwise leave empty)\n` +
            `- "stats": { "genre": string, "artistType": string, "visualStyle": string, "voiceStyle": string } (short strings; empty string when unknown)`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const kit = parseMediaKit(raw, vault?.artist_name ?? "Independent Creator");
    if (!kit) {
      await refund();
      res.status(502).json({
        error: "generation_failed",
        message: "The media kit came back unusable — your Visual Bucs were refunded. Try again.",
      });
      return;
    }

    res.json({ kit, creditsUsed: MEDIA_KIT_GENERATE_CREDIT_COST, creditsRemaining });
  } catch (err) {
    await refund();
    logger.error({ err }, "wave8-media-kit: generation failed, Visual Bucs refunded");
    res.status(502).json({
      error: "generation_failed",
      message: "Something went wrong building your media kit — your Visual Bucs were refunded.",
    });
  }
});

export default router;
