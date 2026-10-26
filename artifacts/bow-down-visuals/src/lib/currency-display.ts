/* ─── Local-currency price display (Wave-4 #46) ──────────────────────────
   DISPLAY ONLY. Real-money prices on this site are charged and settled in
   USD — always. This module only changes how a USD price is *shown* to a
   viewer whose site language implies another currency: the USD figure
   stays the charge, and every converted figure must travel with its
   honesty line ("≈ €27 — charged $29 USD", approximate rate).

   Hard rules baked in here:
   - Visual Bucs are NEVER converted. VB is VB in every country — the
     converter refuses VB-shaped currency codes outright, and VB amounts
     keep flowing through lib/visual-bucs.ts untouched.
   - No live FX API exists on this site (no key, no rail), so rates come
     from ONE seam: the static fallback table below. It is an APPROXIMATE
     snapshot, deliberately rounded — never present it as a live rate.
     `getRates()` is the single place a future live source would plug in;
     until then it returns the fallback table and says so.
   - Currency follows the user's LOCALE SETTING (the i18n language they
     picked), never IP guessing. A Settings preference can override it
     (a specific currency, or "USD only"). */

export type CurrencyCode =
  | "USD" | "EUR" | "GBP" | "BRL" | "INR"
  | "JPY" | "KRW" | "SAR" | "CAD" | "AUD";

export const SUPPORTED_CURRENCIES: CurrencyCode[] = [
  "USD", "EUR", "GBP", "BRL", "INR", "JPY", "KRW", "SAR", "CAD", "AUD",
];

/** Currency implied by each of the site's 10 locale settings.
    The flags in SUPPORTED_LANGUAGES pin the region: es → Spain (EUR),
    pt → Brazil (BRL), ar → Saudi Arabia (SAR), hi → India (INR). */
export const LOCALE_CURRENCY: Record<string, CurrencyCode> = {
  en: "USD",
  es: "EUR",
  fr: "EUR",
  de: "EUR",
  it: "EUR",
  pt: "BRL",
  hi: "INR",
  ar: "SAR",
  ja: "JPY",
  ko: "KRW",
};

/** BCP-47 tag used for Intl number formatting per site locale. */
export const LOCALE_BCP47: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT",
  pt: "pt-BR",
  hi: "hi-IN",
  ar: "ar-SA",
  ja: "ja-JP",
  ko: "ko-KR",
};

export function bcp47ForLocale(locale: string | null | undefined): string {
  const base = (locale ?? "en").split("-")[0]!.toLowerCase();
  return LOCALE_BCP47[base] ?? "en-US";
}

export function currencyForLocale(locale: string | null | undefined): CurrencyCode {
  const base = (locale ?? "en").split("-")[0]!.toLowerCase();
  return LOCALE_CURRENCY[base] ?? "USD";
}

/* ─── The rates seam ─────────────────────────────────────────────────────
   ONE USD = rate × target currency. Static APPROXIMATE snapshot,
   rounded on purpose (no false precision), last reviewed Oct 2026.
   This is a display aid, not a quote: the charge is always the USD
   figure, so a stale rate can never change what anyone pays. */
export const FALLBACK_RATES_USD: Record<CurrencyCode, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  BRL: 5.4,
  INR: 88,
  JPY: 150,
  KRW: 1380,
  SAR: 3.75,
  CAD: 1.36,
  AUD: 1.52,
};

export const RATES_SOURCE = "static-fallback" as const;
export const RATES_LABEL = "approximate static snapshot — not a live exchange rate";

export interface RatesResult {
  rates: Record<CurrencyCode, number>;
  source: typeof RATES_SOURCE;
  approximate: true;
  label: string;
}

/** The single rates seam. No live FX source is wired (no API key exists);
    this returns the labeled fallback table. A live source, if one is ever
    approved, replaces the body here — callers never change. */
export function getRates(): RatesResult {
  return { rates: FALLBACK_RATES_USD, source: RATES_SOURCE, approximate: true, label: RATES_LABEL };
}

/* ─── Rounding ───────────────────────────────────────────────────────────
   Sensible display rounding, never false precision:
   - zero-decimal currencies (JPY, KRW): whole units, nearest 10 at 1,000+.
   - large converted amounts (≥ 1,000): nearest 10 in any currency.
   - ≥ 10: whole units ("≈ €27", like the board's "≈ £24" example).
   - < 10: two decimals so a $9 pack doesn't collapse to a bare €8. */
const ZERO_DECIMAL = new Set<CurrencyCode>(["JPY", "KRW"]);

export function roundForDisplay(value: number, currency: CurrencyCode): number {
  if (!Number.isFinite(value)) return NaN;
  const abs = Math.abs(value);
  if (ZERO_DECIMAL.has(currency) || abs >= 1000) {
    return abs >= 1000 ? Math.round(value / 10) * 10 : Math.round(value);
  }
  if (abs >= 10) return Math.round(value);
  return Math.round(value * 100) / 100;
}

/* ─── Conversion (USD amounts only — VB is refused) ──────────────────────*/
const NON_FIAT_CODES = new Set(["VB", "VBUCS", "VISUALBUCS", "VISUAL_BUCS", "XVB", "CREDITS"]);

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return (SUPPORTED_CURRENCIES as string[]).includes(code.toUpperCase());
}

/**
 * Convert a USD amount for DISPLAY. Returns null for anything that must
 * not be converted: non-finite/negative amounts, unknown currencies, and
 * Visual-Bucs-shaped codes (VB is never fiat and never converted).
 */
export function convertUsd(
  usd: number,
  currency: string,
  rates: Record<CurrencyCode, number> = FALLBACK_RATES_USD,
): number | null {
  const code = String(currency ?? "").toUpperCase();
  if (NON_FIAT_CODES.has(code)) return null;
  if (!isSupportedCurrency(code)) return null;
  if (!Number.isFinite(usd) || usd < 0) return null;
  const rate = rates[code];
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  if (code === "USD") return roundForDisplay(usd, "USD");
  return roundForDisplay(usd * rate, code);
}

/* ─── Formatting ─────────────────────────────────────────────────────────*/
export function formatMoney(amount: number, currency: CurrencyCode, locale?: string): string {
  const fractionDigits = ZERO_DECIMAL.has(currency) || Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat(bcp47ForLocale(locale), {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function formatUsd(usd: number, locale?: string): string {
  return formatMoney(roundForDisplay(usd, "USD"), "USD", locale);
}

/* ─── Preference (Settings → one display choice, stored locally) ────────*/
export const CURRENCY_PREF_KEY = "bdv-currency-display";
export const CURRENCY_PREF_EVENT = "bdv-currency-display-changed";

/** "auto" = follow the locale setting; a code pins that currency;
    "USD" pins dollars-only (which is also the en/auto outcome). */
export type CurrencyPreference = "auto" | CurrencyCode;

export function parseCurrencyPreference(raw: string | null | undefined): CurrencyPreference {
  if (!raw || raw === "auto") return "auto";
  const code = raw.toUpperCase();
  return isSupportedCurrency(code) ? (code as CurrencyCode) : "auto";
}

export function readCurrencyPreference(
  storage: Pick<Storage, "getItem"> | null | undefined =
    typeof localStorage !== "undefined" ? localStorage : null,
): CurrencyPreference {
  try {
    return parseCurrencyPreference(storage?.getItem(CURRENCY_PREF_KEY));
  } catch {
    return "auto";
  }
}

export function writeCurrencyPreference(pref: CurrencyPreference): void {
  try {
    localStorage.setItem(CURRENCY_PREF_KEY, pref);
  } catch { /* private mode — the in-memory event still updates the page */ }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CURRENCY_PREF_EVENT, { detail: pref }));
  }
}

export function resolveDisplayCurrency(opts: {
  locale?: string | null;
  preference?: CurrencyPreference;
}): CurrencyCode {
  if (opts.preference && opts.preference !== "auto") return opts.preference;
  return currencyForLocale(opts.locale);
}

/* ─── The display bundle every surface renders ───────────────────────────*/
export interface DisplayPrice {
  /** The charge, always USD, always shown. */
  usdText: string;
  currency: CurrencyCode;
  isConverted: boolean;
  /** "≈ €27" — null when the display currency IS USD (nothing converted). */
  convertedText: string | null;
  /** Full honesty line, e.g. "≈ €27 — charged $29 USD (approximate rate;
      settled in USD)". Null when nothing was converted. A converted figure
      must NEVER be rendered without this line (or its i18n twin) nearby. */
  honestyLine: string | null;
}

export function displayPrice(
  usd: number,
  opts: { locale?: string | null; preference?: CurrencyPreference } = {},
): DisplayPrice {
  const locale = opts.locale ?? "en";
  const currency = resolveDisplayCurrency({ locale, preference: opts.preference ?? "auto" });
  /* The charge is always rendered in its canonical $ form ("$29"), in
     every locale — locale-formatting the dollar figure produces
     "29 $US"-style strings that muddy the honesty line. Only the
     CONVERTED figure is locale-formatted. */
  const usdText = formatUsd(usd, "en");
  if (currency === "USD") {
    return { usdText, currency, isConverted: false, convertedText: null, honestyLine: null };
  }
  const converted = convertUsd(usd, currency);
  if (converted == null) {
    return { usdText, currency: "USD", isConverted: false, convertedText: null, honestyLine: null };
  }
  const convertedText = `≈ ${formatMoney(converted, currency, locale)}`;
  return {
    usdText,
    currency,
    isConverted: true,
    convertedText,
    honestyLine: `${convertedText} — charged ${usdText} USD (approximate rate; settled in USD)`,
  };
}

/** Cents convenience for storefront/shop payloads (priceCents). */
export function displayPriceFromCents(
  cents: number,
  opts: { locale?: string | null; preference?: CurrencyPreference } = {},
): DisplayPrice {
  return displayPrice(Math.max(0, Math.round(cents)) / 100, opts);
}
