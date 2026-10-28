/**
 * BalanceBreakdown — the permanent/temporary split of the spendable
 * balance (Stack500 Lane V-bucs, owner ruling Oct 28 2026: "The Visual
 * Bucs that expire should be separate and indicate that it's temporary
 * — and say for how long").
 *
 * Two shapes over the one composition (lib/balance):
 *  - <BalanceBreakdown> — the full split for the /credit-history header:
 *    Permanent and Temporary on their own lines, the soonest expiry
 *    named with its amount, date, and days left.
 *  - <TemporaryBucsNote> — the compact one-liner for summary surfaces
 *    (sidebar footer, spend-confirm dialog): the total stays untouched
 *    there; this line rides under it only while a temporary part exists.
 *
 * Copy lives in the `balance` namespace (en.json) — a new namespace, so
 * the locale-wave suites that pin older namespaces are untouched. The
 * other nine catalogs do not carry these keys yet — they fall back to
 * English until the translation wave picks them up (flagged in the
 * lane report; payment/balance copy is never machine-guessed into a
 * catalog). Singular/plural variants are separate keys selected in
 * code, not i18next count families.
 */
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  daysUntilExpiry,
  formatExpiryDate,
  type BalanceComposition,
  type TemporaryCreditGrant,
} from "@/lib/balance";

const fmtNum = (n: number) => n.toLocaleString("en-US");

/** "300 expire Oct 30, 2026 (in 2 days)" for one grant — or the
 *  expires-today wording when the date is today. */
function expiryClause(
  t: (key: string, opts?: Record<string, unknown>) => string,
  locale: string,
  grant: TemporaryCreditGrant,
  now: number,
): string {
  const date = formatExpiryDate(grant.expiresAt, locale);
  const amount = fmtNum(grant.amount);
  const sameDay =
    grant.expiresAt != null &&
    new Date(grant.expiresAt).toDateString() === new Date(now).toDateString();
  if (sameDay) {
    return t("balance.temporary_expires_today", { amount, date });
  }
  const days = daysUntilExpiry(grant.expiresAt, now) ?? 0;
  return days === 1
    ? t("balance.temporary_expires_day", { amount, date })
    : t("balance.temporary_expires_days", { amount, date, days });
}

/** "+ 1 more temporary grant (200)" when later grants sit behind the
 *  soonest one; empty string for a single-grant composition. */
function moreGrantsClause(
  t: (key: string, opts?: Record<string, unknown>) => string,
  composition: BalanceComposition,
): string {
  const soonest = composition.soonestTemporaryExpiry;
  if (!soonest || composition.temporaryGrants.length <= 1) return "";
  const count = composition.temporaryGrants.length - 1;
  const amount = fmtNum(composition.temporaryCredits - soonest.amount);
  return t(count === 1 ? "balance.temporary_more_grant" : "balance.temporary_more_grants", {
    count,
    amount,
  });
}

export function BalanceBreakdown({
  composition,
  className = "",
  now = Date.now(),
}: {
  composition: BalanceComposition;
  className?: string;
  now?: number;
}) {
  const { t, i18n } = useTranslation();
  const soonest = composition.soonestTemporaryExpiry;
  const more = moreGrantsClause(t, composition);
  return (
    <div className={className} data-testid="balance-breakdown">
      <div className="flex flex-wrap gap-x-8 gap-y-1">
        <p className="text-sm text-white/70">
          {t("balance.permanent_label")}:{" "}
          <span className="font-black text-white">{fmtNum(composition.permanentCredits)}</span>
        </p>
        <p className="text-sm text-white/70">
          {t("balance.temporary_label")}:{" "}
          <span className="font-black text-amber-300">{fmtNum(composition.temporaryCredits)}</span>
        </p>
      </div>
      {composition.temporaryCredits > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {soonest ? (
            <p className="flex items-center gap-1.5 text-xs text-amber-200/90">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span>
                {expiryClause(t, i18n.language, soonest, now)}
                {more ? <span className="text-white/50"> · {more}</span> : null}
              </span>
            </p>
          ) : (
            <p className="text-xs text-white/50">{t("balance.temporary_no_expiry")}</p>
          )}
          <p className="text-xs text-white/40">{t("balance.temporary_spent_first")}</p>
        </div>
      )}
    </div>
  );
}

export function TemporaryBucsNote({
  composition,
  mode = "includes",
  className = "",
  now = Date.now(),
}: {
  composition: BalanceComposition;
  /** "includes" for the spend dialog ("Includes Y temporary Bucs — …");
   *  "label" for chrome like the sidebar ("Temporary: Y — …"). */
  mode?: "includes" | "label";
  className?: string;
  now?: number;
}) {
  const { t, i18n } = useTranslation();
  if (composition.temporaryCredits <= 0) return null;
  const soonest = composition.soonestTemporaryExpiry;
  const total = fmtNum(composition.temporaryCredits);
  const more = moreGrantsClause(t, composition);

  let text: string;
  if (mode === "label") {
    const base = t("balance.temporary_amount", { amount: total });
    text = soonest ? `${base} — ${expiryClause(t, i18n.language, soonest, now)}` : base;
  } else if (soonest && composition.temporaryGrants.length <= 1) {
    const date = formatExpiryDate(soonest.expiresAt, i18n.language);
    const sameDay =
      soonest.expiresAt != null &&
      new Date(soonest.expiresAt).toDateString() === new Date(now).toDateString();
    const days = daysUntilExpiry(soonest.expiresAt, now) ?? 0;
    text = sameDay
      ? t("balance.includes_temporary_today", { amount: total, date })
      : days === 1
        ? t("balance.includes_temporary_day", { amount: total, date })
        : t("balance.includes_temporary_days", { amount: total, date, days });
  } else if (soonest) {
    text = `${t("balance.includes_temporary_no_expiry", { amount: total })} — ${expiryClause(t, i18n.language, soonest, now)}`;
  } else {
    text = t("balance.includes_temporary_no_expiry", { amount: total });
  }

  return (
    <span className={className} data-testid="temporary-bucs-note">
      <Clock className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
      {text}
      {more ? <span className="opacity-70"> · {more}</span> : null}
    </span>
  );
}
