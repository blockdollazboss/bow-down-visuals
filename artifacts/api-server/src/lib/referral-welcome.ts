/**
 * referral-welcome.ts — Referral guards rung 3: the pending welcome.
 *
 * POST /referrals/apply no longer pays the 1,000 VB referee welcome to
 * a bare signup. The referrals row is recorded with
 * welcome_status='pending' and the grant fires exactly once when the
 * referred user creates a creator profile:
 *
 *   - the status flip pending -> granted is the claim (an UPDATE
 *     guarded on welcome_status='pending' — only one caller can win
 *     it, however many replays / retries / profile saves race);
 *   - the money then moves through the same rails as every other
 *     referral grant: addCreditsToProfile + recordCreditUsageStrict
 *     with the ledger idempotency key `referral-welcome:<userId>`
 *     (credit_usage's UNIQUE idempotency index is the second guard);
 *   - if either leg fails after the claim, the credits are clawed
 *     back and the claim is released (status back to 'pending'), so a
 *     later profile save / retry can fire it cleanly — never a burned,
 *     unpaid claim and never a double grant.
 *
 * Callers: routes/creator-platform.ts after a NEW creator profile is
 * inserted (profileConfirmed — that store is drizzle, this module's
 * store is Supabase, so the caller vouches for the profile), and any
 * future repair path, which calls without the flag and gets a real
 * creator_profiles existence check instead.
 *
 * This function NEVER throws: profile creation must not fail over a
 * bookkeeping grant. Failures are logged and reported in the result.
 */
import { getSupabaseAdmin, addCreditsToProfile } from "./supabase-admin";
import { recordCreditUsageStrict } from "./payment-record";
import { logger } from "./logger";

export const REFERRAL_WELCOME_CREDITS = 1000;

export interface ReferralWelcomeRow {
  id: string;
  refereeCanonicalEmail: string | null;
  welcomeStatus: string | null;
  refereeCreditsAwarded: number;
}

export interface ReferralWelcomeDeps {
  findReferral: (userId: string) => Promise<ReferralWelcomeRow | null>;
  hasCreatorProfile: (userId: string) => Promise<boolean>;
  /** Another referrals row (different id) with this canonical mailbox
   *  already collected its welcome — the rung-2 rule, re-checked at
   *  grant time so two pending aliases can never both pay. */
  hasGrantedCanonical: (canonicalEmail: string, exceptReferralId: string) => Promise<boolean>;
  /** Atomically flip pending -> granted. True only for the winner. */
  claimPending: (userId: string) => Promise<boolean>;
  /** Undo the claim after a failed grant leg (back to 'pending'). */
  releaseClaim: (userId: string) => Promise<void>;
  markWithheld: (userId: string) => Promise<void>;
  addCredits: (userId: string, amount: number) => Promise<unknown>;
  recordLedger: (record: {
    userId: string;
    action: string;
    creditsUsed: number;
    idempotencyKey: string;
  }) => Promise<void>;
}

function defaultDeps(): ReferralWelcomeDeps {
  const supabase = () => getSupabaseAdmin();
  return {
    findReferral: async (userId) => {
      const { data } = await supabase()
        .from("referrals")
        .select("id, referee_canonical_email, welcome_status, referee_credits_awarded")
        .eq("referee_user_id", userId)
        .maybeSingle();
      if (!data) return null;
      const row = data as Record<string, unknown>;
      return {
        id: String(row["id"]),
        refereeCanonicalEmail: (row["referee_canonical_email"] as string | null) ?? null,
        welcomeStatus: (row["welcome_status"] as string | null) ?? null,
        refereeCreditsAwarded: Number(row["referee_credits_awarded"] ?? 0),
      };
    },
    hasCreatorProfile: async (userId) => {
      const { data } = await supabase()
        .from("creator_profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      return !!data;
    },
    hasGrantedCanonical: async (canonicalEmail, exceptReferralId) => {
      const { data } = await supabase()
        .from("referrals")
        .select("id")
        .eq("referee_canonical_email", canonicalEmail)
        .eq("welcome_status", "granted");
      return (data ?? []).some(
        (r) => String((r as Record<string, unknown>)["id"]) !== exceptReferralId,
      );
    },
    claimPending: async (userId) => {
      const { data, error } = await supabase()
        .from("referrals")
        .update({
          welcome_status: "granted",
          referee_credits_awarded: REFERRAL_WELCOME_CREDITS,
        })
        .eq("referee_user_id", userId)
        .eq("welcome_status", "pending")
        .select("id");
      if (error) throw new Error(`referral welcome claim failed: ${error.message}`);
      return Array.isArray(data) && data.length > 0;
    },
    releaseClaim: async (userId) => {
      const { error } = await supabase()
        .from("referrals")
        .update({ welcome_status: "pending", referee_credits_awarded: 0 })
        .eq("referee_user_id", userId)
        .eq("welcome_status", "granted");
      if (error) {
        logger.error(
          { err: error, userId },
          "referral-welcome: CRITICAL claim release failed — pending welcome may be stuck granted-but-unpaid; manual reconciliation required",
        );
      }
    },
    markWithheld: async (userId) => {
      await supabase()
        .from("referrals")
        .update({ welcome_status: "withheld", referee_credits_awarded: 0 })
        .eq("referee_user_id", userId)
        .eq("welcome_status", "pending");
    },
    addCredits: async (userId, amount) => addCreditsToProfile(userId, amount),
    recordLedger: async (record) => {
      await recordCreditUsageStrict(record);
    },
  };
}

export type PendingWelcomeReason =
  | "granted"
  | "no_referral"
  | "already_granted"
  | "not_pending"
  | "no_creator_profile"
  | "duplicate_mailbox"
  | "error";

export interface PendingWelcomeResult {
  granted: boolean;
  amount: number;
  reason: PendingWelcomeReason;
}

/**
 * Fire the pending referral welcome for `userId`, exactly once.
 * Safe to call any number of times, from any path, concurrently.
 */
export async function maybeGrantPendingReferralWelcome(
  userId: string,
  opts: { profileConfirmed?: boolean; deps?: ReferralWelcomeDeps } = {},
): Promise<PendingWelcomeResult> {
  const deps = opts.deps ?? defaultDeps();
  try {
    const referral = await deps.findReferral(userId);
    if (!referral) return { granted: false, amount: 0, reason: "no_referral" };
    if (
      referral.welcomeStatus === "granted" ||
      (referral.welcomeStatus == null && referral.refereeCreditsAwarded > 0)
    ) {
      return { granted: false, amount: 0, reason: "already_granted" };
    }
    if (referral.welcomeStatus !== "pending") {
      return {
        granted: false,
        amount: 0,
        reason: referral.welcomeStatus === "withheld" ? "duplicate_mailbox" : "not_pending",
      };
    }

    if (!opts.profileConfirmed && !(await deps.hasCreatorProfile(userId))) {
      return { granted: false, amount: 0, reason: "no_creator_profile" };
    }

    /* Rung 2, re-checked at grant time: two alias accounts can both be
       pending (the second would normally have been withheld at apply,
       but a race or a pre-rung row must still never let both pay). */
    if (
      referral.refereeCanonicalEmail &&
      (await deps.hasGrantedCanonical(referral.refereeCanonicalEmail, referral.id))
    ) {
      await deps.markWithheld(userId).catch(() => {});
      return { granted: false, amount: 0, reason: "duplicate_mailbox" };
    }

    const claimed = await deps.claimPending(userId);
    if (!claimed) {
      // A concurrent caller won the flip (or the row changed state) —
      // the welcome is theirs to pay; never double-grant from here.
      return { granted: false, amount: 0, reason: "not_pending" };
    }

    let creditsMoved = false;
    try {
      await deps.addCredits(userId, REFERRAL_WELCOME_CREDITS);
      creditsMoved = true;
      await deps.recordLedger({
        userId,
        action: "Referral Welcome Grant",
        creditsUsed: -REFERRAL_WELCOME_CREDITS,
        idempotencyKey: `referral-welcome:${userId}`,
      });
    } catch (grantErr) {
      if (creditsMoved) {
        await deps.addCredits(userId, -REFERRAL_WELCOME_CREDITS).catch(() => {});
      }
      await deps.releaseClaim(userId).catch(() => {});
      logger.error(
        { err: grantErr, userId },
        "referral-welcome: pending grant failed after claim — claim released for retry",
      );
      return { granted: false, amount: 0, reason: "error" };
    }

    logger.info(
      { userId, amount: REFERRAL_WELCOME_CREDITS, referralId: referral.id },
      "Referral welcome grant paid at creator-profile creation (rung 3)",
    );
    return { granted: true, amount: REFERRAL_WELCOME_CREDITS, reason: "granted" };
  } catch (err) {
    logger.error({ err, userId }, "referral-welcome: pending grant check failed (non-fatal)");
    return { granted: false, amount: 0, reason: "error" };
  }
}
