import Stripe from "stripe";
import type { Request } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { getSupabaseAdmin } from "./supabase-admin";

/* ── Stripe Connect (Express) money-out — shared helper ──────────────────
 * TEST MODE: every call below runs against Stripe's test API when the
 * secret key is a test key (sk_test_*). Test-mode transfers move no real
 * money. Real payouts require a later explicit user approval + live keys.
 * All functions fail closed when STRIPE_SECRET_KEY is missing. */

export function getConnectStripe(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key);
}

export function isTestMode(): boolean {
  const key = process.env["STRIPE_SECRET_KEY"] ?? "";
  return key.startsWith("sk_test_");
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

/* Create the Express connected account for a creator profile and store it. */
export async function createConnectAccount(profileId: string, email: string | null): Promise<Stripe.Account> {
  const stripe = getConnectStripe();
  const account = await stripe.accounts.create({
    type: "express",
    ...(email ? { email } : {}),
    capabilities: { transfers: { requested: true } },
    metadata: { profile_id: profileId, platform: "bow-down-visuals" },
  });
  await db.execute(sql`
    UPDATE creator_profiles
    SET stripe_connect_account_id = ${account.id}, updated_at = NOW()
    WHERE id = ${profileId}
  `);
  logger.info({ profileId, accountId: account.id }, "[connect] Express account created");
  return account;
}

/* Onboarding (or re-onboarding) link for the connected account. */
export async function createOnboardingLink(accountId: string, req?: Request): Promise<Stripe.AccountLink> {
  const stripe = getConnectStripe();
  const base = getBaseUrl(req);
  return stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${base}/store/dashboard?connect=refresh`,
    return_url: `${base}/store/dashboard?connect=done`,
    type: "account_onboarding",
  });
}

/* Live capability state straight from Stripe. */
export async function getConnectStatus(accountId: string): Promise<ConnectFields> {
  const stripe = getConnectStripe();
  const acct = await stripe.accounts.retrieve(accountId);
  return {
    accountId: acct.id,
    onboarded: acct.details_submitted === true,
    chargesEnabled: acct.charges_enabled === true,
    payoutsEnabled: acct.payouts_enabled === true,
  };
}

/* Dashboard login link so creators can manage their Express account. */
export async function createLoginLink(accountId: string): Promise<Stripe.LoginLink> {
  const stripe = getConnectStripe();
  return stripe.accounts.createLoginLink(accountId);
}

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

/* account.updated webhook → keep the profile flags in sync. */
export async function syncConnectAccountStatus(acct: Stripe.Account): Promise<void> {
  const profileId = await getProfileIdByConnectAccount(acct.id);
  if (!profileId) {
    logger.warn({ accountId: acct.id }, "[connect] account.updated for unknown account — skipping");
    return;
  }
  await db.execute(sql`
    UPDATE creator_profiles
    SET stripe_connect_onboarded = ${acct.details_submitted === true},
        stripe_connect_charges_enabled = ${acct.charges_enabled === true},
        stripe_connect_payouts_enabled = ${acct.payouts_enabled === true},
        updated_at = NOW()
    WHERE id = ${profileId}
  `);
  logger.info(
    {
      profileId,
      accountId: acct.id,
      onboarded: acct.details_submitted,
      chargesEnabled: acct.charges_enabled,
      payoutsEnabled: acct.payouts_enabled,
    },
    "[connect] account status synced from webhook",
  );
}
