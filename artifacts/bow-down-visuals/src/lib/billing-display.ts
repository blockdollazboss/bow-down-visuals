/* ── Billing display — the ONE derivation behind Settings → Billing ──────
   Mirrors the API's BillingState (artifacts/api-server/src/lib/
   billing-state.ts) so the Settings card can never drift from the
   server truth:

     free      — no paid subscription on record
     active    — paid, renews on renewalDate
     trialing  — paid trial, renews on renewalDate
     canceling — cancel requested; the tier is KEPT until endsAt
                 (cancel_at_period_end — the FAQ promise), then the
                 subscription ends and the tier glides to Free
     past_due  — last payment failed
     canceled  — subscription has ended; tier reads Free
     incomplete— checkout started but never completed payment

   Pure functions only — the component renders what this returns, and
   the tests pin the free / paid / canceling / period-end behavior here.
──────────────────────────────────────────────────────────────────────── */

export type BillingStatus =
  | "free"
  | "active"
  | "trialing"
  | "canceling"
  | "past_due"
  | "canceled"
  | "incomplete";

export interface BillingStateView {
  plan: string;
  planName: string;
  priceUsdPerMonth: number | null;
  status: BillingStatus;
  currentPeriodEnd: string | null;
  renewalDate: string | null;
  endsAt: string | null;
  hasStripeSubscription: boolean;
  hasStripeCustomer: boolean;
  canCancel: boolean;
  canResume: boolean;
}

export type BillingDateKind = "renews" | "ends" | "ended" | null;

export interface BillingDisplay {
  status: BillingStatus;
  /** i18n suffix under settings.billing.status.* */
  statusKey: BillingStatus;
  isPaid: boolean;
  /** "$12/mo" style price line, null on Free. */
  priceLine: string | null;
  /** Which date the card headlines, and the ISO value for it. */
  dateKind: BillingDateKind;
  dateIso: string | null;
  showCancel: boolean;
  showResume: boolean;
  showManagePayment: boolean;
  showSeePlans: boolean;
}

export function describeBilling(b: BillingStateView): BillingDisplay {
  const isPaid = b.priceUsdPerMonth != null && b.status !== "free";
  const priceLine = isPaid ? `$${b.priceUsdPerMonth}/mo` : null;

  let dateKind: BillingDateKind = null;
  let dateIso: string | null = null;
  if (b.status === "active" || b.status === "trialing") {
    dateKind = "renews";
    dateIso = b.renewalDate ?? b.currentPeriodEnd;
  } else if (b.status === "canceling") {
    // Period-end hold: the paid tier stays live until endsAt.
    dateKind = "ends";
    dateIso = b.endsAt ?? b.currentPeriodEnd;
  } else if (b.status === "canceled") {
    dateKind = "ended";
    dateIso = b.endsAt ?? b.currentPeriodEnd;
  }

  return {
    status: b.status,
    statusKey: b.status,
    isPaid,
    priceLine,
    dateKind,
    dateIso,
    showCancel: b.canCancel,
    showResume: b.canResume,
    showManagePayment: b.hasStripeCustomer && b.status !== "free",
    showSeePlans: b.status === "free" || b.status === "canceled" || b.status === "incomplete",
  };
}

/** "Nov 25, 2026" — locale-aware, UTC-pinned so the day never shifts. */
export function formatBillingDate(iso: string | null, locale?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}
