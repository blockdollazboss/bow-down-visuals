import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db, beatsTable, beatLicensesTable, beatLicenseTemplatesTable } from "@workspace/db";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { generationLimiter } from "../../lib/rate-limit";
import { chargeCredits as chargeCreditsAtomic, refundCredits } from "../../lib/credits";
import {
  BEAT_LICENSE_FORMATS,
  beatFiltersSchema,
  beatLicenseTemplatePatchSchema,
  beatLicenseTemplateSchema,
  beatMetadataSchema,
  commissionFor,
  defaultTermsForTier,
  getBeatAiTagsCost,
  isBeatLicenseTier,
  type BeatLicenseFormat,
  type BeatLicenseTerms,
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

/* A license purchase names exactly one offer: a fixed tier OR one of the
   producer's custom templates (migration 0187). */
const beatLicenseSchema = z.object({
  tier: z.enum(["basic", "premium", "exclusive"]).optional(),
  templateId: z.string().uuid().optional(),
}).refine((v) => (v.tier === undefined) !== (v.templateId === undefined), {
  message: "Choose exactly one of tier or templateId.",
});

/* ── Custom license templates (0187) ───────────────────────────────────────
   DTO + snapshot mapping. The snapshot is the terms EXACTLY as sold,
   copied onto the license row at purchase; the live template row is
   never re-read for a sold license. */

type BeatLicenseTemplateRow = typeof beatLicenseTemplatesTable.$inferSelect;

export function toTemplateJson(row: BeatLicenseTemplateRow) {
  return {
    id: row.id,
    producerId: row.producer_id,
    name: row.name,
    priceCents: row.price_cents,
    isExclusive: row.is_exclusive,
    format: row.format,
    streamsCap: row.streams_cap,
    salesCap: row.sales_cap,
    musicVideosCap: row.music_videos_cap,
    radioTvAllowed: row.radio_tv_allowed,
    livePerformancesCap: row.live_performances_cap,
    termYears: row.term_years,
    territory: row.territory,
    creditLine: row.credit_line,
    termsNote: row.terms_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function termsFromTemplateRow(row: BeatLicenseTemplateRow): BeatLicenseTerms {
  return {
    name: row.name,
    format: (BEAT_LICENSE_FORMATS as readonly string[]).includes(row.format)
      ? (row.format as BeatLicenseFormat)
      : "mp3",
    streamsCap: row.streams_cap,
    salesCap: row.sales_cap,
    musicVideosCap: row.music_videos_cap,
    radioTvAllowed: row.radio_tv_allowed,
    livePerformancesCap: row.live_performances_cap,
    termYears: row.term_years,
    territory: row.territory,
    creditLine: row.credit_line,
    termsNote: row.terms_note,
    isExclusive: row.is_exclusive,
  };
}

/** Attach each beat's producer's custom templates (buyer-facing DTOs) so
    the license modal can offer them next to the fixed tiers. */
async function attachLicenseTemplates<T extends { user_id: string }>(
  rows: T[],
): Promise<Array<T & { license_templates: ReturnType<typeof toTemplateJson>[] }>> {
  const producerIds = [...new Set(rows.map((r) => r.user_id))];
  if (producerIds.length === 0) return rows.map((r) => ({ ...r, license_templates: [] }));
  const templates = await db
    .select()
    .from(beatLicenseTemplatesTable)
    .where(inArray(beatLicenseTemplatesTable.producer_id, producerIds))
    .orderBy(desc(beatLicenseTemplatesTable.created_at));
  const byProducer = new Map<string, ReturnType<typeof toTemplateJson>[]>();
  for (const t of templates) {
    const list = byProducer.get(t.producer_id) ?? [];
    list.push(toTemplateJson(t));
    byProducer.set(t.producer_id, list);
  }
  return rows.map((r) => ({ ...r, license_templates: byProducer.get(r.user_id) ?? [] }));
}

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
    const presented = await Promise.all(rows.map(presentBeat));
    res.json({ beats: await attachLicenseTemplates(presented) });
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
    const [withTemplates] = await attachLicenseTemplates([await presentBeat({ ...beat, plays: beat.plays + 1 })]);
    res.json({ beat: withTemplates });
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
   Custom license templates (0187) — producer-owned CRUD.
   A template is an offer definition, not a sale record: editing or
   deleting one changes future sales only. Licenses already sold keep
   the terms snapshot taken at purchase.
───────────────────────────────────────────────────────────────────────────── */

router.get("/beats/license-templates/mine", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(beatLicenseTemplatesTable)
      .where(eq(beatLicenseTemplatesTable.producer_id, req.userId!))
      .orderBy(desc(beatLicenseTemplatesTable.created_at));
    res.json({ templates: rows.map(toTemplateJson) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load license templates";
    res.status(500).json({ error: msg });
  }
});

router.post("/beats/license-templates", requireAuth, async (req, res) => {
  const parsed = beatLicenseTemplateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid license template.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const input = parsed.data;
  try {
    const rows = await db.insert(beatLicenseTemplatesTable).values({
      producer_id: req.userId!,
      name: input.name,
      price_cents: input.priceCents,
      is_exclusive: input.isExclusive,
      format: input.format,
      streams_cap: input.streamsCap ?? null,
      sales_cap: input.salesCap ?? null,
      music_videos_cap: input.musicVideosCap ?? null,
      radio_tv_allowed: input.radioTvAllowed,
      live_performances_cap: input.livePerformancesCap ?? null,
      term_years: input.termYears ?? null,
      territory: input.territory,
      credit_line: input.creditLine ?? null,
      terms_note: input.termsNote ?? null,
    }).returning();
    res.status(201).json({ template: rows[0] ? toTemplateJson(rows[0]) : rows[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create license template";
    res.status(500).json({ error: msg });
  }
});

async function loadOwnedTemplate(req: { userId?: string }, templateId: string, res: { status: (n: number) => { json: (b: unknown) => void } }): Promise<BeatLicenseTemplateRow | null> {
  const rows = await db
    .select()
    .from(beatLicenseTemplatesTable)
    .where(eq(beatLicenseTemplatesTable.id, templateId))
    .limit(1);
  const template = rows[0];
  if (!template) {
    res.status(404).json({ error: "License template not found" });
    return null;
  }
  if (template.producer_id !== req.userId) {
    res.status(403).json({ error: "Only the producer who created this template can change it" });
    return null;
  }
  return template;
}

router.patch("/beats/license-templates/:templateId", requireAuth, async (req, res) => {
  const { templateId } = req.params as { templateId: string };
  const template = await loadOwnedTemplate(req, templateId, res);
  if (!template) return;
  const parsed = beatLicenseTemplatePatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid license template patch.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const p = parsed.data;
  try {
    const updated = await db.update(beatLicenseTemplatesTable).set({
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.priceCents !== undefined ? { price_cents: p.priceCents } : {}),
      ...(p.isExclusive !== undefined ? { is_exclusive: p.isExclusive } : {}),
      ...(p.format !== undefined ? { format: p.format } : {}),
      ...(p.streamsCap !== undefined ? { streams_cap: p.streamsCap } : {}),
      ...(p.salesCap !== undefined ? { sales_cap: p.salesCap } : {}),
      ...(p.musicVideosCap !== undefined ? { music_videos_cap: p.musicVideosCap } : {}),
      ...(p.radioTvAllowed !== undefined ? { radio_tv_allowed: p.radioTvAllowed } : {}),
      ...(p.livePerformancesCap !== undefined ? { live_performances_cap: p.livePerformancesCap } : {}),
      ...(p.termYears !== undefined ? { term_years: p.termYears } : {}),
      ...(p.territory !== undefined ? { territory: p.territory } : {}),
      ...(p.creditLine !== undefined ? { credit_line: p.creditLine } : {}),
      ...(p.termsNote !== undefined ? { terms_note: p.termsNote } : {}),
      updated_at: new Date(),
    }).where(eq(beatLicenseTemplatesTable.id, templateId)).returning();
    res.json({ template: updated[0] ? toTemplateJson(updated[0]) : updated[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update license template";
    res.status(500).json({ error: msg });
  }
});

router.delete("/beats/license-templates/:templateId", requireAuth, async (req, res) => {
  const { templateId } = req.params as { templateId: string };
  const template = await loadOwnedTemplate(req, templateId, res);
  if (!template) return;
  try {
    await db.delete(beatLicenseTemplatesTable).where(eq(beatLicenseTemplatesTable.id, templateId));
    res.json({ deleted: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete license template";
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
    templateId: l.template_id,
    /* The terms exactly as sold — buyer surfaces render from this
       snapshot, never from the (possibly since-edited) template. */
    terms: l.terms_snapshot,
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

  /* Resolve the offer being bought. Fixed tier: the beat's listed tier
     price + the tier's standing terms. Custom template: the template
     must exist AND belong to this beat's producer (templates are
     producer-scoped offers, never cross-producer), the price is the
     producer's own template price, and the terms snapshot is copied
     from the template NOW — later edits never reach this sale. The
     license row's tier records "exclusive" for exclusive templates so
     the verify path's atomic exclusive claim treats them identically
     to the fixed exclusive tier; other templates record "custom". */
  let licenseTier: BeatLicenseTier | "custom";
  let templateId: string | null = null;
  let priceCents: number;
  let termsSnapshot: BeatLicenseTerms;
  if (parsed.data.templateId) {
    const tRows = await db
      .select()
      .from(beatLicenseTemplatesTable)
      .where(eq(beatLicenseTemplatesTable.id, parsed.data.templateId))
      .limit(1);
    const template = tRows[0];
    if (!template) {
      res.status(404).json({ error: "License template not found" });
      return;
    }
    if (template.producer_id !== beat.user_id) {
      res.status(400).json({ error: "That license template doesn't belong to this beat's producer" });
      return;
    }
    templateId = template.id;
    priceCents = template.price_cents;
    termsSnapshot = termsFromTemplateRow(template);
    licenseTier = template.is_exclusive ? "exclusive" : "custom";
  } else {
    const tier = parsed.data.tier as BeatLicenseTier;
    licenseTier = tier;
    priceCents =
      tier === "basic" ? beat.basic_price_cents
      : tier === "premium" ? beat.premium_price_cents
      : beat.exclusive_price_cents;
    termsSnapshot = defaultTermsForTier(tier);
  }

  if (licenseTier === "exclusive" && beat.exclusive_sold) {
    res.status(409).json({ error: "This beat's exclusive license is already sold" });
    return;
  }

  try {
    /* Insert first with a placeholder, then bind the session id — the
       session metadata carries the license id, and the row carries the
       session id, so verify can cross-check both directions. */
    const inserted = await db.insert(beatLicensesTable).values({
      beat_id: beat.id,
      buyer_id: req.userId!,
      producer_id: beat.user_id,
      tier: licenseTier,
      template_id: templateId,
      terms_snapshot: termsSnapshot,
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
        productName: `${beat.title} — ${termsSnapshot.name} license`,
        description: `Beat license (${termsSnapshot.name})`,
        successUrl: `${baseUrl}/beats?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}/beats`,
        metadata: {
          purchase_kind: "beat_license",
          license_id: license.id,
          beat_id: beat.id,
          buyer_user_id: req.userId!,
          tier: licenseTier,
          ...(templateId ? { template_id: templateId } : {}),
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
