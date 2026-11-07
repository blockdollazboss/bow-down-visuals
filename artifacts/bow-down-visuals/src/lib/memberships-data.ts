/* ── Memberships payload guards (Stack-200 hardening C, item 38) ────
 * Same pattern as lib/earnings-data.ts. pages/memberships.tsx stored
 * its payloads by cast — setDashboard(data as unknown as Dashboard)
 * after only an `activeMembers !== undefined` sniff, setMine(data as
 * unknown as {...}) after checking ONLY data.memberships is an array
 * (giftsSent / giftsReceived unchecked), tiers/members arrays checked
 * but their ENTRIES unguarded — while the render dereferences
 * mine.memberships.length, mine.giftsSent.map, mine.giftsReceived
 * .length, tiers.map (twice) and dashboard.byTier unconditionally. A
 * partial payload missing one array blanked the whole memberships
 * manager, fan side and creator side. These normalizers run at the
 * fetch boundary:
 *   • a payload that isn't the shape at all → null → the page's
 *     existing per-source error state (tiersError / dashboardError /
 *     membersError / mineError / recoveryError) — never a throw;
 *   • inside a shape, arrays default to [] and fields coerce —
 *     giftsSent/giftsReceived defaulting to [] is the exact gap
 *     that used to crash the fan side. */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const num = (v: unknown): number => finite(v) ?? 0;
const numOrNull = (v: unknown): number | null => finite(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" ? v : null;
const strList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).filter(
    (x): x is string => typeof x === "string",
  );

export interface Tier {
  id: string;
  creatorUserId?: string;
  name: string;
  priceDollars: number;
  priceCents: number;
  description: string;
  perks: string[];
  isActive: boolean;
  trialEnabled: boolean;
  /* Pause offer (#39): members may rest 1–3 months unless off. */
  pauseEnabled: boolean;
  annualDiscountPct: number;
  annualPriceCents: number;
  annualPriceDollars: number;
  createdAt: string;
}

export interface TierBreakdown {
  tierId: string;
  name: string;
  activeMembers: number;
  mrrCents: number;
}

export interface Dashboard {
  activeMembers: number;
  pausedMembers: number;
  pastDueMembers: number;
  canceledMembers: number;
  mrrCents: number;
  mrrDollars: number;
  netMrrCents: number;
  churnPct: number;
  byTier: TierBreakdown[];
  paymentsLive: boolean;
}

export interface Member {
  id: string;
  tierId: string;
  tierName: string;
  fanLabel: string;
  fanUserId: string | null;
  status: "trialing" | "active" | "past_due" | "canceled" | "expired" | "paused";
  priceDollars: number;
  billingPeriod: string;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  isGift: boolean;
  joinedAt: string;
  pastDueSince: string | null;
  accessEndsAt: string | null;
  pastDueDaysLeft: number | null;
}

export interface MyMembership {
  id: string;
  tierName: string | null;
  creatorUserId: string;
  status: string;
  priceDollars: number;
  billingPeriod: string;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  isGift: boolean;
  joinedAt: string;
  /* Dunning (past_due only): when the payment failed + the exact date
     access pauses if it still hasn't succeeded. */
  pastDueSince: string | null;
  accessEndsAt: string | null;
  pastDueDaysLeft: number | null;
  /* Pause (#39): when the rest began, the resume date stated before
     the fan confirmed, the period end after resuming on that date,
     and whether this tier offers pause at all (creator toggle). */
  pausedAt: string | null;
  pauseResumesAt: string | null;
  pauseNewPeriodEnd: string | null;
  pauseOffered: boolean | null;
}

/* Creator Recovery view (GET /memberships/recovery): a past-due (or
   chased) member plus the recovery picture the server derives from
   the email claim ledger. */
export interface RecoveryRow {
  member: Member;
  recovery: {
    state: "in_grace" | "recovered" | "access_ended" | "ended_other";
    pastDueSince: string | null;
    graceEndsAt: string | null;
    daysLeft: number | null;
    stepsSent: number;
    stepCount: number;
    lastStepKey: string | null;
    lastSentAt: string | null;
  };
}

export interface MyGift {
  id: string;
  tierId: string;
  recipientUserId: string;
  purchaserUserId: string;
  amountDollars: number;
  billingPeriod: string;
  status: string;
  createdAt: string;
}

const MEMBER_STATUSES: ReadonlyArray<Member["status"]> = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
  "paused",
];

function memberStatus(v: unknown): Member["status"] {
  return typeof v === "string" &&
    (MEMBER_STATUSES as ReadonlyArray<string>).includes(v)
    ? (v as Member["status"])
    : "active";
}

export function normalizeMember(v: unknown): Member {
  const m = isObj(v) ? v : {};
  return {
    id: str(m.id),
    tierId: str(m.tierId),
    tierName: str(m.tierName),
    fanLabel: str(m.fanLabel),
    fanUserId: strOrNull(m.fanUserId),
    status: memberStatus(m.status),
    priceDollars: num(m.priceDollars),
    billingPeriod: str(m.billingPeriod),
    currentPeriodEnd: strOrNull(m.currentPeriodEnd),
    trialEndsAt: strOrNull(m.trialEndsAt),
    isGift: m.isGift === true,
    joinedAt: str(m.joinedAt),
    pastDueSince: strOrNull(m.pastDueSince),
    accessEndsAt: strOrNull(m.accessEndsAt),
    pastDueDaysLeft: numOrNull(m.pastDueDaysLeft),
  };
}

export function normalizeTiers(v: unknown): Tier[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter(isObj).map((t) => ({
    id: str(t.id),
    creatorUserId: typeof t.creatorUserId === "string" ? t.creatorUserId : undefined,
    name: str(t.name),
    priceDollars: num(t.priceDollars),
    priceCents: num(t.priceCents),
    description: str(t.description),
    perks: strList(t.perks),
    isActive: t.isActive === true,
    trialEnabled: t.trialEnabled === true,
    pauseEnabled: t.pauseEnabled === true,
    annualDiscountPct: num(t.annualDiscountPct),
    annualPriceCents: num(t.annualPriceCents),
    annualPriceDollars: num(t.annualPriceDollars),
    createdAt: str(t.createdAt),
  }));
}

export function normalizeDashboard(v: unknown): Dashboard | null {
  if (!isObj(v)) return null;
  /* The page's old sniff was `activeMembers !== undefined`; the real
     bar is a finite number — anything else is not a dashboard. */
  if (finite(v.activeMembers) === null) return null;
  return {
    activeMembers: num(v.activeMembers),
    pausedMembers: num(v.pausedMembers),
    pastDueMembers: num(v.pastDueMembers),
    canceledMembers: num(v.canceledMembers),
    mrrCents: num(v.mrrCents),
    mrrDollars: num(v.mrrDollars),
    netMrrCents: num(v.netMrrCents),
    churnPct: num(v.churnPct),
    byTier: (Array.isArray(v.byTier) ? v.byTier : []).filter(isObj).map((b) => ({
      tierId: str(b.tierId),
      name: str(b.name),
      activeMembers: num(b.activeMembers),
      mrrCents: num(b.mrrCents),
    })),
    paymentsLive: v.paymentsLive === true,
  };
}

export function normalizeMembers(v: unknown): Member[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter(isObj).map(normalizeMember);
}

export interface MinePayload {
  memberships: MyMembership[];
  giftsSent: MyGift[];
  giftsReceived: MyGift[];
}

function myMembership(v: Record<string, unknown>): MyMembership {
  return {
    id: str(v.id),
    tierName: strOrNull(v.tierName),
    creatorUserId: str(v.creatorUserId),
    status: str(v.status),
    priceDollars: num(v.priceDollars),
    billingPeriod: str(v.billingPeriod),
    currentPeriodEnd: strOrNull(v.currentPeriodEnd),
    trialEndsAt: strOrNull(v.trialEndsAt),
    isGift: v.isGift === true,
    joinedAt: str(v.joinedAt),
    pastDueSince: strOrNull(v.pastDueSince),
    accessEndsAt: strOrNull(v.accessEndsAt),
    pastDueDaysLeft: numOrNull(v.pastDueDaysLeft),
    pausedAt: strOrNull(v.pausedAt),
    pauseResumesAt: strOrNull(v.pauseResumesAt),
    pauseNewPeriodEnd: strOrNull(v.pauseNewPeriodEnd),
    pauseOffered: typeof v.pauseOffered === "boolean" ? v.pauseOffered : null,
  };
}

function myGift(v: Record<string, unknown>): MyGift {
  return {
    id: str(v.id),
    tierId: str(v.tierId),
    recipientUserId: str(v.recipientUserId),
    purchaserUserId: str(v.purchaserUserId),
    amountDollars: num(v.amountDollars),
    billingPeriod: str(v.billingPeriod),
    status: str(v.status),
    createdAt: str(v.createdAt),
  };
}

export function normalizeMine(v: unknown): MinePayload | null {
  if (!isObj(v) || !Array.isArray(v.memberships)) return null;
  return {
    memberships: v.memberships.filter(isObj).map(myMembership),
    /* The two gift arrays were NOT checked by the old cast — a
       payload without them threw at mine.giftsSent.length. They
       default to [] here. */
    giftsSent: (Array.isArray(v.giftsSent) ? v.giftsSent : []).filter(isObj).map(myGift),
    giftsReceived: (Array.isArray(v.giftsReceived) ? v.giftsReceived : [])
      .filter(isObj)
      .map(myGift),
  };
}

export interface RecoveryPayload {
  members: RecoveryRow[];
  automationEnabled: boolean;
  automationProvisioned: boolean;
}

const RECOVERY_STATES: ReadonlyArray<RecoveryRow["recovery"]["state"]> = [
  "in_grace",
  "recovered",
  "access_ended",
  "ended_other",
];

export function normalizeRecovery(v: unknown): RecoveryPayload | null {
  if (!isObj(v) || !Array.isArray(v.members)) return null;
  return {
    members: v.members.filter(isObj).map((row) => {
      const rec = isObj(row.recovery) ? row.recovery : {};
      return {
        member: normalizeMember(row.member),
        recovery: {
          state:
            typeof rec.state === "string" &&
            (RECOVERY_STATES as ReadonlyArray<string>).includes(rec.state)
              ? (rec.state as RecoveryRow["recovery"]["state"])
              : "in_grace",
          pastDueSince: strOrNull(rec.pastDueSince),
          graceEndsAt: strOrNull(rec.graceEndsAt),
          daysLeft: numOrNull(rec.daysLeft),
          stepsSent: num(rec.stepsSent),
          stepCount: num(rec.stepCount),
          lastStepKey: strOrNull(rec.lastStepKey),
          lastSentAt: strOrNull(rec.lastSentAt),
        },
      };
    }),
    automationEnabled: v.automationEnabled === true,
    automationProvisioned: v.automationProvisioned === true,
  };
}
