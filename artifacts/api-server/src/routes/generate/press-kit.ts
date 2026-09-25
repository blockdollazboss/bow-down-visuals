import { Router } from "express";
import { z } from "zod/v4";
import { eq, and, desc } from "drizzle-orm";
import { db, pressKitsTable, artistVaultsTable, pressKitHandleSchema } from "@workspace/db";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { publicApiLimiter } from "../../lib/rate-limit";

/* ─── Press Kit Builder ───────────────────────────────────────────────────
   Electronic press kits (EPKs): artists generate a professional bio with AI
   and publish a shareable page at /press/:handle with photos, top tracks,
   achievements, press quotes, and booking contact.

   Pricing (standing rule — compute burns, so it charges):
   - POST /api/press-kit/generate: 3 credits (AI bio + kit creation).
     Charge BEFORE the model call; automatic refund on provider/DB failure.
   - POST /api/press-kit/:id/regenerate-bio: 1 credit (bio refresh only).
   - Everything else (list, view, edit, delete, public page): free. */

const router = Router();

/** Express 5 types req.params as string | string[] — normalize to string. */
function param(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export const PRESS_KIT_GENERATE_CREDITS =
  Number(process.env["PRESS_KIT_GENERATE_CREDITS"]) || 3;
export const PRESS_KIT_BIO_REFRESH_CREDITS =
  Number(process.env["PRESS_KIT_BIO_REFRESH_CREDITS"]) || 1;

const trackSchema = z.object({
  title: z.string().min(1).max(120),
  url: z.string().url().max(500),
});

const quoteSchema = z.object({
  quote: z.string().min(1).max(500),
  source: z.string().min(1).max(120),
});

const generatePressKitSchema = z.object({
  handle: pressKitHandleSchema,
  artist_name: z.string().min(1).max(120),
  tagline: z.string().max(160).optional().default(""),
  genre: z.string().max(80).optional().default(""),
  location: z.string().max(120).optional().default(""),
  booking_email: z.string().email().max(160).optional().or(z.literal("")),
  website: z.string().url().max(500).optional().or(z.literal("")),
  instagram_url: z.string().url().max(500).optional().or(z.literal("")),
  tiktok_url: z.string().url().max(500).optional().or(z.literal("")),
  youtube_url: z.string().url().max(500).optional().or(z.literal("")),
  spotify_url: z.string().url().max(500).optional().or(z.literal("")),
  achievements: z.array(z.string().min(1).max(200)).max(20).optional().default([]),
  press_quotes: z.array(quoteSchema).max(10).optional().default([]),
  photo_urls: z.array(z.string().url().max(1000)).max(12).optional().default([]),
  top_tracks: z.array(trackSchema).max(10).optional().default([]),
  /** Optional artist vault to source the bio voice + identity details from. */
  artist_vault_id: z.string().uuid().optional(),
});

const updatePressKitSchema = generatePressKitSchema.partial().extend({
  bio: z.string().max(5000).optional(),
  is_public: z.boolean().optional(),
});

const regenerateBioSchema = z.object({
  achievements: z.array(z.string().min(1).max(200)).max(20).optional(),
  tone: z.enum(["professional", "bold", "playful", "luxury"]).optional().default("professional"),
});

function toPublicKit(row: typeof pressKitsTable.$inferSelect) {
  const { user_id: _userId, ...publicKit } = row;
  return publicKit;
}

/** Exported for tests: the public kit shape never leaks user_id. */
export { toPublicKit };
export { generatePressKitSchema, updatePressKitSchema, regenerateBioSchema };

async function writeArtistBio(args: {
  artistName: string;
  tagline: string;
  genre: string;
  location: string;
  achievements: string[];
  vault: typeof artistVaultsTable.$inferSelect | null;
  tone: string;
}): Promise<string> {
  const { artistName, tagline, genre, location, achievements, vault, tone } = args;
  const vaultLines: string[] = [];
  if (vault) {
    if (vault.genre) vaultLines.push(`Genre: ${vault.genre}`);
    if (vault.voice_style) vaultLines.push(`Vocal style: ${vault.voice_style}`);
    if (vault.visual_style) vaultLines.push(`Visual style: ${vault.visual_style}`);
    if (vault.personality) vaultLines.push(`Personality: ${vault.personality}`);
    if (vault.clothing_style) vaultLines.push(`Style: ${vault.clothing_style}`);
  }
  const achievementLines =
    achievements.length > 0
      ? achievements.map((a) => `- ${a}`).join("\n")
      : "(no achievements listed — write aspirationally but honestly, no fabricated awards)";

  const completion = await getOpenAI().chat.completions.create({
    model: getTextModel(),
    messages: [
      {
        role: "system",
        content:
          `You are a music-industry publicist writing electronic press kit bios. ` +
          `Write in third person, ${tone} tone, 120-180 words, two short paragraphs. ` +
          `Lead with what makes the artist undeniable, weave in the achievements naturally, ` +
          `close with momentum (what's next). No hype clichés ("taking the world by storm"), ` +
          `no fabricated awards, venues, or numbers — if achievements are thin, lean on ` +
          `sound and story. Return ONLY the bio text, no headings, no quotes around it.`,
      },
      {
        role: "user",
        content:
          `Artist: ${artistName}\n` +
          (tagline ? `Tagline: ${tagline}\n` : "") +
          (genre ? `Genre: ${genre}\n` : "") +
          (location ? `Based in: ${location}\n` : "") +
          (vaultLines.length > 0 ? `Artist profile:\n${vaultLines.join("\n")}\n` : "") +
          `Achievements:\n${achievementLines}\n\nWrite the press-kit bio.`,
      },
    ],
    max_completion_tokens: 600,
    temperature: 0.8,
  });

  const bio = completion.choices[0]?.message?.content?.trim() ?? "";
  if (bio.length < 40) {
    throw new Error("Model returned no usable bio");
  }
  return bio;
}

async function handleExists(handle: string, excludeId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: pressKitsTable.id })
    .from(pressKitsTable)
    .where(eq(pressKitsTable.handle, handle))
    .limit(1);
  if (rows.length === 0) return false;
  if (excludeId && rows[0]!.id === excludeId) return false;
  return true;
}

/* POST /api/press-kit/generate — 3 credits. AI bio + kit creation. */
router.post("/press-kit/generate", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = generatePressKitSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid press kit request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < PRESS_KIT_GENERATE_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to generate a press kit.",
    });
    return;
  }

  if (await handleExists(parsed.data.handle)) {
    res.status(409).json({ error: "handle_taken", message: "That press-kit URL is already taken — try another handle." });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, PRESS_KIT_GENERATE_CREDITS, {
      action: "Press Kit Generation",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to generate a press kit." });
      return;
    }
    throw err;
  }

  try {
    let vault: typeof artistVaultsTable.$inferSelect | null = null;
    if (parsed.data.artist_vault_id) {
      const rows = await db
        .select()
        .from(artistVaultsTable)
        .where(and(eq(artistVaultsTable.id, parsed.data.artist_vault_id), eq(artistVaultsTable.user_id, req.userId!)))
        .limit(1);
      vault = rows[0] ?? null;
    }

    const bio = await writeArtistBio({
      artistName: parsed.data.artist_name,
      tagline: parsed.data.tagline,
      genre: parsed.data.genre,
      location: parsed.data.location,
      achievements: parsed.data.achievements,
      vault,
      tone: "professional",
    });

    const [kit] = await db
      .insert(pressKitsTable)
      .values({
        user_id: req.userId!,
        handle: parsed.data.handle,
        artist_name: parsed.data.artist_name,
        tagline: parsed.data.tagline || null,
        bio,
        genre: parsed.data.genre || null,
        location: parsed.data.location || null,
        booking_email: parsed.data.booking_email || null,
        website: parsed.data.website || null,
        instagram_url: parsed.data.instagram_url || null,
        tiktok_url: parsed.data.tiktok_url || null,
        youtube_url: parsed.data.youtube_url || null,
        spotify_url: parsed.data.spotify_url || null,
        achievements: parsed.data.achievements,
        press_quotes: parsed.data.press_quotes,
        photo_urls: parsed.data.photo_urls,
        top_tracks: parsed.data.top_tracks,
        artist_vault_id: parsed.data.artist_vault_id ?? null,
        is_public: true,
      })
      .returning();

    res.json({ kit: toPublicKit(kit!), creditsUsed: PRESS_KIT_GENERATE_CREDITS, creditsRemaining });
  } catch (err) {
    // Provider or DB failed after charging — refund so failures are free.
    await refundCredits(req.userId!, PRESS_KIT_GENERATE_CREDITS, {
      action: "Press Kit Generation — Refund (generation failed)",
    }).catch(() => {});
    if (err instanceof LedgerWriteError) throw err;
    res.status(502).json({ error: "generation_failed", message: "The press kit couldn't be generated — your credits were refunded." });
  }
});

/* POST /api/press-kit/:id/regenerate-bio — 1 credit. Bio refresh only. */
router.post("/press-kit/:id/regenerate-bio", publicApiLimiter, requireAuth, async (req, res) => {
  const kitId = param(req.params.id);
  const parsed = regenerateBioSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bio refresh request." });
    return;
  }

  const rows = await db
    .select()
    .from(pressKitsTable)
    .where(and(eq(pressKitsTable.id, kitId), eq(pressKitsTable.user_id, req.userId!)))
    .limit(1);
  const kit = rows[0];
  if (!kit) {
    res.status(404).json({ error: "Press kit not found." });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < PRESS_KIT_BIO_REFRESH_CREDITS) {
    res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to refresh the bio." });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, PRESS_KIT_BIO_REFRESH_CREDITS, {
      action: "Press Kit Bio Refresh",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to refresh the bio." });
      return;
    }
    throw err;
  }

  try {
    let vault: typeof artistVaultsTable.$inferSelect | null = null;
    if (kit.artist_vault_id) {
      const vrows = await db
        .select()
        .from(artistVaultsTable)
        .where(and(eq(artistVaultsTable.id, kit.artist_vault_id), eq(artistVaultsTable.user_id, req.userId!)))
        .limit(1);
      vault = vrows[0] ?? null;
    }

    const bio = await writeArtistBio({
      artistName: kit.artist_name,
      tagline: kit.tagline ?? "",
      genre: kit.genre ?? "",
      location: kit.location ?? "",
      achievements: parsed.data.achievements ?? (kit.achievements as string[]),
      vault,
      tone: parsed.data.tone,
    });

    const [updated] = await db
      .update(pressKitsTable)
      .set({ bio, updated_at: new Date() })
      .where(eq(pressKitsTable.id, kitId))
      .returning();

    res.json({ kit: toPublicKit(updated!), creditsUsed: PRESS_KIT_BIO_REFRESH_CREDITS, creditsRemaining });
  } catch (err) {
    await refundCredits(req.userId!, PRESS_KIT_BIO_REFRESH_CREDITS, {
      action: "Press Kit Bio Refresh — Refund (generation failed)",
    }).catch(() => {});
    if (err instanceof LedgerWriteError) throw err;
    res.status(502).json({ error: "generation_failed", message: "The bio couldn't be refreshed — your credits were refunded." });
  }
});

/* GET /api/press-kit/mine — free. List the user's kits. */
router.get("/press-kit/mine", requireAuth, async (req, res) => {
  const kits = await db
    .select()
    .from(pressKitsTable)
    .where(eq(pressKitsTable.user_id, req.userId!))
    .orderBy(desc(pressKitsTable.updated_at));
  res.json({ kits: kits.map(toPublicKit) });
});

/* GET /api/press-kit/public/:handle — free, no auth. Powers /press/:handle. */
router.get("/press-kit/public/:handle", publicApiLimiter, async (req, res) => {
  const handle = String(req.params.handle ?? "").toLowerCase();
  const rows = await db
    .select()
    .from(pressKitsTable)
    .where(eq(pressKitsTable.handle, handle))
    .limit(1);
  const kit = rows[0];
  if (!kit || !kit.is_public) {
    res.status(404).json({ error: "Press kit not found." });
    return;
  }
  res.json({ kit: toPublicKit(kit) });
});

/* GET /api/press-kit/:id — free. Owner view. */
router.get("/press-kit/:id", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(pressKitsTable)
    .where(and(eq(pressKitsTable.id, param(req.params.id)), eq(pressKitsTable.user_id, req.userId!)))
    .limit(1);
  const kit = rows[0];
  if (!kit) {
    res.status(404).json({ error: "Press kit not found." });
    return;
  }
  res.json({ kit: toPublicKit(kit) });
});

/* PUT /api/press-kit/:id — free. Edit everything (bio edits are free). */
router.put("/press-kit/:id", requireAuth, async (req, res) => {
  const parsed = updatePressKitSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid press kit update.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const kitId = param(req.params.id);

  const existing = await db
    .select()
    .from(pressKitsTable)
    .where(and(eq(pressKitsTable.id, kitId), eq(pressKitsTable.user_id, req.userId!)))
    .limit(1);
  if (!existing[0]) {
    res.status(404).json({ error: "Press kit not found." });
    return;
  }

  if (parsed.data.handle && parsed.data.handle !== existing[0].handle) {
    if (await handleExists(parsed.data.handle, kitId)) {
      res.status(409).json({ error: "handle_taken", message: "That press-kit URL is already taken." });
      return;
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date() };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) patch[k] = v === "" ? null : v;
  }

  const [updated] = await db
    .update(pressKitsTable)
    .set(patch)
    .where(eq(pressKitsTable.id, kitId))
    .returning();
  res.json({ kit: toPublicKit(updated!) });
});

/* DELETE /api/press-kit/:id — free. */
router.delete("/press-kit/:id", requireAuth, async (req, res) => {
  const deleted = await db
    .delete(pressKitsTable)
    .where(and(eq(pressKitsTable.id, param(req.params.id)), eq(pressKitsTable.user_id, req.userId!)))
    .returning({ id: pressKitsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Press kit not found." });
    return;
  }
  res.json({ ok: true });
});

export default router;
