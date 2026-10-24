import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ─── PricingSwitcher (Phase 3) ───────────────────────────────────────────
   /pricing (Visual Bucs credit packs) and /creator-pricing (Creator Plans)
   are two different products that both answer to "pricing" — and neither
   page used to mention the other. This shared switcher sits on both: the
   pill names the product you're on, and the caption points at the other
   door. No prices or products change — wayfinding only. */

export function PricingSwitcher({ active }: { active: "credits" | "plans" }) {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();

  const pill = (isActive: boolean) =>
    `rounded-full px-4 py-2 text-sm font-bold transition ${
      isActive
        ? "bg-gradient-to-r from-amber-400 to-yellow-500 text-black"
        : isLight
          ? "text-[#6B5B36] hover:text-[#2A1E07]"
          : "text-white/55 hover:text-white"
    }`;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`inline-flex gap-1 rounded-full border p-1 ${isLight ? "border-[#C9A84C]/40 bg-[#F7ECD2]/80" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
        role="tablist"
        aria-label="Pricing"
      >
        <Link href="/pricing" role="tab" aria-selected={active === "credits"} className={pill(active === "credits")}>
          {t("pricingSwitcher.credits", { defaultValue: "Credit Packs" })}
        </Link>
        <Link href="/creator-pricing" role="tab" aria-selected={active === "plans"} className={pill(active === "plans")}>
          {t("pricingSwitcher.plans", { defaultValue: "Creator Plans" })}
        </Link>
      </div>
      <p className={`text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        {active === "credits"
          ? t("pricingSwitcher.creditsCaption", { defaultValue: "Creator Plans add your own domain, unlimited products and AI boosts — that's the subscription side." })
          : t("pricingSwitcher.plansCaption", { defaultValue: "Need credits right now? Credit Packs top up your Visual Bucs." })}
      </p>
    </div>
  );
}
