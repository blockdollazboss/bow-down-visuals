import { Router, type Request } from "express";
import { z } from "zod";
import type Stripe from "stripe";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { db, ugcBriefsTable, ugcAdsTable } from "@workspace/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { normalizeToStorageRef, refreshSupabaseStorageUrl } from "../lib/objectStorage";
import { mirrorExternalMediaUrl } from "../lib/mirrorMedia";
import { buildCheckoutSessionIdempotencyKey, createGuardedStripeClient, fingerprintStripeRequestParams } from "../lib/stripe-client";
import { checkoutBaseUrl } from "../lib/stripe-checkout";
import { isEmbeddedCheckoutEnabled } from "../lib/embedded-checkout";
import { escrowHeldCents } from "../lib/escrow-held";
import { notifyUserEvent, type UserEventInput } from "../lib/push-events";
import { classifyEscrowCheckoutSession } from "./generate/sponsors";
import { UGC_STYLES } from "./ugc-ads";

const router = Router();

/* ─── UGC Briefs Board (owner order Oct 19, 2026 — the business side) ──
   The other half of UGC Product Ads, in the same Promote surface: a
   brand posts a brief (product, what they want, style, deadline), a
   creator claims it and makes the ad with the same UGC tool (the
   brief pre-fills the ad's product/style), delivers it back through
   the board, and the brand approves it. Lifecycle:
     open → claimed → delivered → approved
     open|claimed → closed (brand) · claimed → open (claimer releases)
   Every other transition is refused (409) — no skipping states, no
   delivering an ad you don't own, no approving your own delivery.

   MONEY (owner ruling C-25, Nov 5, 2026): v1 carried no payment rail
   — a brief had no price and the PAYMENT_NOTE below rode every DTO:
   payment arranged between brand and creator directly. A brief may
   now carry an OPTIONAL price, and a priced brief rides an escrow
   rail cloned from the sponsor-deal escrow:
     · the brand FUNDS at claim (never at post — no money locks on an
       unclaimed brief) through an embedded Checkout session — the
       buyer never leaves the site;
     · settlement is webhook + verify, cross-checked against the
       payment record, exactly-once (markUgcBriefFunded);
     · APPROVE is the release point: it splits what is still HELD
       (escrowHeldCents — a partial refund shrinks the release, never
       the record) at the rail's ruled 5% fee, stamps the split on
       the brief, and the payout ledger accrues it from those stamps;
     · closing a funded brief refunds what is still held; a refund /
       chargeback after funding rides the payment-reversals engine.
   A brief with NO price is a free brief and behaves byte-identically
   to v1 — same lifecycle, same DTO shape, same off-site note.

   Visibility: open briefs are the board — any member can read them.
   A non-open brief reads only for its brand and its claimer; everyone
   else gets a 404, so a claimed brief's existence never leaks. */

export const UGC_BRIEF_PAYMENT_NOTE =
  "Bow Down Visuals doesn't hold or move money for briefs — payment is arranged between the brand and the creator directly.";

/** The note a PRICED brief carries instead: the off-site note would
    be a lie the moment a price exists. */
export const UGC_BRIEF_ESCROW_NOTE =
  "Bow Down Visuals holds this brief's payment safely and releases it to the creator when the brand approves the delivery.";

/* Platform cut in basis points — 500 = 5% (owner ruling C-25: the
   briefs rail takes the standing marketplace 5%, NOT the sponsors
   15%). Env-overridable without a deploy, like its siblings. */
export const UGC_BRIEF_PLATFORM_FEE_BPS =
  Number(process.env["UGC_BRIEF_PLATFORM_FEE_BPS"]) || 500;

export function ugcBriefFeeSplit(grossCents: number): { feeCents: number; netCents: number } {
  const feeCents = Math.round((grossCents * UGC_BRIEF_PLATFORM_FEE_BPS) / 10000);
  return { feeCents, netCents: grossCents - feeCents };
}

export function isStripeConfigured(): boolean {
  return !!process.env["STRIPE_SECRET_KEY"];
}

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ── Lifecycle fan-out (the sponsors pattern) ────────────────────────
   Every money landing tells the party it affects, gated on the
   transition actually landing (a guarded flip's returned row), so
   replays and race-losers stay silent. Best-effort: a tell failure
   never fails the money move it reports. */
type UgcBriefEventNotifier = (input: UserEventInput) => Promise<unknown>;
let _ugcBriefEventNotifier: UgcBriefEventNotifier = notifyUserEvent;
/** Test seam — never used outside tests. */
export function __setUgcBriefEventNotifier(fn: UgcBriefEventNotifier | null): void {
  _ugcBriefEventNotifier = fn ?? notifyUserEvent;
}

async function tellUgcBriefParty(input: {
  userId: string;
  kind: string;
  title: string;
  body: string;
}): Promise<void> {
  try {
    await _ugcBriefEventNotifier({
      userId: input.userId,
      category: "money",
      kind: input.kind,
      title: input.title,
      body: input.body,
      link: "/promote",
    });
  } catch (err) {
    logger.warn({ err, userId: input.userId, kind: input.kind }, "[ugc-briefs] lifecycle tell failed (transition stands)");
  }
}

/** The reversal engine un-funds a funded-but-unreleased brief (refund
 *  / chargeback). The creator working against that escrow is the
 *  harmed party — this is the tell, called by lib/payment-reversals
 *  only after its flip actually lands (the sponsors pattern). */
export async function notifyUgcBriefEscrowReversed(briefId: string): Promise<void> {
  try {
    const row = await loadBrief(briefId);
    if (!row?.claimedByUserId) return;
    await tellUgcBriefParty({
      userId: row.claimedByUserId,
      kind: "ugc_brief_escrow_reversed",
      title: "Brief funding reversed",
      body: "The funding for this UGC brief was refunded or charged back, so the escrow is empty. Don't deliver against it until the brand funds it again.",
    });
  } catch (err) {
    logger.warn({ err, briefId }, "[ugc-briefs] escrow-reversed tell failed (reversal stands)");
  }
}

const BRIEF_STATUSES = ["open", "claimed", "delivered", "approved", "closed"] as const;

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v ?? "");
}

async function toDTO(row: typeof ugcBriefsTable.$inferSelect) {
  const base = {
    id: row.id,
    brandUserId: row.brandUserId,
    productName: row.productName,
    productImageUrl: row.productImageRef
      ? await refreshSupabaseStorageUrl(row.productImageRef)
      : null,
    productUrl: row.productUrl ?? null,
    details: row.details,
    style: row.style,
    deadline: row.deadline ? iso(row.deadline) : null,
    status: row.status,
    claimedByUserId: row.claimedByUserId ?? null,
    deliveredAdId: row.deliveredAdId ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
  /* A free brief's DTO is byte-identical to the v1 shape — no money
     keys at all, off-site note intact. Money fields exist ONLY on a
     priced brief, whose note is the escrow note. */
  if (row.priceCents == null) {
    return { ...base, paymentNote: UGC_BRIEF_PAYMENT_NOTE };
  }
  return {
    ...base,
    paymentNote: UGC_BRIEF_ESCROW_NOTE,
    priceCents: row.priceCents,
    escrowStatus: row.escrowStatus,
    feeBps: UGC_BRIEF_PLATFORM_FEE_BPS,
    platformFeeCents: row.platformFeeCents ?? null,
    creatorPayoutCents: row.creatorPayoutCents ?? null,
    releasedAmountCents: row.releasedAmountCents ?? null,
    releasedAt: row.releasedAt ? iso(row.releasedAt) : null,
  };
}

type BriefDTO = Awaited<ReturnType<typeof toDTO>>;

/** A brief the caller may see: open (the board), theirs as brand, or
    theirs as claimer. Anything else is indistinguishable from missing. */
function canSee(row: typeof ugcBriefsTable.$inferSelect, userId: string): boolean {
  return (
    row.status === "open" ||
    row.brandUserId === userId ||
    row.claimedByUserId === userId
  );
}

async function loadBrief(id: string) {
  const [row] = await db
    .select()
    .from(ugcBriefsTable)
    .where(eq(ugcBriefsTable.id, id))
    .limit(1);
  return row ?? null;
}

async function saveBrief(
  id: string,
  patch: Partial<typeof ugcBriefsTable.$inferInsert>,
) {
  const [row] = await db
    .update(ugcBriefsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(ugcBriefsTable.id, id))
    .returning();
  return row ?? null;
}

/* ── POST /api/ugc-briefs — a brand posts a brief ──────────────────── */
const createBriefSchema = z.object({
  productName: z.string().trim().min(1).max(120),
  productImageUrl: z
    .string()
    .trim()
    .max(2048)
    .regex(/^https?:\/\//, "must be an http(s) URL")
    .optional(),
  productUrl: z
    .string()
    .trim()
    .max(2048)
    .regex(/^https?:\/\//, "must be an http(s) URL")
    .optional(),
  details: z.string().trim().min(10, "Say what you want in the ad.").max(2000),
  style: z.enum(UGC_STYLES),
  deadline: z.string().trim().max(40).optional(),
  /* OPTIONAL agreed price ($1 floor, huge ceiling) — a brief without
     one is a free brief and never touches the escrow rail. */
  priceCents: z.number().int().min(100).max(100000000).optional(),
});

router.post("/ugc-briefs", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = createBriefSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid brief.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const d = parsed.data;
  let deadline: Date | null = null;
  if (d.deadline) {
    const when = new Date(d.deadline);
    if (Number.isNaN(when.getTime())) {
      res.status(400).json({ error: "That deadline isn't a real date." });
      return;
    }
    deadline = when;
  }
  try {
    /* Product photo rides mirror-on-save, same as the ad side. */
    let productImageRef: string | null = null;
    if (d.productImageUrl) {
      const normalized = normalizeToStorageRef(d.productImageUrl) ?? d.productImageUrl;
      productImageRef = /^https?:\/\//i.test(normalized)
        ? ((await mirrorExternalMediaUrl(normalized, { kind: "image", ownerKey: req.userId! })) ?? normalized)
        : normalized;
    }
    const [row] = await db
      .insert(ugcBriefsTable)
      .values({
        brandUserId: req.userId!,
        productName: d.productName,
        productImageRef,
        productUrl: d.productUrl ?? null,
        details: d.details,
        style: d.style,
        deadline,
        status: "open",
        priceCents: d.priceCents ?? null,
      })
      .returning();
    res.status(201).json({ brief: await toDTO(row!) });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] create failed");
    res.status(500).json({ error: "Could not post that brief — try again." });
  }
});

/* ── GET /api/ugc-briefs?scope=open|posted|claimed ─────────────────── */
router.get("/ugc-briefs", requireAuth, async (req, res) => {
  const scope = typeof req.query["scope"] === "string" ? req.query["scope"] : "open";
  if (scope !== "open" && scope !== "posted" && scope !== "claimed") {
    res.status(400).json({ error: "scope must be open, posted, or claimed." });
    return;
  }
  const rawLimit = Number(req.query["limit"]);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(100, Math.floor(rawLimit)) : 50;
  try {
    const where =
      scope === "open"
        ? eq(ugcBriefsTable.status, "open")
        : scope === "posted"
          ? eq(ugcBriefsTable.brandUserId, req.userId!)
          : eq(ugcBriefsTable.claimedByUserId, req.userId!);
    const rows = await db
      .select()
      .from(ugcBriefsTable)
      .where(where)
      .orderBy(desc(ugcBriefsTable.createdAt))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const briefs: BriefDTO[] = await Promise.all(page.map(toDTO));
    res.json({ briefs, limit, hasMore });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] list failed");
    res.status(500).json({ error: "Could not load the briefs board — try again." });
  }
});

/* ── GET /api/ugc-briefs/:id ───────────────────────────────────────── */
router.get("/ugc-briefs/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await loadBrief(id);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    res.json({ brief: await toDTO(row) });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] get failed");
    res.status(500).json({ error: "Could not load that brief — try again." });
  }
});

/* ── POST /api/ugc-briefs/:id/claim — a creator takes the brief ────── */
router.post("/ugc-briefs/:id/claim", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await loadBrief(id);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    if (row.brandUserId === req.userId) {
      res.status(400).json({ error: "This is your own brief — a creator has to claim it." });
      return;
    }
    if (row.status !== "open") {
      res.status(409).json({ error: `This brief is ${row.status} — only an open brief can be claimed.` });
      return;
    }
    /* C-11: the claim is a GUARDED flip, not a load-check-save. Two
       creators claiming the same open brief in the same instant both
       pass the in-memory check above, and an unguarded save lets the
       second write silently steal the brief the first creator was
       just told they had won — the escrow then funds against whoever
       the row happens to name. The status predicate rides the UPDATE
       itself, so exactly one claim lands; the loser reads the row
       back and gets the same honest 409 copy with its real state. */
    const [flipped] = await db
      .update(ugcBriefsTable)
      .set({ status: "claimed", claimedByUserId: req.userId!, updatedAt: new Date() })
      .where(and(eq(ugcBriefsTable.id, id), eq(ugcBriefsTable.status, "open")))
      .returning();
    if (!flipped) {
      const now = await loadBrief(id);
      res.status(409).json({
        error: `This brief is ${now?.status ?? "claimed"} — only an open brief can be claimed.`,
      });
      return;
    }
    res.json({ brief: await toDTO(flipped) });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] claim failed");
    res.status(500).json({ error: "Could not claim that brief — try again." });
  }
});

/* ── POST /api/ugc-briefs/:id/release — the claimer hands it back ──── */
router.post("/ugc-briefs/:id/release", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await loadBrief(id);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    if (row.claimedByUserId !== req.userId) {
      res.status(403).json({ error: "Only the creator who claimed this brief can release it." });
      return;
    }
    if (row.status !== "claimed") {
      res.status(409).json({ error: `This brief is ${row.status} — only a claimed brief can be released.` });
      return;
    }
    /* A priced brief whose payment is moving or held can't be handed
       back to the board: the money would strand against a claim that
       no longer exists. The doors are deliver, or the brand closes
       (closing refunds the held payment). */
    if (row.priceCents != null && (row.escrowStatus === "funding" || row.escrowStatus === "funded")) {
      res.status(409).json({
        error: "This brief's payment is already funded — you can't hand it back now. Deliver the ad, or ask the brand to close the brief (closing refunds the payment).",
      });
      return;
    }
    /* C-11 audit (same-treatment): release shared the claim's
       load-check-save shape — a release whose save lands after a
       fresh claim (or after the brand's fund claim flips the escrow)
       clobbers state its checks never saw, silently un-claiming a
       brief another creator was just told they won. CAS flip on
       exactly the state validated above: still claimed, still by
       this claimer, escrow exactly as read. */
    const [flipped] = await db
      .update(ugcBriefsTable)
      .set({ status: "open", claimedByUserId: null, updatedAt: new Date() })
      .where(
        and(
          eq(ugcBriefsTable.id, id),
          eq(ugcBriefsTable.status, "claimed"),
          eq(ugcBriefsTable.claimedByUserId, req.userId!),
          eq(ugcBriefsTable.escrowStatus, row.escrowStatus),
        ),
      )
      .returning();
    if (!flipped) {
      res.status(409).json({ error: "This brief changed while you were releasing it — refresh and check its state." });
      return;
    }
    res.json({ brief: await toDTO(flipped) });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] release failed");
    res.status(500).json({ error: "Could not release that brief — try again." });
  }
});

/* ── POST /api/ugc-briefs/:id/deliver — the claimer delivers the ad ── */
const deliverSchema = z.object({
  adId: z.string().uuid(),
});

router.post("/ugc-briefs/:id/deliver", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  const parsed = deliverSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid delivery.", details: parsed.error.issues });
    return;
  }
  try {
    const row = await loadBrief(id);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    if (row.claimedByUserId !== req.userId) {
      res.status(403).json({ error: "Only the creator who claimed this brief can deliver on it." });
      return;
    }
    if (row.status !== "claimed") {
      res.status(409).json({ error: `This brief is ${row.status} — only a claimed brief can be delivered.` });
      return;
    }
    /* The delivered ad must be the claimer's own finished ad. Another
       member's ad, an unfinished ad, and a missing ad all read the
       same way: not deliverable. */
    const [ad] = await db
      .select()
      .from(ugcAdsTable)
      .where(and(eq(ugcAdsTable.id, parsed.data.adId), eq(ugcAdsTable.userId, req.userId!)))
      .limit(1);
    if (!ad || ad.status !== "ready") {
      res.status(400).json({ error: "That ad isn't one of your finished ads — generate it first, then deliver." });
      return;
    }
    if (ad.briefId && ad.briefId !== id) {
      res.status(400).json({ error: "That ad was made for a different brief." });
      return;
    }
    /* C-11 audit (same-treatment): deliver shared the load-check-save
       shape too — a release or close landing between the checks and
       the save was silently overwritten back to "delivered", against
       a claim that no longer exists. Guarded flip first, on exactly
       the state validated above; the ad's brief stamp lands only
       after the delivery itself does, so a refused delivery never
       pins the ad to a brief it was not delivered to. */
    const [flipped] = await db
      .update(ugcBriefsTable)
      .set({ status: "delivered", deliveredAdId: ad.id, updatedAt: new Date() })
      .where(
        and(
          eq(ugcBriefsTable.id, id),
          eq(ugcBriefsTable.status, "claimed"),
          eq(ugcBriefsTable.claimedByUserId, req.userId!),
        ),
      )
      .returning();
    if (!flipped) {
      res.status(409).json({ error: "This brief changed while you were delivering — refresh and check its state." });
      return;
    }
    if (!ad.briefId) {
      await db
        .update(ugcAdsTable)
        .set({ briefId: id, updatedAt: new Date() })
        .where(eq(ugcAdsTable.id, ad.id));
    }
    res.json({ brief: await toDTO(flipped) });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] deliver failed");
    res.status(500).json({ error: "Could not deliver that ad — try again." });
  }
});

/* ── POST /api/ugc-briefs/:id/approve — the brand accepts delivery ─── */
router.post("/ugc-briefs/:id/approve", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await loadBrief(id);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    if (row.brandUserId !== req.userId) {
      res.status(403).json({ error: "Only the brand that posted this brief can approve a delivery." });
      return;
    }
    if (row.status !== "delivered") {
      res.status(409).json({ error: `This brief is ${row.status} — only a delivered brief can be approved.` });
      return;
    }
    /* ── A PRICED brief: approve IS the escrow release ────────────
       The release splits what is still HELD (escrowHeldCents), never
       the nominal price: a partial refund shrinks the release, never
       the record. The split stamps land on the brief row — those
       stamps are the creator's Earnings (lib/seller-earnings). */
    if (row.priceCents != null) {
      if (row.escrowStatus === "unfunded") {
        res.status(409).json({
          error: "Fund this brief's payment first — approving a paid brief releases the held payment to the creator.",
        });
        return;
      }
      if (row.escrowStatus === "funding") {
        res.status(409).json({
          error: "The funding payment hasn't completed yet — once it lands, approval releases it to the creator.",
        });
        return;
      }
      if (row.escrowStatus !== "funded") {
        res.status(409).json({
          error: `This brief's payment is ${row.escrowStatus} — there is nothing left to release.`,
        });
        return;
      }
      let held;
      try {
        held = await escrowHeldCents({
          stripe: isStripeConfigured() ? createGuardedStripeClient() : null,
          paymentIntentId: row.stripePaymentIntentId,
          grossCents: row.priceCents,
        });
      } catch (err) {
        logger.error({ err, briefId: id }, "[ugc-briefs] release held-check failed — refusing (fail closed)");
        res.status(503).json({
          error: "We couldn't verify the held payment just now, so nothing was released. Try again in a moment.",
        });
        return;
      }
      if (held.heldCents <= 0) {
        res.status(409).json({
          error: "The payment was refunded in full — there is nothing left to release.",
        });
        return;
      }
      const { feeCents, netCents } = ugcBriefFeeSplit(held.heldCents);
      const [flipped] = await db
        .update(ugcBriefsTable)
        .set({
          status: "approved",
          escrowStatus: "released",
          releasedAmountCents: held.heldCents,
          platformFeeCents: feeCents,
          creatorPayoutCents: netCents,
          releasedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ugcBriefsTable.id, id),
            eq(ugcBriefsTable.status, "delivered"),
            eq(ugcBriefsTable.escrowStatus, "funded"),
          ),
        )
        .returning();
      if (!flipped) {
        res.status(409).json({ error: "This brief changed while you were approving — refresh and check its state." });
        return;
      }
      if (flipped.claimedByUserId) {
        await tellUgcBriefParty({
          userId: flipped.claimedByUserId,
          kind: "ugc_brief_escrow_released",
          title: "Brief payment released 👑",
          body:
            `The brand approved your delivery and ${fmtMoney(netCents)} was released to you` +
            (held.refundedCents > 0
              ? ` — the brand had refunded ${fmtMoney(held.refundedCents)} of the held payment before approving, so the release covers the rest.`
              : "."),
        });
      }
      res.json({
        brief: await toDTO(flipped),
        release: {
          grossCents: held.heldCents,
          ...(held.refundedCents > 0 ? { refundedCents: held.refundedCents } : {}),
          platformFeeCents: feeCents,
          creatorPayoutCents: netCents,
        },
      });
      return;
    }
    const saved = await saveBrief(id, { status: "approved" });
    res.json({ brief: await toDTO(saved!) });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] approve failed");
    res.status(500).json({ error: "Could not approve that delivery — try again." });
  }
});

/* ── POST /api/ugc-briefs/:id/close — the brand closes the brief ──── */
router.post("/ugc-briefs/:id/close", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await loadBrief(id);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    if (row.brandUserId !== req.userId) {
      res.status(403).json({ error: "Only the brand that posted this brief can close it." });
      return;
    }
    if (row.status !== "open" && row.status !== "claimed") {
      res.status(409).json({
        error: `This brief is ${row.status} — only an open or claimed brief can be closed.`,
      });
      return;
    }
    /* ── A PRICED brief whose escrow is FUNDED: closing refunds what
       is still held (the sponsors' close-on-funded rule). The refund
       goes first — if it fails, nothing changes. ────────────────── */
    if (row.priceCents != null && row.escrowStatus === "funded") {
      let held;
      try {
        held = await escrowHeldCents({
          stripe: isStripeConfigured() ? createGuardedStripeClient() : null,
          paymentIntentId: row.stripePaymentIntentId,
          grossCents: row.priceCents,
        });
      } catch (err) {
        logger.error({ err, briefId: id }, "[ugc-briefs] close held-check failed — refusing (fail closed)");
        res.status(503).json({
          error: "We couldn't verify the held payment just now, so the brief is unchanged. Try again in a moment.",
        });
        return;
      }
      if (held.heldCents > 0 && row.stripePaymentIntentId) {
        try {
          await createGuardedStripeClient().refunds.create(
            { payment_intent: row.stripePaymentIntentId, amount: held.heldCents },
            { idempotencyKey: `ugc-brief-refund:${id}` },
          );
        } catch (err) {
          logger.error({ err, briefId: id }, "[ugc-briefs] close refund failed — brief unchanged");
          res.status(503).json({
            error: "We couldn't refund the held payment just now, so the brief is unchanged. Try again in a moment.",
          });
          return;
        }
      }
      const [flipped] = await db
        .update(ugcBriefsTable)
        .set({ status: "closed", escrowStatus: "refunded", updatedAt: new Date() })
        .where(
          and(
            eq(ugcBriefsTable.id, id),
            inArray(ugcBriefsTable.status, ["open", "claimed"]),
            eq(ugcBriefsTable.escrowStatus, "funded"),
          ),
        )
        .returning();
      if (!flipped) {
        res.status(409).json({ error: "This brief changed while you were closing it — refresh and check its state." });
        return;
      }
      if (flipped.claimedByUserId) {
        await tellUgcBriefParty({
          userId: flipped.claimedByUserId,
          kind: "ugc_brief_escrow_refunded",
          title: "Brief closed — payment refunded",
          body: `The brand closed this brief, and the held payment of ${fmtMoney(held.heldCents)} was refunded to the brand.`,
        });
      }
      res.json({ brief: await toDTO(flipped), refundedCents: held.heldCents });
      return;
    }
    /* A funding attempt in flight is abandoned with the brief: free
       the claim first (markUgcBriefFunded refuses closed briefs and
       stale sessions, so a late payment can never settle against it). */
    if (row.priceCents != null && row.escrowStatus === "funding") {
      const [flipped] = await db
        .update(ugcBriefsTable)
        .set({ status: "closed", escrowStatus: "unfunded", stripeSessionId: null, updatedAt: new Date() })
        .where(
          and(
            eq(ugcBriefsTable.id, id),
            inArray(ugcBriefsTable.status, ["open", "claimed"]),
            eq(ugcBriefsTable.escrowStatus, "funding"),
          ),
        )
        .returning();
      if (!flipped) {
        res.status(409).json({ error: "This brief changed while you were closing it — refresh and check its state." });
        return;
      }
      res.json({ brief: await toDTO(flipped) });
      return;
    }
    const saved = await saveBrief(id, { status: "closed" });
    res.json({ brief: await toDTO(saved!) });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] close failed");
    res.status(500).json({ error: "Could not close that brief — try again." });
  }
});

/* ═══ THE ESCROW RAIL (C-25) ════════════════════════════════════════
   Fund → settle → (approve releases | close refunds). Fund happens
   at CLAIM, never at post: money only locks once a creator is
   actually on the brief. Settlement funnels through ONE function —
   markUgcBriefFunded — shared by the Stripe webhook and the verify
   endpoint, and its guarded flip is what makes settlement
   exactly-once (same-session replay is a no-op success). */

/** Free a stale funding claim so the brand can start over. Guarded:
 *  only a row still in 'funding' with exactly this session frees.
 *  Used by the re-fund reconciliation below and by the webhook's
 *  checkout.session.expired branch. Returns true when freed. */
export async function freeUgcBriefFundingForSession(
  briefId: string,
  sessionId: string | null,
): Promise<boolean> {
  const [row] = await db
    .update(ugcBriefsTable)
    .set({ escrowStatus: "unfunded", stripeSessionId: null, updatedAt: new Date() })
    .where(
      and(
        eq(ugcBriefsTable.id, briefId),
        eq(ugcBriefsTable.escrowStatus, "funding"),
        sessionId ? eq(ugcBriefsTable.stripeSessionId, sessionId) : isNull(ugcBriefsTable.stripeSessionId),
      ),
    )
    .returning();
  return !!row;
}

/** THE settle flip. Guarded on the escrow still being fundable AND
 *  the brief still live (claimed|delivered) — a closed or approved
 *  brief can never be settled against. The nominal 5% split is
 *  stamped at funding (the sponsors pattern); the release overwrites
 *  it with the split of what was actually held. The claimer is told
 *  ONLY when the flip lands, so webhook replays stay silent.
 *  C-34: a brief whose row names no session can ADOPT the completed
 *  session (its metadata named the brief) while its funding claim is
 *  still open — see the adoption branch inside. */
export async function markUgcBriefFunded(
  briefId: string,
  sessionId: string,
  paymentIntentId: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  const row = await loadBrief(briefId);
  if (!row) return { ok: false, reason: "brief-not-found" };
  if (row.escrowStatus === "funded" && row.stripeSessionId === sessionId) {
    return { ok: true, reason: "already-funded" };
  }
  if (row.status === "closed" || row.status === "approved") {
    return { ok: false, reason: `bad-state:${row.status}` };
  }
  if (row.stripeSessionId && row.stripeSessionId !== sessionId) {
    return { ok: false, reason: "stale-session" };
  }
  /* C-34 adoption: the row names NO session — the wreckage shape of
     a fund call whose session-id save failed after Stripe created
     the session (persistUgcBriefFundingSessionId now guards that
     save; this branch reconciles any session already out there).
     The webhook dispatched here on the session's own metadata
     naming this brief. Adopt it ONLY while the funding claim is
     still open ('funding'): a completed session arriving against a
     freed claim ('unfunded') is an orphan — refuse it and log it at
     error level with both ids, so the paid session can be
     reconciled (refunded) by hand. Money never settles against a
     claim the brand already abandoned. */
  const adopting = row.stripeSessionId == null;
  if (adopting && row.escrowStatus !== "funding") {
    logger.error(
      { briefId, sessionId },
      "[ugc-briefs] completed session matches no open funding claim — orphaned session, not settled",
    );
    return { ok: false, reason: "orphaned-session" };
  }
  if (row.escrowStatus !== "funding" && row.escrowStatus !== "unfunded") {
    return { ok: false, reason: `bad-state:${row.escrowStatus}` };
  }
  const split = row.priceCents != null ? ugcBriefFeeSplit(row.priceCents) : null;
  const [flipped] = await db
    .update(ugcBriefsTable)
    .set({
      escrowStatus: "funded",
      stripeSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId,
      platformFeeCents: split?.feeCents ?? null,
      creatorPayoutCents: split?.netCents ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ugcBriefsTable.id, briefId),
        inArray(ugcBriefsTable.escrowStatus, ["funding", "unfunded"]),
        inArray(ugcBriefsTable.status, ["claimed", "delivered"]),
        /* The flip itself is session-bound, not just the load-time
           checks above: the row must still carry THIS session — or,
           adopting, still carry none with the claim still open — so
           two different sessions can never both settle one brief. */
        adopting
          ? and(isNull(ugcBriefsTable.stripeSessionId), eq(ugcBriefsTable.escrowStatus, "funding"))
          : eq(ugcBriefsTable.stripeSessionId, sessionId),
      ),
    )
    .returning();
  if (!flipped) {
    const now = await loadBrief(briefId);
    if (now?.escrowStatus === "funded" && now.stripeSessionId === sessionId) {
      return { ok: true, reason: "already-funded" };
    }
    return { ok: false, reason: `bad-state:${now?.escrowStatus ?? "missing"}` };
  }
  if (adopting) {
    logger.warn(
      { briefId, sessionId },
      "[ugc-briefs] adopted an orphaned funding session — settled against the open funding claim",
    );
  }
  if (flipped.claimedByUserId && flipped.priceCents != null) {
    await tellUgcBriefParty({
      userId: flipped.claimedByUserId,
      kind: "ugc_brief_escrow_funded",
      title: "Your brief is funded 👑",
      body: `The brand funded ${fmtMoney(flipped.priceCents)} for your claimed brief — it's held safely and releases to you when the brand approves your delivery.`,
    });
  }
  return { ok: true };
}

/** Persist a freshly created funding session's id — GUARDED on the
 *  funding claim still being open (C-34). The unguarded saveBrief it
 *  replaces could stamp the id onto a row whose claim had already
 *  been freed or closed — or fail into the fund catch, which frees
 *  the claim — stranding a live, payable Stripe session against a
 *  row that does not name it: settlement then refuses it and the
 *  paid money is unreconcilable without manual Stripe work. Returns
 *  the row when the id landed; null when the claim had moved on, in
 *  which case the caller must treat the session as orphaned and
 *  never hand it to the client. */
async function persistUgcBriefFundingSessionId(briefId: string, sessionId: string) {
  const [row] = await db
    .update(ugcBriefsTable)
    .set({ stripeSessionId: sessionId, updatedAt: new Date() })
    .where(
      and(eq(ugcBriefsTable.id, briefId), eq(ugcBriefsTable.escrowStatus, "funding")),
    )
    .returning();
  return row ?? null;
}

/** Base URL for Stripe return links. Loopback is refused on a
 *  deployed runtime — a checkout that returns to a loopback origin
 *  silently strands the buyer (the sponsors' guard, cloned). */
function ugcBriefEscrowBaseUrl(req: Request): string {
  const base = checkoutBaseUrl(req);
  const deployed = !!process.env["RENDER"] || process.env["NODE_ENV"] === "production";
  if (deployed && /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(base)) {
    throw new Error("UGC brief escrow return URL resolved to a loopback origin on a deployed runtime");
  }
  return base;
}

const fundBriefSchema = z.object({
  uiMode: z.enum(["embedded", "hosted"]).optional(),
});

/* ── POST /api/ugc-briefs/:id/fund — the brand funds the escrow ────── */
router.post("/ugc-briefs/:id/fund", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  const parsed = fundBriefSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  try {
    const row = await loadBrief(id);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    if (row.brandUserId !== req.userId) {
      res.status(403).json({ error: "Only the brand that posted this brief can fund it." });
      return;
    }
    if (row.priceCents == null) {
      res.status(400).json({ error: "This brief has no price — there is nothing to fund." });
      return;
    }
    if (row.status !== "claimed" && row.status !== "delivered") {
      res.status(409).json({
        error: `This brief is ${row.status} — a creator has to claim it before it can be funded.`,
      });
      return;
    }
    let supersededSessionId: string | null = null;
    if (row.escrowStatus === "funding") {
      /* Re-fund reconciliation (the sponsors pattern): a row stuck in
         'funding' is either an abandoned checkout (free it and start
         over) or a live one (resume it / refuse honestly). */
      const staleSessionId = row.stripeSessionId;
      if (!isStripeConfigured()) {
        /* Sandbox sessions never expire server-side — the new attempt
           supersedes the stale one. */
        if (staleSessionId) {
          const freed = await freeUgcBriefFundingForSession(id, staleSessionId);
          if (!freed) {
            const now = await loadBrief(id);
            res.status(409).json({ error: `This brief's payment is already ${now?.escrowStatus ?? "moving"} — refresh and check its state.` });
            return;
          }
          supersededSessionId = staleSessionId;
        }
      } else {
        if (!staleSessionId || staleSessionId.startsWith("sandbox_")) {
          res.status(409).json({ error: "A funding payment is already in progress for this brief." });
          return;
        }
        let staleSession: Stripe.Checkout.Session;
        try {
          staleSession = await createGuardedStripeClient().checkout.sessions.retrieve(staleSessionId);
        } catch (err) {
          logger.error({ err, briefId: id }, "[ugc-briefs] funding reconciliation check failed");
          res.status(503).json({ error: "We couldn't check the earlier checkout just now. Try again in a moment." });
          return;
        }
        const verdict = classifyEscrowCheckoutSession(staleSession);
        if (verdict === "expired") {
          const freed = await freeUgcBriefFundingForSession(id, staleSessionId);
          if (!freed) {
            res.status(409).json({ error: "This brief's payment is already funded — refresh and check its state." });
            return;
          }
          supersededSessionId = staleSessionId;
        } else if (verdict === "open") {
          if (staleSession.url) {
            res.json({ sandbox: false, checkoutUrl: staleSession.url, sessionId: staleSession.id });
            return;
          }
          if (staleSession.client_secret) {
            res.json({ sandbox: false, checkoutUrl: null, clientSecret: staleSession.client_secret, uiMode: "embedded", sessionId: staleSession.id });
            return;
          }
          res.status(409).json({ error: "A funding payment is already in progress for this brief." });
          return;
        } else if (verdict === "paid") {
          res.status(409).json({ error: "That checkout was already paid — the funding is settling. Refresh in a moment." });
          return;
        } else {
          res.status(409).json({ error: "A funding payment is already in progress for this brief." });
          return;
        }
      }
    } else if (row.escrowStatus !== "unfunded") {
      res.status(409).json({ error: `This brief's payment is already ${row.escrowStatus}.` });
      return;
    }
    const amountCents = row.priceCents;
    /* Claim the funding state with a guarded flip so two concurrent
       fund calls can never mint two live checkouts for one brief. */
    const [claimed] = await db
      .update(ugcBriefsTable)
      .set({ escrowStatus: "funding", updatedAt: new Date() })
      .where(and(eq(ugcBriefsTable.id, id), eq(ugcBriefsTable.escrowStatus, "unfunded")))
      .returning();
    if (!claimed) {
      res.status(409).json({ error: "This brief's payment is already moving — refresh and check its state." });
      return;
    }
    if (!isStripeConfigured()) {
      /* Sandbox: no Stripe keys — the payment is simulated and the
         confirm endpoint below settles it (refused when configured). */
      const sessionId = `sandbox_${randomUUID()}`;
      const persistedSandbox = await persistUgcBriefFundingSessionId(id, sessionId);
      if (!persistedSandbox) {
        throw new Error("sandbox funding session id could not be persisted — the funding claim had moved on");
      }
      res.json({
        sandbox: true,
        sessionId,
        amountCents,
        message: "Sandbox mode — no real money moved. Confirm to simulate funding.",
      });
      return;
    }
    const stripe = createGuardedStripeClient();
    const baseUrl = ugcBriefEscrowBaseUrl(req);
    const embeddedRequested = parsed.data.uiMode === "embedded" && isEmbeddedCheckoutEnabled();
    const successUrl = `${baseUrl}/promote?ugcBriefFunded=${id}`;
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `UGC brief escrow — ${row.productName}` },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        ugc_brief_id: id,
        ugc_brief_escrow: "true",
        brand_user_id: req.userId!,
        amount_cents: String(amountCents),
      },
      ...(embeddedRequested
        ? { ui_mode: "embedded_page" as const, return_url: successUrl }
        : { success_url: successUrl, cancel_url: `${baseUrl}/promote?ugcBriefFunded=0` }),
    };
    /* Determinism (the sponsors pattern): the same brand re-funding
       the same priced brief for the same claimer re-asks for the SAME
       session instead of minting a duplicate; a superseded attempt
       counts as a new purchase and mints a fresh one. */
    const idempotencyKey = buildCheckoutSessionIdempotencyKey({
      memberId: req.userId!,
      rail: "ugc-brief-escrow",
      purchaseIntent: {
        briefId: id,
        claimerUserId: row.claimedByUserId,
        amountCents,
        ...(supersededSessionId ? { supersededSessionId } : {}),
      },
      requestFingerprint: fingerprintStripeRequestParams(sessionParams),
    });
    const session = await stripe.checkout.sessions.create(sessionParams, { idempotencyKey });
    if (embeddedRequested && !session.client_secret) {
      throw new Error("Embedded checkout requested but Stripe returned no client_secret");
    }
    /* C-34: the session id lands through the guarded persist, and a
       miss is FATAL before the session ever reaches the client —
       the brand must never hold a payable checkout this row cannot
       name. The orphaned session id is logged at error level with
       the brief id so the wreckage stays reconcilable by hand; if
       the session is somehow paid anyway, markUgcBriefFunded's
       adoption branch can still settle it while the funding claim
       is open. */
    const persisted = await persistUgcBriefFundingSessionId(id, session.id).catch(() => null);
    if (!persisted) {
      logger.error(
        { briefId: id, sessionId: session.id },
        "[ugc-briefs] funding session orphaned — its id could not be persisted against the open funding claim",
      );
      throw new Error("funding session id could not be persisted");
    }
    if (embeddedRequested) {
      res.json({ sandbox: false, checkoutUrl: null, clientSecret: session.client_secret, uiMode: "embedded", sessionId: session.id });
    } else {
      res.json({ sandbox: false, checkoutUrl: session.url, sessionId: session.id });
    }
  } catch (err) {
    logger.error({ err, briefId: id }, "[ugc-briefs] escrow fund failed");
    /* Creation failed after the funding claim — free the claim back
       (guarded: only while still 'funding') so the brand can retry. */
    try {
      await db
        .update(ugcBriefsTable)
        .set({ escrowStatus: "unfunded", updatedAt: new Date() })
        .where(and(eq(ugcBriefsTable.id, id), eq(ugcBriefsTable.escrowStatus, "funding")));
    } catch { /* best effort — the next fund call reconciles */ }
    res.status(500).json({ error: "Could not start the funding payment — try again." });
  }
});

/* ── POST /api/ugc-briefs/:id/verify — settle from the payment record ─ */
router.post("/ugc-briefs/:id/verify", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await loadBrief(id);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    if (row.brandUserId !== req.userId) {
      res.status(403).json({ error: "Only the brand that posted this brief can verify its funding." });
      return;
    }
    if (!isStripeConfigured()) {
      res.status(400).json({ error: "Sandbox mode — confirm the sandbox funding instead." });
      return;
    }
    if (row.priceCents == null) {
      res.status(400).json({ error: "This brief has no price — there is nothing to verify." });
      return;
    }
    const sessionId = row.stripeSessionId;
    if (!sessionId || sessionId.startsWith("sandbox_")) {
      res.status(409).json({ error: "There is no checkout to verify yet — fund the brief first." });
      return;
    }
    let session: Stripe.Checkout.Session;
    try {
      session = await createGuardedStripeClient().checkout.sessions.retrieve(sessionId);
    } catch (err) {
      logger.error({ err, briefId: id }, "[ugc-briefs] verify session retrieve failed");
      res.status(503).json({ error: "We couldn't reach the payment record just now. Try again in a moment." });
      return;
    }
    if (session.metadata?.["ugc_brief_id"] !== id) {
      res.status(400).json({ error: "That checkout doesn't belong to this brief." });
      return;
    }
    if (session.payment_status !== "paid") {
      res.status(400).json({ error: "Payment has not been completed for this brief yet." });
      return;
    }
    if ((session.amount_total ?? 0) !== row.priceCents) {
      res.status(400).json({ error: "The paid amount doesn't match this brief's price." });
      return;
    }
    const result = await markUgcBriefFunded(
      id,
      session.id,
      typeof session.payment_intent === "string" ? session.payment_intent : null,
    );
    if (!result.ok) {
      res.status(409).json({ error: "This funding can't be settled in the brief's current state." });
      return;
    }
    const now = await loadBrief(id);
    res.json({ success: true, duplicate: result.reason === "already-funded", brief: now ? await toDTO(now) : null });
  } catch (err) {
    logger.error({ err, briefId: id }, "[ugc-briefs] verify failed");
    res.status(500).json({ error: "Could not verify that funding — try again." });
  }
});

/* ── POST /api/ugc-briefs/escrow/confirm — sandbox settle ──────────── */
export const ugcBriefEscrowConfirmSchema = z.object({
  briefId: z.string().uuid(),
  sessionId: z.string().min(1).max(200),
});

router.post("/ugc-briefs/escrow/confirm", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = ugcBriefEscrowConfirmSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  if (isStripeConfigured()) {
    res.status(400).json({ error: "Sandbox confirm is disabled when real payments are configured." });
    return;
  }
  try {
    const row = await loadBrief(parsed.data.briefId);
    if (!row || !canSee(row, req.userId!)) {
      res.status(404).json({ error: "Brief not found" });
      return;
    }
    if (row.brandUserId !== req.userId) {
      res.status(403).json({ error: "Only the brand that posted this brief can confirm its funding." });
      return;
    }
    if (row.stripeSessionId !== parsed.data.sessionId || !parsed.data.sessionId.startsWith("sandbox_")) {
      res.status(400).json({ error: "That sandbox session doesn't belong to this brief." });
      return;
    }
    const result = await markUgcBriefFunded(parsed.data.briefId, parsed.data.sessionId, null);
    if (!result.ok) {
      res.status(409).json({ error: "This funding can't be settled in the brief's current state." });
      return;
    }
    const now = await loadBrief(parsed.data.briefId);
    res.json({ success: true, duplicate: result.reason === "already-funded", brief: now ? await toDTO(now) : null });
  } catch (err) {
    logger.error({ err }, "[ugc-briefs] escrow confirm failed");
    res.status(500).json({ error: "Could not confirm that funding — try again." });
  }
});

export default router;
