import { useState } from "react";
import { Link } from "wouter";
import { Crosshair, ArrowRight, ArrowLeft, RefreshCw, Coins } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import type { IntelContext, NicheAnalysis, IntelPlatform } from "./types";
import { usePaidCall } from "./use-paid-call";
import {
  inputClass, labelClass, ghostButton,
  scoreColor, scoreBar, StepCard, StepFooter,
} from "./ui";

const COST = 150;

type ExperienceLevel = "beginner" | "intermediate" | "advanced";
type NichePlatform = IntelPlatform | "all";

interface StepProps {
  ctx: IntelContext;
  onPatchCtx: (p: Partial<IntelContext>) => void;
  result: NicheAnalysis | null;
  onResult: (r: NicheAnalysis | null) => void;
  onAdvance: () => void;
  onBack: () => void;
}

export default function StepNiche({ ctx, onPatchCtx, result, onResult, onAdvance, onBack }: StepProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { call, loading, error, outOfCredits } = usePaidCall();
  const [targetPlatform, setTargetPlatform] = useState<NichePlatform>(
    (["tiktok", "instagram", "youtube", "x"] as const).includes(ctx.platform as IntelPlatform) ? ctx.platform : "all"
  );
  const [experience, setExperience] = useState<ExperienceLevel>("beginner");
  const [editing, setEditing] = useState(!result);

  async function run() {
    const data = await call<{ analysis?: NicheAnalysis }>("/api/analyze-niche", {
      niche: ctx.niche.trim().slice(0, 120),
      targetPlatform,
      experienceLevel: experience,
    });
    if (data?.analysis && data.analysis.contentPillars?.length) {
      onResult(data.analysis);
      setEditing(false);
      setTimeout(() => {
        document.getElementById("intel-step-3")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }

  const PLATFORM_OPTS: { id: NichePlatform; label: string }[] = [
    { id: "all", label: t("contentIntelligence.nicheAllPlatforms") },
    { id: "tiktok", label: "TikTok" },
    { id: "instagram", label: "Instagram" },
    { id: "youtube", label: "YouTube" },
    { id: "x", label: "X" },
  ];

  return (
    <StepCard
      id="intel-step-3"
      stepNumber={3}
      icon={Crosshair}
      eyebrow={t("contentIntelligence.step3Eyebrow")}
      title={t("contentIntelligence.step3Title")}
      blurb={t("contentIntelligence.step3Blurb")}
      done={!!result && !editing}
      doneSummary={
        result ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className={`font-display text-2xl font-black ${scoreColor(100 - result.competitionLevel.score)}`}>
              {result.competitionLevel.label}
            </span>
            <span className="text-sm text-white/55">{result.niche}</span>
            <button
              onClick={() => setEditing(true)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-bold text-white/60 transition hover:border-primary/50 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("contentIntelligence.editRerun")}
            </button>
          </div>
        ) : undefined
      }
    >
      {(!result || editing) && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label className={labelClass} htmlFor="intel-niche-3">{t("contentIntelligence.nicheLabel")}</label>
              <input
                id="intel-niche-3"
                value={ctx.niche}
                onChange={(e) => onPatchCtx({ niche: e.target.value })}
                maxLength={120}
                placeholder={t("contentIntelligence.nichePlaceholder")}
                className={inputClass}
              />
            </div>
            <div>
              <p className={labelClass}>{t("contentIntelligence.nichePlatformLabel")}</p>
              <div className="flex flex-wrap gap-2">
                {PLATFORM_OPTS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setTargetPlatform(p.id)}
                    className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                      targetPlatform === p.id
                        ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                        : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className={labelClass}>{t("contentIntelligence.experienceLabel")}</p>
              <div className="flex flex-wrap gap-2">
                {(["beginner", "intermediate", "advanced"] as const).map((e) => (
                  <button
                    key={e}
                    onClick={() => setExperience(e)}
                    className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                      experience === e
                        ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                        : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    {t(`contentIntelligence.experience.${e}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {user ? (
            <StepFooter
              costNote={t("contentIntelligence.costNote", { cost: COST })}
              loading={loading}
              loadingLabel={t("contentIntelligence.analyzingNiche")}
              ctaLabel={t("contentIntelligence.step3Cta")}
              ctaIcon={Crosshair}
              onRun={run}
              error={error}
              outOfCredits={outOfCredits}
              disabled={ctx.niche.trim().length < 2}
            />
          ) : (
            <p className="mt-6 text-center text-sm text-white/50">
              <Link href="/login" className="font-bold text-primary hover:underline">
                {t("contentIntelligence.signIn")}
              </Link>{" "}
              {t("contentIntelligence.signInSuffix")}
            </p>
          )}
        </>
      )}

      {result && !editing && (
        <div className="mt-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("contentIntelligence.competitionLevel")}
              </p>
              <div className="mt-2 flex items-center gap-3">
                <p className={`font-display text-3xl font-black ${scoreColor(100 - result.competitionLevel.score)}`}>
                  {result.competitionLevel.score}
                </p>
                <span className="rounded-full border border-white/15 px-3 py-1 text-xs font-bold text-white/70">
                  {result.competitionLevel.label}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${scoreBar(100 - result.competitionLevel.score)}`}
                  style={{ width: `${result.competitionLevel.score}%` }}
                />
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("contentIntelligence.audienceTitle")}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/75">{result.audienceProfile.demographics}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {result.audienceProfile.interests.map((i, k) => (
                  <span key={k} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-white/60">
                    {i}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {result.contentGaps.length > 0 && (
            <>
              <p className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("contentIntelligence.underservedAngles")}
              </p>
              <div className="grid gap-2.5">
                {result.contentGaps.slice(0, 3).map((g, i) => (
                  <div key={i} className="rounded-2xl border border-primary/25 bg-primary/[0.05] p-4">
                    <p className="text-sm font-bold text-white">{g.angle}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-white/60">{g.opportunity}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {result.monetizationPaths.length > 0 && (
            <>
              <p className="mb-3 mt-6 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
                <Coins className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                {t("contentIntelligence.moneyPaths")}
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {result.monetizationPaths.slice(0, 4).map((m, i) => (
                  <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-white">{m.path}</p>
                      <span className={`text-sm font-black ${scoreColor(m.fitScore)}`}>{m.fitScore}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-white/50">{m.firstStep}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="mt-4 text-sm italic leading-relaxed text-white/45">{result.summary}</p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-5 py-2.5 text-sm font-bold text-white/60 transition hover:border-white/40 hover:text-white">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t("contentIntelligence.back")}
            </button>
            <button onClick={onAdvance} className={ghostButton}>
              {t("contentIntelligence.continueCompetitor")}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </StepCard>
  );
}
