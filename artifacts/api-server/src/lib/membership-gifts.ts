/**
 * membership-gifts.ts — the gift-membership rail (payfix lane 9).
 *
 * One signed-in member gifts a Pro/Elite period to another member.
 * The gift is a ONE-TIME payment (Stripe Checkout, mode=payment,
 * embedded on bowdownvisuals.com) — never a subscription:
 *
 *   - Nothing auto-renews. No card of the recipient's is ever charged
 *     (they may not even have one). At period end the recipient glides
 *     back to whatever their own subscription says (Free if none) —
 *     the tier resolver reads the gift window directly, so glide-back
 *     needs no cron and no writes.
 *   - Collision rule (stated in schema + UI copy): gifts QUEUE behind
 *     an already-active/queued gift for the same recipient (the new
 *     period starts when the current gift coverage ends) and run
 *     CONCURRENTLY with the recipient's own paid subscription — the
 *     effective tier is the higher of the two, so a gift can never
 *     downgrade anyone and never wastes paid time.
 *   - Exactly once: the membership_gifts row is born at fulfillment
 *     (webhook OR the buyer's verify call, whichever lands first) and
 *     claims on UNIQUE(stripe_session_id). A replay returns the
 *     existing row as the sender's receipt and grants nothing twice.
 *     The recipient notification is inserted only by the claim winner.
 *
 * All DB access is raw SQL via db.execute (the pg-mem test adapter
 * cannot run drizzle's query builder — same discipline as gift-cards).
 */
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { TIER_PLANS, meetsTier, type CreatorTier } from "./platform-fees";

export type GiftTier = Exclude<CreatorTier, "free">;

export const GIFT_TIERS: GiftTier[] = ["pro", "elite"];

/** The lifecycle truth, in the exact words every surface must use. */
export const GIFT_NO_RENEW_COPY =
  "A gift is a one-time payment — it does not auto-renew and no card is charged again. When the gifted period ends, the recipient glides back to Free unless they subscribe on their own.";

export const GIFT_COLLISION_COPY =
  "If they already have this tier from another gift, your gift queues up and starts when that gift ends — no paid time is lost. If they pay for their own plan, the gift runs alongside it and they always keep the higher tier.";

export function isGiftTier(v: unknown): v is GiftTier {
  return v === "pro" || v === "elite";
}

/** Server-authoritative gift price: the approved monthly price × months. */
export function giftAmountCents(tier: GiftTier, months: number): number {
  const plan = TIER_PLANS.find((p) => p.tier === tier);
  if (!plan || plan.priceUsdPerMonth == null) throw new Error(`No price for gift tier ${tier}`);
  return plan.priceUsdPerMonth * 100 * months;
}

export function giftTierName(tier: GiftTier): string {
  return tier === "elite" ? "Elite" : "Pro";
}

/** Add calendar months, clamping the day (Jan 31 + 1mo → Feb 28/29). */
export function addMonthsClamped(start: Date, months: number): Date {
  const d = new Date(start.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/**
 * Queue rule: the new gift starts at the later of `now` and the latest
 * existing gift coverage end, and runs `months` from there.
 */
export function computeGiftWindow(
  existingEnds: Date[],
  now: Date,
  months: number,
): { periodStart: Date; periodEnd: Date } {
  let start = now;
  for (const end of existingEnds) {
    if (end.getTime() > start.getTime()) start = new Date(end.getTime());
  }
  return { periodStart: start, periodEnd: addMonthsClamped(start, months) };
}

export interface GiftWindowRow {
  tier: string;
  status: string;
  periodStart: Date | string;
  periodEnd: Date | string;
}

/** Highest gifted tier whose window covers `at` — null when none does (the glide-back). */
export function highestGiftTierAt(rows: GiftWindowRow[], at: Date): GiftTier | null {
  let best: GiftTier | null = null;
  for (const r of rows) {
    if (r.status !== "active" || !isGiftTier(r.tier)) continue;
    const s = new Date(r.periodStart).getTime();
    const e = new Date(r.periodEnd).getTime();
    if (s <= at.getTime() && at.getTime() < e) {
      if (!best || meetsTier(r.tier, best)) best = r.tier;
    }
  }
  return best;
}

/** Display status computed from the window — the stored status stays 'active'/'refunded'. */
export function giftDisplayStatus(
  row: GiftWindowRow,
  at: Date,
): "active" | "queued" | "expired" | "refunded" {
  if (row.status === "refunded") return "refunded";
  const s = new Date(row.periodStart).getTime();
  const e = new Date(row.periodEnd).getTime();
  if (at.getTime() < s) return "queued";
  if (at.getTime() >= e) return "expired";
  return "active";
}

/* ── Recipient resolution ─────────────────────────────────────────────
   The site identifies users by their creator handle (creator_profiles
   .slug, with or without a leading @) or by the email on their account
   (profiles.email). A recipient must have a creator profile — the
   gift row's entitlement FK points at it. Unknown → null (the route
   refuses honestly; it never guesses). */
export interface GiftRecipient {
  userId: string;
  profileId: string;
  slug: string;
  displayName: string;
}

export async function resolveGiftRecipient(lookupRaw: string): Promise<GiftRecipient | null> {
  const lookup = lookupRaw.trim();
  if (!lookup) return null;
  try {
    if (lookup.includes("@") && lookup.includes(".")) {
      const r = await db.execute(sql`
        SELECT cp.id AS profile_id, cp.user_id AS user_id, cp.slug AS slug, cp.display_name AS display_name
        FROM creator_profiles cp
        JOIN profiles p ON p.id = cp.user_id
        WHERE LOWER(p.email) = ${lookup.toLowerCase()}
        LIMIT 1
      `);
      const row = r.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        userId: String(row["user_id"]),
        profileId: String(row["profile_id"]),
        slug: String(row["slug"]),
        displayName: String(row["display_name"]),
      };
    }
    const handle = lookup.replace(/^@+/, "").toLowerCase();
    const r = await db.execute(sql`
      SELECT id AS profile_id, user_id, slug, display_name
      FROM creator_profiles
      WHERE LOWER(slug) = ${handle}
      LIMIT 1
    `);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      userId: String(row["user_id"]),
      profileId: String(row["profile_id"]),
      slug: String(row["slug"]),
      displayName: String(row["display_name"]),
    };
  } catch (err) {
    logger.warn({ err }, "membership-gifts: recipient lookup failed");
    return null;
  }
}

/* ── Fulfillment: grant exactly once ────────────────────────────────── */
export interface FulfillGiftInput {
  sessionId: string;
  paymentIntentId: string | null;
  amountCents: number | null;
  currency: string | null;
  senderUserId: string;
  recipientUserId: string;
  recipientProfileId: string;
  tier: GiftTier;
  months: number;
  now?: Date;
}

export interface GiftRow extends Record<string, unknown> {
  id: string;
  sender_user_id: string;
  recipient_user_id: string;
  recipient_profile_id: string;
  tier: string;
  months: number;
  status: string;
  stripe_session_id: string;
  period_start: Date | string;
  period_end: Date | string;
}

async function fetchGiftBySession(sessionId: string): Promise<GiftRow | null> {
  const r = await db.execute(sql`
    SELECT * FROM membership_gifts WHERE stripe_session_id = ${sessionId} LIMIT 1
  `);
  return (r.rows[0] as GiftRow | undefined) ?? null;
}

async function gifterLabel(senderUserId: string): Promise<string> {
  try {
    const r = await db.execute(sql`
      SELECT display_name, slug FROM creator_profiles WHERE user_id = ${senderUserId} LIMIT 1
    `);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (row) return `${String(row["display_name"])} (@${String(row["slug"])})`;
  } catch { /* label only — never block the grant */ }
  return "A Bow Down Visuals member";
}

/**
 * Claim + grant a paid gift. Insert-first on UNIQUE(stripe_session_id):
 * only the claim winner computes the queued window, inserts the row
 * (the sender's receipt + the recipient's entitlement record) and
 * inserts the recipient's notification naming the gifter. A replay
 * (webhook redelivery, verify-after-webhook, double verify) returns
 * { duplicate: true } with the original row and writes nothing.
 */
export async function fulfillGiftMembership(
  input: FulfillGiftInput,
): Promise<{ gift: GiftRow; duplicate: boolean }> {
  const existing = await fetchGiftBySession(input.sessionId);
  if (existing) return { gift: existing, duplicate: true };

  const now = input.now ?? new Date();
  const endsRes = await db.execute(sql`
    SELECT period_end FROM membership_gifts
    WHERE recipient_profile_id = ${input.recipientProfileId}
      AND status = 'active' AND period_end > ${now.toISOString()}
  `);
  const ends = (endsRes.rows as Array<Record<string, unknown>>).map(
    (r) => new Date(r["period_end"] as string),
  );
  const { periodStart, periodEnd } = computeGiftWindow(ends, now, input.months);

  const inserted = await db.execute(sql`
    INSERT INTO membership_gifts
      (id, sender_user_id, recipient_user_id, recipient_profile_id, tier, months, status,
       stripe_session_id, stripe_payment_intent_id, amount_cents, currency,
       period_start, period_end)
    VALUES (${randomUUID()}, ${input.senderUserId}, ${input.recipientUserId}, ${input.recipientProfileId},
            ${input.tier}, ${input.months}, 'active',
            ${input.sessionId}, ${input.paymentIntentId}, ${input.amountCents}, ${input.currency},
            ${periodStart.toISOString()}, ${periodEnd.toISOString()})
    ON CONFLICT (stripe_session_id) DO NOTHING
    RETURNING *
  `);
  const gift = (inserted.rows[0] as GiftRow | undefined) ?? null;
  if (!gift) {
    // Lost a concurrent claim race — the winner's row is the receipt.
    const winner = await fetchGiftBySession(input.sessionId);
    if (!winner) throw new Error("Gift claim vanished after conflict");
    return { gift: winner, duplicate: true };
  }

  /* Recipient notification — only the claim winner writes it, so a
     replay can never double-notify. Best-effort: the entitlement row
     above is already durable; a notification failure must not un-grant. */
  try {
    const gifter = await gifterLabel(input.senderUserId);
    const tierName = giftTierName(input.tier);
    const queued = periodStart.getTime() > now.getTime();
    await db.execute(sql`
      INSERT INTO notifications (id, user_id, kind, title, body, link)
      VALUES (${randomUUID()}, ${input.recipientUserId}, 'membership_gift',
              ${`${gifter.split(" (")[0]} gifted you ${tierName}`},
              ${`${gifter} gifted you ${input.months} month${input.months === 1 ? "" : "s"} of ${tierName} on Bow Down Visuals — ${queued ? `it starts ${periodStart.toISOString().slice(0, 10)} (queued behind your current gift, so no time is lost) and runs` : "it is active now and runs"} until ${periodEnd.toISOString().slice(0, 10)}. ${GIFT_NO_RENEW_COPY}`},
              '/creator-pricing')
    `);
  } catch (err) {
    logger.warn({ err, giftId: gift.id }, "membership-gifts: recipient notification failed (grant stands)");
  }

  logger.info(
    { giftId: gift.id, sender: input.senderUserId, recipientProfileId: input.recipientProfileId, tier: input.tier, periodStart, periodEnd },
    "membership gift granted",
  );
  return { gift, duplicate: false };
}

/** The gifted tier covering `at` for a profile — the resolver's gift leg. Null = glide back. */
export async function giftTierForProfile(
  profileId: string,
  at: Date = new Date(),
): Promise<GiftTier | null> {
  const r = await db.execute(sql`
    SELECT tier, status, period_start, period_end FROM membership_gifts
    WHERE recipient_profile_id = ${profileId} AND status = 'active'
      AND period_start <= ${at.toISOString()} AND period_end > ${at.toISOString()}
  `);
  return highestGiftTierAt(
    (r.rows as Array<Record<string, unknown>>).map((row) => ({
      tier: String(row["tier"]),
      status: String(row["status"]),
      periodStart: row["period_start"] as Date,
      periodEnd: row["period_end"] as Date,
    })),
    at,
  );
}

/** Sent (receipts) + received gifts for the caller's gift desk. */
export async function listGiftsForUser(
  userId: string,
  at: Date = new Date(),
): Promise<{ sent: Array<Record<string, unknown>>; received: Array<Record<string, unknown>> }> {
  const present = (rows: Array<Record<string, unknown>>) =>
    rows.map((r) => ({
      id: String(r["id"]),
      tier: String(r["tier"]),
      months: Number(r["months"]),
      amountCents: r["amount_cents"] == null ? null : Number(r["amount_cents"]),
      currency: (r["currency"] as string | null) ?? null,
      periodStart: r["period_start"],
      periodEnd: r["period_end"],
      createdAt: r["created_at"],
      displayStatus: giftDisplayStatus(
        {
          tier: String(r["tier"]),
          status: String(r["status"]),
          periodStart: r["period_start"] as Date,
          periodEnd: r["period_end"] as Date,
        },
        at,
      ),
      counterpartyName: String(r["counterparty_name"] ?? ""),
      counterpartySlug: String(r["counterparty_slug"] ?? ""),
    }));
  const sent = await db.execute(sql`
    SELECT mg.*, cp.display_name AS counterparty_name, cp.slug AS counterparty_slug
    FROM membership_gifts mg
    JOIN creator_profiles cp ON cp.id = mg.recipient_profile_id
    WHERE mg.sender_user_id = ${userId}
    ORDER BY mg.created_at DESC LIMIT 100
  `);
  const received = await db.execute(sql`
    SELECT mg.*, cp.display_name AS counterparty_name, cp.slug AS counterparty_slug
    FROM membership_gifts mg
    LEFT JOIN creator_profiles cp ON cp.user_id = mg.sender_user_id
    WHERE mg.recipient_user_id = ${userId}
    ORDER BY mg.created_at DESC LIMIT 100
  `);
  return {
    sent: present(sent.rows as Array<Record<string, unknown>>),
    received: present(received.rows as Array<Record<string, unknown>>),
  };
}

/** Count of completed gifts for one sender+recipient+tier+months intent (checkout idempotency sequence). */
export async function countCompletedGifts(input: {
  senderUserId: string;
  recipientProfileId: string;
  tier: GiftTier;
  months: number;
}): Promise<number> {
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM membership_gifts
    WHERE sender_user_id = ${input.senderUserId}
      AND recipient_profile_id = ${input.recipientProfileId}
      AND tier = ${input.tier} AND months = ${input.months}
  `);
  return Number((r.rows[0] as { c?: number } | undefined)?.c ?? 0);
}
