import { useState } from "react";
import { Link } from "wouter";
import {
  FileCheck2, ScrollText, CalendarClock, FolderPlus, Share2, Check,
  Copy, Loader2, ArrowUpRight, Sparkles, ExternalLink,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useHubProject } from "@/lib/hub-project";
import type { IntelContext, IntelResults, IntelPlatform } from "./types";
import { INTEL_PLATFORM_LABELS } from "./types";
import { ghostButton, sectionTitle } from "./ui";

/* ─── Content Intelligence — plan review ─────────────────────────────────
   The brief: validated idea, winning hook, niche verdict, 3 competitor
   gaps, and the 7-day launch week. Handoffs: Script Writer, Scheduler,
   save-to-project, and a public share link (/plan/:slug) with the
   creator's ?ref=CODE attached — shares earn referral credit. */

interface PlanReviewProps {
  ctx: IntelContext;
  results: IntelResults;
}

function scrollToStep(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const SCRIPT_PLATFORM: Record<IntelPlatform, string> = {
  youtube: "youtube",
  tiktok: "tiktok",
  instagram: "reels",
  x: "tiktok",
};

export default function PlanReview({ ctx, results }: PlanReviewProps) {
  const { t } = useTranslation();
  const { user, profile, getAccessToken } = useAuth();
  const { addAsset } = useHubProject();

  const [saved, setSaved] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [includeCredit, setIncludeCredit] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const gaps = (results.competitor?.opportunities ?? []).slice(0, 3);
  const launchWeek = (results.calendar ?? []).slice(0, 7);
  const hasCore = !!(ctx.idea && ctx.hook);

  const scriptHref =
    `/script-writer?topic=${encodeURIComponent(ctx.idea.slice(0, 300))}` +
    `&audience=${encodeURIComponent(ctx.audience.slice(0, 200))}` +
    `&platform=${SCRIPT_PLATFORM[ctx.platform]}` +
    `&hook=${encodeURIComponent(ctx.hook.slice(0, 600))}`;

  const schedulerCaption = `${ctx.hook}\n\n${ctx.idea}`.slice(0, 400);
  /* Scheduler deep-link protocol: ?schedule=1&caption=… auto-opens the
     composer with the caption prefilled. */
  const schedulerHref = `/scheduler?schedule=1&caption=${encodeURIComponent(schedulerCaption)}`;

  function planText(withCredit: boolean): string {
    const lines = [
      `CONTENT PLAN — ${ctx.idea}`,
      `Niche: ${ctx.niche} · Platform: ${INTEL_PLATFORM_LABELS[ctx.platform]}`,
      ctx.audience ? `Audience: ${ctx.audience}` : "",
      "",
      `VALIDATED IDEA (${results.validate?.verdict ?? "—"} · ${results.validate?.overallScore ?? "—"}/100)`,
      results.validate?.summary ?? "",
      "",
      `WINNING HOOK (${results.hook?.overallScore ?? "—"}/10)`,
      `“${ctx.hook}”`,
      "",
      `NICHE VERDICT`,
      results.niche ? `${results.niche.competitionLevel.label} (competition ${results.niche.competitionLevel.score}/100) — ${results.niche.summary}` : "—",
      "",
      `COMPETITOR GAPS`,
      ...gaps.map((g, i) => `${i + 1}. ${g.gap} — ${g.howToExploit}`),
      "",
      `7-DAY LAUNCH WEEK`,
      ...launchWeek.filter((d) => d.post).map((d) => `· ${d.dayLabel} — ${d.title} (${d.platform}, ${d.bestTime})`),
      "",
      withCredit ? "Made with Bow Down Visuals — bowdownvisuals.com" : "",
    ].filter((l) => l !== undefined);
    return lines.join("\n");
  }

  function saveToProject() {
    if (!hasCore || saved) return;
    addAsset({
      kind: "other",
      url: `data:text/plain;charset=utf-8,${encodeURIComponent(planText(includeCredit))}`,
      label: `Content Plan · ${ctx.idea.slice(0, 40)}`,
      detail: results.validate?.summary || ctx.hook.slice(0, 80),
      meta: {
        idea: ctx.idea.slice(0, 200),
        hook: ctx.hook.slice(0, 200),
        niche: ctx.niche.slice(0, 80),
        platform: ctx.platform,
        gaps: gaps.map((g) => g.gap).join(" | ").slice(0, 300),
      },
    });
    setSaved(true);
  }

  async function publishPlan() {
    if (publishing || !user) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const token = await getAccessToken();
      // Referral code for the share link — shares earn 25% of referee purchases for 90 days.
      let refCode = "";
      try {
        const refRes = await fetch("/api/referrals/me", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const refData = (await refRes.json().catch(() => ({}))) as { code?: string };
        if (refRes.ok && refData.code) refCode = refData.code;
      } catch {
        /* referral lookup failed — share without it */
      }
      const creatorName =
        profile?.display_name?.trim() || (user.email ? user.email.split("@")[0] : "") || "Anonymous Creator";
      const res = await fetch("/api/content-plans/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title: ctx.idea.slice(0, 120) || t("contentIntelligence.planFallbackTitle"),
          creatorName: creatorName.slice(0, 60),
          includeCredit,
          plan: {
            idea: ctx.idea.slice(0, 500),
            niche: ctx.niche.slice(0, 120),
            platform: ctx.platform,
            audience: ctx.audience.slice(0, 200),
            verdict: results.validate?.verdict ?? "",
            overallScore: results.validate?.overallScore,
            hook: ctx.hook.slice(0, 600),
            hookScore: results.hook?.overallScore,
            nicheVerdict: results.niche?.summary.slice(0, 200) ?? "",
            competitionLabel: results.niche?.competitionLevel.label ?? "",
            gaps: gaps.map((g) => ({ gap: g.gap, howToExploit: g.howToExploit })),
            days: launchWeek.map((d) => ({
              date: d.date,
              dayLabel: d.dayLabel,
              post: d.post,
              title: d.title,
              format: d.format,
              platform: d.platform,
              hook: d.hook,
              bestTime: d.bestTime,
            })),
            summary: results.validate?.summary.slice(0, 600) ?? "",
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { slug?: string; error?: string; message?: string };
      if (!res.ok || !data.slug) throw new Error(data.message || data.error || t("contentIntelligence.shareFailed"));
      const url = `${window.location.origin}/plan/${data.slug}${refCode ? `?ref=${refCode}` : ""}`;
      setShareUrl(url);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : t("contentIntelligence.shareFailed"));
    } finally {
      setPublishing(false);
    }
  }

  async function copyShare() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <section id="intel-plan" className="relative scroll-mt-24 overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-b from-[#171208] to-black">
      <div className="p-6 md:p-8">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary bg-primary/15 text-primary">
            <FileCheck2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary/80">
              {t("contentIntelligence.reviewEyebrow")}
            </p>
            <h3 className="mt-1 text-xl font-black text-white md:text-2xl">{t("contentIntelligence.reviewTitle")}</h3>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-white/55">{t("contentIntelligence.reviewBlurb")}</p>
          </div>
        </div>

        {/* ── the brief ── */}
        <div className="mt-6 grid gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className={sectionTitle}>{t("contentIntelligence.briefIdea")}</p>
            <p className="text-[15px] font-bold leading-relaxed text-white">“{ctx.idea || "—"}”</p>
            {results.validate && (
              <p className="mt-2 text-sm text-white/55">
                <span className="font-black uppercase tracking-widest text-primary">{results.validate.verdict}</span>
                {" · "}{results.validate.overallScore}/100 — {results.validate.summary}
              </p>
            )}
            <button onClick={() => scrollToStep("intel-step-1")} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary/80 hover:underline">
              {t("contentIntelligence.traceValidation")} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="rounded-2xl border border-primary/25 bg-primary/[0.05] p-5">
            <p className={sectionTitle}>{t("contentIntelligence.briefHook")}</p>
            <p className="text-[15px] font-bold leading-relaxed text-white">“{ctx.hook || "—"}”</p>
            {results.hook && (
              <p className="mt-2 text-sm text-white/55">
                {t("contentIntelligence.hookScoreLabel", { score: results.hook.overallScore })} — {results.hook.verdict}
              </p>
            )}
            <button onClick={() => scrollToStep("intel-step-2")} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary/80 hover:underline">
              {t("contentIntelligence.traceHook")} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className={sectionTitle}>{t("contentIntelligence.briefNiche")}</p>
              {results.niche ? (
                <>
                  <p className="text-sm font-bold text-white">
                    {results.niche.niche} · {results.niche.competitionLevel.label}
                  </p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">{results.niche.summary}</p>
                </>
              ) : (
                <p className="text-sm text-white/40">{t("contentIntelligence.notRunYet", { step: 3 })}</p>
              )}
              <button onClick={() => scrollToStep("intel-step-3")} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary/80 hover:underline">
                {t("contentIntelligence.viewStep", { step: 3 })} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className={sectionTitle}>{t("contentIntelligence.briefGaps")}</p>
              {gaps.length > 0 ? (
                <ul className="grid gap-2">
                  {gaps.map((g, i) => (
                    <li key={i} className="text-[13px] leading-relaxed text-white/70">
                      <span className="font-black text-primary">{i + 1}. </span>{g.gap}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-white/40">{t("contentIntelligence.notRunYet", { step: 4 })}</p>
              )}
              <button onClick={() => scrollToStep("intel-step-4")} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary/80 hover:underline">
                {t("contentIntelligence.viewStep", { step: 4 })} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className={sectionTitle}>
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              {t("contentIntelligence.briefWeek")}
            </p>
            {launchWeek.some((d) => d.post) ? (
              <div className="grid gap-2">
                {launchWeek.map((d) => (
                  <div key={d.date} className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-black/40 p-3">
                    <span className="w-20 shrink-0 text-[11px] font-bold uppercase tracking-widest text-white/40">
                      {d.dayLabel}
                    </span>
                    {d.post ? (
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{d.title}</p>
                        {d.hook && <p className="mt-0.5 text-xs italic text-primary/75">“{d.hook}”</p>}
                        <p className="mt-1 text-[11px] text-white/35 capitalize">
                          {d.platform}{d.format ? ` · ${d.format}` : ""}{d.bestTime ? ` · ${d.bestTime}` : ""}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs italic text-white/30">{t("contentIntelligence.restDay")}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/40">{t("contentIntelligence.notRunYet", { step: 5 })}</p>
            )}
            <button onClick={() => scrollToStep("intel-step-5")} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary/80 hover:underline">
              {t("contentIntelligence.viewStep", { step: 5 })} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* ── handoffs ── */}
        <p className="mb-3 mt-8 text-[11px] font-bold uppercase tracking-widest text-white/40">
          {t("contentIntelligence.handoffsTitle")}
        </p>
        {hasCore ? (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              href={scriptHref}
              className="group rounded-2xl border border-primary/40 bg-primary/10 p-4 text-left transition hover:bg-primary/20"
            >
              <p className="flex items-center justify-between text-sm font-bold text-white">
                <span className="flex items-center gap-2">
                  <ScrollText className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t("contentIntelligence.toScriptWriter")}
                </span>
                <ArrowUpRight className="h-4 w-4 text-primary transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
              </p>
              <p className="mt-1 text-xs text-white/45">{t("contentIntelligence.toScriptWriterHint")}</p>
            </Link>
            <Link
              href={schedulerHref}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/50"
            >
              <p className="flex items-center justify-between text-sm font-bold text-white">
                <span className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t("contentIntelligence.toScheduler")}
                </span>
                <ArrowUpRight className="h-4 w-4 text-primary transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
              </p>
              <p className="mt-1 text-xs text-white/45">{t("contentIntelligence.toSchedulerHint")}</p>
            </Link>
            <button
              onClick={saveToProject}
              disabled={saved}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/50 disabled:opacity-60"
            >
              <p className="flex items-center justify-between text-sm font-bold text-white">
                <span className="flex items-center gap-2">
                  {saved ? (
                    <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  ) : (
                    <FolderPlus className="h-4 w-4 text-primary" aria-hidden="true" />
                  )}
                  {saved ? t("contentIntelligence.savedToProject") : t("contentIntelligence.saveToProject")}
                </span>
              </p>
              <p className="mt-1 text-xs text-white/45">{t("contentIntelligence.saveToProjectHint")}</p>
            </button>
            <button
              onClick={() => { setShareOpen(true); setShareUrl(null); setPublishError(null); }}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/50"
            >
              <p className="flex items-center justify-between text-sm font-bold text-white">
                <span className="flex items-center gap-2">
                  <Share2 className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t("contentIntelligence.sharePlan")}
                </span>
              </p>
              <p className="mt-1 text-xs text-white/45">{t("contentIntelligence.sharePlanHint")}</p>
            </button>
          </div>
        ) : (
          <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
            {t("contentIntelligence.handoffsLocked")}
          </p>
        )}

        {/* ── share dialog ── */}
        {shareOpen && (
          <div className="mt-4 rounded-2xl border border-primary/30 bg-black/60 p-5">
            {!shareUrl ? (
              <>
                <p className="flex items-center gap-2 text-sm font-bold text-white">
                  <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t("contentIntelligence.shareTitle")}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
                  {t("contentIntelligence.shareBlurb")}
                </p>
                <button
                  onClick={() => setIncludeCredit((v) => !v)}
                  className="mt-4 flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-primary/40"
                  aria-pressed={includeCredit}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                      includeCredit ? "border-primary bg-primary text-black" : "border-white/25 text-transparent"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="text-sm text-white/75">{t("contentIntelligence.creditLineOption")}</span>
                </button>
                {publishError && (
                  <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    {publishError}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2.5">
                  <button onClick={publishPlan} disabled={publishing} className={ghostButton}>
                    {publishing ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Share2 className="h-4 w-4" aria-hidden="true" />
                    )}
                    {publishing ? t("contentIntelligence.publishing") : t("contentIntelligence.publishShare")}
                  </button>
                  <button
                    onClick={() => setShareOpen(false)}
                    className="rounded-2xl border border-white/15 px-6 py-3 text-sm font-bold text-white/60 transition hover:border-white/40 hover:text-white"
                  >
                    {t("contentIntelligence.cancel")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                  <Check className="h-4 w-4" aria-hidden="true" />
                  {t("contentIntelligence.shareLive")}
                </p>
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-black/60 p-2 pl-4">
                  <p className="min-w-0 flex-1 truncate text-sm text-primary">{shareUrl}</p>
                  <button
                    onClick={copyShare}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-black text-black transition hover:brightness-110"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                    {copied ? t("contentIntelligence.copied") : t("contentIntelligence.copyLink")}
                  </button>
                </div>
                <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-relaxed text-white/45">
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {t("contentIntelligence.shareEarns")}
                </p>
                <button
                  onClick={() => setShareOpen(false)}
                  className="mt-3 rounded-2xl border border-white/15 px-6 py-2.5 text-sm font-bold text-white/60 transition hover:border-white/40 hover:text-white"
                >
                  {t("contentIntelligence.done")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
