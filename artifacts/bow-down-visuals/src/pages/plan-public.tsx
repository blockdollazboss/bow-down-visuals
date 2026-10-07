import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Loader2, ArrowRight, CalendarClock, Zap, Crosshair, Swords, Eye, Crown } from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";

/* ─── Public content plan ─────────────────────────────────────────────────
   The shareable plan page at /plan/:slug. No auth required — this is what
   anyone opening a creator's shared Content Intelligence plan sees:
   validated idea, winning hook, niche verdict, competitor gaps, 7-day
   launch week. Indexable (SEO-friendly clean URL); the creator's ?ref=
   code rides on the share link for referral credit. */

interface PlanDay {
  date: string;
  dayLabel: string;
  post: boolean;
  title: string;
  format: string;
  platform: string;
  hook: string;
  bestTime: string;
}

interface SharedPlan {
  idea?: string;
  niche?: string;
  platform?: string;
  audience?: string;
  verdict?: string;
  overallScore?: number;
  hook?: string;
  hookScore?: number;
  nicheVerdict?: string;
  competitionLabel?: string;
  gaps?: { gap: string; howToExploit: string }[];
  days?: PlanDay[];
  summary?: string;
}

interface PlanPayload {
  slug: string;
  title: string;
  plan: SharedPlan;
  creatorName: string;
  includeCredit: boolean;
  views: number;
  createdAt: string;
}

export default function PlanPublic() {
  const { t } = useTranslation();
  const [, params] = useRoute("/plan/:slug");
  const slug = params?.slug ?? "";
  const [payload, setPayload] = useState<PlanPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) { setNotFound(true); setLoading(false); return; }
    fetch(`/api/content-plans/p/${encodeURIComponent(slug)}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((d) => {
        if (d?.plan) setPayload(d as PlanPayload);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const plan = payload?.plan;
  usePageTitle(
    payload ? `${payload.title} — Content Plan | Bow Down Visuals` : "Content Plan | Bow Down Visuals",
    payload && plan
      ? `${plan.idea || payload.title} — a content plan by ${payload.creatorName}: validated idea, winning hook, niche verdict, competitor gaps, and a 7-day launch week.`
      : "A creator's content plan — validated idea, winning hook, niche analysis, and launch calendar."
  );

  const jsonLd = payload && plan ? {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: payload.title,
    description: plan.summary || plan.idea || payload.title,
    author: { "@type": "Person", name: payload.creatorName },
    datePublished: payload.createdAt,
  } : null;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  if (notFound || !payload || !plan) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-black px-5 text-center">
        <p className="font-display text-2xl font-black text-white">{t("planPublic.notFoundTitle")}</p>
        <p className="mt-2 text-sm text-white/50">{t("planPublic.notFoundBody")}</p>
        <Link href="/" className="mt-6 rounded-2xl bg-primary px-6 py-3 text-sm font-black text-black">
          {t("planPublic.backHome")}
        </Link>
      </div>
    );
  }

  const gaps = plan.gaps ?? [];
  const days = (plan.days ?? []).filter((d) => d.post);

  return (
    <div className="min-h-screen bg-black text-white">
      {jsonLd && <JsonLd data={jsonLd} />}
      <main className="relative mx-auto max-w-3xl px-5 pb-24 pt-14 md:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[260px] w-[520px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Crown className="h-3 w-3" aria-hidden="true" /> {t("planPublic.badge")}
          </p>
          <h1 className="font-display text-3xl font-black tracking-tight md:text-4xl">“{plan.idea || payload.title}”</h1>
          <p className="mt-3 text-sm text-white/50">
            {t("planPublic.byCreator", { name: payload.creatorName })}
            {plan.niche ? ` · ${plan.niche}` : ""}
            {plan.platform ? ` · ${plan.platform}` : ""}
          </p>
          <p className="mt-1 flex items-center justify-center gap-1 text-xs text-white/30">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" /> {payload.views}
          </p>
        </div>

        <div className="relative mt-10 grid gap-4">
          {plan.verdict && (
            <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-[#14100a] to-black p-6">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-primary/80">{t("planPublic.validatedIdea")}</p>
              <p className="text-lg font-black uppercase tracking-widest text-white">
                {plan.verdict}
                {typeof plan.overallScore === "number" ? <span className="text-primary"> · {plan.overallScore}/100</span> : ""}
              </p>
              {plan.summary && <p className="mt-2 text-sm leading-relaxed text-white/60">{plan.summary}</p>}
            </div>
          )}

          {plan.hook && (
            <div className="rounded-3xl border border-primary/25 bg-primary/[0.05] p-6">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                <Zap className="h-3.5 w-3.5" aria-hidden="true" /> {t("planPublic.winningHook")}
              </p>
              <p className="text-lg font-bold leading-relaxed text-white">“{plan.hook}”</p>
              {typeof plan.hookScore === "number" && (
                <p className="mt-2 text-sm text-white/55">{t("planPublic.hookScore", { score: plan.hookScore })}</p>
              )}
            </div>
          )}

          {(plan.nicheVerdict || plan.competitionLabel) && (
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                <Crosshair className="h-3.5 w-3.5" aria-hidden="true" /> {t("planPublic.nicheVerdict")}
              </p>
              {plan.competitionLabel && <p className="text-base font-black text-white">{plan.competitionLabel}</p>}
              {plan.nicheVerdict && <p className="mt-1.5 text-sm leading-relaxed text-white/60">{plan.nicheVerdict}</p>}
            </div>
          )}

          {gaps.length > 0 && (
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <p className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                <Swords className="h-3.5 w-3.5" aria-hidden="true" /> {t("planPublic.competitorGaps")}
              </p>
              <div className="grid gap-2.5">
                {gaps.map((g, i) => (
                  <div key={i} className="rounded-2xl border border-primary/25 bg-primary/[0.05] p-4">
                    <p className="text-sm font-bold text-white">{g.gap}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-white/60">{g.howToExploit}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {days.length > 0 && (
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <p className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {t("planPublic.launchWeek")}
              </p>
              <div className="grid gap-2">
                {days.map((d) => (
                  <div key={d.date} className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-black/40 p-3">
                    <span className="w-20 shrink-0 text-[11px] font-bold uppercase tracking-widest text-white/40">{d.dayLabel}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{d.title}</p>
                      {d.hook && <p className="mt-0.5 text-xs italic text-primary/75">“{d.hook}”</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {payload.includeCredit && (
          <p className="relative mt-10 text-center text-sm text-white/40">
            {t("planPublic.madeWithStart")}{" "}
            <Link href="/" className="font-bold text-primary hover:underline">Bow Down Visuals</Link>
          </p>
        )}

        <div className="relative mt-6 rounded-3xl border border-primary/30 bg-gradient-to-b from-[#171208] to-black p-6 text-center md:p-8">
          <p className="font-display text-xl font-black text-white md:text-2xl">{t("planPublic.ctaTitle")}</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/55">{t("planPublic.ctaBody")}</p>
          <Link
            href="/analytics-hub?tab=intelligence"
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-base font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95"
          >
            {t("planPublic.ctaButton")}
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
      </main>
    </div>
  );
}
