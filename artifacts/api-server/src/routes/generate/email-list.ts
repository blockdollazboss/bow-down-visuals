import { Router } from "express";
import { z } from "zod";
import { eq, and, count, desc, inArray, isNull } from "drizzle-orm";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { recordCreditUsage } from "../../lib/payment-record";
import {
  db,
  emailListsTable,
  emailSubscribersTable,
  emailCampaignsTable,
  emailCampaignDeliveriesTable,
  emailAutomationsTable,
  emailSegmentsTable,
  emailSubscriberTagsTable,
  emailTagsTable,
  insertEmailListSchema,
  EMAIL_AUTOMATION_KINDS,
  type EmailAutomationKind,
} from "@workspace/db";
import {
  autoTagsFor,
  evaluateSegment,
  loadListFacts,
  normalizeCriteria,
  parseStoredCriteria,
} from "../../lib/email-segments";
import { dispatchCampaign } from "../../lib/email-campaign-send";
import { ensureAutomationsForList, automationDto } from "../../lib/email-automations";
import {
  EMAIL_NEWSLETTER_CREDIT_COST,
  EMAIL_FREE_SUBSCRIBER_LIMIT,
  isValidHandle,
  isValidEmail,
  isNewsletterTone,
  buildNewsletterPrompt,
  parseNewsletterDraft,
  subscribersToCsv,
  NEWSLETTER_TONES,
} from "./email-list-helpers";

const router = Router();

/* ─── Email List Builder ──────────────────────────────────────────────────
   Creators own their fan list: hosted landing pages (/join/:handle),
   embeddable signup forms, AI newsletter drafts, subscriber dashboard,
   welcome-email automation, CSV export.

   Pricing rule: lists/subscribers/dashboard/export are pure interface +
   data — free. The AI newsletter writer burns compute — 1 credit per
   draft, charged BEFORE the model call, refunded on provider failure.

   Honesty: sends go through the house Resend rail with best-effort
   deliverability — no guaranteed inbox placement, disclosed in the UI.
   Engagement (opens/clicks) is tracked for real since migration 0188:
   a house pixel + wrapped-link redirects on every campaign send, plus
   the signature-verified Resend webhook, deduplicated first-signal-
   wins into email_engagement_events. Stats below read those recorded
   signals only — a list that has never sent reports opensTracked
   false and a null open rate, never a fabricated number. Tags and
   segments (lib/email-segments) build audiences over the same rail;
   unsubscribed addresses are excluded from every audience, always. */

/* ── Public: subscribe (no auth — used by embed forms + landing pages) ── */

const subscribeSchema = z.object({
  handle: z.string().min(1),
  email: z.string().min(1),
  name: z.string().max(120).optional().default(""),
  source: z.enum(["embed", "landing", "import"]).default("landing"),
});

router.post("/email-list/subscribe", publicApiLimiter, async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid signup request." });
    return;
  }
  const { handle, source } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();
  const name = parsed.data.name.trim();

  if (!isValidEmail(email)) {
    res.status(400).json({ error: "Enter a valid email address.", code: "invalid_email" });
    return;
  }

  const [list] = await db
    .select()
    .from(emailListsTable)
    .where(eq(emailListsTable.handle, handle.toLowerCase()))
    .limit(1);
  if (!list) {
    res.status(404).json({ error: "List not found.", code: "list_not_found" });
    return;
  }

  /* Free tier: 1,000 subscribers per list. */
  const [{ value: subCount }] = await db
    .select({ value: count() })
    .from(emailSubscribersTable)
    .where(
      and(
        eq(emailSubscribersTable.listId, list.id),
        isNull(emailSubscribersTable.unsubscribedAt)
      )
    );
  if (subCount >= EMAIL_FREE_SUBSCRIBER_LIMIT) {
    res.status(403).json({
      error: "This list is full.",
      code: "list_full",
      message: `This list has reached the ${EMAIL_FREE_SUBSCRIBER_LIMIT}-subscriber free tier.`,
    });
    return;
  }

  /* Idempotent: re-subscribing the same email re-activates it. */
  const [existing] = await db
    .select()
    .from(emailSubscribersTable)
    .where(
      and(
        eq(emailSubscribersTable.listId, list.id),
        eq(emailSubscribersTable.email, email)
      )
    )
    .limit(1);

  if (existing) {
    if (existing.unsubscribedAt) {
      await db
        .update(emailSubscribersTable)
        .set({ unsubscribedAt: null, name: name || existing.name, source })
        .where(eq(emailSubscribersTable.id, existing.id));
    }
    res.json({ ok: true, alreadySubscribed: true, listName: list.name });
    return;
  }

  await db.insert(emailSubscribersTable).values({
    listId: list.id,
    email,
    name: name || null,
    source,
    confirmed: true,
  });

  /* Welcome-email automation (v1: queued server-side; honest limits in UI).
     Best-effort — a welcome failure never fails the signup. */
  if (list.welcomeSubject && list.welcomeBody) {
    try {
      await db.insert(emailCampaignsTable).values({
        listId: list.id,
        subject: list.welcomeSubject,
        body: `Hi${name ? ` ${name}` : ""},\n\n${list.welcomeBody}`,
        status: "queued",
        recipientCount: 1,
      });
    } catch (err) {
      logger.warn({ err, listId: list.id }, "[email-list] welcome email queue failed (signup still succeeded)");
    }
  }

  res.json({ ok: true, listName: list.name });
});

/* ── Public: resolve a landing page handle (no auth) ───────────────────── */

router.get("/email-list/join/:handle", publicApiLimiter, async (req, res) => {
  const handle = String(req.params.handle ?? "").toLowerCase();
  const [list] = await db
    .select({
      name: emailListsTable.name,
      handle: emailListsTable.handle,
      description: emailListsTable.description,
    })
    .from(emailListsTable)
    .where(eq(emailListsTable.handle, handle))
    .limit(1);
  if (!list) {
    res.status(404).json({ error: "List not found.", code: "list_not_found" });
    return;
  }
  res.json({ list });
});

/* ── Authed: lists ─────────────────────────────────────────────────────── */

router.get("/email-list/lists", publicApiLimiter, requireAuth, async (req, res) => {
  const lists = await db
    .select()
    .from(emailListsTable)
    .where(eq(emailListsTable.userId, req.userId!))
    .orderBy(desc(emailListsTable.createdAt));
  res.json({ lists });
});

router.post("/email-list/lists", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = insertEmailListSchema
    .omit({ userId: true })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid list.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const handle = parsed.data.handle.toLowerCase();
  if (!isValidHandle(handle)) {
    res.status(400).json({
      error: "That handle isn't available.",
      code: "handle_unavailable",
    });
    return;
  }
  const [taken] = await db
    .select({ id: emailListsTable.id })
    .from(emailListsTable)
    .where(eq(emailListsTable.handle, handle))
    .limit(1);
  if (taken) {
    res.status(409).json({ error: "That handle is taken.", code: "handle_taken" });
    return;
  }
  const [list] = await db
    .insert(emailListsTable)
    .values({ ...parsed.data, handle, userId: req.userId! })
    .returning();
  res.status(201).json({ list });
});

router.patch("/email-list/lists/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const parsed = insertEmailListSchema
    .omit({ userId: true, handle: true })
    .partial()
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid list update." });
    return;
  }
  const [updated] = await db
    .update(emailListsTable)
    .set(parsed.data)
    .where(and(eq(emailListsTable.id, id), eq(emailListsTable.userId, req.userId!)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  res.json({ list: updated });
});

router.delete("/email-list/lists/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const [deleted] = await db
    .delete(emailListsTable)
    .where(and(eq(emailListsTable.id, id), eq(emailListsTable.userId, req.userId!)))
    .returning({ id: emailListsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  res.json({ ok: true });
});

/* ── Authed: subscribers + dashboard ───────────────────────────────────── */

router.get("/email-list/lists/:id/subscribers", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const [list] = await db
    .select()
    .from(emailListsTable)
    .where(and(eq(emailListsTable.id, id), eq(emailListsTable.userId, req.userId!)))
    .limit(1);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  const subscribers = await db
    .select()
    .from(emailSubscribersTable)
    .where(eq(emailSubscribersTable.listId, id))
    .orderBy(desc(emailSubscribersTable.subscribedAt))
    .limit(500);
  const active = subscribers.filter((s) => !s.unsubscribedAt);
  /* Engagement is tracked for real (migration 0188): opens and clicks
     land in email_engagement_events from the house pixel/redirect and
     the verified Resend webhook, and the recorder maintains the
     opens/clicks counters read here. A list with no tracked sends yet
     has no signal at all — it still reports opensTracked false and a
     null rate rather than dressing up "never measured" as 0%. */
  const facts = await loadListFacts(list, subscribers);
  const enriched = subscribers.map((s) => {
    const f = facts.get(s.id);
    return {
      ...s,
      tags: f ? [...f.manualTags] : [],
      autoTags: f ? autoTagsFor(f, s.source) : [],
    };
  });
  const [deliveryCount] = await db
    .select({ value: count() })
    .from(emailCampaignDeliveriesTable)
    .innerJoin(emailCampaignsTable, eq(emailCampaignDeliveriesTable.campaignId, emailCampaignsTable.id))
    .where(eq(emailCampaignsTable.listId, id));
  const opensTracked = (deliveryCount?.value ?? 0) > 0;
  const totalOpens = active.reduce((sum, s) => sum + s.opens, 0);
  const totalClicks = active.reduce((sum, s) => sum + s.clicks, 0);
  res.json({
    subscribers: enriched,
    stats: {
      total: subscribers.length,
      active: active.length,
      unsubscribed: subscribers.length - active.length,
      openRate: opensTracked && active.length > 0 ? totalOpens / active.length : null,
      opensTracked,
      totalOpens,
      totalClicks,
      freeLimit: EMAIL_FREE_SUBSCRIBER_LIMIT,
    },
  });
});

router.post("/email-list/lists/:id/unsubscribe", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const { email } = (req.body ?? {}) as { email?: string };
  if (!email || !isValidEmail(String(email))) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  const [list] = await db
    .select({ id: emailListsTable.id })
    .from(emailListsTable)
    .where(and(eq(emailListsTable.id, id), eq(emailListsTable.userId, req.userId!)))
    .limit(1);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  await db
    .update(emailSubscribersTable)
    .set({ unsubscribedAt: new Date() })
    .where(
      and(
        eq(emailSubscribersTable.listId, id),
        eq(emailSubscribersTable.email, String(email).trim().toLowerCase())
      )
    );
  res.json({ ok: true });
});

/* ── Authed: tags (migration 0188 — manual labels per list) ────────────── */

async function ownList(req: { userId?: string }, id: string) {
  const [list] = await db
    .select()
    .from(emailListsTable)
    .where(and(eq(emailListsTable.id, id), eq(emailListsTable.userId, req.userId!)))
    .limit(1);
  return list ?? null;
}

const tagNameSchema = z.object({
  name: z.string().trim().min(1, "Tag name is required.").max(40),
});

router.get("/email-list/lists/:id/tags", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const list = await ownList(req, id);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  const tags = await db
    .select()
    .from(emailTagsTable)
    .where(eq(emailTagsTable.listId, id))
    .orderBy(emailTagsTable.name);
  const links = await db
    .select({ tagId: emailSubscriberTagsTable.tagId, value: count() })
    .from(emailSubscriberTagsTable)
    .innerJoin(emailTagsTable, eq(emailSubscriberTagsTable.tagId, emailTagsTable.id))
    .where(eq(emailTagsTable.listId, id))
    .groupBy(emailSubscriberTagsTable.tagId);
  const counts = new Map(links.map((l) => [l.tagId, l.value]));
  res.json({ tags: tags.map((t) => ({ ...t, subscriberCount: counts.get(t.id) ?? 0 })) });
});

router.post("/email-list/lists/:id/tags", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const list = await ownList(req, id);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  const parsed = tagNameSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid tag.", details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  const name = parsed.data.name.toLowerCase();
  const [existing] = await db
    .select()
    .from(emailTagsTable)
    .where(and(eq(emailTagsTable.listId, id), eq(emailTagsTable.name, name)))
    .limit(1);
  if (existing) {
    res.json({ tag: existing });
    return;
  }
  const [tag] = await db.insert(emailTagsTable).values({ listId: id, name }).returning();
  res.status(201).json({ tag });
});

router.delete("/email-list/lists/:id/tags/:tagId", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const tagId = String(req.params.tagId ?? "");
  const list = await ownList(req, id);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  const [deleted] = await db
    .delete(emailTagsTable)
    .where(and(eq(emailTagsTable.id, tagId), eq(emailTagsTable.listId, id)))
    .returning({ id: emailTagsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Tag not found." });
    return;
  }
  res.json({ ok: true });
});

router.put("/email-list/lists/:id/subscribers/:subId/tags", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const subId = String(req.params.subId ?? "");
  const list = await ownList(req, id);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  const parsed = z.object({ tagIds: z.array(z.string().uuid()).max(50) }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid tag set." });
    return;
  }
  const [sub] = await db
    .select({ id: emailSubscribersTable.id })
    .from(emailSubscribersTable)
    .where(and(eq(emailSubscribersTable.id, subId), eq(emailSubscribersTable.listId, id)))
    .limit(1);
  if (!sub) {
    res.status(404).json({ error: "Subscriber not found." });
    return;
  }
  /* Every tag must belong to THIS list — a foreign tag id is a 400,
     never a silent cross-list link. */
  let tags: Array<{ id: string; name: string }> = [];
  if (parsed.data.tagIds.length > 0) {
    tags = await db
      .select({ id: emailTagsTable.id, name: emailTagsTable.name })
      .from(emailTagsTable)
      .where(and(eq(emailTagsTable.listId, id), inArray(emailTagsTable.id, parsed.data.tagIds)));
    if (tags.length !== parsed.data.tagIds.length) {
      res.status(400).json({ error: "One or more tags don't belong to this list." });
      return;
    }
  }
  await db.delete(emailSubscriberTagsTable).where(eq(emailSubscriberTagsTable.subscriberId, subId));
  if (tags.length > 0) {
    await db.insert(emailSubscriberTagsTable).values(tags.map((t) => ({ subscriberId: subId, tagId: t.id })));
  }
  res.json({ ok: true, tags: tags.map((t) => t.name) });
});

/* ── Authed: segments (migration 0188 — saved audiences) ──────────────── */

const segmentSchema = z.object({
  name: z.string().trim().min(1, "Segment name is required.").max(80),
  criteria: z.unknown(),
});

async function validateCriteriaForList(listId: string, raw: unknown) {
  const criteria = normalizeCriteria(raw);
  if (!criteria) return null;
  if (criteria.tags.length > 0) {
    const known = await db
      .select({ name: emailTagsTable.name })
      .from(emailTagsTable)
      .where(eq(emailTagsTable.listId, listId));
    const knownNames = new Set(known.map((t) => t.name.toLowerCase()));
    if (!criteria.tags.every((t) => knownNames.has(t))) return null;
  }
  return criteria;
}

router.get("/email-list/lists/:id/segments", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const list = await ownList(req, id);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  const segments = await db
    .select()
    .from(emailSegmentsTable)
    .where(eq(emailSegmentsTable.listId, id))
    .orderBy(desc(emailSegmentsTable.createdAt));
  const withSizes = [];
  for (const seg of segments) {
    const criteria = parseStoredCriteria(seg.criteria);
    const members = await evaluateSegment(list, criteria);
    withSizes.push({ ...seg, criteria, size: members.length });
  }
  res.json({ segments: withSizes });
});

router.post("/email-list/lists/:id/segments", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const list = await ownList(req, id);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  const parsed = segmentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid segment.", details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  const criteria = await validateCriteriaForList(id, parsed.data.criteria);
  if (!criteria) {
    res.status(400).json({ error: "Invalid segment criteria — check tag names, auto tags, sources, and engagement.", code: "invalid_criteria" });
    return;
  }
  const [segment] = await db
    .insert(emailSegmentsTable)
    .values({ listId: id, name: parsed.data.name, criteria: JSON.stringify(criteria) })
    .returning();
  const members = await evaluateSegment(list, criteria);
  res.status(201).json({ segment: { ...segment, criteria, size: members.length } });
});

router.patch("/email-list/lists/:id/segments/:segId", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const segId = String(req.params.segId ?? "");
  const list = await ownList(req, id);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  const parsed = segmentSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid segment update." });
    return;
  }
  const patch: { name?: string; criteria?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  let criteriaObj = null;
  if (parsed.data.criteria !== undefined) {
    criteriaObj = await validateCriteriaForList(id, parsed.data.criteria);
    if (!criteriaObj) {
      res.status(400).json({ error: "Invalid segment criteria.", code: "invalid_criteria" });
      return;
    }
    patch.criteria = JSON.stringify(criteriaObj);
  }
  const [updated] = await db
    .update(emailSegmentsTable)
    .set(patch)
    .where(and(eq(emailSegmentsTable.id, segId), eq(emailSegmentsTable.listId, id)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Segment not found." });
    return;
  }
  const criteria = criteriaObj ?? parseStoredCriteria(updated.criteria);
  const members = await evaluateSegment(list, criteria);
  res.json({ segment: { ...updated, criteria, size: members.length } });
});

router.delete("/email-list/lists/:id/segments/:segId", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const segId = String(req.params.segId ?? "");
  const list = await ownList(req, id);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  const [deleted] = await db
    .delete(emailSegmentsTable)
    .where(and(eq(emailSegmentsTable.id, segId), eq(emailSegmentsTable.listId, id)))
    .returning({ id: emailSegmentsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Segment not found." });
    return;
  }
  res.json({ ok: true });
});

router.get("/email-list/lists/:id/segments/:segId/members", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const segId = String(req.params.segId ?? "");
  const list = await ownList(req, id);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  const [segment] = await db
    .select()
    .from(emailSegmentsTable)
    .where(and(eq(emailSegmentsTable.id, segId), eq(emailSegmentsTable.listId, id)))
    .limit(1);
  if (!segment) {
    res.status(404).json({ error: "Segment not found." });
    return;
  }
  const members = await evaluateSegment(list, parseStoredCriteria(segment.criteria));
  res.json({
    segment: { ...segment, criteria: parseStoredCriteria(segment.criteria), size: members.length },
    members: members.map((m) => ({ id: m.id, email: m.email, name: m.name, source: m.source, opens: m.opens, clicks: m.clicks })),
  });
});

/* ── Authed: CSV export (free — pure data) ─────────────────────────────── */

router.get("/email-list/lists/:id/export", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const [list] = await db
    .select()
    .from(emailListsTable)
    .where(and(eq(emailListsTable.id, id), eq(emailListsTable.userId, req.userId!)))
    .limit(1);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  const subscribers = await db
    .select()
    .from(emailSubscribersTable)
    .where(eq(emailSubscribersTable.listId, id))
    .orderBy(desc(emailSubscribersTable.subscribedAt));
  const csv = subscribersToCsv(
    subscribers.map((s) => ({
      email: s.email,
      name: s.name,
      subscribedAt: s.subscribedAt.toISOString(),
      source: s.source,
    }))
  );
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${list.handle}-subscribers.csv"`
  );
  res.send(csv);
});

/* ── Authed: AI newsletter writer (1 credit, charge-before-generate) ───── */

const newsletterSchema = z.object({
  topic: z.string().min(1, "Tell us what the newsletter is about.").max(500),
  tone: z.string().refine(isNewsletterTone, { message: "Pick a valid tone." }),
  creatorName: z.string().max(120).optional().default(""),
  listName: z.string().max(120).optional().default(""),
  callToAction: z.string().max(300).optional().default(""),
});

router.post("/email-list/newsletter", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = newsletterSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid newsletter request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < EMAIL_NEWSLETTER_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to keep writing newsletters.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, EMAIL_NEWSLETTER_CREDIT_COST, {
      action: "AI Newsletter Draft",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to keep writing newsletters.",
      });
      return;
    }
    throw err;
  }

  try {
    const prompt = buildNewsletterPrompt({
      topic: parsed.data.topic,
      tone: parsed.data.tone,
      creatorName: parsed.data.creatorName || "the creator",
      listName: parsed.data.listName || "the list",
      callToAction: parsed.data.callToAction,
    });

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Write the newsletter about: "${parsed.data.topic}"` },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
      temperature: 0.8,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const draft = parseNewsletterDraft(raw);
    if (!draft) {
      throw new Error("Model returned no usable newsletter draft");
    }

    try {
      await recordCreditUsage({
        userId: req.userId!,
        action: "AI Newsletter Draft",
        creditsUsed: EMAIL_NEWSLETTER_CREDIT_COST,
      });
    } catch (err) {
      logger.warn({ err }, "[email-list] credit usage record failed (non-fatal)");
    }

    res.json({ ...draft, creditsUsed: EMAIL_NEWSLETTER_CREDIT_COST, creditsRemaining });
  } catch (err) {
    /* Provider failure after charging — refund so the user never pays
       for a draft they didn't get. */
    try {
      await refundCredits(req.userId!, EMAIL_NEWSLETTER_CREDIT_COST, {
        action: "AI Newsletter Draft — Refund (provider failed)",
      });
    } catch (refundErr) {
      logger.error({ err: refundErr }, "[email-list] refund failed after provider error");
    }
    logger.error({ err }, "[email-list] newsletter generation failed");
    res.status(502).json({
      error: "Newsletter generation failed — your Visual Buc was refunded.",
      code: "provider_failed",
    });
  }
});

/* ── Authed: campaigns (drafts + tracked sends, migration 0188) ───────── */

const campaignSchema = z.object({
  subject: z.string().min(1, "Subject is required.").max(200),
  body: z.string().min(1, "Body is required.").max(50000),
  /* A campaign can no longer be created already-"sent": sending is a
     real act performed by dispatch (or not at all). */
  status: z.enum(["draft", "queued"]).default("draft"),
  segmentId: z.string().uuid().nullable().optional(),
});

router.get("/email-list/lists/:id/campaigns", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const [list] = await db
    .select({ id: emailListsTable.id })
    .from(emailListsTable)
    .where(and(eq(emailListsTable.id, id), eq(emailListsTable.userId, req.userId!)))
    .limit(1);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  /* Automation carrier campaigns (migration 0197) are not
     newsletters — they never appear in campaign history. */
  const campaigns = await db
    .select()
    .from(emailCampaignsTable)
    .where(and(eq(emailCampaignsTable.listId, id), isNull(emailCampaignsTable.automationId)))
    .orderBy(desc(emailCampaignsTable.createdAt))
    .limit(50);
  res.json({ campaigns });
});

router.post("/email-list/lists/:id/campaigns", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const [list] = await db
    .select({ id: emailListsTable.id })
    .from(emailListsTable)
    .where(and(eq(emailListsTable.id, id), eq(emailListsTable.userId, req.userId!)))
    .limit(1);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  const parsed = campaignSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid campaign.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  /* A segment audience must belong to THIS list — a segment id from
     another list (or another creator) is rejected, never widened. */
  if (parsed.data.segmentId) {
    const [segment] = await db
      .select({ id: emailSegmentsTable.id })
      .from(emailSegmentsTable)
      .where(and(eq(emailSegmentsTable.id, parsed.data.segmentId), eq(emailSegmentsTable.listId, id)))
      .limit(1);
    if (!segment) {
      res.status(400).json({ error: "That segment doesn't belong to this list.", code: "segment_mismatch" });
      return;
    }
  }
  const [campaign] = await db
    .insert(emailCampaignsTable)
    .values({ subject: parsed.data.subject, body: parsed.data.body, status: parsed.data.status, segmentId: parsed.data.segmentId ?? null, listId: id })
    .returning();
  /* "queued" is a real send now: dispatch resolves the audience
     (whole list or segment — unsubscribed always excluded), sends
     through the house rail with tracking, and lands the campaign in
     sent/failed with measured counts. */
  let dispatch = null;
  if (campaign.status === "queued") {
    dispatch = await dispatchCampaign(campaign.id);
    const [fresh] = await db.select().from(emailCampaignsTable).where(eq(emailCampaignsTable.id, campaign.id)).limit(1);
    res.status(201).json({ campaign: fresh ?? campaign, dispatch });
    return;
  }
  res.status(201).json({ campaign, dispatch });
});

router.post("/email-list/lists/:id/campaigns/:campaignId/send", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const campaignId = String(req.params.campaignId ?? "");
  const [list] = await db
    .select({ id: emailListsTable.id })
    .from(emailListsTable)
    .where(and(eq(emailListsTable.id, id), eq(emailListsTable.userId, req.userId!)))
    .limit(1);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return;
  }
  const [campaign] = await db
    .select()
    .from(emailCampaignsTable)
    .where(and(eq(emailCampaignsTable.id, campaignId), eq(emailCampaignsTable.listId, id)))
    .limit(1);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found." });
    return;
  }
  /* Automation carriers send only through the automation runner. */
  if (campaign.automationId) {
    res.status(409).json({
      error: "That campaign belongs to an automation — it sends on its own schedule and can't be sent from here.",
      code: "automation_carrier",
    });
    return;
  }
  if (campaign.status !== "draft" && campaign.status !== "failed") {
    res.status(409).json({ error: `Campaign is ${campaign.status} — it can't be sent again from here.`, code: "not_sendable" });
    return;
  }
  await db
    .update(emailCampaignsTable)
    .set({ status: "queued" })
    .where(eq(emailCampaignsTable.id, campaignId));
  const dispatch = await dispatchCampaign(campaignId);
  const [fresh] = await db.select().from(emailCampaignsTable).where(eq(emailCampaignsTable.id, campaignId)).limit(1);
  res.json({ campaign: fresh ?? campaign, dispatch });
});

/* ── Authed: automations (migration 0197) ───────────────────────────────
   The three starter automations per list. Reading provisions them
   lazily (defaults in, enabled FALSE — nothing sends until the
   creator switches one on). Editing saves subject/body/delay and
   the on/off switch; switching ON stamps enabled_at, and triggers
   older than that moment never fire (lib/email-automations). The
   background sweeper does the sending — there is no manual "run"
   door here, so what the UI shows (enabled, last checked, measured
   counts) is exactly what the system does. */

async function loadOwnedList(req: any, res: any, id: string) {
  const [list] = await db
    .select()
    .from(emailListsTable)
    .where(and(eq(emailListsTable.id, id), eq(emailListsTable.userId, req.userId!)))
    .limit(1);
  if (!list) {
    res.status(404).json({ error: "List not found." });
    return null;
  }
  return list;
}

router.get("/email-list/lists/:id/automations", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const list = await loadOwnedList(req, res, id);
  if (!list) return;
  const automations = await ensureAutomationsForList(list);
  res.json({ automations: await Promise.all(automations.map((a) => automationDto(a))) });
});

const automationPatchSchema = z.object({
  enabled: z.boolean().optional(),
  subject: z.string().min(1, "Subject is required.").max(200).optional(),
  body: z.string().min(1, "Body is required.").max(50000).optional(),
  delayHours: z.number().int().min(0).max(720).optional(),
});

router.patch("/email-list/lists/:id/automations/:kind", publicApiLimiter, requireAuth, async (req, res) => {
  const id = String(req.params.id ?? "");
  const kindParam = String(req.params.kind ?? "");
  if (!(EMAIL_AUTOMATION_KINDS as readonly string[]).includes(kindParam)) {
    res.status(404).json({ error: "Automation not found." });
    return;
  }
  const kind = kindParam as EmailAutomationKind;
  const list = await loadOwnedList(req, res, id);
  if (!list) return;
  const parsed = automationPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid automation update.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const automations = await ensureAutomationsForList(list);
  const automation = automations.find((a) => a.kind === kind);
  if (!automation) {
    res.status(404).json({ error: "Automation not found." });
    return;
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.subject !== undefined) patch.subject = parsed.data.subject;
  if (parsed.data.body !== undefined) patch.body = parsed.data.body;
  if (parsed.data.delayHours !== undefined) patch.delayHours = parsed.data.delayHours;
  if (parsed.data.enabled !== undefined) {
    patch.enabled = parsed.data.enabled;
    /* Switching ON (re)arms the anti-backfill gate at this moment:
       nothing that happened before it can ever fire. Switching off
       keeps the stamp as history. */
    if (parsed.data.enabled && !automation.enabled) patch.enabledAt = new Date();
  }
  await db
    .update(emailAutomationsTable)
    .set(patch)
    .where(eq(emailAutomationsTable.id, automation.id));
  const [fresh] = await db
    .select()
    .from(emailAutomationsTable)
    .where(eq(emailAutomationsTable.id, automation.id))
    .limit(1);
  res.json({ automation: await automationDto(fresh ?? automation) });
});

export default router;
