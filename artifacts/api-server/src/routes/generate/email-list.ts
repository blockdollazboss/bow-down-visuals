import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { eq, and, count, desc, isNull } from "drizzle-orm";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { queueWelcomeSequence } from "../../lib/email-campaign-sender";
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

   Sending: campaigns and the welcome sequence are delivered by the
   Resend-backed sender (lib/email-campaign-sender.ts), drained by the
   job poller. Campaign status is server-owned — clients can draft and
   queue, never stamp "sent". Deliverability, inbox placement, and
   scale limits are disclosed in the UI — never promised. Open rates
   are NOT tracked (no pixel, no webhook) and reported as such. */

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

  const [subscriber] = await db
    .insert(emailSubscribersTable)
    .values({
      listId: list.id,
      email,
      name: name || null,
      source,
      confirmed: true,
      unsubscribeToken: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
    })
    .returning();

  /* Welcome-sequence trigger: queue step 1 (now), step 2 (+24h) and
     step 3 (+72h after step 2) for every step the list has a stored
     template for. The sender drains them via the job poller.
     Best-effort — a welcome failure never fails the signup. */
  if (subscriber) {
    try {
      await queueWelcomeSequence(list, subscriber);
    } catch (err) {
      logger.warn({ err, listId: list.id }, "[email-list] welcome sequence queue failed (signup still succeeded)");
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

/* ── Public: one-click unsubscribe (no auth — token IS the credential) ──
   Target of the List-Unsubscribe header + footer link in every send.
   GET renders a confirmation page (what a human clicking sees); POST is
   the RFC 8058 one-click endpoint mail clients call directly. Both are
   idempotent and never leak whether a token exists beyond 404. */

async function applyUnsubscribe(token: string): Promise<boolean> {
  if (!token || token.length < 16) return false;
  const [sub] = await db
    .select({ id: emailSubscribersTable.id, unsubscribedAt: emailSubscribersTable.unsubscribedAt })
    .from(emailSubscribersTable)
    .where(eq(emailSubscribersTable.unsubscribeToken, token))
    .limit(1);
  if (!sub) return false;
  if (!sub.unsubscribedAt) {
    await db
      .update(emailSubscribersTable)
      .set({ unsubscribedAt: new Date() })
      .where(eq(emailSubscribersTable.id, sub.id));
  }
  return true;
}

router.get("/email-list/unsubscribe/:token", publicApiLimiter, async (req, res) => {
  const ok = await applyUnsubscribe(String(req.params.token ?? ""));
  res
    .status(ok ? 200 : 404)
    .type("html")
    .send(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribe — Bow Down Visuals</title></head>` +
        `<body style="margin:0;background:#0a0a0a;color:#eee;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;">` +
        `<div style="max-width:480px;margin:80px auto;padding:32px 24px;text-align:center;">` +
        `<div style="font-size:32px;">🦈</div>` +
        (ok
          ? `<h1 style="color:#d4af37;font-size:20px;">You're unsubscribed</h1><p style="color:#aaa;line-height:1.6;">You won't get campaign or welcome emails from this list anymore.</p>`
          : `<h1 style="color:#d4af37;font-size:20px;">Link not recognized</h1><p style="color:#aaa;line-height:1.6;">This unsubscribe link is invalid or has expired.</p>`) +
        `</div></body></html>`,
    );
});

router.post("/email-list/unsubscribe/:token", publicApiLimiter, async (req, res) => {
  const ok = await applyUnsubscribe(String(req.params.token ?? ""));
  if (!ok) {
    res.status(404).json({ error: "Link not recognized.", code: "token_not_found" });
    return;
  }
  res.json({ ok: true, unsubscribed: true });
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
  /* Open tracking is NOT wired up — reported honestly as not tracked.
     Nothing in the system records an email open: there is no tracking
     pixel endpoint and no provider webhook (the Resend sender records
     sends, never opens). The subscribers.opens
     column therefore stays 0 forever, and the previous code turned that
     into a permanently-0 "openRate" the dashboard presented as a
     measured stat. Until a real open signal exists, the stat is null
     and opensTracked is false — never a fabricated number. */
  res.json({
    subscribers,
    stats: {
      total: subscribers.length,
      active: active.length,
      unsubscribed: subscribers.length - active.length,
      openRate: null,
      opensTracked: false,
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

/* ── Authed: campaigns (drafts + queue) ────────────────────────────────── */

const campaignSchema = z.object({
  subject: z.string().min(1, "Subject is required.").max(200),
  body: z.string().min(1, "Body is required.").max(50000),
  /* Server-owned status: a client may create a draft or request the
     queue — "sending" / "sent" / "failed" are stamped only by the
     sender after Resend actually accepts the mail. Asking for "sent"
     here is a 400, never a silently-believed lie. */
  status: z.enum(["draft", "queued"]).default("draft"),
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
  /* "queued" hands the campaign to the Resend-backed sender, which the
     job poller drains — the UI discloses there are no inbox-placement
     guarantees even with a real provider. */
  const [campaign] = await db
    .insert(emailCampaignsTable)
    .values({ ...parsed.data, listId: id })
    .returning();
  res.status(201).json({ campaign });
});

/* Queue (or re-queue a failed) campaign for the sender. The ONLY client
   path into the send pipeline: draft|failed → queued. The sender owns
   every transition after this one. */
router.post("/email-list/lists/:id/campaigns/:campaignId/queue", publicApiLimiter, requireAuth, async (req, res) => {
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
  if (campaign.status === "queued" || campaign.status === "sending") {
    res.json({ campaign });
    return;
  }
  if (campaign.status === "sent") {
    res.status(409).json({ error: "That campaign already sent.", code: "already_sent" });
    return;
  }
  const [updated] = await db
    .update(emailCampaignsTable)
    .set({ status: "queued" })
    .where(eq(emailCampaignsTable.id, campaignId))
    .returning();
  res.json({ campaign: updated });
});

export default router;
