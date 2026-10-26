import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Coins } from "lucide-react";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  SUPPORTED_CURRENCIES,
  currencyForLocale,
  readCurrencyPreference,
  writeCurrencyPreference,
  type CurrencyPreference,
} from "@/lib/currency-display";

/* ─── Price display currency (Wave-4 #46) ───────────────────────────────
   The ONE display preference for local-currency rendering, docked in the
   existing Settings page. Default "auto" follows the language the user
   picked (their locale setting — never IP guessing). Stored on the
   device (bdv-currency-display); it changes DISPLAY ONLY — charging
   always stays in USD, and Visual Bucs are never converted. */
export function CurrencyDisplaySettings() {
  const { t, i18n } = useTranslation();
  const isLight = useIsLightTheme();
  const [pref, setPref] = useState<CurrencyPreference>(() => readCurrencyPreference());

  const autoCurrency = currencyForLocale(i18n.language || "en");

  function choose(next: CurrencyPreference) {
    setPref(next);
    writeCurrencyPreference(next);
  }

  const options: { value: CurrencyPreference; label: string }[] = [
    { value: "auto", label: `${t("currencyDisplay.autoOption")} (${autoCurrency})` },
    ...SUPPORTED_CURRENCIES.map((code) => ({
      value: code as CurrencyPreference,
      label: code === "USD" ? t("currencyDisplay.usdOnlyOption") : code,
    })),
  ];

  return (
    <section
      className={`rounded-3xl border p-5 md:p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="currency-display-settings"
    >
      <div className="flex items-center gap-3 mb-1">
        <div className="h-10 w-10 rounded-xl bg-primary/[0.12] border border-primary/25 flex items-center justify-center shrink-0">
          <Coins className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className={`text-base font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
            {t("currencyDisplay.settingsTitle")}
          </h2>
          <p className={`text-xs mt-0.5 ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
            {t("currencyDisplay.settingsDesc")}
          </p>
        </div>
      </div>

      <label className="mt-4 block">
        <span className="sr-only">{t("currencyDisplay.settingsTitle")}</span>
        <select
          value={pref}
          onChange={(e) => choose(e.target.value as CurrencyPreference)}
          className={`w-full rounded-xl border px-3 py-2.5 text-sm font-semibold outline-none ${
            isLight
              ? "border-[#C9A84C]/50 bg-[#FCF7EA] text-[#2A1E07]"
              : "border-white/15 bg-black/50 text-white"
          }`}
          data-testid="currency-display-select"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      <p className={`mt-3 text-[11px] leading-relaxed ${isLight ? "text-[#8A7A56]" : "text-white/35"}`}>
        {t("currencyDisplay.approxNote")} {t("currencyDisplay.vbNote")} {t("currencyDisplay.ratesNote")}
      </p>
    </section>
  );
}
