import Stripe from "stripe";
import type { Request } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { getSupabaseAdmin } from "./supabase-admin";
import { createGuardedStripeClient, isStripeTestModeKey } from "./stripe-client";
import { notifyUserEvent, type UserEventInput } from "./push-events";

/* ── Stripe Connect (Express) money-out — shared helper ──────────────────
 * TEST MODE: every call below runs against Stripe's test API when the
 * secret key is a test key (sk_test_*). Test-mode transfers move no real
 * money. Real payouts require a later explicit user approval + live keys.
 * All functions fail closed when STRIPE_SECRET_KEY is missing. */

export function getConnectStripe(): Stripe {
  /* Fail closed on live keys (Lane V3 F7): money-out rides the shared
     guard in lib/stripe-client.ts, never a local key check. */
  return createGuardedStripeClient();
}

export function isTestMode(): boolean {
  return isStripeTestModeKey();
}

function getBaseUrl(req?: Request): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (domain) return `https://${domain}`;
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) return `https://${devDomain}`;
  const frontend = process.env["FRONTEND_URL"];
  if (frontend) return frontend.replace(/\/$/, "");
  if (req) {
    const proto = req.headers["x-forwarded-proto"] ?? "https";
    const host = req.headers["host"];
    if (host) return `${proto}://${host}`;
  }
  return "http://localhost";
}

export interface ConnectFields {
  accountId: string | null;
  onboarded: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

/* The seller-facing Connect state machine (payfix payout-build):
 *   not_started   — no connected account exists yet
 *   pending       — account exists, Stripe still verifying / no user
 *                   action outstanding, payouts not yet enabled
 *   action_needed — Stripe is waiting on the SELLER (requirement
 *                   entries awaiting user action, or a past-due list);
 *                   `actionNeeded` carries Stripe's own descriptions
 *   verified      — payouts capability active: the seller can cash out
 * Derived in exactly one place (parseConnectAccountState) so the
 * webhook sync, the live status read and the payout gate can never
 * disagree about what a Stripe account object means. */
export type ConnectState = "not_started" | "pending" | "action_needed" | "verified";

export interface ConnectAccountState extends ConnectFields {
  state: ConnectState;
  /** Stripe's own reasons the seller must act (human-readable). */
  actionNeeded: string[];
}

/* The two account shapes Stripe actually sends us:
 * - v2 (accounts.retrieve / v2 event destinations):
 *   configuration.recipient.capabilities.stripe_balance
 *     .{stripe_transfers,payouts}.status + requirements.entries[]
 * - v1 (the classic webhook endpoint's account.updated — the payload
 *   our /api/stripe-webhook actually receives):
 *   payouts_enabled / charges_enabled / details_submitted booleans +
 *   requirements.currently_due[] / requirements.disabled_reason.
 * The pre-fix sync read ONLY the v2 shape, so every v1 account.updated
 * (and every thin v2 event carrying just an id) synced to
 * payouts_enabled=false — a verified seller could never reconcile. */
export interface ConnectAccountLike {
  id: string;
  configuration?: {
    recipient?: {
      capabilities?: {
        stripe_balance?: {
          stripe_transfers?: { status?: string; status_details?: Array<{ code?: string }> };
          payouts?: { status?: string; status_details?: Array<{ code?: string }> };
        };
      };
    };
  };
  requirements?: {
    entries?: Array<{
      description?: string;
      awaiting_action_from?: string;
      errors?: Array<{ description?: string }>;
    }>;
    currently_due?: string[];
    disabled_reason?: string | null;
  };
  payouts_enabled?: boolean;
  charges_enabled?: boolean;
  details_submitted?: boolean;
}

const REASON_TEXT: Record<string, string> = {
  determining_status: "Stripe is still determining your account status.",
  requirements_past_due: "Some required information is past due — Stripe needs it to keep payouts on.",
  requirements_pending_verification: "Stripe is verifying the information you submitted.",
  restricted_other: "Your payouts are restricted — finish your Stripe setup or contact Stripe support.",
  unsupported_business: "This business type isn't supported for payouts.",
  unsupported_country: "Payouts aren't supported in the account's country yet.",
  unsupported_entity_type: "This entity type isn't supported for payouts.",
};

function reasonText(code: string | undefined): string | null {
  if (!code) return null;
  return REASON_TEXT[code] ?? `Stripe flagged your account: ${code.replace(/_/g, " ")}.`;
}

/** True when the payload carries ANY capability signal — a payload
 *  with none (a thin v2 event: id only) must never be synced as
 *  "everything disabled". */
export function connectPayloadHasSignal(acct: ConnectAccountLike): boolean {
  const balance = acct.configuration?.recipient?.capabilities?.stripe_balance;
  if (balance?.stripe_transfers?.status || balance?.payouts?.status) return true;
  if (typeof acct.payouts_enabled === "boolean" || typeof acct.charges_enabled === "boolean") return true;
  return false;
}

export function parseConnectAccountState(acct: ConnectAccountLike): ConnectAccountState {
  const balance = acct.configuration?.recipient?.capabilities?.stripe_balance;
  const hasV2 = !!(balance?.stripe_transfers?.status || balance?.payouts?.status);
  const hasV1 = typeof acct.payouts_enabled === "boolean" || typeof acct.charges_enabled === "boolean";

  let transfersActive = false;
  let payoutsActive = false;
  let onboarded = false;
  const actionNeeded: string[] = [];

  if (hasV2) {
    transfersActive = balance?.stripe_transfers?.status === "active";
    payoutsActive = balance?.payouts?.status === "active";
    const entries = acct.requirements?.entries ?? [];
    onboarded = payoutsActive || transfersActive || entries.length === 0;
    for (const e of entries) {
      if (e.awaiting_action_from === "user") {
        for (const err of e.errors ?? []) {
          if (err.description) actionNeeded.push(err.description);
        }
        if ((!e.errors || e.errors.length === 0) && e.description) {
          actionNeeded.push(e.description);
        }
      }
    }
    if (!payoutsActive) {
      for (const d of balance?.payouts?.status_details ?? []) {
        const t = reasonText(d.code);
        if (t && d.code !== "requirements_pending_verification") actionNeeded.push(t);
      }
    }
  } else if (hasV1) {
    transfersActive = acct.charges_enabled === true;
    payoutsActive = acct.payouts_enabled === true;
    onboarded = acct.details_submitted === true || payoutsActive || transfersActive;
    const due = acct.requirements?.currently_due ?? [];
    for (const field of due) {
      actionNeeded.push(`Stripe still needs: ${field.replace(/[._]/g, " ")}`);
    }
    if (acct.requirements?.disabled_reason) {
      actionNeeded.push(`Stripe disabled payouts on this account (${acct.requirements.disabled_reason.replace(/_/g, " ")}).`);
    }
  }

  const deduped = [...new Set(actionNeeded)];
  const state: ConnectState = payoutsActive
    ? "verified"
    : deduped.length > 0
      ? "action_needed"
      : "pending";
  return {
    accountId: acct.id,
    onboarded,
    chargesEnabled: transfersActive,
    payoutsEnabled: payoutsActive,
    state,
    actionNeeded: deduped,
  };
}

/** The stored-flags fallback state when Stripe can't be reached:
 *  derived from the same booleans the DB carries, never invented. */
export function connectStateFromStored(fields: ConnectFields): ConnectAccountState {
  return {
    ...fields,
    state: !fields.accountId
      ? "not_started"
      : fields.payoutsEnabled
        ? "verified"
        : "pending",
    actionNeeded: [],
  };
}

/* ── Payout-ready push (push wiring #4) ──────────────────────────────────
   The moment Stripe flips a seller to payouts_enabled is a money moment
   the seller should hear about on their phone, not discover by opening
   Earnings. Exactly-once comes from the transition itself: the flags
   row only crosses false → true once, and persistConnectFlags is the
   ONE writer of those flags (webhook sync + status self-heal both ride
   it), so the crossing is observed exactly once. */
export function payoutBecameReady(
  prev: Pick<ConnectFields, "payoutsEnabled">,
  next: Pick<ConnectFields, "payoutsEnabled">,
): boolean {
  return !prev.payoutsEnabled && next.payoutsEnabled;
}

type ConnectEventNotifier = (input: UserEventInput) => Promise<unknown>;
let _connectEventNotifier: ConnectEventNotifier = notifyUserEvent;
/** Test seam — never used outside tests. */
export function __setConnectEventNotifier(fn: ConnectEventNotifier | null): void {
  _connectEventNotifier = fn ?? notifyUserEvent;
}

export interface PayoutReadyDeps {
  readUserId: (profileId: string) => Promise<string | null>;
  notify: ConnectEventNotifier;
}

const realPayoutReadyDeps: PayoutReadyDeps = {
  readUserId: async (profileId) => {
    const r = await db.execute(sql`
      SELECT user_id FROM creator_profiles WHERE id = ${profileId} LIMIT 1
    `);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return typeof row?.["user_id"] === "string" ? (row["user_id"] as string) : null;
  },
  notify: (input) => _connectEventNotifier(input),
};

/** Fire the payout-ready event iff the flags crossed to payouts-on.
 *  Best-effort by design: never throws into the Connect sync. */
export async function maybeNotifyPayoutReady(
  profileId: string,
  prev: Pick<ConnectFields, "payoutsEnabled">,
  next: Pick<ConnectFields, "payoutsEnabled">,
  deps: PayoutReadyDeps = realPayoutReadyDeps,
): Promise<boolean> {
  if (!payoutBecameReady(prev, next)) return false;
  try {
    const userId = await deps.readUserId(profileId);
    if (!userId) return false;
    await deps.notify({
      userId,
      category: "money",
      kind: "payout_ready",
      title: "You're ready to get paid 👑",
      body: "Stripe finished verifying your account — payouts are on. Head to Earnings to send your money out.",
      link: "/earnings",
    });
    return true;
  } catch (err) {
    logger.warn({ err, profileId }, "connect: payout-ready notification failed (non-fatal)");
    return false;
  }
}

/** Persist reconciled flags onto the creator profile — the ONE writer
 *  (webhook sync + status self-heal both ride it). */
export async function persistConnectFlags(profileId: string, s: ConnectFields): Promise<void> {
  /* Read the stored flags BEFORE the write so the payout-ready
   * transition (push wiring #4) is observed against the truth. A read
   * failure skips the notification, never the persist. */
  let prev: ConnectFields | null = null;
  try {
    prev = await getProfileConnectFields(profileId);
  } catch {
    prev = null;
  }
  await db.execute(sql`
    UPDATE creator_profiles
    SET stripe_connect_onboarded = ${s.onboarded},
        stripe_connect_charges_enabled = ${s.chargesEnabled},
        stripe_connect_payouts_enabled = ${s.payoutsEnabled},
        updated_at = NOW()
    WHERE id = ${profileId}
  `);
  if (prev) {
    await maybeNotifyPayoutReady(profileId, prev, s);
  }
}

export async function getProfileConnectFields(profileId: string): Promise<ConnectFields> {
  const r = await db.execute(sql`
    SELECT stripe_connect_account_id, stripe_connect_onboarded,
           stripe_connect_charges_enabled, stripe_connect_payouts_enabled
    FROM creator_profiles WHERE id = ${profileId} LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("profile not found");
  return {
    accountId: (row["stripe_connect_account_id"] as string | null) ?? null,
    onboarded: row["stripe_connect_onboarded"] === true,
    chargesEnabled: row["stripe_connect_charges_enabled"] === true,
    payoutsEnabled: row["stripe_connect_payouts_enabled"] === true,
  };
}

export async function getProfileIdByConnectAccount(accountId: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT id FROM creator_profiles WHERE stripe_connect_account_id = ${accountId} LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row ? String(row["id"]) : null;
}

export async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) return null;
    return data.user.email;
  } catch {
    return null;
  }
}

/* Create the Express connected account for a creator profile and store it.
 * Uses the Accounts v2 API — Stripe deprecated v1 account creation for new
 * Connect integrations (Oct 2026: v1 returns "use POST /v2/core/accounts"). */
export async function createConnectAccount(profileId: string, email: string | null): Promise<Stripe.V2.Core.Account> {
  const stripe = getConnectStripe();
  const account = await stripe.v2.core.accounts.create({
    ...(email ? { contact_email: email } : {}),
    dashboard: "express",
    /* v2 requires identity.country before configuration.recipient can be
     * set. US default (platform is US-based); onboarding collects/updates
     * the creator's actual identity details. */
    identity: { country: "US", entity_type: "individual" },
    /* Required by Stripe for recipient accounts with the stripe_transfers
     * capability: the platform collects fees and covers losses (matches the
     * platform-liability choice made during Connect onboarding). */
    defaults: {
      responsibilities: { fees_collector: "application", losses_collector: "application" },
    },
    configuration: {
      recipient: {
        capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
      },
    },
    metadata: { profile_id: profileId, platform: "bow-down-visuals" },
  });
  await db.execute(sql`
    UPDATE creator_profiles
    SET stripe_connect_account_id = ${account.id}, updated_at = NOW()
    WHERE id = ${profileId}
  `);
  logger.info({ profileId, accountId: account.id }, "[connect] Express account created (v2)");
  return account;
}

/* Onboarding (or re-onboarding) link for the connected account. v2 account
 * links take a use_case instead of the v1 account_onboarding type flag. */
export async function createOnboardingLink(accountId: string, req?: Request): Promise<Stripe.V2.Core.AccountLink> {
  const stripe = getConnectStripe();
  const base = getBaseUrl(req);
  return stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["recipient"],
        refresh_url: `${base}/store/dashboard?connect=refresh`,
        return_url: `${base}/store/dashboard?connect=done`,
      },
    },
  });
}

/* Live capability state straight from Stripe (v2). For a recipient account:
 * - stripe_transfers = money IN (platform → creator's Stripe balance)
 * - payouts = money OUT (Stripe balance → creator's bank)
 * "Payouts enabled" on the Get Paid card reflects the payouts capability.
 * Parsing rides parseConnectAccountState — the same derivation the
 * webhook sync uses — so live reads and webhook writes never disagree. */
export async function getConnectStatus(accountId: string): Promise<ConnectAccountState> {
  const stripe = getConnectStripe();
  const acct = await stripe.v2.core.accounts.retrieve(accountId);
  const state = parseConnectAccountState(acct as unknown as ConnectAccountLike);
  logger.info(
    {
      accountId,
      state: state.state,
      payoutsEnabled: state.payoutsEnabled,
      chargesEnabled: state.chargesEnabled,
      actionNeeded: state.actionNeeded.length,
    },
    "[connect] v2 capability state",
  );
  return state;
}

/* Removed 2026-10-10: createLoginLink was a dead stub (zero imports).
 * Dashboard login link: the v2 API has no login-link endpoint, so creators
 * manage their account in the Stripe Express dashboard directly. */

/* Transfer creator earnings to their connected account. TEST MODE only moves
 * test funds. Idempotency key prevents double-payouts on retry. */
export async function createPayoutTransfer(
  accountId: string,
  amountCents: number,
  idempotencyKey: string,
): Promise<Stripe.Transfer> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("payout amount must be a positive integer of cents");
  }
  const stripe = getConnectStripe();
  return stripe.transfers.create(
    {
      amount: amountCents,
      currency: "usd",
      destination: accountId,
      description: "Bow Down Visuals creator payout",
    },
    { idempotencyKey },
  );
}

/* account.updated webhook → keep the profile flags in sync.
 *
 * Shape-tolerant (payfix payout-build): the classic webhook endpoint
 * delivers v1-shaped account objects; v2 event destinations deliver
 * the v2 shape OR a thin event (id only). All three land here:
 * - v1 / full v2 payload → parse and persist.
 * - thin payload (no capability signal) → re-fetch the account live
 *   and persist THAT. Writing the parsed thin payload would store
 *   all-false flags — the pre-fix bug that kept verified sellers at
 *   "isn't verified yet" forever. */
export async function syncConnectAccountStatus(acct: ConnectAccountLike): Promise<void> {
  const profileId = await getProfileIdByConnectAccount(acct.id);
  if (!profileId) {
    logger.warn({ accountId: acct.id }, "[connect] account.updated for unknown account — skipping");
    return;
  }
  let state: ConnectAccountState;
  if (connectPayloadHasSignal(acct)) {
    state = parseConnectAccountState(acct);
  } else {
    state = await getConnectStatus(acct.id);
  }
  await persistConnectFlags(profileId, state);
  logger.info(
    {
      profileId,
      accountId: acct.id,
      state: state.state,
      onboarded: state.onboarded,
      chargesEnabled: state.chargesEnabled,
      payoutsEnabled: state.payoutsEnabled,
    },
    "[connect] account status synced from webhook",
  );
}
