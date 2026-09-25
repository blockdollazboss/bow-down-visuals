import { Router } from "express";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db, beatsTable, beatLicensesTable } from "@workspace/db";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits as chargeCreditsAtomic, refundCredits } from "../../lib/credits";
import {
  beatFiltersSchema,
  beatMetadataSchema,
  commissionFor,
  getBeatAiTagsCost,
  isBeatLicenseTier,
  type BeatLicenseTier,
} from "./beats-pricing";

const router = Router();

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/beats — browse the marketplace (free).
   Filters: genre, mood (matches mood_tags), minBpm, maxBpm, key, search, limit, offset.
───────────────────────────────────────────────────────────────────────────── */
router.get("/api/beats", async (req, res) => {
  const parsed = beatFiltersSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid filters", details: parsed.error.flatten() });
    return;
  }
  const f = parsed.data;

  const conditions = [];
  if (f.genre) conditions.push(ilike(beatsTable.genre, f.genre));
  if (f.mood) {
    // mood_tags is a text[] — match case-insensitively against any element.
    conditions.push(sql`EXISTS (SELECT 1 FROM unnest(${beatsTable.mood_tags}) AS t WHERE t ILIKE ${`%${f.mood}%`})`);
  }
  if (f.minBpm !== undefined) conditions.push(gte(beatsTable.bpm, f.minBpm));
  if (f.maxBpm !== undefined) conditions.push(lte(beatsTable.bpm, f.maxBpm));
  if (f.key) conditions.push(ilike(beatsTable.musical_key, f.key));
  if (f.search) {
    conditions.push(
      or(
        ilike(beatsTable.title, `%${f.search}%`),
        ilike(beatsTable.description, `%${f.search}%`),
      ),
    );
  }

  try {
    const rows = await db
      .select()
      .from(beatsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(beatsTable.created_at))
      .limit(f.limit)
      .offset(f.offset);
    res.json({ beats: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list beats";
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/beats/:id — beat detail (free). Bumps the play counter.
───────────────────────────────────────────────────────────────────────────── */
router.get("/api/beats/:id", async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const rows = await db.select().from(beatsTable).where(eq(beatsTable.id, id)).limit(1);
    const beat = rows[0];
    if (!beat) {
      res.status(404).json({ error: "Beat not found" });
      return;
    }
    // Best-effort play bump — never fails the read.
    try {
      await db.update(beatsTable)
        .set({ plays: sql`${beatsTable.plays} + 1` })
        .where(eq(beatsTable.id, id));
    } catch { /* ignore */ }
    res.json({ beat: { ...beat, plays: beat.plays + 1 } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch beat";
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/beats — list a beat (FREE to list).
───────────────────────────────────────────────────────────────────────────── */
router.post("/api/beats", requireAuth, async (req, res) => {
  const parsed = beatMetadataSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid beat metadata", details: parsed.error.flatten() });
    return;
  }
  const m = parsed.data;

  try {
    const rows = await db.insert(beatsTable).values({
      user_id: req.userId!,
      title: m.title,
      audio_url: m.audioUrl,
      audio_path: m.audioPath ?? null,
      preview_url: m.previewUrl ?? null,
      genre: m.genre,
      bpm: m.bpm ?? null,
      musical_key: m.musicalKey ?? null,
      mood_tags: m.moodTags,
      description: m.description ?? null,
      basic_price_cents: m.basicPriceCents,
      premium_price_cents: m.premiumPriceCents,
      exclusive_price_cents: m.exclusivePriceCents,
    }).returning();
    res.status(201).json({ beat: rows[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list beat";
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/beats/mine/dashboard — producer storefront + sales (auth).
───────────────────────────────────────────────────────────────────────────── */
router.get("/api/beats/mine/dashboard", requireAuth, async (req, res) => {
  try {
    const myBeats = await db
      .select()
      .from(beatsTable)
      .where(eq(beatsTable.user_id, req.userId!))
      .orderBy(desc(beatsTable.created_at));

    const sales = await db
      .select()
      .from(beatLicensesTable)
      .where(eq(beatLicensesTable.producer_id, req.userId!))
      .orderBy(desc(beatLicensesTable.created_at));

    const grossCents = sales.reduce((s: number, l: { price_cents: number }) => s + l.price_cents, 0);
    const commissionCents = sales.reduce((s: number, l: { commission_cents: number }) => s + l.commission_cents, 0);

    res.json({
      beats: myBeats,
      sales,
      stats: {
        beatCount: myBeats.length,
        saleCount: sales.length,
        grossCents,
        commissionCents,
        netCents: grossCents - commissionCents,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load dashboard";
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/beats/:id/ai-tags — AI tag suggester (1 credit).
   Analyzes the beat's metadata (title, genre, BPM, key, description) and
   suggests genre + mood tags via GPT-6. Charge-before-generate, refund on
   provider failure or empty output.
───────────────────────────────────────────────────────────────────────────── */
router.post("/api/beats/:id/ai-tags", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  const cost = getBeatAiTagsCost();

  const rows = await db.select().from(beatsTable).where(eq(beatsTable.id, id)).limit(1);
  const beat = rows[0];
  if (!beat) {
    res.status(404).json({ error: "Beat not found" });
    return;
  }
  if (beat.user_id !== req.userId) {
    res.status(403).json({ error: "Only the beat's producer can run the AI tag suggester" });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < cost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough credits. Please buy more credits to continue.",
    });
    return;
  }

  // Charge before generation.
  let creditsAfter: number;
  try {
    creditsAfter = await chargeCreditsAtomic(
      req.userId!,
      cost,
      { action: "Beat AI Tag Suggester" },
      { rollbackOnLedgerFailure: true },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Credit charge failed";
    res.status(402).json({ error: msg });
    return;
  }

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            "You are a music metadata expert. Given a beat's metadata, suggest the best genre label and up to 8 mood tags. " +
            "Reply with JSON only: {\"genre\": \"...\", \"moodTags\": [\"...\"], \"reason\": \"one short sentence\"}. " +
            "Mood tags must be single lowercase words like: dark, aggressive, chill, bouncy, melancholic, triumphant, smooth, hard.",
        },
        {
          role: "user",
          content: JSON.stringify({
            title: beat.title,
            genre: beat.genre,
            bpm: beat.bpm,
            key: beat.musical_key,
            description: beat.description,
            existingTags: beat.mood_tags,
          }),
        },
      ],
      max_completion_tokens: 400,
      temperature: 0.6,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let genre = beat.genre;
    let moodTags: string[] = [];
    try {
      const parsedJson = JSON.parse(raw) as { genre?: unknown; moodTags?: unknown };
      if (typeof parsedJson.genre === "string" && parsedJson.genre.trim()) {
        genre = parsedJson.genre.trim().slice(0, 40);
      }
      if (Array.isArray(parsedJson.moodTags)) {
        moodTags = parsedJson.moodTags
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim().toLowerCase().slice(0, 24))
          .slice(0, 8);
      }
    } catch {
      /* fall through to the empty check below */
    }

    if (moodTags.length === 0) {
      await refundCredits(req.userId!, cost, { action: "Beat AI Tag Suggester — Refund (empty output)" });
      res.status(500).json({ error: "AI returned no usable tags — credits refunded." });
      return;
    }

    res.json({ genre, moodTags, creditsRemaining: creditsAfter, creditCost: cost });
  } catch (err: unknown) {
    await refundCredits(req.userId!, cost, { action: "Beat AI Tag Suggester — Refund (provider failure)" }).catch(() => {});
    const msg = err instanceof Error ? err.message : "AI tag suggester failed";
    res.status(500).json({ error: `${msg} — credits refunded.` });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   PATCH /api/beats/:id — producer updates metadata/tags (auth, owner only).
───────────────────────────────────────────────────────────────────────────── */
router.patch("/api/beats/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  const rows = await db.select().from(beatsTable).where(eq(beatsTable.id, id)).limit(1);
  const beat = rows[0];
  if (!beat) {
    res.status(404).json({ error: "Beat not found" });
    return;
  }
  if (beat.user_id !== req.userId) {
    res.status(403).json({ error: "Only the producer can edit this beat" });
    return;
  }

  const patch = beatMetadataSchema.partial().safeParse(req.body);
  if (!patch.success) {
    res.status(400).json({ error: "Invalid patch", details: patch.error.flatten() });
    return;
  }
  const p = patch.data;
  try {
    const updated = await db.update(beatsTable).set({
      ...(p.title !== undefined ? { title: p.title } : {}),
      ...(p.genre !== undefined ? { genre: p.genre } : {}),
      ...(p.bpm !== undefined ? { bpm: p.bpm } : {}),
      ...(p.musicalKey !== undefined ? { musical_key: p.musicalKey } : {}),
      ...(p.moodTags !== undefined ? { mood_tags: p.moodTags } : {}),
      ...(p.description !== undefined ? { description: p.description } : {}),
      ...(p.basicPriceCents !== undefined ? { basic_price_cents: p.basicPriceCents } : {}),
      ...(p.premiumPriceCents !== undefined ? { premium_price_cents: p.premiumPriceCents } : {}),
      ...(p.exclusivePriceCents !== undefined ? { exclusive_price_cents: p.exclusivePriceCents } : {}),
      updated_at: new Date(),
    }).where(eq(beatsTable.id, id)).returning();
    res.json({ beat: updated[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update beat";
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   DELETE /api/beats/:id — producer removes a listing (auth, owner only).
───────────────────────────────────────────────────────────────────────────── */
router.delete("/api/beats/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  const rows = await db.select().from(beatsTable).where(eq(beatsTable.id, id)).limit(1);
  const beat = rows[0];
  if (!beat) {
    res.status(404).json({ error: "Beat not found" });
    return;
  }
  if (beat.user_id !== req.userId) {
    res.status(403).json({ error: "Only the producer can delete this beat" });
    return;
  }
  try {
    await db.delete(beatsTable).where(eq(beatsTable.id, id));
    res.json({ deleted: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete beat";
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/beats/:id/license — choose a license tier (v1: intent only).
   Payment processing is coming soon, so this records the license as
   'pending_payment' and NEVER completes a purchase. The UI says so plainly.
───────────────────────────────────────────────────────────────────────────── */
router.post("/api/beats/:id/license", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  const { tier } = req.body as { tier?: string };

  if (!isBeatLicenseTier(tier)) {
    res.status(400).json({ error: `tier must be one of: basic, premium, exclusive` });
    return;
  }
  const licenseTier = tier as BeatLicenseTier;

  const rows = await db.select().from(beatsTable).where(eq(beatsTable.id, id)).limit(1);
  const beat = rows[0];
  if (!beat) {
    res.status(404).json({ error: "Beat not found" });
    return;
  }
  if (beat.user_id === req.userId) {
    res.status(400).json({ error: "Producers can't license their own beat" });
    return;
  }
  if (licenseTier === "exclusive" && beat.exclusive_sold) {
    res.status(409).json({ error: "This beat's exclusive license is already sold" });
    return;
  }

  const priceCents =
    licenseTier === "basic" ? beat.basic_price_cents
    : licenseTier === "premium" ? beat.premium_price_cents
    : beat.exclusive_price_cents;

  try {
    const inserted = await db.insert(beatLicensesTable).values({
      beat_id: beat.id,
      buyer_id: req.userId!,
      producer_id: beat.user_id,
      tier: licenseTier,
      price_cents: priceCents,
      commission_cents: commissionFor(priceCents),
      // v1 honesty: payment is coming soon — intent recorded, never completed.
      status: "pending_payment",
    }).returning();

    res.status(201).json({
      license: inserted[0],
      paymentStatus: "coming_soon",
      message: "License reserved. Payment processing is coming soon — no charge was made.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to reserve license";
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/beats/licenses/mine — buyer's license library (auth).
───────────────────────────────────────────────────────────────────────────── */
router.get("/api/beats/licenses/mine", requireAuth, async (req, res) => {
  try {
    const licenses = await db
      .select()
      .from(beatLicensesTable)
      .where(eq(beatLicensesTable.buyer_id, req.userId!))
      .orderBy(desc(beatLicensesTable.created_at));
    res.json({ licenses });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load licenses";
    res.status(500).json({ error: msg });
  }
});

export default router;
