import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CURRENCY_PREF_EVENT,
  readCurrencyPreference,
  resolveDisplayCurrency,
  type CurrencyCode,
  type CurrencyPreference,
} from "@/lib/currency-display";

/* The viewer's display currency (Wave-4 #46): follows the i18n locale
   SETTING they picked, overridden only by their Settings preference.
   Re-renders on language change and on preference change (same-tab via
   the custom event, other tabs via the storage event). */
export function useDisplayCurrency(): {
  currency: CurrencyCode;
  preference: CurrencyPreference;
  locale: string;
} {
  const { i18n } = useTranslation();
  const [preference, setPreference] = useState<CurrencyPreference>(() => readCurrencyPreference());

  useEffect(() => {
    const refresh = () => setPreference(readCurrencyPreference());
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<CurrencyPreference>).detail;
      if (detail) setPreference(detail);
      else refresh();
    };
    window.addEventListener(CURRENCY_PREF_EVENT, onCustom);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CURRENCY_PREF_EVENT, onCustom);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const locale = i18n.language || "en";
  return { currency: resolveDisplayCurrency({ locale, preference }), preference, locale };
}
