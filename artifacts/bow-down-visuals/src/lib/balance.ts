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
