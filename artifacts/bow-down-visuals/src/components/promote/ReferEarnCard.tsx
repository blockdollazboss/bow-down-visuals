import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Gift, ArrowRight } from "lucide-react";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ─── ReferEarnCard ──────────────────────────────────────────────────────
   The Refer & Earn cross-surface for /promote: a slim handoff card, not a
   second program home. Copy reuses the homepage band's home.refer* keys
   verbatim (no new strings, no drift between surfaces). The card never
   fetches the personal referral link — the link, QR, share kit and ranks
   all live on /referrals; this card's only job is the handoff. */
export function ReferEarnCard() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();

  return (
    <div
      className={`flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="promote-refer-earn-card"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
        <Gift className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className={`font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
          {t("home.referTitleA")} <span className="text-primary">{t("home.referTitleB")}</span>
        </h2>
        <p className={`mt-0.5 text-sm leading-relaxed ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          {t("home.referBodyA")}
          <span className={`font-semibold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>{t("home.referBodyB")}</span>
          {t("home.referBodyC")}
          <span className={`font-semibold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>{t("home.referBodyD")}</span>
          {t("home.referBodyE")}
        </p>
      </div>
      <Link
        href="/referrals"
        className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-primary/40 bg-primary/15 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/25"
      >
        <Gift className="h-4 w-4" /> {t("home.referCta")} <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
