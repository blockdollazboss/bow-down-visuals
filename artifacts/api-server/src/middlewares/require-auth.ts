import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response, NextFunction } from "express";
import { ensureKingsWelcome } from "../lib/kings-welcome";
import { recordGrantLedger, STARTER_GRANT_CREDITS } from "../lib/grant-ledger";
import { logger } from "../lib/logger";
import { resolveCreatorTier } from "./require-tier";
import {
  meetsTier,
  tierFromLegacyPlan,
  tierFromPlanTier,
  legacyPlanNameForTier,
  type CreatorTier,
} from "../lib/platform-fees";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      accessToken?: string;
      userCredits?: number;
      userPlan?: string;
      userSupabase?: SupabaseClient;
    }
  }
}

const SUPABASE_URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
const SUPABASE_ANON_KEY = process.env["SUPABASE_ANON_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"] ?? "";

// Creates a Supabase client with the user's session active — mirrors exactly
// how the frontend SDK operates after signIn, which is required for the
// sb_publishable_* key format to reach PostgREST correctly.
export async function createSessionSupabase(accessToken: string): Promise<SupabaseClient> {
  // Use the verified browser JWT as the Authorization header for PostgREST.
  // Do not call auth.setSession() here: the API only receives an access token,
  // not a real refresh token, and fake refresh tokens can cause random auth
  // failures. This still lets Supabase RLS see auth.uid() correctly.
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Effective plan for req.userPlan, expressed in the legacy plan-name
 * vocabulary its consumers parse. profiles.plan is written exactly once
 * ("free", by the first-run insert below) and never updated again — the
 * live tier sources are profiles.plan_tier (the 1–6 ladder) and the
 * creator subscription (creator_subscriptions.tier). Derive from those:
 * max(subscription tier, ladder tier, legacy column) so nobody loses
 * access they bought. resolveCreatorTier never throws; on any lookup
 * failure the legacy candidate stands.
 */
async function deriveEffectivePlan(userId: string, legacyTier: CreatorTier): Promise<string> {
  const { tier } = await resolveCreatorTier(userId, legacyPlanNameForTier(legacyTier));
  return legacyPlanNameForTier(tier);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);

  // Validate token via auth.getUser (works regardless of key format).
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: { user }, error } = await anonClient.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.userId = user.id;
  req.userEmail = user.email;
  req.accessToken = token;

  // Build a properly-sessioned client and attach to req for use in routes.
  const userClient = await createSessionSupabase(token);
  req.userSupabase = userClient;

  // Fetch profile with credits and plan sources (plan_tier is the live
  // ladder; the plan column itself is write-once "free" — see
  // deriveEffectivePlan).
  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("id, credits, plan, plan_tier")
    .eq("id", user.id)
    .single();

  if (process.env["NODE_ENV"] === "development") {
    console.log(`[requireAuth] userId=${user.id} profileOk=${!!profile} profileError=${profileError?.message ?? "none"} credits=${profile?.credits} plan=${profile?.plan ?? "none"}`);
  }

  if (profile) {
    req.userCredits = profile.credits;
    const byLegacy = tierFromLegacyPlan(profile.plan);
    const byPlanTier = tierFromPlanTier(profile.plan_tier);
    const legacyTier = meetsTier(byPlanTier, byLegacy) ? byPlanTier : byLegacy;
    req.userPlan = await deriveEffectivePlan(user.id, legacyTier);
  } else {
    // Profile doesn't exist yet — create it.
    const { data: newProfile, error: insertError } = await userClient
      .from("profiles")
      .insert({
        id: user.id,
        email: user.email ?? "",
        display_name: (user.user_metadata as Record<string, unknown>)?.display_name ?? null,
        plan: "free",
        credits: STARTER_GRANT_CREDITS,
      })
      .select("credits")
      .single();

    if (process.env["NODE_ENV"] === "development") {
      console.log(`[requireAuth] insert newProfile=${!!newProfile} insertError=${insertError?.message ?? "none"}`);
    }

    req.userCredits = newProfile?.credits ?? STARTER_GRANT_CREDITS;
    // Genuinely free: this branch is the account's first authed contact
    // (it creates the profile row), so no ladder tier or subscription
    // can exist yet.
    req.userPlan = "free";

    if (newProfile) {
      /* Strict ledger row for the starter grant (board item 58,
         referral pattern): /credit-history reads credit_usage, so a
         bare profiles.credits insert leaves the 300 VB invisible there.
         Keyed `starter-grant:${userId}` — this branch runs exactly once
         per user, and the keyed row makes any replay a no-op. Auth must
         never fail over bookkeeping (the King's Welcome rule below), so
         a failed write is logged loudly for reconciliation instead. */
      try {
        await recordGrantLedger("starter", user.id);
      } catch (ledgerErr) {
        logger.error(
          { err: ledgerErr, userId: user.id },
          "[require-auth] starter grant landed without its ledger row — reconcile from the starter-grant key",
        );
      }
      // Brand-new account (this branch runs exactly once per user — when
      // their profile row is first provisioned). The Tom move: Thy Cheat
      // Code becomes their first friend, both directions. Idempotent and
      // never throws, so auth can't fail over it.
      await ensureKingsWelcome(user.id);
    }
  }

  next();
}
