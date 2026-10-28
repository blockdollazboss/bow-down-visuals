/**
 * The one displayed-balance definition (Stack400 Lane 4, charge integrity).
 *
 * The server charges against credits + live bonus (deductCredits spends
 * the bonus pool first), so the balance a member SEES must be the same
 * sum — otherwise a real charge can leave the displayed number unmoved
 * while the ledger shows the spend (the Pass 4 defect: a −100 history
 * row next to an unchanged 87,475 readout). Mirrors the server's
 * spendableBalance in artifacts/api-server/src/lib/credits.ts exactly:
 * an expired bonus pool counts as zero.
 */
export interface BalanceProfile {
  credits?: number | null;
  bonus_credits?: number | null;
  bonus_credits_expires_at?: string | null;
}

export function spendableCredits(profile: BalanceProfile | null | undefined, now: number = Date.now()): number {
  if (!profile) return 0;
  const credits = profile.credits ?? 0;
  let bonus = profile.bonus_credits ?? 0;
  if (bonus > 0 && profile.bonus_credits_expires_at) {
    if (new Date(profile.bonus_credits_expires_at).getTime() < now) bonus = 0;
  }
  return credits + bonus;
}

/* ── The composition behind the total (Stack500 Lane V-bucs) ─────────────
 * Owner ruling, Oct 28 2026: the Visual Bucs that expire are shown
 * SEPARATELY, labelled temporary, with how long they last. These helpers
 * mirror the server's composeCreditBalance / creditBalanceComposition
 * (artifacts/api-server/src/lib/credits.ts) so every surface splits the
 * one spendable total the same way. Display only — spending still draws
 * the bonus pool first, unchanged. */

/** One live temporary (bonus) grant segment. */
export interface TemporaryCreditGrant {
  amount: number;
  /** ISO expiry, or null when this temporary segment has no expiry. */
  expiresAt: string | null;
}

export interface BalanceComposition {
  /** Permanent + live temporary — identical to spendableCredits(). */
  total: number;
  permanentCredits: number;
  /** Sum of the live temporary grants only; expired grants never count. */
  temporaryCredits: number;
  /** Live temporary grants, soonest dated expiry first. */
  temporaryGrants: TemporaryCreditGrant[];
  /** The soonest dated temporary expiry and the amount expiring then. */
  soonestTemporaryExpiry: TemporaryCreditGrant | null;
}

function finiteAmount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Compose a balance from permanent credits plus any number of temporary
 * grant segments. A grant is live under the same rule spendableCredits
 * has always used: an expiry strictly before `now` is expired, while a
 * missing or unparseable expiry does not expire the segment.
 */
export function composeBalance(
  permanentCredits: number | null | undefined,
  temporaryGrants: readonly TemporaryCreditGrant[],
  now: number = Date.now(),
): BalanceComposition {
  const permanent = finiteAmount(permanentCredits);
  const live: Array<TemporaryCreditGrant & { expiryMs: number | null }> = [];

  for (const grant of temporaryGrants) {
    const amount = finiteAmount(grant?.amount);
    if (amount <= 0) continue;
    const parsedExpiry =
      grant.expiresAt == null ? Number.NaN : new Date(grant.expiresAt).getTime();
    const hasValidExpiry = Number.isFinite(parsedExpiry);
    if (hasValidExpiry && parsedExpiry < now) continue;
    live.push({
      amount,
      expiresAt: hasValidExpiry ? new Date(parsedExpiry).toISOString() : null,
      expiryMs: hasValidExpiry ? parsedExpiry : null,
    });
  }

  live.sort((a, b) => {
    if (a.expiryMs == null && b.expiryMs == null) return 0;
    if (a.expiryMs == null) return 1;
    if (b.expiryMs == null) return -1;
    return a.expiryMs - b.expiryMs;
  });

  const grants = live.map(({ amount, expiresAt }) => ({ amount, expiresAt }));
  const temporaryCredits = grants.reduce((sum, grant) => sum + grant.amount, 0);
  const soonest = grants.find((grant) => grant.expiresAt != null) ?? null;

  return {
    total: permanent + temporaryCredits,
    permanentCredits: permanent,
    temporaryCredits,
    temporaryGrants: grants,
    soonestTemporaryExpiry: soonest ? { ...soonest } : null,
  };
}

/**
 * Compose the balance for an auth profile. The permanent side is the raw
 * credits column — `credits_base` once AuthContext has folded the total
 * into `credits`, or `credits` itself on a raw profile row. The bonus
 * pool is ONE aggregate segment: the profile stores a single pool with
 * a single expiry (a new grant refreshes the whole pool's expiry), so
 * this never invents per-grant segments the profile does not retain.
 */
export function balanceComposition(
  profile: (BalanceProfile & { credits_base?: number | null }) | null | undefined,
  now: number = Date.now(),
): BalanceComposition {
  if (!profile) return composeBalance(0, [], now);
  const permanent = profile.credits_base ?? profile.credits;
  const bonus = finiteAmount(profile.bonus_credits);
  return composeBalance(
    permanent,
    bonus > 0
      ? [{ amount: bonus, expiresAt: profile.bonus_credits_expires_at ?? null }]
      : [],
    now,
  );
}

/** Whole days until an ISO expiry, rounded up (a grant with 47 hours
 *  left "expires in 2 days"); 0 once the moment is reached. Null when
 *  there is no parseable expiry to count down to. */
export function daysUntilExpiry(expiresAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil((ms - now) / 86_400_000));
}

/** "Oct 30, 2026" for an ISO expiry; empty string when unparseable. */
export function formatExpiryDate(expiresAt: string | null | undefined, locale: string = "en-US"): string {
  if (!expiresAt) return "";
  const d = new Date(expiresAt);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}
