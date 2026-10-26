import { useTranslation } from "react-i18next";
import { displayPrice, displayPriceFromCents, type DisplayPrice } from "@/lib/currency-display";
import { useDisplayCurrency } from "@/hooks/use-display-currency";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ─── LocalCurrencyPrice (Wave-4 #46) ────────────────────────────────────
   The DISPLAY-ONLY converted price that docks beside a real USD price.
   It renders NOTHING when the viewer's display currency is USD (the USD
   figure already on the page is the whole story). When it does render,
   the converted figure NEVER appears alone: it always carries the
   honesty line naming the USD amount as the charge and the rate as
   approximate — inline (visible without hover, so touch users see it
   too) and in the accessible label. Visual Bucs never pass through
   here: this component takes USD amounts (or USD cents) only. */

export function LocalCurrencyPrice({
  usd,
  cents,
  className = "",
  inline = false,
}: {
  /** USD amount (dollars). Pass exactly one of usd / cents. */
  usd?: number;
  /** USD amount in cents (storefront / shop payloads). */
  cents?: number;
  className?: string;
  /** inline = render as one flowing line instead of a stacked sub-line. */
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const { locale, preference } = useDisplayCurrency();
  const isLight = useIsLightTheme();

  const d: DisplayPrice = cents != null
    ? displayPriceFromCents(cents, { locale, preference })
    : displayPrice(usd ?? 0, { locale, preference });

  if (!d.isConverted || !d.convertedText) return null;

  const honesty = t("currencyDisplay.honesty", {
    converted: d.convertedText.replace(/^≈\s*/, ""),
    usd: d.usdText,
  });

  return (
    <span
      className={`${inline ? "inline" : "block"} ${className}`}
      title={honesty}
      aria-label={honesty}
      data-testid="local-currency-price"
      data-currency={d.currency}
    >
      <span className={`font-semibold ${isLight ? "text-[#7A5A12]" : "text-amber-200/90"}`}>
        {d.convertedText}
      </span>{" "}
      <span className={isLight ? "text-[#8A7A56]" : "text-white/45"}>
        — {t("currencyDisplay.chargedInUsd", { usd: d.usdText })}
      </span>
    </span>
  );
}

/* Section-level honesty note for pricing surfaces: states the whole rule
   once where converted figures appear — charged in USD, converted amounts
   approximate, Visual Bucs never converted. Renders in every currency
   context (it is also the VB note for USD viewers), styled for both themes. */
export function CurrencyHonestyNote({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  return (
    <p
      className={`text-xs leading-relaxed ${isLight ? "text-[#8A7A56]" : "text-white/40"} ${className}`}
      data-testid="currency-honesty-note"
    >
      {t("currencyDisplay.approxNote")} {t("currencyDisplay.vbNote")} {t("currencyDisplay.ratesNote")}
    </p>
  );
}
