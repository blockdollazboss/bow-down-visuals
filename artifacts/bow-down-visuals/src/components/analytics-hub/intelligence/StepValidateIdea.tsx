import { useState } from "react";
import { Link } from "wouter";
import { Lightbulb, ArrowRight, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import type { IntelContext, ValidateVerdict, IntelPlatform } from "./types";
import { INTEL_PLATFORMS, INTEL_PLATFORM_LABELS } from "./types";
import { usePaidCall } from "./use-paid-call";
import {
  inputClass, labelClass, ghostButton,
  ScoreRow, StepCard, StepFooter,
} from "./ui";

const COST = 75;

interface StepProps {
  ctx: IntelContext;
  onPatchCtx: (p: Partial<IntelContext>) => void;
  result: ValidateVerdict | null;
  onResult: (r: ValidateVerdict | null) => void;
  onAdvance: () => void;
}

function verdictBadge(verdict: ValidateVerdict["verdict"]): string {
  if (verdict === "go") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (verdict === "pivot") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-red-500/40 bg-red-500/10 text-red-300";
}

export default function StepValidateIdea({ ctx, onPatchCtx, result, onResult, onAdvance }: StepProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { call, loading, error, outOfCredits } = usePaidCall();
  const [editing, setEditing] = useState(!result);

  async function run() {
    const idea = ctx.idea.trim().slice(0, 500);
    const niche = ctx.niche.trim().slice(0, 100);
    const data = await call<{ verdict?: ValidateVerdict }>("/api/validate-idea", {
      idea,
      niche,
      platform: ctx.platform,
      targetAudience: ctx.audience.trim().slice(0, 200),
    });
    if (data?.verdict && data.verdict.overallScore != null) {
      onResult(data.verdict);
      setEditing(false);
      setTimeout(() => {
        document.getElementById("intel-step-1")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }

  function chooseIdea(text: string) {
    onPatchCtx({ idea: text.trim().slice(0, 500) });
  }

  return (
    <StepCard
      id="intel-step-1"
      stepNumber={1}
      icon={Lightbulb}
      eyebrow={t("contentIntelligence.step1Eyebrow")}
      title={t("contentIntelligence.step1Title")}
      blurb={t("contentIntelligence.step1Blurb")}
      done={!!result && !editing}
      doneSummary={
        result ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-widest ${verdictBadge(result.verdict)}`}>
              {t(`contentIntelligence.verdict.${result.verdict}`)}
            </span>
            <span className="font-display text-2xl font-black text-white">{result.overallScore}</span>
            <span className="text-sm text-white/55">“{ctx.idea}”</span>
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
          <div className="grid gap-4">
            <div>
              <label className={labelClass} htmlFor="intel-idea">{t("contentIntelligence.ideaLabel")}</label>
              <textarea
                id="intel-idea"
                value={ctx.idea}
                onChange={(e) => onPatchCtx({ idea: e.target.value })}
                maxLength={500}
                rows={3}
                placeholder={t("contentIntelligence.ideaPlaceholder")}
                className={inputClass}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="intel-niche">{t("contentIntelligence.nicheLabel")}</label>
                <input
                  id="intel-niche"
                  value={ctx.niche}
                  onChange={(e) => onPatchCtx({ niche: e.target.value })}
                  maxLength={100}
                  placeholder={t("contentIntelligence.nichePlaceholder")}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="intel-audience">{t("contentIntelligence.audienceLabel")}</label>
                <input
                  id="intel-audience"
                  value={ctx.audience}
                  onChange={(e) => onPatchCtx({ audience: e.target.value })}
                  maxLength={200}
                  placeholder={t("contentIntelligence.audiencePlaceholder")}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <p className={labelClass}>{t("contentIntelligence.platformLabel")}</p>
              <div className="flex flex-wrap gap-2">
                {INTEL_PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onPatchCtx({ platform: p.id as IntelPlatform })}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      ctx.platform === p.id
                        ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                        : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    {t(p.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {user ? (
            <StepFooter
              costNote={t("contentIntelligence.costNote", { cost: COST })}
              loading={loading}
              loadingLabel={t("contentIntelligence.validating")}
              ctaLabel={t("contentIntelligence.step1Cta")}
              ctaIcon={Lightbulb}
              onRun={run}
              error={error}
              outOfCredits={outOfCredits}
              disabled={ctx.idea.trim().length < 5 || ctx.niche.trim().length < 2}
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
          <p className={`${"mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80"}`}>
            {t("contentIntelligence.scoreBreakdown")}
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <ScoreRow label={result.scores.virality.label} score={result.scores.virality.score} reasoning={result.scores.virality.reasoning} />
            <ScoreRow label={result.scores.competition.label} score={result.scores.competition.score} reasoning={result.scores.competition.reasoning} />
            <ScoreRow label={result.scores.audienceFit.label} score={result.scores.audienceFit.score} reasoning={result.scores.audienceFit.reasoning} />
          </div>
          <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-[15px] leading-relaxed text-white/90">
            <span className="font-bold text-primary">{t("contentIntelligence.verdictLabel")}: </span>
            {result.summary}
          </p>

          {result.pivots.length > 0 && (
            <>
              <p className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("contentIntelligence.pickFinalIdea")}
              </p>
              <div className="grid gap-2.5">
                {result.pivots.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => chooseIdea(p.angle)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      ctx.idea === p.angle
                        ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                        : "border-white/10 bg-white/[0.03] hover:border-primary/40"
                    }`}
                  >
                    <p className="text-sm font-bold text-white">{p.angle}</p>
                    <p className="mt-1 text-xs leading-relaxed text-white/50">{p.whyItWorks}</p>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="mt-6 text-center">
            <p className="mb-3 text-xs text-white/40">
              {t("contentIntelligence.lockedIdea")}: <span className="font-semibold text-white/70">“{ctx.idea || "—"}”</span>
            </p>
            <button onClick={onAdvance} className={ghostButton}>
              {t("contentIntelligence.continueHook")}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {!user && !result && (
        <p className="mt-2 text-center text-xs text-white/30">
          {t("contentIntelligence.platformNote", { platform: INTEL_PLATFORM_LABELS[ctx.platform] })}
        </p>
      )}
    </StepCard>
  );
}
