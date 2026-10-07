import { useEffect } from "react";
import { Link } from "wouter";
import {
  Scale, Copyright, GraduationCap, ArrowRight, Sparkles,
  ShieldCheck, BadgeDollarSign, BookOpen, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarketingBadge } from "@/components/MarketingBadge";

/* ─── Guides & Services ─────────────────────────────────────────────────
   The business side of being a creator — free-to-read guides:
   LLC formation, copyright registration, and the Creator Academy.
   Pure interface: no AI compute here, so everything is FREE. */

const GUIDES = [
  { href: "/llc-guide", icon: Scale, key: "llc" },
  { href: "/copyright", icon: Copyright, key: "copyright" },
  { href: "/academy", icon: GraduationCap, key: "academy" },
] as const;

export default function Guides() {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = t("guides.pageTitle");
  }, [t]);

  return (
    <div className="min-h-screen bg-black text-white">

      {/* ── HERO ── */}
      <section className="max-w-3xl mx-auto px-5 md:px-8 pt-16 pb-12 text-center">
        <MarketingBadge variant="kicker" className="mb-5 px-4 py-1.5">
          {t("guides.badge")}
        </MarketingBadge>
        <h1 className="text-5xl md:text-6xl font-black text-white tracking-tight mb-5 leading-[0.92]">
          {t("guides.heroLine1")}
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-primary to-yellow-300">
            {t("guides.heroLine2")}
          </span>
        </h1>
        <p className="text-white/50 text-xl max-w-2xl mx-auto leading-relaxed">
          {t("guides.heroSub")}
        </p>
      </section>

      {/* ── GUIDE CARDS ── */}
      <section className="max-w-6xl mx-auto px-5 md:px-8 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {GUIDES.map((g) => (
            <Link key={g.href} href={g.href}>
              <div className="group relative rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:border-primary/40 hover:bg-gradient-to-b hover:from-primary/[0.08] hover:to-transparent transition-all p-6 flex flex-col h-full cursor-pointer hover:shadow-[0_0_60px_rgba(218,165,32,0.12)]">
                <div className="flex items-start justify-between mb-5">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center">
                    <g.icon className="h-6 w-6 text-primary" />
                  </div>
                  <MarketingBadge variant="free">
                    <Sparkles className="h-2.5 w-2.5" /> {t(`guides.${g.key}.badge`)}
                  </MarketingBadge>
                </div>

                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary/80 mb-1.5">
                  {t(`guides.${g.key}.tagline`)}
                </p>
                <h2 className="text-xl font-bold text-white mb-2.5">{t(`guides.${g.key}.name`)}</h2>
                <p className="text-sm text-white/55 leading-relaxed mb-5">
                  {t(`guides.${g.key}.description`)}
                </p>

                <div className="space-y-2 flex-1 mb-6">
                  {[1, 2, 3, 4].map((i) => {
                    const b = t(`guides.${g.key}.bullet${i}`);
                    return (
                      <div key={b} className="flex items-start gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                        <span className="text-sm text-white/70">{b}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 text-sm font-bold text-primary group-hover:gap-3 transition-all">
                  {t("guides.openGuide")} <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* ── WHY IT MATTERS ── */}
        <div className="mt-14 rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.07] to-transparent p-8 md:p-10">
          <div className="flex items-center gap-2.5 mb-4">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h3 className="text-xl font-bold text-white">{t("guides.whyTitle")}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-white/60 leading-relaxed">
            <div>
              <p className="font-bold text-white mb-1.5 flex items-center gap-1.5">
                <BadgeDollarSign className="h-4 w-4 text-primary" /> {t("guides.whyBrandTitle")}
              </p>
              {t("guides.whyBrandBody")}
            </div>
            <div>
              <p className="font-bold text-white mb-1.5 flex items-center gap-1.5">
                <Copyright className="h-4 w-4 text-primary" /> {t("guides.whyRegTitle")}
              </p>
              {t("guides.whyRegBody")}
            </div>
            <div>
              <p className="font-bold text-white mb-1.5 flex items-center gap-1.5">
                <BookOpen className="h-4 w-4 text-primary" /> {t("guides.whySkillTitle")}
              </p>
              {t("guides.whySkillBody")}
            </div>
          </div>
        </div>

        {/* ── DISCLAIMER ── */}
        <p className="text-center text-xs text-white/25 max-w-2xl mx-auto mt-8 flex items-start justify-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {t("guides.disclaimer")}
        </p>
      </section>


    </div>
  );
}
