import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db, beatsTable, beatLicensesTable, beatLicenseTemplatesTable, creatorProfilesTable } from "@workspace/db";
import { effectiveSearchTokens, searchTextCondition } from "../../lib/search-match";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { generationLimiter } from "../../lib/rate-limit";
import { shouldCountView, viewKey } from "../../lib/view-counting";
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
import { plainWordsForTerms, renderPlainTermsText } from "../../lib/beat-plain-terms";
import { refreshSupabaseStorageUrl, isStorageRef } from "../../lib/objectStorage";
import {
  createPaymentCheckout,
  retrieveCheckoutSession,
  refundCheckoutSessionPayment,
  checkoutBaseUrl,
  isCheckoutTestMode,
  type PaymentCheckoutInput,
} from "../../lib/stripe-checkout";
import { isEmbeddedCheckoutEnabled } from "../../lib/embedded-checkout";
import { createJobNotification } from "../../lib/job-notifications";
import { notifyUserEvent } from "../../lib/push-events";
import { logger } from "../../lib/logger";

/* Mirror-on-save (2026-10-13 law): a listed beat's audio/preview are
   re-hosted into permanent storage at listing time; reads serve fresh
   signed URLs minted from the stored ref (audio_path when present).
   Stems (migration 0304) ride the same pattern: stems_path when
   present is the stored ref, stems_url the served URL. */
async function presentBeat<T extends { audio_url: string; audio_path: string | null; preview_url: string | null; stems_url?: string | null; stems_path?: string | null }>(row: T): Promise<T> {
  const audioSource = row.audio_path ?? row.audio_url;
  const stemsSource = row.stems_path ?? row.stems_url ?? null;
  return {
    ...row,
    audio_url: audioSource ? await refreshSupabaseStorageUrl(audioSource) : row.audio_url,
    preview_url: row.preview_url ? await refreshSupabaseStorageUrl(row.preview_url) : row.preview_url,
    stems_url: stemsSource ? await refreshSupabaseStorageUrl(stemsSource) : null,
    stems_path: row.stems_path ?? null,
  };
}

/**
 * The PUBLIC shape of a beat (guest browse reads — the marketplace is
 * public to browse, D5). audio_url is the FULL master file — the very
 * thing a license sells — while preview_url is the watermarked
 * preview made for listening before buying. The public reads used to
 * hand out the refreshed master next to the preview, so the product
 * itself was free to anyone who opened the payload (public-surface
 * truth, stack1000 R1). On public reads the master is masked behind
 * the preview: audio_url carries the preview's URL and the storage
 * path is dropped. A beat with NO distinct preview keeps the schema's
 * documented fallback (the full file is its preview — the producer
 * never made a separate one). Owner and buyer reads keep presentBeat:
 * a paid license's download IS the master. The stems file
 * (migration 0304) is masked the same way in both branches — it is
 * delivered only through a completed stems license.
 */
export async function presentBeatPublic<T extends { audio_url: string; audio_path: string | null; preview_url: string | null; stems_url?: string | null; stems_path?: string | null }>(row: T): Promise<T> {
  const presented = await presentBeat(row);
  /* Stems are part of what a stems license SELLS (migration 0304) —
     they are masked on public reads in both branches, exactly like
     the master: a completed stems license is the only door. */
  const masked = { ...presented, stems_url: null, stems_path: null };
  if (!presented.preview_url) return masked;
  return { ...masked, audio_url: presented.preview_url, audio_path: null };
}

const router = Router();

/* A license purchase names exactly one offer: a fixed tier OR one of the
   producer's custom templates (migration 0188). */
const beatLicenseSchema = z.object({
  tier: z.enum(["basic", "premium", "exclusive"]).optional(),
  templateId: z.string().uuid().optional(),
  /* N11: the buyer's one tap on the plain-words checkout ("Agree &
     pay"). When true, the license row records terms_accepted_at — the
     durable acceptance of the terms snapshot exactly as rendered in
     plain words. Absent/false keeps the legacy purchase behavior. */
  plainTermsAgreed: z.boolean().optional(),
  /* Embedded checkout (owner law 2026-10-26: never leave the site):
     "embedded" asks createPaymentCheckout for the session's
     clientSecret so the World BeatsDesk mounts the payment form
     in-panel; absent/"hosted" keeps the hosted-URL shape. Honored
     only while the EMBEDDED_CHECKOUT kill switch is on. */
  uiMode: z.enum(["embedded", "hosted"]).optional(),
}).refine((v) => (v.tier === undefined) !== (v.templateId === undefined), {
  message: "Choose exactly one of tier or templateId.",
});

/* ── Custom license templates (0188) ───────────────────────────────────────
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

function termsFromTemplateRow(row: BeatLicenseTemplateRow): BeatLicenseTerms {
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

  /* The try opens before the conditions are built: search resolves
     producer ids with its own reads, and a failure there belongs on
     this route's JSON 500 like every other browse failure. */
  try {
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
    /* Token-AND search (lib/search-match): every meaningful word of
       the query must hit the beat's own text — title, description,
       genre, musical key, mood tags — OR its producer's display name.
       Producer ids are resolved per token (the two-query shape
       attachLicenseTemplates already uses), so "dark shark" finds a
       dark beat by a producer named Shark, and no token can be
       satisfied by the wrong side alone. The old form matched the
       whole string against title/description only: "dark trap" found
       nothing, and producer names were unsearchable. */
    const fields = [
      sql`${beatsTable.title}`,
      sql`${beatsTable.description}`,
      sql`${beatsTable.genre}`,
      sql`${beatsTable.musical_key}`,
      sql`array_to_string(${beatsTable.mood_tags}, ' ')`,
    ];
    const perToken = [];
    for (const tok of effectiveSearchTokens(f.search)) {
      const fieldGroup = searchTextCondition(fields, tok);
      if (!fieldGroup) continue;
      const producers = await db
        .select({ userId: creatorProfilesTable.userId })
        .from(creatorProfilesTable)
        .where(searchTextCondition([sql`${creatorProfilesTable.displayName}`], tok)!)
        .limit(200);
      perToken.push(
        producers.length
          ? or(fieldGroup, inArray(beatsTable.user_id, producers.map((p) => p.userId)))
          : fieldGroup,
      );
    }
    if (perToken.length) conditions.push(and(...perToken));
  }

    const rows = await db
      .select()
      .from(beatsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(beatsTable.created_at))
      .limit(f.limit)
      .offset(f.offset);
    const presented = await Promise.all(rows.map(presentBeatPublic));
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
    // Best-effort play bump — never fails the read. Deduped per
    // viewer+item (lib/view-counting): a refresh storm can't mint
    // plays, and the echoed count only claims the +1 when it landed.
    const countIt = shouldCountView(viewKey("beat", id, req.ip));
    if (countIt) {
      try {
        await db.update(beatsTable)
          .set({ plays: sql`${beatsTable.plays} + 1` })
          .where(eq(beatsTable.id, id));
      } catch { /* ignore */ }
    }
    const [withTemplates] = await attachLicenseTemplates([await presentBeatPublic({ ...beat, plays: beat.plays + (countIt ? 1 : 0) })]);
    res.json({ beat: withTemplates });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch beat";
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/beats/:id/offers — the one-tap lease shelf (N11).
   Every offer on this beat — the fixed tiers the producer priced and
   their custom templates — with the terms rendered IN PLAIN WORDS.
   The words come from the SAME terms objects the purchase snapshots
   (defaultTermsForTier / termsFromTemplateRow), so what the buyer
   reads on this shelf is exactly what lands on their license; the
   tap on "Agree & pay" (POST /beats/:id/license with
   plainTermsAgreed) records the acceptance on the row.
───────────────────────────────────────────────────────────────────────────── */
router.get("/beats/:id/offers", async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const rows = await db.select().from(beatsTable).where(eq(beatsTable.id, id)).limit(1);
    const beat = rows[0];
    if (!beat) {
      res.status(404).json({ error: "Beat not found" });
      return;
    }
    type Offer = {
      kind: "tier" | "template";
      tier: BeatLicenseTier | null;
      templateId: string | null;
      name: string;
      priceCents: number;
      available: boolean;
      terms: BeatLicenseTerms;
      plainWords: ReturnType<typeof plainWordsForTerms>;
      plainText: string;
    };
    const offers: Offer[] = [];
    const tierPrices: Array<{ tier: BeatLicenseTier; price: number | null }> = [
      { tier: "basic", price: beat.basic_price_cents },
      { tier: "premium", price: beat.premium_price_cents },
      { tier: "exclusive", price: beat.exclusive_price_cents },
    ];
    for (const { tier, price } of tierPrices) {
      if (price === null || price === undefined || price <= 0) continue;
      const terms = defaultTermsForTier(tier);
      offers.push({
        kind: "tier",
        tier,
        templateId: null,
        name: terms.name,
        priceCents: price,
        /* An exclusive sale closes the WHOLE shelf, not just the
           exclusive offer (stack1100 X4): the exclusive buyer's plain
           words promise the producer stops selling this beat. */
        available: !beat.exclusive_sold,
        terms,
        plainWords: plainWordsForTerms(terms),
        plainText: renderPlainTermsText(terms),
      });
    }
    const templates = await db
      .select()
      .from(beatLicenseTemplatesTable)
      .where(eq(beatLicenseTemplatesTable.producer_id, beat.user_id))
      .orderBy(desc(beatLicenseTemplatesTable.created_at));
    for (const t of templates) {
      const terms = termsFromTemplateRow(t);
      offers.push({
        kind: "template",
        tier: null,
        templateId: t.id,
        name: terms.name,
        priceCents: t.price_cents,
        available: !beat.exclusive_sold,
        terms,
        plainWords: plainWordsForTerms(terms),
        plainText: renderPlainTermsText(terms),
      });
    }
    res.json({ beat_id: beat.id, title: beat.title, offers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load offers";
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
    const storedStemsUrl = m.stemsUrl
      ? ((await mirrorExternalMediaUrl(m.stemsUrl, { kind: "audio", ownerKey: req.userId! })) ?? m.stemsUrl)
      : null;
    const rows = await db.insert(beatsTable).values({
      user_id: req.userId!,
      title: m.title,
      audio_url: storedAudioUrl,
      audio_path: isStorageRef(storedAudioUrl) ? storedAudioUrl : (m.audioPath ?? null),
      preview_url: storedPreviewUrl,
      stems_url: storedStemsUrl,
      stems_path: storedStemsUrl && isStorageRef(storedStemsUrl) ? storedStemsUrl : null,
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

    /* The headline numbers read COMPLETED sales only — the same
       contract the earnings rail (lib/seller-earnings sellerBeats)
       and the reversal engine keep ("producer numbers read
       status='completed' only"). Until stack1100 X4 these stats
       summed EVERY row: an abandoned checkout (pending_payment) and
       a refunded sale both inflated the producer's Gross / Your cut
       and the Licenses count. The sales LIST below keeps every row —
       pending and refunded sales are the producer's record, and the
       page names each row's state; only the totals were lying. */
    const completedSales = sales.filter((l: { status: string }) => l.status === "completed");
    const grossCents = completedSales.reduce((s: number, l: { price_cents: number }) => s + l.price_cents, 0);
    const commissionCents = completedSales.reduce((s: number, l: { commission_cents: number }) => s + l.commission_cents, 0);

    res.json({
      beats: await Promise.all(myBeats.map(presentBeat)),
      sales,
      stats: {
        beatCount: myBeats.length,
        saleCount: completedSales.length,
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
   Custom license templates (0188) — producer-owned CRUD.
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
   POST /api/beats/:id/ai-tags — AI tag suggester (100 credits).
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
  /* Stems can be added after listing (migration 0304) — the natural
     remediation when a stems-bearing license sells and the producer
     had not uploaded them yet. Mirrored into permanent storage
     exactly like the listing path. */
  let stemsPatch: { stems_url: string; stems_path: string | null } | null = null;
  if (p.stemsUrl !== undefined) {
    const storedStems =
      (await mirrorExternalMediaUrl(p.stemsUrl, { kind: "audio", ownerKey: req.userId! })) ?? p.stemsUrl;
    stemsPatch = { stems_url: storedStems, stems_path: isStorageRef(storedStems) ? storedStems : null };
  }
  try {
    const updated = await db.update(beatsTable).set({
      ...(stemsPatch ?? {}),
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
   Completion runs through settleBeatLicenseSession (below): verify
   re-retrieves the session, requires payment_status 'paid', the buyer
   to match, and the paid total to equal the license's locked price;
   the Stripe webhook settles the same session when the buyer never
   returns (WEBHOOK-SETTLE, stack1200).
───────────────────────────────────────────────────────────────────────────── */

type BeatLicenseRow = typeof beatLicensesTable.$inferSelect;

function toLicenseJson(l: BeatLicenseRow) {
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
    /* N11: the plain words of the sold terms + when the buyer agreed
       to them on the one-tap checkout (null = bought without the tap). */
    plainWords: l.terms_snapshot ? plainWordsForTerms(l.terms_snapshot) : null,
    termsAcceptedAt: l.terms_accepted_at,
    priceCents: l.price_cents,
    commissionCents: l.commission_cents,
    status: l.status,
    createdAt: l.created_at,
  };
}

/* ── Stems delivery (migration 0304, stack1100 X4) ───────────────────
   A completed license delivers the beat's stems ONLY when the terms
   it was sold under carry a stems format — the purchase-time snapshot
   decides, so a later template edit can neither grant nor revoke
   stems on a sold license. A beat with no stems on file delivers
   null: the slot exists; filling it is the producer's move (PATCH). */
function licenseStemsUrl(
  terms: BeatLicenseTerms | null | undefined,
  presented: { stems_url?: string | null },
): string | null {
  if (!terms) return null;
  if (terms.format !== "wav_mp3_stems" && terms.format !== "ownership_stems") return null;
  return presented.stems_url ?? null;
}

/* ── Undeliverable files (stack1400 ruling #23, H-1) ─────────────────
   A buyer must never be left paid-for-nothing on a file that cannot
   be delivered. Remedy order: (1) REDELIVERY — the producer gets a
   window to supply the missing file (stems via the PATCH path that
   already existed; the master via the same PATCH, extended below);
   (2) AUTO-REFUND — past the window, the purchase refunds in full
   through the ONE existing refund helper.

   UNDELIVERABLE is judged from STORED STATE only (no live probing
   of external hosts): the master is missing when the beat row has
   neither an audio_url nor an audio_path; the stems are missing
   when a license whose sold terms carry a stems format has a beat
   with neither a stems_url nor a stems_path.

   WINDOW: 7 days from the license's creation. No source report
   named a window; 7 days is the codebase's existing comparable
   fan-facing grace window (DUNNING_GRACE_DAYS in lib/dunning.ts —
   the payment-failure grace — itself mirroring the 7-day trial).

   No new cron: the check is evaluated where the code already flows
   — the settle and GET /beats/licenses/mine (plus the producer
   dashboard's sales list, read-only) — so the refund is reachable
   on the buyer's next library read the moment the window lapses. */
export const BEAT_DELIVERY_WINDOW_DAYS = 7;
const BEAT_DELIVERY_WINDOW_MS = BEAT_DELIVERY_WINDOW_DAYS * 24 * 3600 * 1000;

type BeatRowForDelivery = {
  audio_url: string | null;
  audio_path: string | null;
  stems_url?: string | null;
  stems_path?: string | null;
};

interface BeatDeliveryAssessment {
  masterMissing: boolean;
  stemsMissing: boolean;
  undeliverable: boolean;
  missingDelivery: Array<"master" | "stems">;
  /** created_at + window — the moment redelivery stops being enough. */
  deadline: Date;
  expired: boolean;
}

function assessBeatDelivery(
  license: { terms_snapshot: BeatLicenseTerms | null; created_at: Date | string },
  beat: BeatRowForDelivery,
  now: Date = new Date(),
): BeatDeliveryAssessment {
  const masterMissing = !(beat.audio_url ?? "").trim() && !(beat.audio_path ?? "").trim();
  const terms = license.terms_snapshot;
  const stemsOwed =
    !!terms && (terms.format === "wav_mp3_stems" || terms.format === "ownership_stems");
  const stemsMissing =
    stemsOwed && !(beat.stems_url ?? "").trim() && !(beat.stems_path ?? "").trim();
  const missingDelivery: Array<"master" | "stems"> = [];
  if (masterMissing) missingDelivery.push("master");
  if (stemsMissing) missingDelivery.push("stems");
  const deadline = new Date(new Date(license.created_at).getTime() + BEAT_DELIVERY_WINDOW_MS);
  return {
    masterMissing,
    stemsMissing,
    undeliverable: missingDelivery.length > 0,
    missingDelivery,
    deadline,
    expired: now.getTime() > deadline.getTime(),
  };
}

/** The delivery fields a completed license's surfaces carry. A
    missing file is NEVER handed back as a download: the URL is null
    and the state names what is owed and by when. */
function deliveryFieldsFor(
  license: BeatLicenseRow,
  beat: BeatRowForDelivery,
  presented: { audio_url: string; stems_url?: string | null },
  assessment: BeatDeliveryAssessment,
) {
  return {
    downloadUrl: assessment.masterMissing ? null : presented.audio_url,
    stemsUrl: assessment.stemsMissing ? null : licenseStemsUrl(license.terms_snapshot, presented),
    deliveryState: assessment.undeliverable ? "awaiting_delivery" : "delivered",
    deliveryDeadline: assessment.undeliverable ? assessment.deadline.toISOString() : null,
    missingDelivery: assessment.missingDelivery,
    deliveryMessage: assessment.undeliverable
      ? "Waiting on the producer to deliver the file for this license. If it's still missing after the delivery window, you'll be refunded in full automatically."
      : null,
  };
}

const UNDELIVERABLE_REFUNDED_MESSAGE =
  "The file for this license was never delivered, so your payment has been refunded in full.";
const UNDELIVERABLE_REFUND_FAILED_MESSAGE =
  "The file for this license was never delivered. Your payment couldn't be refunded automatically — contact support and we'll make it right.";

/** Auto-refund ONE undeliverable license whose window has lapsed,
    through the existing refund helper ONLY. Exactly-once: the
    helper keys its Stripe refund `refund:<session id>`, and on
    success the license flips to 'refunded' behind a guard on the
    status it was read with — every later evaluation sees the
    terminal status and never calls the helper again. The flip (and
    the claim of a refund) happens ONLY when the helper says the
    refund landed. An auto-refunded exclusive releases the beat,
    mirroring the payment-reversals beat_license case. */
async function autoRefundUndeliverableLicense(
  license: BeatLicenseRow,
  session?: Awaited<ReturnType<typeof retrieveCheckoutSession>>,
): Promise<boolean> {
  let paidSession = session;
  if (!paidSession) {
    if (!license.stripe_session_id) return false;
    try {
      paidSession = await retrieveCheckoutSession(license.stripe_session_id);
    } catch {
      return false;
    }
  }
  const refunded = await refundCheckoutSessionPayment(paidSession);
  if (!refunded) return false;
  const flipped = await db
    .update(beatLicensesTable)
    .set({ status: "refunded" })
    .where(
      and(
        eq(beatLicensesTable.id, license.id),
        eq(beatLicensesTable.status, license.status),
      ),
    )
    .returning();
  if (flipped.length > 0 && license.tier === "exclusive") {
    await db
      .update(beatsTable)
      .set({ exclusive_sold: false, updated_at: new Date() })
      .where(and(eq(beatsTable.id, license.beat_id), eq(beatsTable.exclusive_sold, true)))
      .catch(() => {});
  }
  return flipped.length > 0;
}

const licenseVerifySchema = z.object({
  sessionId: z.string().min(1).max(200),
});

/* ─── Beat-license settle (WEBHOOK-SETTLE, stack1200) ─────────────────
   ONE settle path takes a paid beat-license session to a completed
   license. Both completion paths run through it: the buyer's
   return-verify (below) and the Stripe webhook (stripe-webhook.ts,
   keyed on purchase_kind "beat_license"). Before the webhook door
   existed, verify was the ONLY path to 'completed' — the webhook
   had no branch for these sessions, so a paid license fell through
   the dispatch to the credit-grant tail's "missing user_id"
   warning, and a producer who closed the tab after paying kept a
   pending_payment license forever: money taken, no download, no
   stems. Exactly-once: the exclusive tier is serialized by its
   atomic beat-row claim, and the completion flip is now guarded on
   status 'pending_payment' — a racing settle's loser flips nothing
   and answers as the duplicate it is. Amounts, tiers and delivery
   are unchanged — the settle returns the very { status, body }
   verify always answered. */

export interface BeatLicenseSettleResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

/** Settle a paid beat-license checkout session. The caller asserts
    the session is paid (verify asks Stripe; the webhook trusts the
    signature-verified event) and names the buyer (verify: the
    signed-in user; the webhook: the session metadata's buyer —
    the ownership check below then trivially holds). */
export async function settleBeatLicenseSession(
  session: Awaited<ReturnType<typeof retrieveCheckoutSession>>,
  opts: { buyerUserId: string },
): Promise<BeatLicenseSettleResult> {
  const sessionId = session.id;
  /* The settle owns the paid invariant: no caller (verify or
     webhook) can complete a license off an unpaid session, even
     though both already check before calling. */
  if (session.payment_status !== "paid") {
    return { httpStatus: 400, body: { error: "Payment has not been completed." } };
  }
  const meta = session.metadata ?? {};
  if (meta["purchase_kind"] !== "beat_license" || !meta["license_id"]) {
    return { httpStatus: 400, body: { error: "This session isn't a beat license purchase." } };
  }
  if (meta["buyer_user_id"] !== opts.buyerUserId) {
    return { httpStatus: 403, body: { error: "This purchase doesn't belong to you." } };
  }

  try {
    const rows = await db
      .select()
      .from(beatLicensesTable)
      .where(eq(beatLicensesTable.stripe_session_id, sessionId))
      .limit(1);
    const license = rows[0];
    if (!license || license.id !== meta["license_id"]) {
      return { httpStatus: 400, body: { error: "License for this session not found." } };
    }
    if ((session.amount_total ?? 0) !== license.price_cents) {
      return { httpStatus: 400, body: { error: "The paid amount doesn't match the license price." } };
    }
    const beatRows = await db.select().from(beatsTable).where(eq(beatsTable.id, license.beat_id)).limit(1);
    const beat = beatRows[0];
    if (!beat) {
      /* Paid, but the beat was deleted after payment — the license
         can NEVER be recorded (Lane V3 F3). Refund automatically;
         the claim is made only when the refund landed. */
      const refunded = await refundCheckoutSessionPayment(session);
      return {
        httpStatus: 400,
        body: {
          error: refunded
            ? "The beat for this license no longer exists — your payment has been refunded in full."
            : "The beat for this license no longer exists. Your payment couldn't be refunded automatically — contact support and we'll make it right.",
          refunded,
        },
      };
    }
    const presented = await presentBeat(beat);
    /* Undeliverable-file discipline (ruling #23): judged from the
       stored row, never by probing the file's host. */
    const delivery = assessBeatDelivery(license, beat);
    if (license.status === "refunded") {
      /* Already refunded (auto-refund at the delivery window, or a
         reversal): a replayed verify must never re-complete it or
         refund it a second time. */
      return {
        httpStatus: 200,
        body: {
          success: true,
          duplicate: true,
          refunded: true,
          license: toLicenseJson(license),
          downloadUrl: null,
          stemsUrl: null,
          deliveryState: "refunded",
          deliveryMessage: UNDELIVERABLE_REFUNDED_MESSAGE,
        },
      };
    }
    if (license.status === "completed") {
      if (delivery.undeliverable && delivery.expired) {
        const refunded = await autoRefundUndeliverableLicense(license, session);
        if (refunded) {
          return {
            httpStatus: 200,
            body: {
              success: true,
              duplicate: true,
              refunded: true,
              license: toLicenseJson({ ...license, status: "refunded" }),
              downloadUrl: null,
              stemsUrl: null,
              deliveryState: "refunded",
              deliveryMessage: UNDELIVERABLE_REFUNDED_MESSAGE,
            },
          };
        }
        return {
          httpStatus: 200,
          body: {
            success: true,
            duplicate: true,
            refunded: false,
            license: toLicenseJson(license),
            ...deliveryFieldsFor(license, beat, presented, delivery),
            deliveryMessage: UNDELIVERABLE_REFUND_FAILED_MESSAGE,
          },
        };
      }
      return {
        httpStatus: 200,
        body: {
          success: true,
          duplicate: true,
          license: toLicenseJson(license),
          ...deliveryFieldsFor(license, beat, presented, delivery),
        },
      };
    }
    if (delivery.undeliverable && delivery.expired) {
      /* The redelivery window already lapsed before this paid
         session settled (a very late return/webhook): there is
         nothing left to wait for — refund now, exactly once, and
         mark the license refunded. A failed refund is reported
         honestly and the row stays pending for the next attempt. */
      const refunded = await autoRefundUndeliverableLicense(license, session);
      return {
        httpStatus: 409,
        body: {
          error: refunded
            ? "The file for this license was never delivered. Your payment has been refunded in full."
            : UNDELIVERABLE_REFUND_FAILED_MESSAGE,
          refunded,
        },
      };
    }
    /* A paid session this settle refuses for a reason that can
       NEVER clear on retry — a rival COMPLETED the exclusive, or
       this license's market was closed by a completed exclusive —
       is fulfillment-impossible in exactly the Lane V3 F3 sense the
       beat-deleted path above already auto-refunds. Refund it here
       too: the claim is made only when the refund landed, and the
       helper's per-session refund idempotency key
       (lib/stripe-checkout) keeps a replayed refusal from
       double-refunding. A refusal that CAN still clear — a rival
       merely pending behind a dangling flag — stays a plain
       retryable 409 below with no refund. (Gate #5 beats-fail lane:
       before this, the losing exclusive buyer was 409'd with their
       money kept, and an in-flight non-exclusive checkout paid after
       the exclusive completed settled anyway, breaching the
       exclusive buyer's "producer stops selling this beat" terms.) */
    const refuseWithRefund = async (error: string): Promise<BeatLicenseSettleResult> => {
      const refunded = await refundCheckoutSessionPayment(session);
      return {
        httpStatus: 409,
        body: {
          error: refunded
            ? `${error} Your payment has been refunded in full.`
            : `${error} Your payment couldn't be refunded automatically — contact support and we'll make it right.`,
          refunded,
        },
      };
    };
    if (license.tier !== "exclusive" && beat.exclusive_sold) {
      /* An exclusive sale closes the WHOLE market (stack1100 X4) —
         the creation rail and the offers shelf already close, but an
         in-flight checkout started before the sale could still
         settle after it, re-selling in slices what the exclusive
         buyer paid to own outright. The settle is the last door:
         when a COMPLETED exclusive exists for this beat, a pending
         non-exclusive license can never be fulfilled. A dangling
         flag with no completed exclusive is a crashed attempt, not
         a sale (the C2 philosophy) — it does not strand this buyer. */
      const exclusives = await db
        .select()
        .from(beatLicensesTable)
        .where(and(eq(beatLicensesTable.beat_id, beat.id), eq(beatLicensesTable.tier, "exclusive")));
      if (exclusives.some((l) => l.status === "completed")) {
        return refuseWithRefund("This beat was sold exclusively before this purchase could complete.");
      }
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
           earlier attempt) — a rival still pending keeps the 409.
           A REFUNDED rival is terminal, not pending (stack1100 X4):
           its reversal already released its claim on the beat, so it
           must never block this release — the old "not completed"
           test counted refunded rows as live rivals forever. */
        const others = await db
          .select()
          .from(beatLicensesTable)
          .where(and(eq(beatLicensesTable.beat_id, beat.id), eq(beatLicensesTable.tier, "exclusive")));
        const rivalCompleted = others.some((l) => l.id !== license.id && l.status === "completed");
        const rivalPending = others.some((l) => l.id !== license.id && l.status === "pending_payment");
        if (rivalCompleted) {
          /* Definitive loss: this paid session can never complete —
             refund it like every other fulfillment-impossible paid
             session on this rail. */
          return refuseWithRefund("This beat's exclusive license was sold to someone else first.");
        }
        if (rivalPending) {
          /* Not yet a loss: the rival has not paid to completion and
             its claim may still be released (refunded rivals already
             don't count above) — plain retryable 409, no refund. */
          return { httpStatus: 409, body: { error: "This beat's exclusive license was sold to someone else first." } };
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
        /* The atomic claim went to a racing settle — this paid
           session lost the beat for good; refund it. */
        return refuseWithRefund("This beat's exclusive license was sold to someone else first.");
      }
    }
    let updated: typeof license | undefined;
    try {
      [updated] = await db
        .update(beatLicensesTable)
        .set({ status: "completed" })
        .where(and(eq(beatLicensesTable.id, license.id), eq(beatLicensesTable.status, "pending_payment")))
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
    if (!updated) {
      /* The completion flip matched nothing: a racing settle (the
         webhook against this verify, or two of either) completed
         the license in the awaits above. The beat is delivered —
         answer as the duplicate this call now is. */
      return {
        httpStatus: 200,
        body: {
          success: true,
          duplicate: true,
          license: toLicenseJson({ ...license, status: "completed" }),
          ...deliveryFieldsFor({ ...license, status: "completed" }, beat, presented, delivery),
        },
      };
    }
    /* The sale just landed — this flip is its one landing, and
       only the winner reaches this line (the loser answered
       duplicate above), so the producer tell fires here, inside
       the shared settle, whichever door carried the payment home.
       The helper never throws. */
    await notifyBeatSaleSafely(updated, beat.title);
    return {
      httpStatus: 200,
      body: {
        success: true,
        duplicate: false,
        license: toLicenseJson(updated),
        /* A sale whose file is missing completes as AWAITING
           delivery — never as delivered with a dead download. The
           producer's window runs from the license's creation; the
           buyer's library heals the moment the file lands, and the
           window's lapse auto-refunds (licenses/mine evaluation). */
        ...deliveryFieldsFor(updated, beat, presented, delivery),
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to verify license";
    return { httpStatus: 500, body: { error: msg } };
  }
}
/* POST /api/beats/licenses/verify — the buyer's return path from
   paid checkout to a completed license; the Stripe webhook settles
   the same session through the same settle when the buyer never
   returns. */
/* The producer tell (BEATS-SETTLE, stack1200) — the notify-census
   lane's fix #5 in the shape THIS lineage needs. That lane wired
   the tell into its own verify-local completion (its finding #4
   recorded that beats had no webhook settle — true on its base,
   already fixed here by WEBHOOK-SETTLE). On this branch completion
   lives in the shared settle below, so the tell hangs off the
   settle's completion-flip win and fires identically from the
   webhook door (buyer closed the tab) and the verify door. Same
   claim-first shape as the storefront sale finale
   (lib/market-sale.ts): the claim (jobType "sale", jobId
   `beat-license:<id>`) lands on the unique (job_type, job_id)
   key — only its winner fires the door, so racing doors and
   replays tell exactly once. Copy names the TRUE money: the
   producer's net from the row's own price − commission, never
   the gross. Best-effort: a tell failure never fails the
   buyer's completion. */
async function notifyBeatSaleSafely(license: {
  id: string;
  producer_id: string;
  price_cents: number;
  commission_cents: number;
  tier: string;
}, beatTitle: string): Promise<void> {
  const title = "Your beat just sold 👑";
  const message = `${beatTitle} (${license.tier}) — net $${((license.price_cents - license.commission_cents) / 100).toFixed(2)} to you. See it in your beat dashboard.`;
  try {
    const claimed = await createJobNotification({
      jobType: "sale",
      jobId: `beat-license:${license.id}`,
      userId: license.producer_id,
      projectId: null,
      status: "completed",
      title,
      message,
    });
    if (!claimed) return; // a twin request already claimed the tell
    await notifyUserEvent({
      userId: license.producer_id,
      category: "money",
      kind: "beat_sale",
      title,
      body: message,
      link: "/beats",
    });
  } catch (err) {
    logger.warn({ err, licenseId: license.id }, "[beats] producer sale tell failed (sale stands)");
  }
}

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
  const result = await settleBeatLicenseSession(session, { buyerUserId: req.userId! });
  res.status(result.httpStatus).json(result.body);
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
  /* An exclusive sale takes the beat OFF the market. The plain words
     every exclusive buyer agrees to say "once you buy it, the producer
     stops selling this beat", and the producer's own template copy
     says an exclusive "sells once, then the beat is off the market".
     Until stack1100 X4 the rail only blocked buying a SECOND
     exclusive — basic, premium and custom licenses kept selling on a
     beat whose buyer had paid for sole ownership, so "full ownership"
     was re-sold in slices. The closure sits at the purchase rail for
     EVERY offer (fixed tiers and custom templates alike); browse and
     preview stay up — listening is not selling. */
  if (beat.exclusive_sold) {
    res.status(409).json({ error: "This beat was sold exclusively and is no longer for sale." });
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
      terms_accepted_at: parsed.data.plainTermsAgreed ? new Date() : null,
    }).returning();
    const license = inserted[0]!;

    /* Embedded presentation is asked for per-request and honored only
       while the EMBEDDED_CHECKOUT kill switch is on — the metadata and
       every money figure are identical either way; only the
       presentation differs (the helper's idempotency key fingerprints
       the exact parameters, so each presentation is its own request). */
    const embeddedRequested =
      parsed.data.uiMode === "embedded" && isEmbeddedCheckoutEnabled();

    let session: { sessionId: string; url: string } | { sessionId: string; clientSecret: string };
    try {
      const baseUrl = checkoutBaseUrl(req);
      const checkoutInput: PaymentCheckoutInput = {
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
        /* A beat license is a digital audio work (lib/stripe-tax.ts). */
        taxKind: "store-audio",
      };
      session = embeddedRequested
        ? await createPaymentCheckout({ ...checkoutInput, uiMode: "embedded" })
        : await createPaymentCheckout(checkoutInput);
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

    const checkoutUrl = "url" in session ? session.url : null;
    const clientSecret = "clientSecret" in session ? session.clientSecret : null;

    res.status(201).json({
      license: toLicenseJson(bound ?? license),
      /* Embedded sessions have no hosted URL to hand back — the
         clientSecret is what the in-World desk mounts in-panel (null
         on the hosted shape, mirroring routes/storefront.ts). */
      checkoutUrl,
      clientSecret,
      uiMode: embeddedRequested ? "embedded" : "hosted",
      sessionId: session.sessionId,
      paymentStatus: "pending_payment",
      testMode: isCheckoutTestMode(),
      message: embeddedRequested
        ? "License reserved — complete checkout right here to activate it. No charge has been made yet."
        : "License reserved — complete checkout to activate it. No charge has been made yet.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to start license checkout";
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/beats/licenses/mine — buyer's license library (auth).
   Entitlement (downloadUrl, and stemsUrl when the sold terms carry
   stems) is present ONLY on completed licenses. Every row names its
   beat (beatTitle) so the library reads as purchases, not ids.
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
      const beatRows = await db.select().from(beatsTable).where(eq(beatsTable.id, l.beat_id)).limit(1);
      const beat = beatRows[0];
      let downloadUrl: string | null = null;
      let stemsUrl: string | null = null;
      if (l.status === "completed" && beat) {
        const presented = await presentBeat(beat);
        downloadUrl = presented.audio_url;
        stemsUrl = licenseStemsUrl(l.terms_snapshot, presented);
      }
      out.push({ ...toLicenseJson(l), beatTitle: beat?.title ?? null, downloadUrl, stemsUrl });
    }
    res.json({ licenses: out });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load licenses";
    res.status(500).json({ error: msg });
  }
});

export default router;
