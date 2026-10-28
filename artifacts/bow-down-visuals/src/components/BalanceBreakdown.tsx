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
 * Copy lives in the credit-history namespace (en.json). The other nine
 * catalogs do not carry these keys yet — they fall back to English
 * until the translation wave picks them up (flagged in the lane report;
 * payment/balance copy is never machine-guessed into a catalog).
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
    return t("credit-history.temporary_expires_today", { amount, date });
  }
  const days = daysUntilExpiry(grant.expiresAt, now) ?? 0;
  return t("credit-history.temporary_expires", { amount, date, count: days });
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
  /* Base key + count: i18next resolves the _one/_other plural forms. */
  return t("credit-history.temporary_more_grants", { count, amount });
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
          {t("credit-history.permanent_label")}:{" "}
          <span className="font-black text-white">{fmtNum(composition.permanentCredits)}</span>
        </p>
        <p className="text-sm text-white/70">
          {t("credit-history.temporary_label")}:{" "}
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
            <p className="text-xs text-white/50">{t("credit-history.temporary_no_expiry")}</p>
          )}
          <p className="text-xs text-white/40">{t("credit-history.temporary_spent_first")}</p>
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
    const base = t("credit-history.temporary_amount", { amount: total });
    text = soonest ? `${base} — ${expiryClause(t, i18n.language, soonest, now)}` : base;
  } else if (soonest && composition.temporaryGrants.length <= 1) {
    const date = formatExpiryDate(soonest.expiresAt, i18n.language);
    const sameDay =
      soonest.expiresAt != null &&
      new Date(soonest.expiresAt).toDateString() === new Date(now).toDateString();
    text = sameDay
      ? t("credit-history.includes_temporary_today", { amount: total, date })
      : t("credit-history.includes_temporary", {
          amount: total,
          date,
          count: daysUntilExpiry(soonest.expiresAt, now) ?? 0,
        });
  } else if (soonest) {
    text = `${t("credit-history.includes_temporary_no_expiry", { amount: total })} — ${expiryClause(t, i18n.language, soonest, now)}`;
  } else {
    text = t("credit-history.includes_temporary_no_expiry", { amount: total });
  }

  return (
    <span className={className} data-testid="temporary-bucs-note">
      <Clock className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
      {text}
      {more ? <span className="opacity-70"> · {more}</span> : null}
    </span>
  );
}
