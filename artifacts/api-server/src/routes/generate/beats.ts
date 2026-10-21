import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db, beatsTable, beatLicensesTable } from "@workspace/db";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { generationLimiter } from "../../lib/rate-limit";
import { chargeCredits as chargeCreditsAtomic, refundCredits } from "../../lib/credits";
import {
  beatFiltersSchema,
  beatMetadataSchema,
  commissionFor,
  getBeatAiTagsCost,
  isBeatLicenseTier,
  type BeatLicenseTier,
} from "./beats-pricing";
import { mirrorExternalMediaUrl } from "../../lib/mirrorMedia";
import { refreshSupabaseStorageUrl, isStorageRef } from "../../lib/objectStorage";
import {
  createPaymentCheckout,
  retrieveCheckoutSession,
  refundCheckoutSessionPayment,
  checkoutBaseUrl,
  isCheckoutTestMode,
} from "../../lib/stripe-checkout";

/* Mirror-on-save (2026-10-13 law): a listed beat's audio/preview are
   re-hosted into permanent storage at listing time; reads serve fresh
   signed URLs minted from the stored ref (audio_path when present). */
async function presentBeat<T extends { audio_url: string; audio_path: string | null; preview_url: string | null }>(row: T): Promise<T> {
  const audioSource = row.audio_path ?? row.audio_url;
  return {
    ...row,
    audio_url: audioSource ? await refreshSupabaseStorageUrl(audioSource) : row.audio_url,
    preview_url: row.preview_url ? await refreshSupabaseStorageUrl(row.preview_url) : row.preview_url,
  };
}

const router = Router();

const beatLicenseSchema = z.object({
  tier: z.enum(["basic", "premium", "exclusive"]),
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/beats — browse the marketplace (free).
   Filters: genre, mood (matches mood_tags), minBpm, maxBpm, key, search, limit, offset.
───────────────────────────────────────────────────────────────────────────── */
router.get("/beats", async (req, res) => {
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
    res.json({ beats: await Promise.all(rows.map(presentBeat)) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list beats";
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/beats/:id — beat detail (free). Bumps the play counter.
───────────────────────────────────────────────────────────────────────────── */
router.get("/beats/:id", async (req, res) => {
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
    res.json({ beat: await presentBeat({ ...beat, plays: beat.plays + 1 }) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch beat";
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/beats — list a beat (FREE to list).
───────────────────────────────────────────────────────────────────────────── */
router.post("/beats", requireAuth, generationLimiter, async (req, res) => {
  const parsed = beatMetadataSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid beat metadata", details: parsed.error.flatten() });
    return;
  }
  const m = parsed.data;

  try {
    const storedAudioUrl =
      (await mirrorExternalMediaUrl(m.audioUrl, { kind: "audio", ownerKey: req.userId! })) ?? m.audioUrl;
    const storedPreviewUrl = m.previewUrl
      ? ((await mirrorExternalMediaUrl(m.previewUrl, { kind: "audio", ownerKey: req.userId! })) ?? m.previewUrl)
      : null;
    const rows = await db.insert(beatsTable).values({
      user_id: req.userId!,
      title: m.title,
      audio_url: storedAudioUrl,
      audio_path: isStorageRef(storedAudioUrl) ? storedAudioUrl : (m.audioPath ?? null),
      preview_url: storedPreviewUrl,
      genre: m.genre,
      bpm: m.bpm ?? null,
      musical_key: m.musicalKey ?? null,
      mood_tags: m.moodTags,
      description: m.description ?? null,
      basic_price_cents: m.basicPriceCents,
      premium_price_cents: m.premiumPriceCents,
      exclusive_price_cents: m.exclusivePriceCents,
    }).returning();
    res.status(201).json({ beat: rows[0] ? await presentBeat(rows[0]) : rows[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list beat";
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/beats/mine/dashboard — producer storefront + sales (auth).
───────────────────────────────────────────────────────────────────────────── */
router.get("/beats/mine/dashboard", requireAuth, async (req, res) => {
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
      beats: await Promise.all(myBeats.map(presentBeat)),
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
router.post("/beats/:id/ai-tags", requireAuth, async (req, res) => {
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
      message: "Not enough Visual Bucs. Please Buy more Visual Bucs to continue.",
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
      res.status(500).json({ error: "AI returned no usable tags — Visual Bucs refunded." });
      return;
    }

    res.json({ genre, moodTags, creditsRemaining: creditsAfter, creditCost: cost });
  } catch (err: unknown) {
    await refundCredits(req.userId!, cost, { action: "Beat AI Tag Suggester — Refund (provider failure)" }).catch(() => {});
    const msg = err instanceof Error ? err.message : "AI tag suggester failed";
    res.status(500).json({ error: `${msg} — Visual Bucs refunded.` });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   PATCH /api/beats/:id — producer updates metadata/tags (auth, owner only).
───────────────────────────────────────────────────────────────────────────── */
router.patch("/beats/:id", requireAuth, async (req, res) => {
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
router.delete("/beats/:id", requireAuth, async (req, res) => {
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
   Beat license payments (0132, TEST-mode checkout).
   POST /api/beats/:id/license creates a pending_payment license + a
   checkout session for the tier's listed price (displayed = charged).
   POST /api/beats/licenses/verify is the ONLY path to 'completed': it
   re-retrieves the session, requires payment_status 'paid', the buyer
   to match, and the paid total to equal the license's locked price.
───────────────────────────────────────────────────────────────────────────── */

type BeatLicenseRow = typeof beatLicensesTable.$inferSelect;

export function toLicenseJson(l: BeatLicenseRow) {
  return {
    id: l.id,
    beatId: l.beat_id,
    buyerId: l.buyer_id,
    producerId: l.producer_id,
    tier: l.tier,
    priceCents: l.price_cents,
    commissionCents: l.commission_cents,
    status: l.status,
    createdAt: l.created_at,
  };
}

const licenseVerifySchema = z.object({
  sessionId: z.string().min(1).max(200),
});

router.post("/beats/licenses/verify", requireAuth, async (req, res) => {
  const parsed = licenseVerifySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  const { sessionId } = parsed.data;

  let session: Awaited<ReturnType<typeof retrieveCheckoutSession>>;
  try {
    session = await retrieveCheckoutSession(sessionId);
  } catch {
    res.status(400).json({ error: "Could not retrieve this checkout session." });
    return;
  }
  if (session.payment_status !== "paid") {
    res.status(400).json({ error: "Payment has not been completed." });
    return;
  }
  const meta = session.metadata ?? {};
  if (meta["purchase_kind"] !== "beat_license" || !meta["license_id"]) {
    res.status(400).json({ error: "This session isn't a beat license purchase." });
    return;
  }
  if (meta["buyer_user_id"] !== req.userId) {
    res.status(403).json({ error: "This purchase doesn't belong to you." });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(beatLicensesTable)
      .where(eq(beatLicensesTable.stripe_session_id, sessionId))
      .limit(1);
    const license = rows[0];
    if (!license || license.id !== meta["license_id"]) {
      res.status(400).json({ error: "License for this session not found." });
      return;
    }
    if ((session.amount_total ?? 0) !== license.price_cents) {
      res.status(400).json({ error: "The paid amount doesn't match the license price." });
      return;
    }
    const beatRows = await db.select().from(beatsTable).where(eq(beatsTable.id, license.beat_id)).limit(1);
    const beat = beatRows[0];
    if (!beat) {
      /* Paid, but the beat was deleted after payment — the license
         can NEVER be recorded (Lane V3 F3). Refund automatically;
         the claim is made only when the refund landed. */
      const refunded = await refundCheckoutSessionPayment(session);
      res.status(400).json({
        error: refunded
          ? "The beat for this license no longer exists — your payment has been refunded in full."
          : "The beat for this license no longer exists. Your payment couldn't be refunded automatically — contact support and we'll make it right.",
        refunded,
      });
      return;
    }
    const presented = await presentBeat(beat);
    if (license.status === "completed") {
      res.json({
        success: true,
        duplicate: true,
        license: toLicenseJson(license),
        downloadUrl: presented.audio_url,
      });
      return;
    }
    /* Exclusive completion is an ATOMIC CLAIM, not check-then-set
       (Lane V3 F5): the old flow read exclusive_sold, completed the
       license, then set the flag — two verifies racing in the awaits
       between check and set could both pass and sell one exclusive
       twice. Now the beat row itself is claimed with a conditional
       UPDATE ... WHERE exclusive_sold = false; exactly one racer's
       claim lands. */
    let claimedExclusive = false;
    if (license.tier === "exclusive") {
      const claim = async (): Promise<boolean> => {
        const rows = await db
          .update(beatsTable)
          .set({ exclusive_sold: true, updated_at: new Date() })
          .where(and(eq(beatsTable.id, beat.id), eq(beatsTable.exclusive_sold, false)))
          .returning();
        return rows.length > 0;
      };
      if (beat.exclusive_sold) {
        /* Already flagged sold. Another COMPLETED exclusive means the
           race is truly lost. A dangling flag with no completed sale
           is a crashed attempt: it may only be released when this
           license is the beat's only pending exclusive (its own
           earlier attempt) — a rival still pending keeps the 409. */
        const others = await db
          .select()
          .from(beatLicensesTable)
          .where(and(eq(beatLicensesTable.beat_id, beat.id), eq(beatLicensesTable.tier, "exclusive")));
        const rivalCompleted = others.some((l) => l.id !== license.id && l.status === "completed");
        const rivalPending = others.some((l) => l.id !== license.id && l.status !== "completed");
        if (rivalCompleted || rivalPending) {
          res.status(409).json({ error: "This beat's exclusive license was sold to someone else first." });
          return;
        }
        await db
          .update(beatsTable)
          .set({ exclusive_sold: false, updated_at: new Date() })
          .where(eq(beatsTable.id, beat.id));
        claimedExclusive = await claim();
      } else {
        claimedExclusive = await claim();
      }
      if (!claimedExclusive) {
        res.status(409).json({ error: "This beat's exclusive license was sold to someone else first." });
        return;
      }
    }
    let updated: typeof license | undefined;
    try {
      [updated] = await db
        .update(beatLicensesTable)
        .set({ status: "completed" })
        .where(eq(beatLicensesTable.id, license.id))
        .returning();
    } catch (err) {
      /* Completion failed after the claim: free the beat so the paid
         buyer's retry (or the next buyer) is not locked out forever. */
      if (claimedExclusive) {
        await db
          .update(beatsTable)
          .set({ exclusive_sold: false, updated_at: new Date() })
          .where(eq(beatsTable.id, beat.id))
          .catch(() => {});
      }
      throw err;
    }
    res.json({
      success: true,
      duplicate: false,
      license: toLicenseJson(updated ?? { ...license, status: "completed" }),
      downloadUrl: presented.audio_url,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to verify license";
    res.status(500).json({ error: msg });
  }
});

router.post("/beats/:id/license", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  const parsed = beatLicenseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const licenseTier: BeatLicenseTier = parsed.data.tier;

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
    /* Insert first with a placeholder, then bind the session id — the
       session metadata carries the license id, and the row carries the
       session id, so verify can cross-check both directions. */
    const inserted = await db.insert(beatLicensesTable).values({
      beat_id: beat.id,
      buyer_id: req.userId!,
      producer_id: beat.user_id,
      tier: licenseTier,
      price_cents: priceCents,
      commission_cents: commissionFor(priceCents),
      status: "pending_payment",
    }).returning();
    const license = inserted[0]!;

    let session: { sessionId: string; url: string };
    try {
      const baseUrl = checkoutBaseUrl(req);
      session = await createPaymentCheckout({
        amountCents: priceCents,
        productName: `${beat.title} — ${licenseTier} license`,
        description: `Beat license (${licenseTier})`,
        successUrl: `${baseUrl}/beats?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}/beats`,
        metadata: {
          purchase_kind: "beat_license",
          license_id: license.id,
          beat_id: beat.id,
          buyer_user_id: req.userId!,
          tier: licenseTier,
        },
        /* The pending license row is the durable purchase intent:
           session creation for this license always carries its key. */
        idempotency: {
          memberId: req.userId!,
          rail: "beat-license",
          purchaseIntent: license.id,
        },
      });
    } catch (err) {
      /* No checkout → no dangling payable license; remove the intent row. */
      await db.delete(beatLicensesTable).where(eq(beatLicensesTable.id, license.id));
      throw err;
    }
    const [bound] = await db
      .update(beatLicensesTable)
      .set({ stripe_session_id: session.sessionId })
      .where(eq(beatLicensesTable.id, license.id))
      .returning();

    res.status(201).json({
      license: toLicenseJson(bound ?? license),
      checkoutUrl: session.url,
      sessionId: session.sessionId,
      paymentStatus: "pending_payment",
      testMode: isCheckoutTestMode(),
      message: "License reserved — complete checkout to activate it. No charge has been made yet.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to start license checkout";
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/beats/licenses/mine — buyer's license library (auth).
   Entitlement (downloadUrl) is present ONLY on completed licenses.
───────────────────────────────────────────────────────────────────────────── */
router.get("/beats/licenses/mine", requireAuth, async (req, res) => {
  try {
    const licenses = await db
      .select()
      .from(beatLicensesTable)
      .where(eq(beatLicensesTable.buyer_id, req.userId!))
      .orderBy(desc(beatLicensesTable.created_at));
    const out = [];
    for (const l of licenses) {
      let downloadUrl: string | null = null;
      if (l.status === "completed") {
        const beatRows = await db.select().from(beatsTable).where(eq(beatsTable.id, l.beat_id)).limit(1);
        if (beatRows[0]) downloadUrl = (await presentBeat(beatRows[0])).audio_url;
      }
      out.push({ ...toLicenseJson(l), downloadUrl });
    }
    res.json({ licenses: out });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load licenses";
    res.status(500).json({ error: msg });
  }
});

export default router;
