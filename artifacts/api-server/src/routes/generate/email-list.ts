import { Router } from "express";
import { z } from "zod";
import { eq, and, count, desc, isNull } from "drizzle-orm";
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
  insertEmailListSchema,
} from "@workspace/db";
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

   Honesty (v1): sends go through a simple server-side queue, NOT a
   dedicated email service provider. Deliverability, inbox placement, and
   scale limits are disclosed in the UI — never promised. */

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
    .select({ id: emailListsTable.id })
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
  const totalOpens = subscribers.reduce((n, s) => n + (s.opens ?? 0), 0);
  /* v1 open-rate honesty: pixel-based, best-effort — disclosed in the UI. */
  const openRate = active.length > 0 ? Math.round((totalOpens / active.length) * 100) / 100 : 0;
  res.json({
    subscribers,
    stats: {
      total: subscribers.length,
      active: active.length,
      unsubscribed: subscribers.length - active.length,
      openRate,
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
      message: "You're out of credits — top up to keep writing newsletters.",
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
        message: "You're out of credits — top up to keep writing newsletters.",
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
      error: "Newsletter generation failed — your credit was refunded.",
      code: "provider_failed",
    });
  }
});

/* ── Authed: campaigns (drafts + queue) ────────────────────────────────── */

const campaignSchema = z.object({
  subject: z.string().min(1, "Subject is required.").max(200),
  body: z.string().min(1, "Body is required.").max(50000),
  status: z.enum(["draft", "queued", "sent"]).default("draft"),
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
  const campaigns = await db
    .select()
    .from(emailCampaignsTable)
    .where(eq(emailCampaignsTable.listId, id))
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
  /* v1 honesty: "queued" means the simple server-side queue — the UI
     discloses this is not a dedicated ESP with inbox-placement guarantees. */
  const [campaign] = await db
    .insert(emailCampaignsTable)
    .values({ ...parsed.data, listId: id })
    .returning();
  res.status(201).json({ campaign });
});

export default router;
