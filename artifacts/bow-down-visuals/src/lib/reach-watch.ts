import type { LoyaltyState, WatchProgress } from "./reach-api";

/* ── Reach watch/loyalty payload guards (DTO guard batch #2) ──────────
 * Same pattern as lib/destination-keys.ts / lib/explore-data.ts: the
 * reach API client returns raw casts, so a partial payload used to flow
 * straight into ReachWatchPanel state and crash render
 * (thresholds.map, weeklyBudget.remainingVb, perks.map) or corrupt it.
 * These normalizers run at the fetch boundary:
 *   • malformed watch progress → null → the panel's honest
 *     "Drop progress couldn't load" state (never a fake budget);
 *   • malformed loyalty state → null → the loyalty section simply
 *     doesn't render, exactly as it doesn't on a failed load;
 *   • a redemption-queue payload missing its list → the honest
 *     empty queue. */

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const arrayOrEmpty = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function normalizeWatchProgress(payload: unknown): WatchProgress | null {
  if (!isObj(payload)) return null;
  if (!Array.isArray(payload.thresholds)) return null;
  const budget = payload.weeklyBudget;
  if (!isObj(budget)) return null;
  const capVb = finite(budget.capVb);
  const remainingVb = finite(budget.remainingVb);
  if (capVb === null || remainingVb === null) return null; // the budget line is money copy — never guess it
  const thresholds: WatchProgress["thresholds"] = [];
  for (const t of payload.thresholds) {
    if (!isObj(t)) continue;
    const seconds = finite(t.seconds);
    const amountVb = finite(t.amountVb);
    if (seconds === null || amountVb === null) continue; // a reward row without its real numbers doesn't render
    thresholds.push({
      seconds,
      amountVb,
      earned: t.earned === true,
      progressSeconds: finite(t.progressSeconds) ?? 0,
    });
  }
  return {
    secondsWatched: finite(payload.secondsWatched) ?? 0,
    thresholds,
    weeklyBudget: { capVb, spentVb: finite(budget.spentVb) ?? 0, remainingVb },
    justAwarded: arrayOrEmpty(payload.justAwarded),
    budgetReached: payload.budgetReached === true,
  };
}

export function normalizeLoyaltyState(payload: unknown): LoyaltyState | null {
  if (!isObj(payload)) return null;
  const myPoints = finite(payload.myPoints);
  if (myPoints === null) return null; // a points balance is never invented
  const perks: LoyaltyState["perks"] = [];
  for (const p of arrayOrEmpty<unknown>(payload.perks)) {
    if (!isObj(p)) continue;
    const cost = finite(p.cost);
    if (typeof p.kind !== "string" || typeof p.label !== "string" || cost === null) continue;
    perks.push({ kind: p.kind, label: p.label, cost });
  }
  const myRedemptions: LoyaltyState["myRedemptions"] = [];
  for (const r of arrayOrEmpty<unknown>(payload.myRedemptions)) {
    if (!isObj(r)) continue;
    myRedemptions.push({
      id: typeof r.id === "string" ? r.id : "",
      perkKind: typeof r.perkKind === "string" ? r.perkKind : "",
      perkLabel: typeof r.perkLabel === "string" ? r.perkLabel : "",
      pointsCost: finite(r.pointsCost) ?? 0,
      status: typeof r.status === "string" ? r.status : "",
      createdAt: typeof r.createdAt === "string" ? r.createdAt : null,
    });
  }
  return {
    profileId: typeof payload.profileId === "string" ? payload.profileId : "",
    enabled: payload.enabled === true,
    watchPointsPer10Min: finite(payload.watchPointsPer10Min) ?? 0,
    chatPoints: finite(payload.chatPoints) ?? 0,
    tipPointsPer100Vb: finite(payload.tipPointsPer100Vb) ?? 0,
    customRewardLabel: typeof payload.customRewardLabel === "string" ? payload.customRewardLabel : null,
    customRewardCost: finite(payload.customRewardCost),
    perks,
    notice: typeof payload.notice === "string" ? payload.notice : "",
    myPoints,
    myRedemptions,
  };
}

export interface PendingRedemption {
  id: string;
  perkLabel: string;
  pointsCost: number;
  status: string;
}

/** The creator's redemption queue: only the pending rows, from a payload
 *  that may be missing its list entirely (→ the honest empty queue). */
export function pendingRedemptionsFromPayload(payload: unknown): PendingRedemption[] {
  if (!isObj(payload)) return [];
  const out: PendingRedemption[] = [];
  for (const r of arrayOrEmpty<unknown>(payload.redemptions)) {
    if (!isObj(r) || r.status !== "pending") continue;
    out.push({
      id: typeof r.id === "string" ? r.id : "",
      perkLabel: typeof r.perkLabel === "string" ? r.perkLabel : "",
      pointsCost: finite(r.pointsCost) ?? 0,
      status: "pending",
    });
  }
  return out;
}
